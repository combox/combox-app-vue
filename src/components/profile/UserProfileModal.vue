<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  blockUser,
  ComboxClient,
  getCurrentUser,
  getProfileSettings,
  getUserByID,
  listChats,
  openDirectChat,
  searchDirectory,
  setChatMuted,
  type AuthUser,
  type ChatItem,
  type PresenceItem,
  type SavedTrack,
} from 'combox-api'
import { createReport } from '../../../../combox-api/src/reports'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { normalizeAvatarSrc } from '../../utils/avatar'
import { avatarColorFor } from '../../utils/avatarColor'
import { openAvatarPreview } from '../../utils/avatarViewer'
import { formatRelativeTime, useRelativeClock } from '../../utils/relativeTime'
import { closeProfileModal, profileModalTarget } from '../../utils/profileModal'
import { setHashToChatId } from '../chat/chatWorkspace.hash'
import { startCall } from '../call/callSession'

const { t } = useI18n()
const toast = useToast()
const presenceClient = new ComboxClient()
const clock = useRelativeClock()

const dialogEl = ref<HTMLElement | null>(null)
const loading = ref(false)
const loadFailed = ref(false)
const user = ref<AuthUser | null>(null)
const resolvedUserID = ref('')
const presence = ref<PresenceItem | null>(null)
const directChat = ref<ChatItem | null>(null)
const mutedChatIDs = ref<string[]>([])
const busyAction = ref('')
let loadToken = 0
let previouslyFocused: HTMLElement | null = null

const target = computed(() => profileModalTarget.value)
const username = computed(() => (user.value?.username || target.value?.username || '').trim().replace(/^@+/, ''))
const avatarSrc = computed(() => normalizeAvatarSrc(user.value?.avatar_data_url))
const bio = computed(() => (user.value?.bio || '').trim())
const phone = computed(() => (user.value?.phone_number || '').trim())

// R13: own vs foreign. Own editor lives in SettingsPage (always visible);
// the modal hides empty sections only in foreign view mode (TG/VK rule).
const currentUserID = computed(() => (getCurrentUser()?.id || '').trim())
const isOwnProfile = computed(
  () => Boolean(resolvedUserID.value && currentUserID.value && resolvedUserID.value === currentUserID.value),
)
const birthDateRaw = computed(() => (user.value?.birth_date || '').trim())
const hasBirthday = computed(() => Boolean(birthDateRaw.value))
const formattedBirthday = computed(() => {
  const raw = birthDateRaw.value
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
})
const showBirthday = computed(() => !loading.value && hasBirthday.value)
const playlistTracks = computed<SavedTrack[]>(() => {
  const list = user.value?.saved_tracks
  if (!Array.isArray(list)) return []
  return list.filter(
    (track): track is SavedTrack => Boolean(track) && typeof track.id === 'string' && typeof track.title === 'string',
  )
})
const playlistTitle = computed(() => (user.value?.playlist_title || '').trim())
const playlistIsPublic = computed(() => user.value?.playlist_is_public !== false)
const hasPlaylistTracks = computed(() => playlistTracks.value.length > 0)
// O1: empty bio/playlist never render in preview (own or foreign).
// Bio is gated by v-if="bio" in the template; the playlist block needs
// tracks>0 in both modes (own view no longer shows the empty placeholder).
const showPlaylist = computed(() => {
  if (loading.value || !user.value) return false
  if (!hasPlaylistTracks.value) return false
  if (isOwnProfile.value) return true
  return playlistIsPublic.value
})

const reportOpen = ref(false)
const reportReason = ref('')
const reportBusy = ref(false)
const reportError = ref('')
const reportSent = ref(false)
const blockBusy = ref(false)
const blockDone = ref(false)
const showModeration = computed(() => !isOwnProfile.value && Boolean(resolvedUserID.value))

