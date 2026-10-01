<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { getAttachmentDownloadURL, getUserByID, searchDirectory } from 'combox-api'
import type { AuthUser, ChatInviteLink, ChatItem, ChatMemberProfile, LocalProfile, SavedTrack, SearchUserResult } from 'combox-api'
import { normalizeAvatarSrc } from './chatUtils'
import { openAvatarPreview } from '../../utils/avatarViewer'
import { avatarColorFor } from '../../utils/avatarColor'
import { useChatPlayback, formatPlayerTime } from '../../composables/useChatPlayback'
import {
  getPlaylistAttachmentId,
  isLocalPlaylistUrl,
  isPermanentAttachmentError,
  resolvePlaylistTrackUrl,
} from '../../utils/playlistAttachment'
import type { ViewMessage } from './chatTypes'
const GroupEditPanel = defineAsyncComponent(() => import('./GroupEditPanel.vue'))
import ChannelPanel from './PublicChannelPanel.vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { yieldToMain } from './yieldToMain'
import { getSharedMediaLazyQueue } from './mediaLazyQueue'
import { preloadAndDecodeImage } from './mediaPreload'

const props = defineProps<{
  open: boolean
  selectedChat: ChatItem | null
  subtitle: string
  currentUser: AuthUser | null
  localProfile: LocalProfile | null
  peerProfile: { username?: string; first_name?: string; last_name?: string; email?: string; birth_date?: string; avatar_data_url?: string } | null
  focusedUserProfile: { id?: string; username?: string; first_name?: string; last_name?: string; email?: string; birth_date?: string; avatar_data_url?: string } | null
  chatMembers: ChatMemberProfile[]
  removedChatMembers: ChatMemberProfile[]
  selectedChatInviteLinks: ChatInviteLink[]
  messages: ViewMessage[]
  directPeerId: string
  mutedChatIDs: Record<string, boolean>
}>()

const emit = defineEmits<{
  close: []
  saveGroupProfile: [payload: {
    title: string
    avatarDataUrl?: string | null
    commentsEnabled?: boolean
    reactionsEnabled?: boolean
    isPublic?: boolean
    publicSlug?: string | null
    onSuccess: () => void
    onError: (message: string) => void
  }]
  addMembers: [memberIDs: string[]]
  updateMemberRole: [payload: { userID: string; role: 'member' | 'moderator' | 'admin' | 'subscriber' | 'banned' }]
  removeMember: [userID: string]
  leaveChat: [payload: { onSuccess: () => void; onError: (message: string) => void }]
  subscribeChannel: []
  unsubscribeChannel: []
  createInviteLink: [title?: string]
  openDirectChat: [userID: string]
  toggleMuteChat: []
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
  chatUpdated: [chat: ChatItem]
}>()

const { t } = useI18n()
const toast = useToast()

type InfoTab = 'media' | 'files' | 'links' | 'members' | 'manage'

const activeTab = ref<InfoTab>(props.selectedChat?.is_direct || (props.selectedChat?.kind || '').trim() === 'saved' ? 'media' : 'members')
const manageMembers = ref(false)
const manageQuery = ref('')
const manageResults = ref<SearchUserResult[]>([])
const manageBusy = ref(false)
let manageSearchTimer: number | null = null
const rootRef = ref<HTMLElement | null>(null)
const bottomSentinelRef = ref<HTMLElement | null>(null)
const panelReady = ref(false)
let panelReadyTimer: number | null = null
let moreIO: IntersectionObserver | null = null

// Must be initialized before any immediate watchers run (TDZ-safe).
const mediaQueue = getSharedMediaLazyQueue()
const mediaTileElById = new Map<string, HTMLElement>()
const mediaTileCleanupById = new Map<string, () => void>()
let mediaTileEpoch = 0
let infoScrollEl: HTMLElement | null = null
let infoScrollUnlockTimer: number | null = null

function onInfoScroll() {
  mediaQueue.lock()
  if (infoScrollUnlockTimer) window.clearTimeout(infoScrollUnlockTimer)
  infoScrollUnlockTimer = window.setTimeout(() => {
    infoScrollUnlockTimer = null
    mediaQueue.unlock()
  }, 140)
}
const activeProfile = computed(() => props.focusedUserProfile || props.peerProfile)
const isUserInfoMode = computed(() => Boolean(props.focusedUserProfile?.id))
/**
 * Saved Messages self-chat (backend chat kind 'saved'): a service chat, not a
 * group — no GroupEdit/settings, no members/manage tabs, no participants
 * subtitle. The backend already rejects member ops for it, so the panel must
 * not offer them (no dead buttons).
 */
const isSavedChat = computed(() => (props.selectedChat?.kind || '').trim() === 'saved')
const isGroupMode = computed(() => Boolean(props.selectedChat && !props.selectedChat.is_direct && !isUserInfoMode.value && !isSavedChat.value))
const infoTitle = computed(() => {
  if (isUserInfoMode.value) return t('chat.contact_info', undefined, 'Contact info')
  if (isGroupMode.value) return t('chat.group_info')
  return t('chat.chat_info', undefined, 'Chat info')
})

const { state: playback, activate, toggle: togglePlayback } = useChatPlayback()

const profileUserID = computed(() => {
  if (isUserInfoMode.value) return (props.focusedUserProfile?.id || '').trim()
  if (props.selectedChat?.is_direct) return (props.directPeerId || '').trim()
  return ''
})

const profilePlaylistPublic = ref(true)
const profilePlaylistResolved = ref(false)

const showProfilePlaylist = computed(() => {
  if (!profileUserID.value) return false
  if (!(isUserInfoMode.value || Boolean(props.selectedChat?.is_direct))) return false
  // Empty playlist never renders (own or foreign): no "0" count, no empty placeholder.
  // Hide while resolving/loading too so a 0-count row never flashes.
  if (!profilePlaylistResolved.value || profileTracksLoading.value) return false
  if (profileTracks.value.length === 0) return false
  return profilePlaylistPublic.value
})

const profileTracks = ref<SavedTrack[]>([])
const profileTracksLoading = ref(false)
let profileTracksToken = 0

function sanitizeTracks(list: unknown): SavedTrack[] {
  if (!Array.isArray(list)) return []
  return list.filter(
    (track) => track && typeof track === 'object' && typeof track.id === 'string' && typeof track.title === 'string',
  )
}

