<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  getUserByID,
  listChatEvents,
  searchDirectory,
  updateChat,
  type AuthUser,
  type ChatEvent,
  type ChatInviteLink,
  type ChatItem,
  type ChatMemberProfile,
  type SearchUserResult,
} from 'combox-api'
import { normalizeAvatarSrc } from './chatUtils'
import ComposerEmojiGifPicker from './ComposerEmojiGifPicker.vue'
import { openAvatarPreview } from '../../utils/avatarViewer'
import { avatarColorFor } from '../../utils/avatarColor'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { chatKindLabel } from './chatLabels'
import { formatRelativeTime } from '../../utils/relativeTime'
import {
  SLOW_MODE_OPTIONS,
  eventActionLabel,
  normalizeSendPermission,
  runeCount,
  slowModeLabel,
  truncateRunes,
} from './groupSettingsMeta'

type PanelMode = 'main' | 'admins' | 'add_admin' | 'members' | 'removed' | 'links' | 'slow_mode' | 'events'

/** Patch body accepted by the SDK `updateChat` (PATCH /chats/{chatID}). */
type ChatPatch = Parameters<typeof updateChat>[1]

/** Server-side snapshot of every setting edited straight from this panel. */
type SettingsDraft = {
  description: string
  iconEmoji: string
  commentsEnabled: boolean
  reactionsEnabled: boolean
  signMessages: boolean
  showAuthorsProfiles: boolean
  autoTranslate: boolean
  sendPermission: 'all' | 'admins'
  slowModeSeconds: number
}

function draftFromChat(chat: ChatItem | null | undefined): SettingsDraft {
  return {
    description: String(chat?.description ?? ''),
    iconEmoji: String(chat?.icon_emoji ?? ''),
    commentsEnabled: Boolean(chat?.comments_enabled ?? true),
    reactionsEnabled: Boolean(chat?.reactions_enabled ?? true),
    signMessages: Boolean(chat?.sign_messages ?? false),
    showAuthorsProfiles: Boolean(chat?.show_authors_profiles ?? false),
    autoTranslate: Boolean(chat?.auto_translate ?? false),
    sendPermission: normalizeSendPermission(chat?.send_permission),
    slowModeSeconds: Number(chat?.slow_mode_seconds || 0),
  }
}

const props = defineProps<{
  selectedChat: ChatItem | null
  currentUser: AuthUser | null
  chatMembers: ChatMemberProfile[]
  removedChatMembers?: ChatMemberProfile[]
  inviteLinks?: ChatInviteLink[]
}>()

const emit = defineEmits<{
  close: []
  saveProfile: [payload: { title: string; avatarDataUrl?: string | null; onSuccess: () => void; onError: (message: string) => void }]
  addMembers: [memberIDs: string[]]
  updateMemberRole: [payload: { userID: string; role: 'member' | 'moderator' | 'admin' }]
  removeMember: [userID: string]
  leaveChat: [payload: { onSuccess: () => void; onError: (message: string) => void }]
  createInviteLink: [title?: string]
  /** Fresh chat returned by a settings PATCH done inside this panel. */
  chatUpdated: [chat: ChatItem]
}>()

const { t } = useI18n()
const toast = useToast()
/**
 * Saved Messages self-chat (backend chat kind 'saved') must never render group
 * settings here (Group title/Chat icon/Description, members, invites): the
 * backend rejects member/settings ops for it, so any such control would be a
 * dead button. The panel renders nothing for saved (ChatInfoPanel already
 * avoids mounting it — this is defense-in-depth).
 */
const isSavedChat = computed(() => (props.selectedChat?.kind || '').trim() === 'saved')
const panelMode = ref<PanelMode>('main')

const addQuery = ref('')
const addBusy = ref(false)
const addResults = ref<SearchUserResult[]>([])
const adminSearchQuery = ref('')
const title = ref((props.selectedChat?.title || '').trim())
const avatarPreview = ref(normalizeAvatarSrc(props.selectedChat?.avatar_data_url || ''))
const avatarDataUrl = ref<string | null>(null)
const saveBusy = ref(false)
const saveError = ref('')

const serverDraft = ref<SettingsDraft>(draftFromChat(props.selectedChat))
const descriptionDraft = ref(serverDraft.value.description)
const iconEmojiDraft = ref(serverDraft.value.iconEmoji)
const commentsEnabledDraft = ref(serverDraft.value.commentsEnabled)
const reactionsEnabledDraft = ref(serverDraft.value.reactionsEnabled)
const signMessagesDraft = ref(serverDraft.value.signMessages)
const showAuthorsDraft = ref(serverDraft.value.showAuthorsProfiles)
const autoTranslateDraft = ref(serverDraft.value.autoTranslate)
const sendPermissionDraft = ref(serverDraft.value.sendPermission)
const slowModeDraft = ref(serverDraft.value.slowModeSeconds)
/** Field name -> in-flight PATCH, used to keep rapid toggles from racing each other. */
const pendingSettings = ref<Record<string, boolean>>({})

const descriptionTextareaRef = ref<HTMLTextAreaElement | null>(null)
const descriptionWrapRef = ref<HTMLElement | null>(null)
const descriptionPickerOpen = ref(false)

const eventsRaw = ref<ChatEvent[]>([])
const actorNames = ref<Record<string, string>>({})
const eventsLoading = ref(false)
const eventsError = ref('')

const descriptionDirty = computed(() => descriptionDraft.value !== serverDraft.value.description)
const iconEmojiDirty = computed(() => iconEmojiDraft.value !== serverDraft.value.iconEmoji)

const chatKindText = computed(() => chatKindLabel(t, props.selectedChat))
const isPublicChat = computed(() => Boolean(props.selectedChat?.is_public))
/** Canonical public entry link: the hash form `readPublicSlugFromHash()` opens. */
const publicLink = computed(() => {
  const slug = (props.selectedChat?.public_slug || '').trim().replace(/^@+/, '')
  if (!slug || typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}#@${encodeURIComponent(slug)}`
})
/** The backend only accepts `send_permission` on chats of kind `channel`. */
const sendPermissionSupported = computed(() => {
  const kind = (props.selectedChat?.kind || '').trim().toLowerCase()
  return kind === 'channel' || kind === 'standalone_channel'
})
/** Broadcast-only toggles (`sign_messages`, `show_authors_profiles`) need a broadcast channel. */
const isStandaloneChannel = computed(() => (props.selectedChat?.kind || '').trim() === 'standalone_channel')
const iconGraphemeCount = computed(() => graphemeCount(iconEmojiDraft.value || ''))

const inviteLinks = computed(() => props.inviteLinks || [])
const removedChatMembers = computed(() => props.removedChatMembers || [])