function formatTrackTime(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

const displayName = computed(() => {
  const full = `${user.value?.first_name || ''} ${user.value?.last_name || ''}`.trim()
  if (full) return full
  const hint = target.value?.name || ''
  if (hint) return hint
  if (username.value) return `@${username.value}`
  return t('profile.unknown_user', undefined, 'Unknown user')
})

const initials = computed(() => {
  const source = username.value && displayName.value.startsWith('@') ? username.value : displayName.value
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '#'
  if (parts.length === 1) return (parts[0] || '#').slice(0, 2).toUpperCase()
  return `${(parts[0] || '').slice(0, 1)}${(parts[1] || '').slice(0, 1)}`.toUpperCase()
})

const avatarStyle = computed(() => ({
  background: avatarColorFor(resolvedUserID.value || username.value || displayName.value),
}))

const presenceLine = computed(() => {
  const item = presence.value
  if (!item) return ''
  if (item.online) return t('chat.online', undefined, 'online')
  if (item.last_seen_visible && item.last_seen) {
    const relative = formatRelativeTime(item.last_seen, clock.value)
    if (relative) return t('chat.last_seen_at', { time: relative }, `last seen ${relative}`)
  }
  return ''
})

const muted = computed(() => {
  const chatID = directChat.value?.id || ''
  return Boolean(chatID && mutedChatIDs.value.includes(chatID))
})

const canMessage = computed(() => Boolean(resolvedUserID.value || (username.value && target.value?.openChat)))
const canActOnChat = computed(() => Boolean(directChat.value) && !busyAction.value)

async function load(): Promise<void> {
  const current = profileModalTarget.value
  loadToken += 1
  const token = loadToken
  if (!current) return

  user.value = null
  presence.value = null
  directChat.value = null
  loadFailed.value = false
  resolvedUserID.value = current.userID
  loading.value = true

  if (!resolvedUserID.value && current.username) {
    try {
      const results = await searchDirectory({ q: current.username, scope: 'users', limit: 20 })
      const exact = (results.users || []).find(
        (item) => (item.username || '').trim().toLowerCase() === current.username.toLowerCase(),
      )
      if (exact?.id) {
        resolvedUserID.value = exact.id
        user.value = {
          id: exact.id,
          email: exact.email || '',
          username: exact.username || '',
          first_name: exact.first_name,
          last_name: exact.last_name,
          birth_date: exact.birth_date,
          avatar_data_url: exact.avatar_data_url,
          avatar_gradient: exact.avatar_gradient,
        }
      } else {
        loadFailed.value = true
      }
    } catch {
      loadFailed.value = true
    }
  }
  if (token !== loadToken) return

  const tasks: Promise<void>[] = []
  const userID = resolvedUserID.value
  if (userID) {
    tasks.push(
      (async () => {
        try {
          const profile = await getUserByID(userID)
          if (token === loadToken) user.value = profile
        } catch {
          if (token === loadToken) loadFailed.value = true
        }
      })(),
      (async () => {
        try {
          const items = await presenceClient.getPresence([userID])
          if (token === loadToken && items[0]) presence.value = items[0]
        } catch {
          // Presence is decorative: never fail the popup over it.
        }
      })(),
    )
  }
  tasks.push(
    (async () => {
      try {
        const chats = await listChats()
        if (token !== loadToken) return
        directChat.value =
          chats.find((item) => Boolean(item.is_direct) && (item.peer_user_id || '').trim() === userID) || null
      } catch {
        if (token === loadToken) loadFailed.value = true
      }
    })(),
    (async () => {
      try {
        const payload = await getProfileSettings()
        if (token === loadToken) mutedChatIDs.value = payload.chat_notifications?.muted_chat_ids || []
      } catch {
        // Mute state is cosmetic here.
      }
    })(),
  )
  await Promise.all(tasks)
  if (token === loadToken) loading.value = false
}

/**
 * Selects a chat in the workspace. The only supported entry point is the URL
 * hash, which the workspace listens for via `hashchange`.
 */
function navigateToChat(chatID: string): void {
  const id = (chatID || '').trim()
  if (!id) return
  const desired = `#${encodeURIComponent(id)}`
  const apply = () => {
    if (window.location.hash !== desired) return false
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return true
  }
  setHashToChatId(id)
  apply()
  // A freshly created chat only shows up in the workspace after it reloads its
  // list, so keep nudging the hash until it is picked up (or the user moves on).
  let attempts = 0
  const timer = window.setInterval(() => {
    attempts += 1
    if (attempts > 8 || !apply()) window.clearInterval(timer)
  }, 350)
}

async function openChatWithUser(): Promise<void> {
  const current = profileModalTarget.value
  if (!current || busyAction.value) return
  if (username.value && current.openChat) {
    closeProfileModal()
    current.openChat(username.value)
    return
  }
  if (directChat.value) {
    closeProfileModal()
    navigateToChat(directChat.value.id)
    return
  }
  if (!resolvedUserID.value) return
  busyAction.value = 'message'
  try {
    const payload = await openDirectChat({ recipient_user_id: resolvedUserID.value })
    const chatID = (payload.chat?.id || '').trim()
    if (chatID) {
      closeProfileModal()
      navigateToChat(chatID)
    } else {
      throw new Error(t('profile.message_failed', undefined, 'Could not open the chat'))
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('profile.message_failed', undefined, 'Could not open the chat'))
  } finally {
    busyAction.value = ''
  }
}

async function toggleMute(): Promise<void> {
  const chatID = directChat.value?.id || ''
  if (!chatID || busyAction.value) return
  const next = !muted.value
  const previous = mutedChatIDs.value
  busyAction.value = 'mute'
  mutedChatIDs.value = next ? [...previous, chatID] : previous.filter((id) => id !== chatID)
  try {
    const notifications = await setChatMuted(chatID, next)
    mutedChatIDs.value = notifications?.muted_chat_ids || mutedChatIDs.value
  } catch (error) {
    mutedChatIDs.value = previous
    toast.error(error instanceof Error ? error.message : t('profile.mute_failed', undefined, 'Could not change notifications'))
  } finally {
    busyAction.value = ''
  }
}

async function startUserCall(): Promise<void> {
  const chatID = directChat.value?.id || ''
  if (!chatID || busyAction.value) return
  busyAction.value = 'call'
  closeProfileModal()
  try {
    await startCall({ chatID, kind: 'p2p' })
  } finally {
    busyAction.value = ''
  }
}

async function copyUsername(): Promise<void> {
  const value = username.value
  if (!value) return
  let copied = false
  try {
    await navigator.clipboard.writeText(`@${value}`)
    copied = true
  } catch {
    copied = false
  }
  if (copied) toast.success(t('profile.username_copied', undefined, 'Username copied'))
  else toast.error(t('profile.copy_failed', undefined, 'Could not copy'))
}

function onAvatarClick(): void {
  const src = avatarSrc.value
  if (!src) return
  openAvatarPreview(src, displayName.value, {
    ownerId: resolvedUserID.value || target.value?.userID || '',
    ownerKind: 'user',
  })
}

function resetModeration(): void {
  reportOpen.value = false
  reportReason.value = ''
  reportBusy.value = false
  reportError.value = ''
  reportSent.value = false
  blockBusy.value = false
  blockDone.value = false
}

function toggleReportForm(): void {
  if (reportBusy.value) return
  reportError.value = ''
  reportOpen.value = !reportOpen.value
}

async function submitReport(): Promise<void> {
  const targetID = resolvedUserID.value.trim()
  const reason = reportReason.value.trim()
  if (!targetID || reportBusy.value) return
  if (!reason) {
    reportError.value = t('profile.report_reason_required', undefined, 'Please describe the reason')
    return
  }
  if (Array.from(reason).length > 2000) {
    reportError.value = t('profile.report_reason_too_long', undefined, 'Reason must be 2000 characters or fewer')
    return
  }
  reportBusy.value = true
  reportError.value = ''
  try {
    await createReport({ target_type: 'user', target_id: targetID, reason })
    reportSent.value = true
    reportOpen.value = false
    reportReason.value = ''
    toast.success(t('profile.report_sent', undefined, 'Report sent. Thank you!'))
  } catch (error) {
    reportError.value = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : t('profile.report_failed', undefined, 'Could not send the report')
  } finally {
    reportBusy.value = false
  }
}

async function blockThisUser(): Promise<void> {
  const targetID = resolvedUserID.value.trim()
  if (!targetID || blockBusy.value || blockDone.value) return
  blockBusy.value = true
  try {
    await blockUser(targetID)
    blockDone.value = true
    toast.success(t('profile.blocked', undefined, 'User blocked'))
  } catch (error) {
    toast.error(error instanceof Error && error.message.trim()
      ? error.message.trim()
      : t('profile.block_failed', undefined, 'Could not block the user'))
  } finally {
    blockBusy.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (!profileModalTarget.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeProfileModal()
    return
  }
  if (event.key !== 'Tab') return
  const root = dialogEl.value
  if (!root) return
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'),
  )
  if (nodes.length === 0) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  target,
  (next) => {
    if (next) {
      previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      void nextTick(() => dialogEl.value?.focus())
      resetModeration()
      void load()
    } else {
      previouslyFocused?.focus?.()
      previouslyFocused = null
      loadToken += 1
      loading.value = false
      user.value = null
      presence.value = null
      directChat.value = null
      resetModeration()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadToken += 1
  document.removeEventListener('keydown', onKeydown)
})
document.addEventListener('keydown', onKeydown)
</script>

<template>
  <Teleport to="body">
    <transition name="pfFade">
      <div v-if="target" class="pfOverlay" @click.self="closeProfileModal" @mousedown.self="closeProfileModal">
        <section
          ref="dialogEl"
          class="pfDialog"
          role="dialog"
          aria-modal="true"
          :aria-label="displayName"
          tabindex="-1"
          @click.stop
        >
          <button
            type="button"
            class="pfClose"
            :aria-label="t('common.close', undefined, 'Close')"
            @click="closeProfileModal"
          >
            <v-icon icon="mdi-close" size="18" />
          </button>

          <div class="pfHead">
            <button
              type="button"
              class="pfAvatar"
              :class="{ pfAvatarClickable: avatarSrc }"
              :style="avatarStyle"
              :disabled="!avatarSrc"
              @click="onAvatarClick"
            >
              <img v-if="avatarSrc" :src="avatarSrc" alt="" class="pfAvatarImg" />
              <span v-else>{{ initials }}</span>
            </button>
            <div class="pfName">{{ displayName }}</div>
            <div v-if="username" class="pfUsername">@{{ username }}</div>
            <div v-if="presenceLine" class="pfPresence" :class="{ pfPresenceOnline: presence?.online }">
              {{ presenceLine }}
            </div>
            <div v-if="loading" class="pfStatus">
              <v-progress-circular indeterminate :size="14" :width="2" />
            </div>
            <div v-else-if="loadFailed && !user && !username" class="pfStatus pfStatusError">
              {{ t('profile.load_failed', undefined, 'Could not load the profile') }}
            </div>
          </div>

          <div class="pfActions">
            <button type="button" class="pfAction" :disabled="!canMessage || Boolean(busyAction)" @click="openChatWithUser">
              <v-icon icon="mdi-message-outline" size="20" />
              <span>{{ t('chat.message', undefined, 'Message') }}</span>
            </button>
            <button type="button" class="pfAction" :disabled="!canActOnChat" @click="toggleMute">
              <v-icon :icon="muted ? 'mdi-bell-ring-outline' : 'mdi-bell-outline'" size="20" />
              <span>{{ muted ? t('profile.unmute', undefined, 'Unmute') : t('profile.mute', undefined, 'Mute') }}</span>
            </button>
            <button type="button" class="pfAction" :disabled="!canActOnChat" @click="startUserCall">
              <v-icon icon="mdi-phone-outline" size="20" />
              <span>{{ t('profile.call', undefined, 'Call') }}</span>
            </button>
          </div>

          <div v-if="showModeration" class="pfActions pfActionsSecond">
            <button type="button" class="pfAction pfActionDanger" :disabled="reportBusy" @click="toggleReportForm">
              <v-icon icon="mdi-flag-outline" size="20" />
              <span>{{ t('profile.report', undefined, 'Report') }}</span>
            </button>
            <button
              type="button"
              class="pfAction pfActionDanger"
              :disabled="blockBusy || blockDone"
              @click="blockThisUser"
            >
              <v-icon icon="mdi-account-cancel-outline" size="20" />
              <span>{{ blockDone ? t('profile.blocked', undefined, 'Blocked') : t('profile.block', undefined, 'Block') }}</span>
            </button>
          </div>

          <div v-if="showModeration && reportOpen" class="pfReport">
            <label class="pfInfoLabel" for="pfReportReason">{{ t('profile.report_reason', undefined, 'Reason') }}</label>
            <textarea
              id="pfReportReason"
              v-model="reportReason"
              class="pfReportInput"
              rows="3"
              maxlength="2000"
              :placeholder="t('profile.report_reason_placeholder', undefined, 'Why are you reporting this user?')"
              :disabled="reportBusy"
            />
            <div v-if="reportError" class="pfReportError">{{ reportError }}</div>
            <div v-if="reportSent" class="pfReportOk">{{ t('profile.report_sent', undefined, 'Report sent. Thank you!') }}</div>
            <div class="pfReportActions">
              <button type="button" class="pfReportBtn" :disabled="reportBusy" @click="toggleReportForm">
                {{ t('common.cancel', undefined, 'Cancel') }}
              </button>
              <button type="button" class="pfReportBtn pfReportBtnPrimary" :disabled="reportBusy || !reportReason.trim()" @click="submitReport">
                {{ reportBusy ? t('common.sending', undefined, 'Sending…') : t('profile.report_send', undefined, 'Send report') }}
              </button>
            </div>
          </div>

          <div v-if="phone || username || bio || showBirthday" class="pfInfo">
            <div v-if="phone" class="pfInfoRow">
              <span class="pfInfoLabel">{{ t('profile.phone', undefined, 'Phone') }}</span>
              <span class="pfInfoValue">{{ phone }}</span>
            </div>
            <button v-if="username" type="button" class="pfInfoRow pfInfoRowAction" @click="copyUsername">
              <span class="pfInfoLabel">{{ t('settings.username', undefined, 'Username') }}</span>
              <span class="pfInfoValue">@{{ username }}</span>
            </button>
            <div v-if="bio" class="pfInfoRow pfInfoRowBlock">
              <span class="pfInfoLabel">{{ t('settings.bio', undefined, 'Bio') }}</span>
              <span class="pfInfoValue pfInfoValueBio">{{ bio }}</span>
            </div>
            <div v-if="showBirthday" class="pfInfoRow">
              <span class="pfInfoLabel">{{ t('chat.birthday', undefined, 'Birthday') }}</span>
              <span class="pfInfoValue">{{ formattedBirthday }}</span>
            </div>
          </div>

          <div v-if="showPlaylist" class="pfPlaylist">
            <div class="pfPlaylistHead">
              <v-icon icon="mdi-music-note" size="18" class="pfPlaylistIcon" />
              <span class="pfPlaylistTitle">{{ playlistTitle || t('chat.playlist', undefined, 'Playlist') }}</span>
              <span class="pfPlaylistCount">{{ playlistTracks.length }}</span>
            </div>
            <div class="pfTrackList">
              <div v-for="track in playlistTracks" :key="track.id" class="pfTrackItem">
                <span class="pfTrackMain">
                  <span class="pfTrackTitle">{{ track.title }}</span>
                  <span v-if="track.artist" class="pfTrackArtist">{{ track.artist }}</span>
                </span>
                <span v-if="track.duration > 0" class="pfTrackTime">{{ formatTrackTime(track.duration) }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.pfOverlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(9, 11, 15, 0.46);
}

.pfDialog {
  position: relative;
  width: min(360px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 24px 18px 18px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  outline: none;
}

.pfClose {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.pfClose:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.pfHead {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 4px;
}

.pfAvatar {
  width: 92px;
  height: 92px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-size: 30px;
  font-weight: 700;
  padding: 0;
}
.pfAvatar:disabled {
  cursor: default;
}
.pfAvatarClickable {
  cursor: pointer;
}
.pfAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pfName {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  max-width: 100%;
  overflow-wrap: anywhere;
}

.pfUsername {
  font-size: 13px;
  color: var(--link);
}

.pfPresence {
  font-size: 12px;
  color: var(--text-muted);
}
.pfPresenceOnline {
  color: var(--accent);
}

.pfStatus {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}
.pfStatusError {
  color: #ef4444;
}

.pfActions {
  display: flex;
  gap: 6px;
  margin: 18px 0 12px;
}

.pfAction {
  flex: 1;
  min-width: 0;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 4px;
  border: 0;
  border-radius: 14px;
  background: var(--surface-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.pfAction > span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pfAction:hover:not(:disabled) {
  background: var(--accent-soft);
}
.pfAction:disabled {
  opacity: 0.45;
  cursor: default;
}
.pfActionsSecond {
  margin-top: -4px;
}
.pfActionDanger {
  color: #ef4444;
}

.pfReport {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-soft);
}
.pfReportInput {
  width: 100%;
  min-height: 72px;
  resize: vertical;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  padding: 8px 10px;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: 0;
}
.pfReportError {
  font-size: 12px;
  color: #ef4444;
}
.pfReportOk {
  font-size: 12px;
  color: var(--accent);
}
.pfReportActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.pfReportBtn {
  min-height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.pfReportBtnPrimary {
  background: #ef4444;
  border-color: #ef4444;
  color: #fff;
}
.pfReportBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.pfInfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.pfInfoRow {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 6px;
  border: 0;
  background: transparent;
  text-align: left;
  border-radius: 12px;
}
.pfInfoRowAction {
  cursor: pointer;
}
.pfInfoRowAction:hover {
  background: var(--surface-soft);
}
.pfInfoRowBlock {
  gap: 4px;
}

.pfInfoLabel {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.pfInfoValue {
  font-size: 14px;
  color: var(--text);
}
.pfInfoRowAction .pfInfoValue {
  color: var(--link);
}
.pfInfoValueBio {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.pfPlaylist {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.pfPlaylistHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 6px 6px;
}

.pfPlaylistIcon {
  color: var(--link);
}

.pfPlaylistTitle {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pfPlaylistCount {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  flex: 0 0 auto;
}

.pfPlaylistEmpty {
  padding: 4px 6px 10px;
  font-size: 13px;
  color: var(--text-muted);
}

.pfTrackList {
  display: grid;
  gap: 2px;
  padding-bottom: 4px;
}

.pfTrackItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 12px;
}

.pfTrackMain {
  display: grid;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}

.pfTrackTitle {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pfTrackArtist {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pfTrackTime {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.pfFade-enter-active,
.pfFade-leave-active {
  transition: opacity 140ms ease;
}
.pfFade-enter-active .pfDialog,
.pfFade-leave-active .pfDialog {
  transition: transform 160ms ease;
}
.pfFade-enter-from,
.pfFade-leave-to {
  opacity: 0;
}
.pfFade-enter-from .pfDialog,
.pfFade-leave-to .pfDialog {
  transform: translateY(8px) scale(0.98);
}
</style>