async function loadProfileTracks() {
  const id = profileUserID.value
  profilePlaylistResolved.value = false
  profilePlaylistPublic.value = true
  if (!props.open || !id) {
    profileTracksToken += 1
    profileTracks.value = []
    profileTracksLoading.value = false
    profilePlaylistResolved.value = true
    return
  }

  const token = ++profileTracksToken
  const ownID = (props.currentUser?.id || '').trim()
  if (ownID && id === ownID) {
    profileTracks.value = sanitizeTracks(props.currentUser?.saved_tracks)
    profileTracksLoading.value = false
    profilePlaylistPublic.value = true
    profilePlaylistResolved.value = true
    return
  }

  profileTracksLoading.value = true
  try {
    const user = await getUserByID(id)
    if (token !== profileTracksToken) return
    profileTracks.value = sanitizeTracks(user.saved_tracks)
    profilePlaylistPublic.value = user.playlist_is_public !== false
    profilePlaylistResolved.value = true
  } catch {
    if (token !== profileTracksToken) return
    profileTracks.value = []
    profilePlaylistResolved.value = true
  } finally {
    if (token === profileTracksToken) profileTracksLoading.value = false
  }
}

function isProfileTrackCurrent(track: SavedTrack): boolean {
  return playback.currentId === track.id
}

function isProfileTrackPlaying(track: SavedTrack): boolean {
  return playback.currentId === track.id && playback.playing
}

const profileUnavailableIds = ref<Record<string, true>>({})

function isProfileTrackUnavailable(track: SavedTrack): boolean {
  return Boolean(profileUnavailableIds.value[track.id])
}

async function playProfileTrack(track: SavedTrack) {
  if (playback.currentId === track.id) {
    togglePlayback()
    return
  }
  if (isProfileTrackUnavailable(track)) {
    toast.error(t('player.track_unavailable', undefined, 'This track is no longer available and cannot be played'))
    return
  }
  const storedUrl = (track.fileUrl || '').trim()
  if (isLocalPlaylistUrl(storedUrl) && !getPlaylistAttachmentId(track)) {
    toast.error(t('player.no_url', undefined, 'No playable source for this track'))
    return
  }
  try {
    const resolved = await resolvePlaylistTrackUrl(track)
    const next = { ...profileUnavailableIds.value }
    if (next[track.id]) {
      delete next[track.id]
      profileUnavailableIds.value = next
    }
    await activate({
      id: track.id,
      url: resolved.url,
      title: track.title,
      artist: (track.artist || '').trim(),
      durationMs: (track.duration || 0) * 1000,
      poster: '',
    })
  } catch (error) {
    if (isPermanentAttachmentError(error) || (error instanceof Error && (error.message === 'no_source' || error.message === 'attachment_not_found'))) {
      profileUnavailableIds.value = { ...profileUnavailableIds.value, [track.id]: true }
      toast.error(t('player.track_unavailable', undefined, 'This track is no longer available and cannot be played'))
    } else {
      toast.error(t('player.play_failed', undefined, 'Could not play this track'))
    }
  }
}

watch(
  () => [props.open, profileUserID.value] as const,
  () => {
    void loadProfileTracks()
  },
  { immediate: true },
)

watch(
  () => props.selectedChat?.id,
  () => {
    activeTab.value = props.selectedChat?.is_direct || (props.selectedChat?.kind || '').trim() === 'saved' ? 'media' : 'members'
    manageMembers.value = false
    resetManageSearch()
  },
)

watch(manageQuery, (query) => {
  if (manageSearchTimer) window.clearTimeout(manageSearchTimer)
  const clean = query.trim()
  if (clean.length < 2) {
    manageResults.value = []
    manageBusy.value = false
    return
  }
  manageBusy.value = true
  manageSearchTimer = window.setTimeout(async () => {
    try {
      const found = await searchDirectory({ q: clean, scope: 'users', limit: 20 })
      manageResults.value = Array.isArray(found.users) ? found.users : []
    } catch {
      manageResults.value = []
    } finally {
      manageBusy.value = false
    }
  }, 220)
})

watch(
  () => props.open,
  (open) => {
    if (panelReadyTimer) {
      window.clearTimeout(panelReadyTimer)
      panelReadyTimer = null
    }

    manageMembers.value = false
    resetManageSearch()

    if (!open) {
      panelReady.value = false
      cleanupMediaTileObservers()
      return
    }

    // Let the resize animation start first, then mount/heavy-work.
    panelReady.value = false
    // Don't decode/download while the panel is resizing.
    mediaQueue.lockFor(260)
    panelReadyTimer = window.setTimeout(() => {
      panelReady.value = true
    }, 220)
  },
  { immediate: true },
)

watch(
  () => panelReady.value,
  (ready) => {
    if (!ready) return
    if (!props.open) return

    if (pendingMediaFileRebuild && (activeTab.value === 'media' || activeTab.value === 'files')) {
      pendingMediaFileRebuild = false
      void rebuildDerivedLists(props.messages)
    }

    if (activeTab.value === 'links') {
      void rebuildLinks(props.messages)
    }

    resetVisible(activeTab.value)
    void nextTick(() => attachMoreObserver())
  },
)

const displayName = computed(() => {
  const peerName = `${(activeProfile.value?.first_name || '').trim()} ${(activeProfile.value?.last_name || '').trim()}`.trim()
  return peerName || (props.selectedChat?.title || t('chat.title'))
})
const avatarSrc = computed(() => normalizeAvatarSrc(activeProfile.value?.avatar_data_url || props.selectedChat?.avatar_data_url || ''))