const currentRole = computed(() => {
  const currentUserID = (props.currentUser?.id || '').trim()
  if (!currentUserID) return ''
  const ownMember = props.chatMembers.find((item) => item.user_id === currentUserID)
  return (ownMember?.role || '').trim().toLowerCase()
})

const canManageRoles = computed(() => currentRole.value === 'owner' || currentRole.value === 'admin')
const admins = computed(() => normalizedMembers.value.filter((item) => ['owner', 'admin', 'moderator'].includes(item.role)))
const adminCount = computed(() => admins.value.length)

const normalizedMembers = computed(() =>
  props.chatMembers.map((member) => {
    const profile = member.profile
    const displayName = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() || profile?.username || member.user_id
    return {
      id: member.user_id,
      role: (member.role || 'member').trim().toLowerCase() || 'member',
      username: profile?.username || '',
      displayName,
      avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
      isCurrentUser: member.user_id === props.currentUser?.id,
    }
  }),
)

const removedUsers = computed(() =>
  removedChatMembers.value.map((member) => {
    const profile = member.profile
    const displayName = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() || profile?.username || member.user_id
    return {
      id: member.user_id,
      username: profile?.username || '',
      displayName,
      avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
    }
  }),
)

const visibleAddResults = computed(() => {
  const existing = new Set(props.chatMembers.map((item) => item.user_id))
  return addResults.value.filter((user) => !existing.has(user.id) && user.id !== props.currentUser?.id)
})

const hasUnsavedChanges = computed(() => {
  const originalTitle = (props.selectedChat?.title || '').trim()
  return title.value.trim() !== originalTitle || avatarDataUrl.value !== null
})

/**
 * Keeps drafts in sync with the parent chat. `selectedChat` is rebuilt on every
 * chat list reload (they happen on incoming messages), so untouched fields follow
 * the server while fields the user is editing keep their local value.
 */
function adoptIfClean(target: { value: boolean | number | string }, previousValue: boolean | number | string, nextValue: boolean | number | string): void {
  if (target.value === previousValue) target.value = nextValue
}

function applyServerDraft(fresh: SettingsDraft): void {
  const previous = serverDraft.value
  adoptIfClean(descriptionDraft, previous.description, fresh.description)
  adoptIfClean(iconEmojiDraft, previous.iconEmoji, fresh.iconEmoji)
  adoptIfClean(commentsEnabledDraft, previous.commentsEnabled, fresh.commentsEnabled)
  adoptIfClean(reactionsEnabledDraft, previous.reactionsEnabled, fresh.reactionsEnabled)
  adoptIfClean(signMessagesDraft, previous.signMessages, fresh.signMessages)
  adoptIfClean(showAuthorsDraft, previous.showAuthorsProfiles, fresh.showAuthorsProfiles)
  adoptIfClean(autoTranslateDraft, previous.autoTranslate, fresh.autoTranslate)
  adoptIfClean(sendPermissionDraft, previous.sendPermission, fresh.sendPermission)
  adoptIfClean(slowModeDraft, previous.slowModeSeconds, fresh.slowModeSeconds)
  serverDraft.value = fresh
}

function resetDrafts(fresh: SettingsDraft): void {
  descriptionDraft.value = fresh.description
  iconEmojiDraft.value = fresh.iconEmoji
  commentsEnabledDraft.value = fresh.commentsEnabled
  reactionsEnabledDraft.value = fresh.reactionsEnabled
  signMessagesDraft.value = fresh.signMessages
  showAuthorsDraft.value = fresh.showAuthorsProfiles
  autoTranslateDraft.value = fresh.autoTranslate
  sendPermissionDraft.value = fresh.sendPermission
  slowModeDraft.value = fresh.slowModeSeconds
  serverDraft.value = fresh
  pendingSettings.value = {}
}

watch(
  () => props.selectedChat,
  (chat, previousChat) => {
    closeDescriptionPicker()
    const next = draftFromChat(chat)
    const chatSwitched = (chat?.id || '') !== (previousChat?.id || '')

    if (chatSwitched) {
      title.value = (chat?.title || '').trim()
      avatarPreview.value = normalizeAvatarSrc(chat?.avatar_data_url || '')
      avatarDataUrl.value = null
      saveError.value = ''
      panelMode.value = 'main'
      resetEventsState()
      resetDrafts(next)
    } else {
      if (title.value.trim() === (previousChat?.title || '').trim()) title.value = (chat?.title || '').trim()
      const previousAvatar = normalizeAvatarSrc(previousChat?.avatar_data_url || '')
      if (avatarDataUrl.value === null && avatarPreview.value === previousAvatar) {
        avatarPreview.value = normalizeAvatarSrc(chat?.avatar_data_url || '')
      }
      applyServerDraft(next)
    }
  },
  { immediate: true },
)

let searchTimer: number | null = null
watch(addQuery, (query) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  const clean = query.trim()
  if (clean.length < 2) {
    addResults.value = []
    return
  }
  searchTimer = window.setTimeout(async () => {
    addBusy.value = true
    try {
      const found = await searchDirectory({ q: clean, scope: 'users', limit: 20 })
      addResults.value = Array.isArray(found.users) ? found.users : []
    } catch {
      addResults.value = []
    } finally {
      addBusy.value = false
    }
  }, 220)
})

function goBack() {
  if (descriptionPickerOpen.value) {
    closeDescriptionPicker()
    return
  }
  if (panelMode.value === 'add_admin') {
    panelMode.value = 'admins'
    return
  }
  if (panelMode.value !== 'main') {
    panelMode.value = 'main'
    return
  }
  emit('close')
}

function addMember(user: SearchUserResult) {
  emit('addMembers', [user.id])
  addQuery.value = ''
  addResults.value = []
}

function setRole(userID: string, role: 'member' | 'moderator' | 'admin') {
  emit('updateMemberRole', { userID, role })
}

function removeMember(userID: string) {
  emit('removeMember', userID)
}

function restoreRemoved(userID: string) {
  emit('updateMemberRole', { userID, role: 'member' })
}

function onAvatarPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    if (!result) return
    avatarDataUrl.value = result
    avatarPreview.value = result
    saveError.value = ''
  }
  reader.onerror = () => {
    saveError.value = t('chat.failed_read_avatar')
  }
  reader.readAsDataURL(file)
}

function saveProfile() {
  if (saveBusy.value) return
  const cleanTitle = title.value.trim()
  if (!cleanTitle) {
    saveError.value = t('chat.group_title_required')
    return
  }
  saveBusy.value = true
  saveError.value = ''
  emit('saveProfile', {
    title: cleanTitle,
    avatarDataUrl: avatarDataUrl.value,
    onSuccess: () => {
      saveBusy.value = false
      avatarDataUrl.value = null
    },
    onError: (message: string) => {
      saveBusy.value = false
      saveError.value = message
    },
  })
}