// The fullscreen gallery lazy-loads the history of whatever the hero shows:
// a group / channel owns its own archive, while a direct chat and a focused
// profile show a person's archive.
const heroGalleryOwner = computed(() => {
  if (isGroupMode.value) {
    const chatID = (props.selectedChat?.id || '').trim()
    return chatID ? { ownerId: chatID, ownerKind: 'chat' as const } : undefined
  }
  const userID = profileUserID.value
  return userID ? { ownerId: userID, ownerKind: 'user' as const } : undefined
})
const usernameLine = computed(() => {
  const peerRaw = (activeProfile.value || {}) as Record<string, unknown>
  const nested = ((peerRaw.profile as Record<string, unknown> | undefined) || {}) as Record<string, unknown>
  const fromProfile =
    (typeof peerRaw.username === 'string' ? peerRaw.username : '') ||
    (typeof peerRaw.user_name === 'string' ? peerRaw.user_name : '') ||
    (typeof nested.username === 'string' ? nested.username : '') ||
    (typeof nested.user_name === 'string' ? nested.user_name : '')
  const fromTitle = (props.selectedChat?.title || '').trim().replace(/^@+/, '')
  const value = fromProfile.trim() || (fromTitle.includes(' ') ? '' : fromTitle)
  return value ? `@${value}` : '-'
})
const birthday = computed(() => {
  const peerRaw = (activeProfile.value || {}) as Record<string, unknown>
  const nested = ((peerRaw.profile as Record<string, unknown> | undefined) || {}) as Record<string, unknown>
  const raw = (
    (typeof peerRaw.birth_date === 'string' ? peerRaw.birth_date : '') ||
    (typeof peerRaw.birthDate === 'string' ? peerRaw.birthDate : '') ||
    (typeof nested.birth_date === 'string' ? nested.birth_date : '') ||
    (typeof nested.birthDate === 'string' ? nested.birthDate : '')
  ).trim()
  // Empty birthday hides the row entirely (never render "-").
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
})
const memberItems = ref<
  Array<{ id: string; role: string; joinedAt: string; username: string; displayName: string; avatarSrc: string }>
>([])
const mediaItems = ref<
  Array<{ id: string; src: string; fullSrc: string; kind: 'image' | 'video'; alt: string; filename: string }>
>([])
const fileItems = ref<Array<{ id: string; name: string; kind: string; url?: string }>>([])
const linkItems = ref<string[]>([])

const visibleMemberCount = ref(0)
const visibleMediaCount = ref(0)
const visibleFileCount = ref(0)
const visibleLinkCount = ref(0)

let rebuildToken = 0
let linkToken = 0
let pendingMediaFileRebuild = false

const mediaThumbLoaded = reactive<Record<string, boolean>>({})

watch(
  () => props.chatMembers,
  (members) => {
    memberItems.value = members.map((member) => {
      const profile = member.profile
      const fullName = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim()
      return {
        id: member.user_id,
        role: (member.role || 'member').trim() || 'member',
        joinedAt: member.joined_at || '',
        username: profile?.username || '',
        displayName: fullName || profile?.username || member.user_id,
        avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
      }
    })
  },
  { immediate: true },
)

function collectMediaAndFiles(messages: ViewMessage[]) {
  const media: Array<{ id: string; src: string; fullSrc: string; kind: 'image' | 'video'; alt: string; filename: string }> = []
  const files: Array<{ id: string; name: string; kind: string; url?: string }> = []

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    for (const attachment of message.attachments) {
      if (attachment.kind === 'image' || attachment.kind === 'video') {
        const src = attachment.previewUrl || attachment.url
        if (!src) continue
        media.push({
          id: attachment.id,
          src,
          fullSrc: attachment.url || attachment.previewUrl,
          kind: attachment.kind,
          alt: attachment.filename || attachment.kind,
          filename: attachment.filename || '',
        })
        continue
      }
      files.push({
        id: attachment.id,
        name: attachment.filename || 'file',
        kind: attachment.kind || 'file',
        url: attachment.url,
      })
    }
    if (media.length >= 160 && files.length >= 160) break
  }

  mediaItems.value = media.slice(0, 120)
  fileItems.value = files.slice(0, 120)

  // Reset loaded flags for new collection.
  for (const key of Object.keys(mediaThumbLoaded)) delete mediaThumbLoaded[key]
  cleanupMediaTileObservers()
}

async function rebuildDerivedLists(messages: ViewMessage[]) {
  const my = ++rebuildToken

  // Yield once so the open/resize animation can start first.
  await yieldToMain()
  if (my !== rebuildToken) return

  collectMediaAndFiles(messages)
}

watch(
  () => [props.open, activeTab.value, props.messages] as const,
  ([open, tab, messages]) => {
    // Media and Files are the heavy tabs because of thumbnails. Don't even prepare their lists
    // unless the user actually opens the tab.
    if (!open || !panelReady.value || (tab !== 'media' && tab !== 'files')) {
      pendingMediaFileRebuild = true
      return
    }
    pendingMediaFileRebuild = false
    void rebuildDerivedLists(messages)
  },
  { immediate: true },
)

async function rebuildLinks(messages: ViewMessage[]) {
  const my = ++linkToken
  await yieldToMain()
  if (my !== linkToken) return

  const seen = new Set<string>()
  const found: string[] = []
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)\b/gi

  // Chunk to avoid long tasks.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    for (const match of (message.text || '').matchAll(re)) {
      const raw = (match[1] || '').trim()
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      if (!url || seen.has(url)) continue
      seen.add(url)
      found.push(url)
      if (found.length >= 200) break
    }
    if (found.length >= 200) break
    if (i % 40 === 0) {
      await yieldToMain()
      if (my !== linkToken) return
    }
  }

  linkItems.value = found
}

watch(
  () => [props.open, activeTab.value, props.messages] as const,
  ([open, tab, messages]) => {
    if (!open || !panelReady.value || tab !== 'links') return
    void rebuildLinks(messages)
  },
  { immediate: true },
)

function growVisible(tab: InfoTab) {
  const step = 24
  if (tab === 'members' || tab === 'manage') visibleMemberCount.value = Math.min(memberItems.value.length, visibleMemberCount.value + step)
  if (tab === 'media') visibleMediaCount.value = Math.min(mediaItems.value.length, visibleMediaCount.value + step)
  if (tab === 'files') visibleFileCount.value = Math.min(fileItems.value.length, visibleFileCount.value + step)
  if (tab === 'links') visibleLinkCount.value = Math.min(linkItems.value.length, visibleLinkCount.value + step)
}

function resetVisible(tab: InfoTab) {
  const step = 24
  if (tab === 'members' || tab === 'manage') visibleMemberCount.value = Math.min(step, memberItems.value.length)
  if (tab === 'media') visibleMediaCount.value = Math.min(step, mediaItems.value.length)
  if (tab === 'files') visibleFileCount.value = Math.min(step, fileItems.value.length)
  if (tab === 'links') visibleLinkCount.value = Math.min(step, linkItems.value.length)
}

function attachMoreObserver() {
  if (moreIO) {
    moreIO.disconnect()
    moreIO = null
  }
  if (!props.open || !panelReady.value) return
  if (!rootRef.value || !bottomSentinelRef.value) return

  moreIO = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (!entry?.isIntersecting) return
      growVisible(activeTab.value)
    },
    { root: rootRef.value, rootMargin: '700px 0px', threshold: 0.01 },
  )

  moreIO.observe(bottomSentinelRef.value)
}

onMounted(() => {
  attachMoreObserver()

  // Pause media decode/loading while the panel is actively scrolling (tweb-like).
  infoScrollEl = rootRef.value
  infoScrollEl?.addEventListener('scroll', onInfoScroll, { passive: true })
})

onBeforeUnmount(() => {
  if (panelReadyTimer) window.clearTimeout(panelReadyTimer)
  panelReadyTimer = null
  if (manageSearchTimer) window.clearTimeout(manageSearchTimer)
  manageSearchTimer = null
  if (moreIO) moreIO.disconnect()
  moreIO = null
  if (infoScrollEl) infoScrollEl.removeEventListener('scroll', onInfoScroll)
  infoScrollEl = null
  if (infoScrollUnlockTimer) window.clearTimeout(infoScrollUnlockTimer)
  infoScrollUnlockTimer = null
  mediaQueue.unlock()
  cleanupMediaTileObservers()
})

watch(
  () => [props.open, activeTab.value] as const,
  ([open, tab]) => {
    if (!open) return

    if (pendingMediaFileRebuild && (tab === 'media' || tab === 'files')) {
      pendingMediaFileRebuild = false
      void rebuildDerivedLists(props.messages)
    }

    resetVisible(tab)
    void nextTick(() => attachMoreObserver())
  },
  { immediate: true },
)

function onMediaThumbLoad(id: string) {
  mediaThumbLoaded[id] = true
}

function cleanupMediaTileObservers() {
  mediaTileEpoch += 1
  for (const cleanup of mediaTileCleanupById.values()) {
    try {
      cleanup()
    } catch {
      // ignore
    }
  }
  mediaTileCleanupById.clear()
  mediaTileElById.clear()
}

function setMediaTileRef(id: string, el: Element | null) {
  const next = (el as HTMLElement | null) || null
  const prev = mediaTileElById.get(id)
  if (prev && prev === next) return

  const prevCleanup = mediaTileCleanupById.get(id)
  if (prevCleanup) {
    prevCleanup()
    mediaTileCleanupById.delete(id)
  }

  if (!next) {
    mediaTileElById.delete(id)
    return
  }

  mediaTileElById.set(id, next)
  const item = mediaItems.value.find((x) => x.id === id)
  if (!item) return

  const epoch = mediaTileEpoch
  const cleanup = mediaQueue.observe({
    target: next,
    load: async () => {
      if (mediaThumbLoaded[id]) return
      await preloadAndDecodeImage(item.src)
      if (epoch !== mediaTileEpoch) return
      if (!props.open || activeTab.value !== 'media') return
      if (!next.isConnected) return
      window.requestAnimationFrame(() => {
        if (epoch !== mediaTileEpoch) return
        mediaThumbLoaded[id] = true
      })
    },
  })

  mediaTileCleanupById.set(id, cleanup)
}

// Avoid function-refs in v-for (can create unstable pending ref jobs). Use a directive instead.
const vMediaTile = {
  mounted(el: Element, binding: { value: string }) {
    const id = (binding.value || '').trim()
    if (!id) return
    setMediaTileRef(id, el)
  },
  updated(el: Element, binding: { value: string; oldValue?: string }) {
    const prev = (binding.oldValue || '').trim()
    const next = (binding.value || '').trim()
    if (prev && prev !== next) setMediaTileRef(prev, null)
    if (next) setMediaTileRef(next, el)
  },
  unmounted(_el: Element, binding: { value: string }) {
    const id = (binding.value || '').trim()
    if (!id) return
    setMediaTileRef(id, null)
  },
}
const currentGroupRole = computed(() => {
  if (isStandaloneChannel.value) return ((props.selectedChat?.viewer_role || '').trim().toLowerCase())
  if (props.selectedChat?.is_direct) return ''
  const currentUserID = (props.currentUser?.id || '').trim()
  if (!currentUserID) return ''
  const ownMember = props.chatMembers.find((item) => item.user_id === currentUserID)
  const memberRole = (ownMember?.role || '').trim().toLowerCase()
  return memberRole || ((props.selectedChat?.viewer_role || '').trim().toLowerCase())
})
const canManageGroup = computed(() => currentGroupRole.value === 'owner' || currentGroupRole.value === 'admin' || currentGroupRole.value === 'moderator')
const isStandaloneChannel = computed(() => (props.selectedChat?.kind || '').trim() === 'standalone_channel')
const canViewChannelMembers = computed(() => {
  if (!isStandaloneChannel.value) return true
  return currentGroupRole.value === 'owner' || currentGroupRole.value === 'admin'
})
const basePublicSubscriberCount = computed(() => Number(props.selectedChat?.subscriber_count || props.chatMembers.length || 0))
// L6: rows migrated by the boxchat ETL may carry role 'member', which is not
// a valid standalone_channel role but still means "subscribed" — the backend
// normalizes it to 'subscriber' on subscribe, the client must already treat
// it as subscribed so the button reads Unsubscribe.
const serverSubscribedToChannel = computed(() => {
  if (!isStandaloneChannel.value) return false
  return ['owner', 'admin', 'subscriber', 'member'].includes(currentGroupRole.value)
})
// Optimistic toggle for the inline subscribe button below (the ChannelPanel
// above handles its own tile): flip instantly, the parent's server patch
// confirms it through props, otherwise roll back with a toast.
const channelSubscribePending = ref<boolean | null>(null)
const channelSubscribeDelta = ref(0)
let channelSubscribeTimer: number | null = null
const isSubscribedToChannel = computed(() => channelSubscribePending.value ?? serverSubscribedToChannel.value)
const publicSubscriberCount = computed(() => Math.max(0, basePublicSubscriberCount.value + channelSubscribeDelta.value))
function clearChannelSubscribeOptimism() {
  channelSubscribePending.value = null
  channelSubscribeDelta.value = 0
  if (channelSubscribeTimer !== null) {
    window.clearTimeout(channelSubscribeTimer)
    channelSubscribeTimer = null
  }
}
watch([serverSubscribedToChannel, basePublicSubscriberCount], ([server]) => {
  if (channelSubscribePending.value !== null && server === channelSubscribePending.value) clearChannelSubscribeOptimism()
})
function onToggleChannelSubscribe() {
  if (channelSubscribePending.value !== null) return
  const next = !isSubscribedToChannel.value
  channelSubscribePending.value = next
  channelSubscribeDelta.value = next ? 1 : -1
  emit(next ? 'subscribeChannel' : 'unsubscribeChannel')
  channelSubscribeTimer = window.setTimeout(() => {
    if (channelSubscribePending.value === null) return
    const failed = channelSubscribePending.value
    clearChannelSubscribeOptimism()
    toast.error(failed
      ? t('chat.subscribe_failed', undefined, 'Could not subscribe')
      : t('chat.unsubscribe_failed', undefined, 'Could not unsubscribe'))
  }, 8000)
}