function clearAvatar() {
  avatarDataUrl.value = ''
  avatarPreview.value = ''
}

function previewAvatar() {
  if (!avatarPreview.value) return
  const chatID = (props.selectedChat?.id || '').trim()
  openAvatarPreview(avatarPreview.value, props.selectedChat?.title || '', chatID ? { ownerId: chatID, ownerKind: 'chat' } : undefined)
}

function leaveCurrentChat() {
  emit('leaveChat', {
    onSuccess: () => {
      saveError.value = ''
    },
    onError: (message: string) => {
      saveError.value = message
    },
  })
}

function createLink() {
  emit('createInviteLink')
}

const addAdminCandidates = computed(() => {
  const query = adminSearchQuery.value.trim().toLowerCase()
  const base = normalizedMembers.value.filter((member) => !member.isCurrentUser && member.role === 'member')
  if (!query) return base
  return base.filter((member) => {
    const name = member.displayName.toLowerCase()
    const username = member.username.toLowerCase()
    return name.includes(query) || username.includes(query)
  })
})

function openAddAdminPanel() {
  adminSearchQuery.value = ''
  panelMode.value = 'add_admin'
}

function promoteToAdmin(userID: string) {
  setRole(userID, 'admin')
  panelMode.value = 'admins'
}

function inviteLinkUrl(link: ChatInviteLink | null | undefined): string {
  const token = (link?.token || '').trim()
  if (!token || typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}#link:${encodeURIComponent(token)}`
}

function copyText(value: string) {
  if (!value) return
  void (async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
      }
    } catch (error) {
      void error
    }
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  })()
}

// ---------------------------------------------------------------------------
// Group settings saved straight through the SDK (optimistic value + rollback)
// ---------------------------------------------------------------------------

async function patchSettings(key: string, patch: ChatPatch, rollback: () => void): Promise<boolean> {
  const chatID = (props.selectedChat?.id || '').trim()
  if (!chatID) {
    rollback()
    return false
  }
  pendingSettings.value = { ...pendingSettings.value, [key]: true }
  const sameChatStill = () => (props.selectedChat?.id || '').trim() === chatID
  try {
    const payload = await updateChat(chatID, patch)
    if (sameChatStill()) {
      applyServerDraft(draftFromChat(payload.chat))
      emit('chatUpdated', payload.chat)
    }
    return true
  } catch (error) {
    if (sameChatStill()) rollback()
    toast.error(error instanceof Error ? error.message : t('chat.groupset_save_failed', undefined, 'Could not save the setting'))
    return false
  } finally {
    const nextPending = { ...pendingSettings.value }
    delete nextPending[key]
    pendingSettings.value = nextPending
  }
}

function saveDescription() {
  if (pendingSettings.value['description']) return
  const value = truncateRunes(descriptionDraft.value, 255)
  const previous = descriptionDraft.value
  descriptionDraft.value = value
  if (value === serverDraft.value.description) return
  void patchSettings('description', { description: value }, () => {
    descriptionDraft.value = previous
  })
}

function toggleDescriptionPicker() {
  descriptionPickerOpen.value = !descriptionPickerOpen.value
}

function closeDescriptionPicker() {
  descriptionPickerOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (descriptionPickerOpen.value && target && !descriptionWrapRef.value?.contains(target)) {
    descriptionPickerOpen.value = false
  }
}

function onDescriptionEmojiPick(emoji: string) {
  if (!emoji) return
  const element = descriptionTextareaRef.value
  const current = descriptionDraft.value || ''
  let start = current.length
  let end = current.length
  try {
    if (element && typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number') {
      start = Math.max(0, Math.min(element.selectionStart, current.length))
      end = Math.max(start, Math.min(element.selectionEnd, current.length))
    }
  } catch {
    // Selection is unavailable; append at the end.
  }
  const raw = `${current.slice(0, start)}${emoji}${current.slice(end)}`
  const truncated = truncateRunes(raw, 255)
  descriptionDraft.value = truncated
  const caret = Array.from(raw).length <= 255 ? Math.min(start + emoji.length, truncated.length) : truncated.length
  void nextTick(() => {
    try {
      element?.focus()
      element?.setSelectionRange(caret, caret)
    } catch {
      // Some input modes do not expose a selection; the caret stays at the end.
    }
  })
}

watch(descriptionPickerOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})

function graphemeSegments(value: string): string[] {
  const text = value || ''
  try {
    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (locales?: string | string[], options?: { granularity?: string }) => {
        segment(input: string): Iterable<{ segment: string }>
      }
    }
    const SegmenterCtor = intlWithSegmenter.Segmenter
    if (typeof SegmenterCtor === 'function') {
      const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' })
      return Array.from(segmenter.segment(text), (part) => part.segment)
    }
  } catch {
    // Intl.Segmenter is unavailable; fall back to code points below.
  }
  return Array.from(text)
}

function graphemeCount(value: string): number {
  return graphemeSegments(value).length
}

function saveIconEmoji() {
  if (pendingSettings.value['icon_emoji']) return
  const next = (iconEmojiDraft.value || '').trim()
  const previous = iconEmojiDraft.value
  const serverValue = serverDraft.value.iconEmoji || ''
  if (!next) {
    iconEmojiDraft.value = ''
    if (serverValue === '' || serverValue.trim() === '') {
      iconEmojiDraft.value = serverValue
      return
    }
    void patchSettings('icon_emoji', { icon_emoji: '' }, () => {
      iconEmojiDraft.value = previous
    })
    return
  }
  if (graphemeCount(next) !== 1) {
    iconEmojiDraft.value = serverValue
    toast.error(t('chat.chanset_emoji_too_long', undefined, 'Icon emoji must be a single emoji'))
    return
  }
  iconEmojiDraft.value = next
  if (next === serverValue) return
  void patchSettings('icon_emoji', { icon_emoji: next }, () => {
    iconEmojiDraft.value = previous
  })
}

function clearIconEmoji() {
  if (pendingSettings.value['icon_emoji']) return
  const previous = iconEmojiDraft.value
  if (!previous) return
  iconEmojiDraft.value = ''
  void patchSettings('icon_emoji', { icon_emoji: '' }, () => {
    iconEmojiDraft.value = previous
  })
}

function onIconEmojiInput(event: Event) {
  const input = event.target as HTMLInputElement
  iconEmojiDraft.value = input.value
}