watch(
  () => [props.open, activeTab.value, isGroupMode.value, canManageGroup.value, isSavedChat.value] as const,
  ([open, tab, group, canManage, saved]) => {
    if (open && saved && (tab === 'manage' || tab === 'members')) activeTab.value = 'media'
    else if (open && tab === 'manage' && (!group || !canManage)) activeTab.value = 'members'
  },
  { immediate: true },
)

const manageCandidates = computed(() => {
  const existing = new Set(props.chatMembers.map((item) => item.user_id))
  const ownID = (props.currentUser?.id || '').trim()
  return manageResults.value.filter((user) => !existing.has(user.id) && user.id !== ownID)
})

function resultAvatarSrc(user: SearchUserResult): string {
  return normalizeAvatarSrc(user.avatar_data_url || '')
}

function canManageMember(item: { id: string; role: string }): boolean {
  if (!canManageGroup.value) return false
  if (item.role === 'owner') return false
  const ownID = (props.currentUser?.id || '').trim()
  return Boolean(ownID) && item.id !== ownID
}

function memberRoleActionLabel(role: string): string {
  return role === 'admin'
    ? t('chat.demote_admin', undefined, 'Make member')
    : t('chat.promote_admin', undefined, 'Make admin')
}

function toggleMemberRole(item: { id: string; role: string }) {
  if (!canManageMember(item)) return
  emit('updateMemberRole', { userID: item.id, role: item.role === 'admin' ? 'member' : 'admin' })
}

function addManagedMember(user: SearchUserResult) {
  emit('addMembers', [user.id])
  manageQuery.value = ''
  manageResults.value = []
}

function resetManageSearch() {
  if (manageSearchTimer) window.clearTimeout(manageSearchTimer)
  manageSearchTimer = null
  manageQuery.value = ''
  manageResults.value = []
  manageBusy.value = false
}

async function downloadAttachment(attachmentID: string, filename: string, fallbackURL?: string) {
  let href = (fallbackURL || '').trim()
  let name = (filename || '').trim() || 'file'
  try {
    const payload = await getAttachmentDownloadURL(attachmentID)
    if (payload.url) href = payload.url
    if (payload.filename?.trim()) name = payload.filename.trim()
  } catch {
    // fallback to current url
  }
  if (!href) return
  const trigger = (url: string) => {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.rel = 'noreferrer'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  try {
    const response = await fetch(href)
    if (!response.ok) throw new Error('download_failed')
    const blob = await response.blob()
    const objectURL = URL.createObjectURL(blob)
    trigger(objectURL)
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
  } catch {
    trigger(href)
  }
}

function openGroupSettings() {
  if (isSavedChat.value) return
  if (props.selectedChat?.is_direct) return
  if (activeTab.value !== 'manage') activeTab.value = 'members'
  manageMembers.value = !manageMembers.value
  void nextTick(() => {
    rootRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}
</script>

<template>
  <aside v-show="open" ref="rootRef" class="ipRoot">
    <ChannelPanel
      v-if="selectedChat && isStandaloneChannel"
      :selected-chat="selectedChat"
      :subtitle="subtitle"
      :current-user="currentUser"
      :chat-members="chatMembers"
      :removed-chat-members="removedChatMembers"
      :invite-links="selectedChatInviteLinks"
      :muted="Boolean(mutedChatIDs[selectedChat.id])"
      @close="emit('close')"
      @save-profile="emit('saveGroupProfile', $event)"
      @update-member-role="emit('updateMemberRole', $event)"
      @remove-member="emit('removeMember', $event)"
      @subscribe="emit('subscribeChannel')"
      @unsubscribe="emit('unsubscribeChannel')"
      @create-invite-link="emit('createInviteLink', $event)"
      @open-direct-chat="emit('openDirectChat', $event)"
      @toggle-mute="emit('toggleMuteChat')"
    />
    <template v-else>
    <GroupEditPanel
      v-if="manageMembers && !selectedChat?.is_direct && canManageGroup && !isSavedChat"
      :selected-chat="selectedChat"
      :current-user="currentUser"
      :chat-members="chatMembers"
      :removed-chat-members="removedChatMembers"
      :invite-links="selectedChatInviteLinks"
      @save-profile="emit('saveGroupProfile', $event)"
      @leave-chat="emit('leaveChat', $event)"
      @close="manageMembers = false"
      @add-members="emit('addMembers', $event)"
      @update-member-role="emit('updateMemberRole', $event)"
      @remove-member="emit('removeMember', $event)"
      @create-invite-link="emit('createInviteLink', $event)"
      @chat-updated="emit('chatUpdated', $event)"
    />
    <template v-else>
    <div class="ipHeader">
      <div class="ipHeaderLeft">
        <button type="button" class="ipIconBtn" :aria-label="t('chat.close')" @click="emit('close')">
          <v-icon icon="mdi-close" size="18" />
        </button>
        <div class="ipTitle">{{ infoTitle }}</div>
      </div>
      <div class="ipHeaderActions">
        <button v-if="!selectedChat?.is_direct && canManageGroup && !isSavedChat" type="button" class="ipIconBtn" :aria-label="t('chat.group_settings')" @click="openGroupSettings">
          <v-icon :icon="manageMembers ? 'mdi-cog' : 'mdi-cog-outline'" size="18" />
        </button>
      </div>
    </div>

    <div class="ipHero">
      <div
            v-if="avatarSrc"
            class="ipHeroAvatar ipHeroAvatar--btn"
            role="button"
            tabindex="0"
            :aria-label="t('chat.preview_avatar', undefined, 'View avatar')"
            @click="openAvatarPreview(avatarSrc, displayName, heroGalleryOwner)"
            @keydown.enter.prevent="openAvatarPreview(avatarSrc, displayName, heroGalleryOwner)"
          >
            <img class="ipAvatarImg" :src="avatarSrc" alt="" />
          </div>
          <div v-else-if="isSavedChat" class="ipHeroAvatarFallback ipHeroAvatarSaved" aria-hidden="true">
            <svg class="ipSavedGlyph" viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
          </div>
          <div v-else class="ipHeroAvatarFallback" :style="{ background: avatarColorFor(selectedChat?.id || displayName) }">{{ displayName.slice(0, 1).toUpperCase() }}</div>
      <div class="ipName">{{ displayName }}</div>
      <div v-if="subtitle && !isSavedChat" class="ipSubtitle">{{ subtitle }}</div>
    </div>

    <div v-if="selectedChat?.is_direct || isUserInfoMode" class="ipMetaSection">
      <div class="ipMetaRow">
        <v-icon icon="mdi-at" size="18" class="ipMetaIcon" />
        <div>
          <div class="ipMetaValue">{{ usernameLine }}</div>
          <div class="ipMetaLabel">{{ t('chat.username') }}</div>
        </div>
      </div>
      <div v-if="birthday" class="ipMetaRow">
        <v-icon icon="mdi-calendar-month-outline" size="18" class="ipMetaIcon" />
        <div>
          <div class="ipMetaValue">{{ birthday }}</div>
          <div class="ipMetaLabel">{{ t('chat.birthday') }}</div>
        </div>
      </div>
    </div>

    <div v-if="showProfilePlaylist" class="ipPlaylistSection">
      <div class="ipPlaylistHead">
        <v-icon icon="mdi-music-note" size="18" class="ipPlaylistIcon" />
        <span class="ipPlaylistTitle">{{ t('chat.playlist', undefined, 'Playlist') }}</span>
        <span class="ipPlaylistCount">{{ profileTracks.length }}</span>
      </div>

      <div v-if="profileTracks.length > 0">
        <button
          v-for="track in profileTracks"
          :key="track.id"
          type="button"
          class="ipTrackItem"
          :class="{ active: isProfileTrackCurrent(track), unavailable: isProfileTrackUnavailable(track) }"
          @click="playProfileTrack(track)"
        >
          <span class="ipTrackPlay">
            <v-icon :icon="isProfileTrackPlaying(track) ? 'mdi-pause' : 'mdi-play'" size="16" />
          </span>
          <span class="ipTrackMain">
            <span class="ipTrackTitle">{{ track.title }}</span>
            <span v-if="track.artist" class="ipTrackArtist">{{ track.artist }}</span>
            <span v-if="isProfileTrackUnavailable(track)" class="ipTrackUnavailable">{{ t('player.unavailable', undefined, 'Unavailable — the audio file was deleted') }}</span>
          </span>
          <span v-if="track.duration > 0" class="ipTrackTime">{{ formatPlayerTime(track.duration) }}</span>
        </button>
      </div>
    </div>

    <div class="ipTabs">
      <button
        v-if="!selectedChat?.is_direct && !isUserInfoMode && !isSavedChat"
        type="button"
        class="ipTab"
        :class="{ active: activeTab === 'members' }"
        @click="activeTab = 'members'"
      >
        {{ t('chat.members') }}
      </button>
      <button
        v-if="!selectedChat?.is_direct && !isUserInfoMode && canManageGroup && !isSavedChat"
        type="button"
        class="ipTab"
        :class="{ active: activeTab === 'manage' }"
        @click="activeTab = 'manage'"
      >
        {{ t('chat.manage') }}
      </button>
      <button type="button" class="ipTab" :class="{ active: activeTab === 'media' }" @click="activeTab = 'media'">{{ t('chat.media') }}</button>
      <button type="button" class="ipTab" :class="{ active: activeTab === 'files' }" @click="activeTab = 'files'">{{ t('chat.files_tab') }}</button>
      <button type="button" class="ipTab" :class="{ active: activeTab === 'links' }" @click="activeTab = 'links'">{{ t('chat.links') }}</button>
    </div>

    <div class="ipBody">
      <template v-if="panelReady">
      <div v-if="activeTab === 'members'" class="ipList">
        <div v-if="isStandaloneChannel" class="ipChannelSummary">
          <div class="ipChannelCount">
            <div class="ipChannelCountValue">{{ publicSubscriberCount }}</div>
            <div class="ipChannelCountLabel">{{ t('chat.subscribers', { count: publicSubscriberCount }, `${publicSubscriberCount} subscribers`) }}</div>
          </div>
          <button
            v-if="!canViewChannelMembers"
            type="button"
            class="ipSubscribeBtn"
            @click="onToggleChannelSubscribe"
          >
            {{ isSubscribedToChannel ? t('chat.unsubscribe', undefined, 'Unsubscribe') : t('chat.subscribe', undefined, 'Subscribe') }}
          </button>
        </div>
        <template v-if="canViewChannelMembers && memberItems.length > 0">
          <div v-for="item in memberItems.slice(0, visibleMemberCount)" :key="item.id" class="ipMemberItem">
            <div
              v-if="item.avatarSrc"
              class="ipMemberAvatar ipMemberAvatar--btn"
              role="button"
              tabindex="0"
              :aria-label="t('chat.preview_avatar', undefined, 'View avatar')"
              @click="openAvatarPreview(item.avatarSrc, item.displayName, { ownerId: item.id, ownerKind: 'user' })"
              @keydown.enter.prevent="openAvatarPreview(item.avatarSrc, item.displayName, { ownerId: item.id, ownerKind: 'user' })"
            >
              <img :src="item.avatarSrc" alt="" class="ipMemberAvatarImg" />
            </div>
            <div v-else class="ipMemberAvatar" :style="{ background: avatarColorFor(item.id) }">{{ item.displayName.slice(0, 1).toUpperCase() }}</div>
            <div class="ipMemberMain">
              <div class="ipMemberName">{{ item.displayName }}</div>
              <div class="ipMemberMeta">
                <span v-if="item.username">@{{ item.username }}</span>
                <span>{{ item.role }}</span>
              </div>
            </div>
          </div>
        </template>
        <div v-else-if="canViewChannelMembers" class="ipEmpty">{{ t('chat.no_participants') }}</div>
      </div>

      <div v-else-if="activeTab === 'manage'" class="ipList">
        <div class="ipManageBox">
          <div class="ipManageState">
            <span class="ipManageStateTitle">{{ t('chat.manage') }}</span>
            <button type="button" class="ipManageClose" @click="openGroupSettings">{{ t('chat.group_settings') }}</button>
          </div>
          <input v-model="manageQuery" class="ipManageInput" type="search" :placeholder="t('chat.add_participants')" />
          <div v-if="manageBusy" class="ipEmpty">{{ t('chat.searching') }}</div>
          <div v-else-if="manageQuery.trim().length >= 2 && manageCandidates.length === 0" class="ipEmpty">
            {{ t('chat.no_users_found', undefined, 'No users found') }}
          </div>
          <div v-else-if="manageCandidates.length > 0" class="ipManageResults">
            <button
              v-for="user in manageCandidates"
              :key="user.id"
              type="button"
              class="ipManageResult"
              @click="addManagedMember(user)"
            >
              <span class="ipMemberAvatar" :style="{ background: avatarColorFor(user.id) }">
                <img v-if="resultAvatarSrc(user)" :src="resultAvatarSrc(user)" alt="" class="ipMemberAvatarImg" />
                <template v-else>{{ (user.first_name || user.username || '?').slice(0, 1).toUpperCase() }}</template>
              </span>
              <span class="ipMemberMain">
                <span class="ipMemberName">{{ `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username }}</span>
                <span class="ipMemberMeta"><span v-if="user.username">@{{ user.username }}</span></span>
              </span>
            </button>
          </div>
        </div>
        <div v-for="item in memberItems.slice(0, visibleMemberCount)" :key="item.id" class="ipMemberItem">
          <div
            v-if="item.avatarSrc"
            class="ipMemberAvatar ipMemberAvatar--btn"
            role="button"
            tabindex="0"
            :aria-label="t('chat.preview_avatar', undefined, 'View avatar')"
            @click="openAvatarPreview(item.avatarSrc, item.displayName, { ownerId: item.id, ownerKind: 'user' })"
            @keydown.enter.prevent="openAvatarPreview(item.avatarSrc, item.displayName, { ownerId: item.id, ownerKind: 'user' })"
          >
            <img :src="item.avatarSrc" alt="" class="ipMemberAvatarImg" />
          </div>
          <div v-else class="ipMemberAvatar" :style="{ background: avatarColorFor(item.id) }">{{ item.displayName.slice(0, 1).toUpperCase() }}</div>
          <div class="ipMemberMain">
            <div class="ipMemberName">{{ item.displayName }}</div>
            <div class="ipMemberMeta">
              <span v-if="item.username">@{{ item.username }}</span>
              <span>{{ item.role }}</span>
            </div>
          </div>
          <div v-if="canManageMember(item)" class="ipMemberActions">
            <button type="button" class="ipRoleBtn" @click="toggleMemberRole(item)">{{ memberRoleActionLabel(item.role) }}</button>
            <button type="button" class="ipDangerBtn" @click="emit('removeMember', item.id)">{{ t('chat.remove') }}</button>
          </div>
        </div>
        <div v-if="memberItems.length === 0" class="ipEmpty">{{ t('chat.no_participants') }}</div>
      </div>

      <div v-else-if="activeTab === 'media'" class="ipMediaGrid">
        <template v-if="mediaItems.length > 0">
          <div
            v-for="item in mediaItems.slice(0, visibleMediaCount)"
            :key="item.id"
            class="ipMediaTile"
            :class="{ loaded: Boolean(mediaThumbLoaded[item.id]) }"
            v-media-tile="item.id"
          >
            <button
              type="button"
              class="ipMediaOpen"
              @click="item.kind === 'video' ? emit('openVideo', { attachmentID: item.id, src: item.fullSrc, poster: item.src, filename: item.filename }) : emit('openImage', item.fullSrc)"
            >
              <div class="ipMediaSkeleton" aria-hidden="true" />
              <img
                v-if="Boolean(mediaThumbLoaded[item.id])"
                :src="item.src"
                :alt="item.alt"
                class="ipMediaImg"
                loading="lazy"
                decoding="async"
                @load="onMediaThumbLoad(item.id)"
              />
            </button>
            <div v-if="item.kind === 'video'" class="ipVideoFlag">{{ t('chat.video_label') }}</div>
          </div>
        </template>
        <div v-else class="ipEmpty">{{ t('chat.no_media') }}</div>
      </div>

      <div v-else-if="activeTab === 'files'" class="ipList">
        <template v-if="fileItems.length > 0">
          <button v-for="item in fileItems.slice(0, visibleFileCount)" :key="item.id" type="button" class="ipFileItem" @click="downloadAttachment(item.id, item.name, item.url)">
            <div class="ipFileName">{{ item.name }}</div>
            <div class="ipFileKind">{{ item.kind }}</div>
          </button>
        </template>
        <div v-else class="ipEmpty">{{ t('chat.no_files') }}</div>
      </div>

      <div v-else class="ipList">
        <template v-if="linkItems.length > 0">
          <a v-for="item in linkItems.slice(0, visibleLinkCount)" :key="item" :href="item" target="_blank" rel="noreferrer" class="ipLinkItem">{{ item }}</a>
        </template>
        <div v-else class="ipEmpty">{{ t('chat.no_links') }}</div>
      </div>
      <div ref="bottomSentinelRef" class="ipBottomSentinel" aria-hidden="true" />
      </template>
      <template v-else>
        <div class="ipPanelSkeleton" aria-hidden="true">
          <div class="ipSkLine ipSkLine--lg" />
          <div class="ipSkLine" />
          <div class="ipSkLine" />
          <div class="ipSkLine ipSkLine--sm" />
        </div>
      </template>
    </div>
    </template>
    </template>
  </aside>
</template>

<style scoped>
.ipRoot {
  animation: uiDockIn 220ms cubic-bezier(0.2, 0.7, 0.3, 1);
  width: 100%;
  max-width: 100%;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  border-left: 1px solid var(--border);
  background: var(--surface-strong);
  height: 100%;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.ipRoot::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.ipHeader {
  min-height: 63px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
}

.ipHeaderLeft {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ipHeaderActions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ipTitle {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -.02em;
}

.ipIconBtn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.ipIconBtn:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.ipHero {
  padding: 12px 20px 10px;
  display: grid;
  justify-items: center;
  gap: 6px;
}

.ipHeroAvatar,
.ipHeroAvatarFallback {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  overflow: hidden;
}

.ipHeroAvatar--btn {
  cursor: pointer;
}

.ipAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ipHeroAvatarFallback {
  display: grid;
  place-items: center;
  background: var(--avatar-fallback);
  color: #fff;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -.02em;
}

/* Saved Messages badge: same gradient/glyph as the chat list row
 * (ChatSidebarChatsPane .cpAvatarSaved). Inline SVG on purpose —
 * mdi-bookmark-outline is NOT in the MDI subset font. No photo exists for
 * saved, so the hero badge is inert (no avatar preview). */
.ipHeroAvatarSaved {
  background: linear-gradient(135deg, #4a90d9 0%, #2f6cb3 100%);
  color: #fff;
}

.ipSavedGlyph {
  display: block;
}

.ipName {
  font-size: 17px;
  font-weight: 800;
  text-align: center;
  color: var(--text);
  line-height: 1.15;
  max-width: 260px;
}

.ipSubtitle {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.15;
}

.ipMetaSection {
  padding: 8px 20px 12px;
}

.ipMetaRow {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
}

.ipMetaIcon {
  margin-top: 2px;
  color: var(--text-muted);
}

.ipMetaValue {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.ipMetaLabel {
  font-size: 13px;
  color: var(--text-muted);
}

.ipPlaylistSection {
  padding: 4px 20px 14px;
  border-top: 1px solid var(--border);
}

.ipPlaylistHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 0 6px;
}

.ipPlaylistIcon {
  color: var(--link);
}

.ipPlaylistTitle {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}

.ipPlaylistCount {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.ipTrackItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 6px;
  margin: 0;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.ipTrackItem:hover {
  background: var(--surface-soft);
}

.ipTrackItem.active {
  background: var(--accent-soft);
}

.ipTrackPlay {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-soft);
  color: var(--text);
  flex: 0 0 auto;
}

.ipTrackItem.active .ipTrackPlay {
  background: var(--accent);
  color: #fff;
}

.ipTrackMain {
  display: grid;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}

.ipTrackTitle {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ipTrackArtist {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ipTrackUnavailable {
  font-size: 11px;
  font-weight: 700;
  color: #ef4444;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ipTrackItem.unavailable {
  opacity: 0.72;
}

.ipTrackTime {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.ipTabs {
  padding: 4px 16px 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px solid var(--border);
}

.ipTab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.ipTab.active {
  color: var(--link);
  background: var(--accent-soft);
}

.ipBody {
  padding: 14px 16px 20px;
}

.ipBottomSentinel {
  height: 1px;
}

.ipPanelSkeleton {
  padding: 8px 2px 14px;
  display: grid;
  gap: 10px;
}

.ipSkLine {
  height: 12px;
  border-radius: 999px;
  background:
    linear-gradient(90deg, rgba(15, 23, 42, 0.06), rgba(148, 163, 184, 0.14), rgba(15, 23, 42, 0.06));
  background-size: 220% 100%;
  animation: ipShimmer 900ms ease-in-out infinite;
}

html[data-theme='dark'] .ipSkLine {
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.05));
}

.ipSkLine--lg { height: 16px; width: 72%; }
.ipSkLine--sm { width: 44%; }

.ipMediaGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ipMediaTile {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 12px;
  content-visibility: auto;
  contain-intrinsic-size: 120px;
  contain: layout paint style;
}

.ipMediaOpen {
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  position: relative;
}

.ipMediaSkeleton {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(15, 23, 42, 0.06), rgba(148, 163, 184, 0.12), rgba(15, 23, 42, 0.06));
  background-size: 220% 100%;
  animation: ipShimmer 900ms ease-in-out infinite;
}

html[data-theme='dark'] .ipMediaSkeleton {
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.05));
}

.ipMediaImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity 160ms ease;
}

.ipMediaTile.loaded .ipMediaImg {
  opacity: 1;
}

.ipMediaTile.loaded .ipMediaSkeleton {
  opacity: 0;
  animation: none;
}

@keyframes ipShimmer {
  0% { background-position: 0% 0; }
  100% { background-position: 200% 0; }
}

.ipVideoFlag {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 10px;
}

.ipList {
  display: grid;
  gap: 8px;
}

.ipChannelSummary {
  display: grid;
  gap: 12px;
  padding: 6px 2px 10px;
}

.ipChannelCount {
  display: grid;
  gap: 2px;
}

.ipChannelCountValue {
  font-size: 28px;
  line-height: 1;
  font-weight: 800;
  color: var(--text);
}

.ipChannelCountLabel {
  font-size: 13px;
  color: var(--text-muted);
}

.ipSubscribeBtn {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid color-mix(in srgb, var(--link) 22%, transparent);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--link);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.ipManageBox {
  display: grid;
  gap: 8px;
  padding: 0 0 6px;
}

.ipManageState {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--link) 22%, transparent);
  background: color-mix(in srgb, var(--link) 6%, transparent);
}

.ipManageStateTitle {
  font-size: 13px;
  font-weight: 700;
  color: var(--link);
}

.ipManageClose {
  min-width: 64px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  background: color-mix(in srgb, var(--link) 14%, transparent);
  color: var(--link);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.ipManageInput {
  width: 100%;
  height: 36px;
  border: 1px solid var(--border);
  background: var(--surface-strong);
  color: var(--text);
  padding: 0 10px;
  outline: 0;
  font-size: 14px;
}

.ipManageResults {
  display: grid;
  gap: 6px;
}

.ipManageResult {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.ipManageResult:hover {
  background: var(--surface-soft-hover);
}

.ipMemberItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.ipMemberAvatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--avatar-fallback);
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  flex: 0 0 auto;
  letter-spacing: -.02em;
}

.ipMemberAvatar--btn {
  cursor: pointer;
}

.ipMemberAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ipMemberAvatarFallback {
  display: block;
}

.ipMemberMain {
  min-width: 0;
  flex: 1 1 auto;
}

.ipMemberName {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.ipMemberMeta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}


.ipMemberActions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ipRoleBtn,
.ipDangerBtn {
  min-width: 56px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text);
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
}

.ipDangerBtn {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 24%, transparent);
}

.ipFileItem,
.ipLinkItem {
  color: inherit;
  text-decoration: none;
}

.ipFileItem {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border: 0;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  cursor: pointer;
}

.ipFileItem:hover {
  background: var(--surface-soft-hover);
}

.ipFileName {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.ipFileKind {
  font-size: 12px;
  color: var(--text-muted);
}

.ipLinkItem {
  display: block;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
}

.ipLinkItem:hover {
  background: var(--surface-soft-hover);
}

.ipEmpty {
  padding: 4px 0;
  font-size: 13px;
  color: var(--text-muted);
}
@keyframes uiDockIn {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .ipRoot { animation: none; }
}
</style>