function setSendPermission(next: 'all' | 'admins') {
  if (sendPermissionDraft.value === next || pendingSettings.value['send_permission']) return
  const previous = sendPermissionDraft.value
  sendPermissionDraft.value = next
  void patchSettings('send_permission', { send_permission: next }, () => {
    sendPermissionDraft.value = previous
  })
}

function setCommentsEnabled(next: boolean) {
  if (commentsEnabledDraft.value === next || pendingSettings.value['comments_enabled']) return
  const previous = commentsEnabledDraft.value
  commentsEnabledDraft.value = next
  void patchSettings('comments_enabled', { comments_enabled: next }, () => {
    commentsEnabledDraft.value = previous
  })
}

function setReactionsEnabled(next: boolean) {
  if (reactionsEnabledDraft.value === next || pendingSettings.value['reactions_enabled']) return
  const previous = reactionsEnabledDraft.value
  reactionsEnabledDraft.value = next
  void patchSettings('reactions_enabled', { reactions_enabled: next }, () => {
    reactionsEnabledDraft.value = previous
  })
}

function setSignMessages(next: boolean) {
  if (signMessagesDraft.value === next || pendingSettings.value['sign_messages']) return
  const previous = signMessagesDraft.value
  signMessagesDraft.value = next
  void patchSettings('sign_messages', { sign_messages: next }, () => {
    signMessagesDraft.value = previous
  })
}

function setShowAuthors(next: boolean) {
  if (showAuthorsDraft.value === next || pendingSettings.value['show_authors_profiles']) return
  const previous = showAuthorsDraft.value
  showAuthorsDraft.value = next
  void patchSettings('show_authors_profiles', { show_authors_profiles: next }, () => {
    showAuthorsDraft.value = previous
  })
}

function setAutoTranslate(next: boolean) {
  if (autoTranslateDraft.value === next || pendingSettings.value['auto_translate']) return
  const previous = autoTranslateDraft.value
  autoTranslateDraft.value = next
  void patchSettings('auto_translate', { auto_translate: next }, () => {
    autoTranslateDraft.value = previous
  })
}

function openSlowMode() {
  panelMode.value = 'slow_mode'
}

function setSlowMode(seconds: number) {
  const next = Number(seconds) || 0
  if (slowModeDraft.value === next || pendingSettings.value['slow_mode_seconds']) return
  const previous = slowModeDraft.value
  slowModeDraft.value = next
  void patchSettings('slow_mode_seconds', { slow_mode_seconds: next }, () => {
    slowModeDraft.value = previous
  })
}

function copyPublicLink() {
  const link = publicLink.value
  if (!link) return
  copyText(link)
  toast.success(t('chat.groupset_link_copied', undefined, 'Link copied'))
}

// ---------------------------------------------------------------------------
// Recent actions
// ---------------------------------------------------------------------------

function resetEventsState() {
  eventsRaw.value = []
  eventsLoading.value = false
  eventsError.value = ''
}

function eventActorLabel(event: ChatEvent): string {
  const actorID = (event.actor_user_id || '').trim()
  if (!actorID) return t('chat.groupset_evt_system', undefined, 'System')
  return actorNames.value[actorID] || t('chat.groupset_unknown_user', undefined, 'Unknown user')
}

const eventRows = computed(() =>
  eventsRaw.value.map((event) => ({
    id: event.id,
    action: eventActionLabel(t, event.event_type),
    actor: eventActorLabel(event),
    payload: (event.payload || '').trim(),
    time: formatRelativeTime(event.created_at),
  })),
)

async function resolveEventActors(items: ChatEvent[]): Promise<void> {
  const actorIDs = new Set<string>()
  for (const event of items) {
    const actorID = (event.actor_user_id || '').trim()
    if (actorID) actorIDs.add(actorID)
  }
  const missing = Array.from(actorIDs).filter((actorID) => !(actorID in actorNames.value))
  if (missing.length === 0) return
  await Promise.all(
    missing.map(async (actorID) => {
      let name = ''
      try {
        const user = await getUserByID(actorID)
        name = `${(user.first_name || '').trim()} ${(user.last_name || '').trim()}`.trim() || (user.username || '').trim() || actorID
      } catch {
        name = ''
      }
      actorNames.value = { ...actorNames.value, [actorID]: name }
    }),
  )
}

async function loadEvents() {
  if (eventsLoading.value) return
  const chatID = (props.selectedChat?.id || '').trim()
  if (!chatID) return
  eventsLoading.value = true
  eventsError.value = ''
  try {
    const items = await listChatEvents(chatID, { limit: 50 })
    eventsRaw.value = items
    await resolveEventActors(items)
  } catch (error) {
    eventsRaw.value = []
    eventsError.value = error instanceof Error ? error.message : t('chat.groupset_load_failed', undefined, 'Could not load chats')
  } finally {
    eventsLoading.value = false
  }
}

function openEvents() {
  panelMode.value = 'events'
  void loadEvents()
}
</script>

<template>
  <div v-if="!isSavedChat" class="gpRoot">
    <header class="gpHeader">
      <button type="button" class="gpIconBtn" :aria-label="t('chat.back')" @click="goBack">
        <v-icon icon="mdi-arrow-left" size="20" />
      </button>
      <div class="gpTitle">
        {{
          panelMode === 'main' ? t('settings.edit_profile', undefined, 'Edit')
          : panelMode === 'admins' ? t('chat.administrators', undefined, 'Administrators')
          : panelMode === 'add_admin' ? t('chat.add_admin', undefined, 'Add Admin')
          : panelMode === 'members' ? t('chat.members', undefined, 'Members')
          : panelMode === 'removed' ? t('chat.removed_users', undefined, 'Blocked users')
          : panelMode === 'slow_mode' ? t('chat.groupset_slow_mode', undefined, 'Slow mode')
          : panelMode === 'events' ? t('chat.recent_actions', undefined, 'Recent actions')
          : t('chat.invite_links', undefined, 'Invite links')
        }}
      </div>
    </header>

    <div class="gpScroll">
      <template v-if="panelMode === 'main'">
        <section class="gpHero">
          <label class="gpAvatarButton">
            <input type="file" accept="image/*" class="avatarFileInput" @change="onAvatarPick" />
            <div class="gpAvatarWrap">
              <img v-if="avatarPreview" :src="avatarPreview" alt="" class="gpAvatar" />
              <div v-else-if="iconEmojiDraft" class="gpAvatarFallback gpAvatarEmoji">{{ iconEmojiDraft }}</div>
              <div v-else class="gpAvatarFallback" :style="{ background: avatarColorFor(selectedChat?.id || selectedChat?.title || 'G') }">{{ (selectedChat?.title || 'G').slice(0, 1).toUpperCase() }}</div>
            </div>
            <div class="gpAvatarOverlay">
              <v-icon icon="mdi-camera-plus-outline" size="30" />
            </div>
          </label>
          <div v-if="avatarPreview" class="gpAvatarActions">
            <button type="button" class="gpAvatarAction" @click="previewAvatar">
              <v-icon icon="mdi-magnify-plus-outline" size="16" />
              {{ t('chat.preview_avatar', undefined, 'Preview') }}
            </button>
            <button type="button" class="gpAvatarAction gpAvatarAction--danger" @click="clearAvatar">
              <v-icon icon="mdi-close-circle-outline" size="16" />
              {{ t('chat.clear_avatar', undefined, 'Remove') }}
            </button>
          </div>
        </section>

        <section class="gpSection">
          <label class="gpField">
            <span class="gpFieldLabel">{{ t('chat.group_title', undefined, 'Group name') }}</span>
            <input v-model="title" class="gpInput" :placeholder="t('chat.group_title')" />
          </label>
          <div v-if="saveError" class="gpError">{{ saveError }}</div>
          <button type="button" class="gpSaveBtn" :disabled="saveBusy || !hasUnsavedChanges" @click="saveProfile">
            {{ saveBusy ? t('chat.saving', undefined, 'Saving...') : t('chat.save', undefined, 'Save') }}
          </button>
        </section>

        <section class="gpSection">
          <div class="gpField">
            <span class="gpFieldLabel">{{ t('chat.groupset_icon_emoji', undefined, 'Chat icon') }}</span>
            <div class="gpEmojiRow">
              <span class="gpEmojiPreview" aria-hidden="true">
                <template v-if="iconEmojiDraft">{{ iconEmojiDraft }}</template>
                <v-icon v-else icon="mdi-emoticon-outline" size="20" />
              </span>
              <input
                class="gpInput gpEmojiInput"
                :value="iconEmojiDraft"
                :disabled="pendingSettings['icon_emoji']"
                :placeholder="t('chat.groupset_icon_placeholder', undefined, 'Emoji')"
                @input="onIconEmojiInput"
              />
              <button
                type="button"
                class="gpCircleBtn"
                :disabled="!iconEmojiDraft || pendingSettings['icon_emoji']"
                :aria-label="t('chat.groupset_clear_icon', undefined, 'Clear icon')"
                @click="clearIconEmoji"
              >
                <v-icon icon="mdi-close" size="16" />
              </button>
            </div>
            <div class="gpFieldFoot">
              <span class="gpHint">{{ t('chat.groupset_icon_hint', undefined, 'Shown instead of the avatar letter when no photo is set.') }}</span>
              <span class="gpCounter">{{ iconGraphemeCount }}/1</span>
            </div>
          </div>
          <button type="button" class="gpSaveBtn" :disabled="pendingSettings['icon_emoji'] || !iconEmojiDirty" @click="saveIconEmoji">
            {{ pendingSettings['icon_emoji'] ? t('chat.saving', undefined, 'Saving...') : t('chat.save', undefined, 'Save') }}
          </button>
        </section>

        <section class="gpSection">
          <div class="gpField">
            <span class="gpFieldLabel">{{ t('chat.groupset_description', undefined, 'Description') }}</span>
            <div ref="descriptionWrapRef" class="gpTextareaWrap">
              <textarea
                ref="descriptionTextareaRef"
                v-model="descriptionDraft"
                class="gpInput gpTextarea gpTextareaWithEmoji"
                rows="3"
                :maxlength="255"
                :disabled="pendingSettings['description']"
                :placeholder="t('chat.groupset_description_placeholder', undefined, 'About this group')"
                @blur="saveDescription"
              ></textarea>
              <button
                type="button"
                class="gpEmojiBtn"
                :class="{ gpEmojiBtnOn: descriptionPickerOpen }"
                :disabled="pendingSettings['description']"
                :aria-expanded="descriptionPickerOpen ? 'true' : 'false'"
                :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                @click.stop="toggleDescriptionPicker"
              >
                <v-icon icon="mdi-emoticon-happy-outline" size="18" />
              </button>
              <div v-if="descriptionPickerOpen" class="gpEmojiPopover" @click.stop>
                <ComposerEmojiGifPicker :open="descriptionPickerOpen" @select="onDescriptionEmojiPick" />
              </div>
            </div>
            <span class="gpCounter">{{ runeCount(descriptionDraft) }}/255</span>
          </div>
          <button type="button" class="gpSaveBtn" :disabled="pendingSettings['description'] || !descriptionDirty" @click="saveDescription">
            {{ pendingSettings['description'] ? t('chat.saving', undefined, 'Saving...') : t('chat.save', undefined, 'Save') }}
          </button>
        </section>

        <section class="gpSection">
          <div class="gpFieldLabel">{{ t('chat.groupset_chat_info', undefined, 'Chat info') }}</div>
          <div class="gpInfoList">
            <div class="gpInfoRow">
              <span class="gpInfoKey">{{ t('chat.groupset_type', undefined, 'Type') }}</span>
              <span class="gpInfoValue">{{ chatKindText }}</span>
            </div>
            <div class="gpInfoRow">
              <span class="gpInfoKey">{{ t('chat.groupset_visibility', undefined, 'Visibility') }}</span>
              <span class="gpInfoValue">{{ isPublicChat ? t('chat.public', undefined, 'Public') : t('chat.private', undefined, 'Private') }}</span>
            </div>
          </div>
          <div class="gpField">
            <span class="gpFieldLabel">{{ t('chat.public_link', undefined, 'Public link') }}</span>
            <div class="gpInput gpInputReadOnly">{{ publicLink || t('chat.private_channel_no_link', undefined, 'No public link') }}</div>
          </div>
          <div class="gpInlineActions">
            <button type="button" class="gpSaveBtn" :disabled="!publicLink" @click="copyPublicLink">{{ t('chat.copy_link', undefined, 'Copy link') }}</button>
          </div>
        </section>

        <section class="gpSection">
          <div v-if="sendPermissionSupported" class="gpField">
            <span class="gpFieldLabel">{{ t('chat.who_can_send', undefined, 'Who can send messages') }}</span>
            <div class="gpChoiceRow">
              <button type="button" class="gpChoicePill" :class="{ active: sendPermissionDraft === 'all' }" @click="setSendPermission('all')">
                {{ t('chat.groupset_everyone', undefined, 'Everyone') }}
              </button>
              <button type="button" class="gpChoicePill" :class="{ active: sendPermissionDraft === 'admins' }" @click="setSendPermission('admins')">
                {{ t('chat.send_permission_admins', undefined, 'Only admins') }}
              </button>
            </div>
          </div>
          <div class="gpSettingLine">
            <div class="gpSettingText">
              <div class="gpFieldLabel">{{ t('chat.groupset_who_can_comment', undefined, 'Who can comment') }}</div>
              <div class="gpRowMeta">{{ commentsEnabledDraft ? t('chat.groupset_everyone', undefined, 'Everyone') : t('chat.groupset_no_one', undefined, 'No one') }}</div>
            </div>
            <button
              type="button"
              class="gpToggle"
              :class="{ on: commentsEnabledDraft }"
              role="switch"
              :aria-checked="commentsEnabledDraft ? 'true' : 'false'"
              :aria-label="t('chat.groupset_who_can_comment', undefined, 'Who can comment')"
              @click="setCommentsEnabled(!commentsEnabledDraft)"
            >
              <span class="gpToggleKnob" />
            </button>
          </div>
        </section>

        <section class="gpSection gpRows">
          <button type="button" class="gpRow" @click="openSlowMode">
            <div class="gpRowIcon"><v-icon icon="mdi-timer-sand" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.groupset_slow_mode', undefined, 'Slow mode') }}</div>
              <div class="gpRowMeta">{{ slowModeLabel(t, slowModeDraft) }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
          <div class="gpRow gpRowStatic">
            <div class="gpRowIcon"><v-icon icon="mdi-heart-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.reactions', undefined, 'Reactions') }}</div>
            </div>
            <button
              type="button"
              class="gpToggle"
              :class="{ on: reactionsEnabledDraft }"
              role="switch"
              :aria-checked="reactionsEnabledDraft ? 'true' : 'false'"
              :aria-label="t('chat.reactions', undefined, 'Reactions')"
              @click="setReactionsEnabled(!reactionsEnabledDraft)"
            >
              <span class="gpToggleKnob" />
            </button>
          </div>
          <div v-if="isStandaloneChannel" class="gpRow gpRowStatic">
            <div class="gpRowIcon"><v-icon icon="mdi-draw-pen" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.groupset_sign_messages', undefined, 'Sign messages') }}</div>
            </div>
            <button
              type="button"
              class="gpToggle"
              :class="{ on: signMessagesDraft }"
              role="switch"
              :aria-checked="signMessagesDraft ? 'true' : 'false'"
              :aria-label="t('chat.groupset_sign_messages', undefined, 'Sign messages')"
              @click="setSignMessages(!signMessagesDraft)"
            >
              <span class="gpToggleKnob" />
            </button>
          </div>
          <div v-if="isStandaloneChannel" class="gpRow gpRowStatic">
            <div class="gpRowIcon"><v-icon icon="mdi-account-circle-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.groupset_show_authors', undefined, 'Show message author') }}</div>
            </div>
            <button
              type="button"
              class="gpToggle"
              :class="{ on: showAuthorsDraft }"
              role="switch"
              :aria-checked="showAuthorsDraft ? 'true' : 'false'"
              :aria-label="t('chat.groupset_show_authors', undefined, 'Show message author')"
              @click="setShowAuthors(!showAuthorsDraft)"
            >
              <span class="gpToggleKnob" />
            </button>
          </div>
          <div class="gpRow gpRowStatic">
            <div class="gpRowIcon"><v-icon icon="mdi-translate" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.groupset_auto_translate', undefined, 'Auto translate') }}</div>
            </div>
            <button
              type="button"
              class="gpToggle"
              :class="{ on: autoTranslateDraft }"
              role="switch"
              :aria-checked="autoTranslateDraft ? 'true' : 'false'"
              :aria-label="t('chat.groupset_auto_translate', undefined, 'Auto translate')"
              @click="setAutoTranslate(!autoTranslateDraft)"
            >
              <span class="gpToggleKnob" />
            </button>
          </div>
          <button type="button" class="gpRow" @click="openEvents">
            <div class="gpRowIcon"><v-icon icon="mdi-history" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.recent_actions', undefined, 'Recent actions') }}</div>
              <div class="gpRowMeta">{{ t('chat.groupset_events_meta', undefined, 'Last 50 changes') }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
        </section>

        <section class="gpSection gpRows">
          <button type="button" class="gpRow" @click="panelMode = 'admins'">
            <div class="gpRowIcon"><v-icon icon="mdi-shield-crown-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.administrators', undefined, 'Administrators') }}</div>
              <div class="gpRowMeta">{{ adminCount }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
          <button type="button" class="gpRow" @click="panelMode = 'links'">
            <div class="gpRowIcon"><v-icon icon="mdi-link-variant" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.invite_links', undefined, 'Invite links') }}</div>
              <div class="gpRowMeta">{{ inviteLinks.length || 1 }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
          <button type="button" class="gpRow" @click="panelMode = 'members'">
            <div class="gpRowIcon"><v-icon icon="mdi-account-group-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.members', undefined, 'Members') }}</div>
              <div class="gpRowMeta">{{ normalizedMembers.length }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
          <button type="button" class="gpRow" @click="panelMode = 'removed'">
            <div class="gpRowIcon"><v-icon icon="mdi-account-cancel-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.removed_users', undefined, 'Removed users') }}</div>
              <div class="gpRowMeta">{{ removedUsers.length }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
        </section>

        <section class="gpSection gpDangerSection">
          <button type="button" class="gpDangerMainBtn" @click="leaveCurrentChat">{{ t('chat.delete_group', undefined, 'Delete Group') }}</button>
        </section>
      </template>

      <template v-else-if="panelMode === 'links'">
        <section class="gpSection">
          <div class="gpFieldLabel">{{ t('chat.primary_link', undefined, 'Primary link') }}</div>
          <div class="gpInput gpInputReadOnly">{{ inviteLinks[0] ? inviteLinkUrl(inviteLinks[0]) : t('chat.no_invite_links', undefined, 'No links found') }}</div>
          <div class="gpInlineActions">
            <button type="button" class="gpSaveBtn" @click="copyText(inviteLinks[0] ? inviteLinkUrl(inviteLinks[0]) : '')">{{ t('chat.copy_link', undefined, 'Copy link') }}</button>
            <button type="button" class="gpSaveBtn" @click="createLink">{{ t('chat.create_new_link', undefined, 'Create a New Link') }}</button>
          </div>
        </section>
        <section v-if="inviteLinks.length > 1" class="gpSection gpRows">
          <article v-for="item in inviteLinks" :key="item.id" class="gpRow gpRowStatic">
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ item.title || t('chat.invite_link', undefined, 'Invite link') }}</div>
              <div class="gpRowMeta">{{ inviteLinkUrl(item) }}</div>
            </div>
            <button type="button" class="gpCircleBtn" @click="copyText(inviteLinkUrl(item))"><v-icon icon="mdi-content-copy" size="16" /></button>
          </article>
        </section>
      </template>

      <template v-else-if="panelMode === 'admins'">
        <section class="gpSection">
          <div class="gpHintStrong">{{ t('chat.admin_help', undefined, 'You can add admins to help you manage your group.') }}</div>
          <button v-if="canManageRoles" type="button" class="gpSaveBtn" @click="openAddAdminPanel">
            {{ t('chat.add_admin', undefined, 'Add Admin') }}
          </button>
        </section>
        <section class="gpSection gpRows">
          <article v-for="member in admins" :key="member.id" class="gpMemberRow">
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
                <span>{{ member.role }}</span>
              </div>
            </div>
            <button v-if="canManageRoles && !member.isCurrentUser && member.role !== 'owner'" type="button" class="gpActionBtn" @click="setRole(member.id, 'member')">
              {{ t('chat.remove_admin', undefined, 'Remove admin') }}
            </button>
          </article>
        </section>
      </template>

      <template v-else-if="panelMode === 'add_admin'">
        <section class="gpSection">
          <div class="gpFieldLabel">{{ t('chat.search', undefined, 'Search') }}</div>
          <input v-model="adminSearchQuery" class="gpInput" :placeholder="t('chat.search', undefined, 'Search')" />
        </section>
        <section class="gpSection gpRows">
          <button
            v-for="member in addAdminCandidates"
            :key="member.id"
            type="button"
            class="gpSearchItem"
            @click="promoteToAdmin(member.id)"
          >
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
                <span>{{ member.role }}</span>
              </div>
            </div>
            <v-icon icon="mdi-account-plus-outline" size="18" class="gpChevron" />
          </button>
          <div v-if="addAdminCandidates.length === 0" class="gpHint">{{ t('chat.no_users_found', undefined, 'No users found') }}</div>
        </section>
      </template>

      <template v-else-if="panelMode === 'members'">
        <section class="gpSection">
          <div class="gpFieldLabel">{{ t('chat.add_participants', undefined, 'Add participants') }}</div>
          <input v-model="addQuery" class="gpInput" :placeholder="t('chat.search', undefined, 'Search')" />
          <div v-if="addBusy" class="gpHint">{{ t('chat.searching', undefined, 'Searching...') }}</div>
          <div v-else-if="visibleAddResults.length > 0" class="gpSearchList">
            <button v-for="user in visibleAddResults" :key="user.id" type="button" class="gpSearchItem" @click="addMember(user)">
              <div class="gpMiniAvatar">
                <img v-if="normalizeAvatarSrc(user.avatar_data_url || '')" :src="normalizeAvatarSrc(user.avatar_data_url || '')" alt="" class="gpMiniAvatarImg" />
                <span v-else>{{ (user.first_name || user.username || '?').slice(0, 1).toUpperCase() }}</span>
              </div>
              <div class="gpSearchText">
                <div class="gpMemberName">{{ `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username }}</div>
                <div class="gpMemberMeta">@{{ user.username }}</div>
              </div>
            </button>
          </div>
        </section>

        <section class="gpSection gpRows">
          <article v-for="member in normalizedMembers" :key="member.id" class="gpMemberRow">
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
                <span>{{ member.role }}</span>
              </div>
            </div>
            <div v-if="!member.isCurrentUser && member.role !== 'owner'" class="gpActions">
              <button type="button" class="gpDangerBtn" @click="removeMember(member.id)">{{ t('chat.remove', undefined, 'Remove') }}</button>
            </div>
          </article>
        </section>
      </template>

      <template v-else-if="panelMode === 'slow_mode'">
        <section class="gpSection">
          <div class="gpHintStrong">{{ t('chat.groupset_slow_hint', undefined, 'Members can send only one message during the selected interval.') }}</div>
        </section>
        <section class="gpSection gpRows">
          <button v-for="option in SLOW_MODE_OPTIONS" :key="option.seconds" type="button" class="gpRow" @click="setSlowMode(option.seconds)">
            <div class="gpRowIcon"><v-icon :icon="option.seconds === 0 ? 'mdi-timer-off-outline' : 'mdi-timer-outline'" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ slowModeLabel(t, option.seconds) }}</div>
            </div>
            <v-icon v-if="slowModeDraft === option.seconds" icon="mdi-check-bold" size="18" class="gpCheck" />
          </button>
        </section>
      </template>

      <template v-else-if="panelMode === 'events'">
        <section class="gpSection gpRows">
          <div v-if="eventsLoading" class="gpHint gpSubHint">{{ t('chat.groupset_loading', undefined, 'Loading...') }}</div>
          <div v-else-if="eventsError" class="gpError gpSubHint">{{ eventsError }}</div>
          <div v-else-if="eventRows.length === 0" class="gpHint gpSubHint">{{ t('chat.groupset_events_empty', undefined, 'No recent actions yet') }}</div>
          <template v-else>
            <article v-for="row in eventRows" :key="row.id" class="gpEventRow">
              <div class="gpEventHead">
                <span class="gpEventAction">{{ row.action }}</span>
                <span class="gpEventTime">{{ row.time }}</span>
              </div>
              <div class="gpEventMeta">
                <span class="gpEventActor">{{ row.actor }}</span>
                <span v-if="row.payload" class="gpEventPayload">{{ row.payload }}</span>
              </div>
            </article>
          </template>
        </section>
      </template>

      <template v-else>
        <section class="gpSection gpRows">
          <article v-for="member in removedUsers" :key="member.id" class="gpMemberRow">
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
              </div>
            </div>
            <button type="button" class="gpActionBtn" @click="restoreRemoved(member.id)">{{ t('chat.restore', undefined, 'Restore') }}</button>
          </article>
          <div v-if="removedUsers.length === 0" class="gpHint">{{ t('chat.no_removed_users', undefined, 'No removed users yet.') }}</div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.gpRoot {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  flex: 0 0 auto;
  min-height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--surface);
  color: var(--text);
  border-left: 1px solid var(--border);
}

.gpHeader {
  min-height: 62px;
  padding: 12px 14px 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}

.gpIconBtn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.gpTitle {
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -.03em;
}

.gpScroll {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.gpHero {
  display: grid;
  justify-items: center;
  padding: 6px 0;
}

.gpAvatarButton {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  position: relative;
}

.avatarFileInput {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  z-index: 6;
}

.gpAvatarWrap {
  width: 112px;
  height: 112px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-soft);
}

.gpAvatar,
.gpAvatarFallback {
  width: 100%;
  height: 100%;
}

.gpAvatar {
  object-fit: cover;
  display: block;
}

.gpAvatarFallback {
  background: var(--avatar-fallback);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 42px;
  font-weight: 800;
}

.gpAvatarOverlay {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, .24);
  color: #fff;
}

.gpAvatarActions {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.gpAvatarAction {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--accent-strong);
  font-size: .8rem;
  font-weight: 800;
  cursor: pointer;
}

.gpAvatarAction--danger {
  border-color: #f87171;
  color: #ef4444;
}

.gpSection {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
}

.gpField {
  display: grid;
  gap: 6px;
}

.gpFieldLabel {
  font-size: .8rem;
  font-weight: 700;
  color: var(--text-muted);
}

.gpInput {
  width: 100%;
  min-height: 42px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, .22);
  background: var(--surface-soft);
  padding: 0 14px;
  color: var(--text);
  font-size: .92rem;
  outline: 0;
}

.gpInputReadOnly {
  display: flex;
  align-items: center;
}

.gpError {
  font-size: .8rem;
  color: #ef4444;
}

.gpSaveBtn {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: #4a90d9;
  color: #fff;
  font-size: .82rem;
  font-weight: 700;
  cursor: pointer;
  justify-self: start;
}

.gpSaveBtn:disabled {
  opacity: .6;
  cursor: default;
}

.gpRows {
  gap: 0;
  padding-top: 2px;
  padding-bottom: 2px;
}

.gpRow {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  cursor: pointer;
}

.gpRow + .gpRow {
  border-top: 1px solid rgba(148, 163, 184, .12);
}

.gpRowStatic {
  cursor: default;
}

.gpRowIcon {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.gpRowBody {
  min-width: 0;
}

.gpRowTitle {
  font-size: .95rem;
  font-weight: 700;
  color: var(--text);
}

.gpRowMeta {
  font-size: .82rem;
  color: var(--text-muted);
}

.gpChevron {
  color: var(--text-muted);
}

.gpInlineActions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.gpCircleBtn {
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

.gpSearchList {
  display: grid;
  gap: 8px;
}

.gpSearchItem,
.gpMemberRow {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, .15);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-soft, #fff) 90%, transparent);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.gpSearchItem {
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.gpMiniAvatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-soft);
  display: grid;
  place-items: center;
}

.gpMiniAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gpSearchText {
  min-width: 0;
}

.gpMemberName {
  font-size: .92rem;
  font-weight: 700;
  color: var(--text);
}

.gpMemberMeta {
  font-size: .78rem;
  color: var(--text-muted);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.gpActions {
  display: flex;
  gap: 6px;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
}

.gpActionBtn,
.gpDangerBtn {
  min-height: 28px;
  border: 0;
  border-radius: 999px;
  padding: 0 10px;
  font-size: .72rem;
  font-weight: 700;
  cursor: pointer;
}

.gpActionBtn {
  background: rgba(59, 130, 246, .14);
  color: #3b82f6;
}

.gpDangerBtn {
  background: rgba(239, 68, 68, .16);
  color: #ef4444;
}

.gpDangerSection {
  padding-top: 8px;
}

.gpDangerMainBtn {
  min-height: 36px;
  border: 0;
  border-radius: 999px;
  padding: 0 16px;
  background: rgba(239, 68, 68, .16);
  color: #ef4444;
  font-size: .9rem;
  font-weight: 800;
  justify-self: start;
  cursor: pointer;
}

.gpHint {
  color: var(--text-muted);
  font-size: .86rem;
}

.gpHintStrong {
  color: var(--text);
  font-size: .92rem;
  line-height: 1.35;
}

.gpAvatarEmoji {
  font-size: 44px;
  line-height: 1;
  background: var(--surface-soft);
  color: var(--text);
}

.gpEmojiRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gpEmojiPreview {
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  border-radius: 12px;
  background: var(--surface-soft);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  font-size: 22px;
  line-height: 1;
}

.gpEmojiInput {
  flex: 1 1 auto;
  min-width: 0;
}

.gpFieldFoot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.gpCounter {
  flex: 0 0 auto;
  font-size: .74rem;
  color: var(--text-muted);
}

.gpTextarea {
  min-height: 86px;
  padding: 10px 14px;
  line-height: 1.4;
  resize: vertical;
}

.gpTextareaWrap {
  position: relative;
}

.gpTextareaWithEmoji {
  padding-right: 40px;
}

.gpEmojiBtn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.gpEmojiBtn:hover:not(:disabled),
.gpEmojiBtnOn {
  background: var(--surface-soft-hover);
  color: var(--accent);
}

.gpEmojiBtn:disabled {
  opacity: .45;
  cursor: default;
}

.gpEmojiPopover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: min(388px, calc(100vw - 44px));
}

.gpEmojiPopover :deep(.ep-tabs) {
  display: none;
}

.gpInfoList {
  display: grid;
  gap: 8px;
}

.gpInfoRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: .88rem;
}

.gpInfoKey {
  color: var(--text-muted);
}

.gpInfoValue {
  font-weight: 700;
  color: var(--text);
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

.gpChoiceRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.gpChoicePill {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: .82rem;
  font-weight: 700;
  cursor: pointer;
}

.gpChoicePill.active {
  border-color: #4a90d9;
  background: rgba(74, 144, 217, .16);
  color: var(--accent-strong);
}

.gpSettingLine {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.gpSettingText {
  min-width: 0;
}

.gpToggle {
  position: relative;
  flex: 0 0 auto;
  width: 44px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(148, 163, 184, .45);
  cursor: pointer;
}

.gpToggle.on {
  background: #4a90d9;
}

.gpToggleKnob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform .15s ease;
}

.gpToggle.on .gpToggleKnob {
  transform: translateX(18px);
}

.gpCheck {
  color: var(--accent-strong);
}

.gpSubHint {
  padding: 10px 0;
}

.gpEventRow {
  display: grid;
  gap: 4px;
  padding: 10px 0;
}

.gpEventRow + .gpEventRow {
  border-top: 1px solid rgba(148, 163, 184, .12);
}

.gpEventHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.gpEventAction {
  font-size: .9rem;
  font-weight: 700;
  color: var(--text);
}

.gpEventTime {
  flex: 0 0 auto;
  font-size: .76rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.gpEventMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: .8rem;
  color: var(--text-muted);
}

.gpEventActor {
  font-weight: 700;
  color: var(--text-soft);
}

.gpEventPayload {
  min-width: 0;
  overflow-wrap: anywhere;
}

.gpCircleBtn:disabled {
  opacity: .45;
  cursor: default;
}

@media (max-width: 1120px) {
  .gpRoot {
    width: 100%;
    border-left: 0;
  }
}

@media (max-width: 420px) {
  .gpSection {
    padding: 10px 10px;
  }
  .gpInlineActions {
    gap: 6px;
  }
  .gpMemberRow {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
