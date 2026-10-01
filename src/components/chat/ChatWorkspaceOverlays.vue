<script setup lang="ts">
import type { ChatItem } from 'combox-api'
import { clearChatHistory, exportChatHistory } from 'combox-api'
import { computed, defineAsyncComponent, inject, nextTick, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { reloadChatList, scrollToChatTop } from '../../utils/chatListActions'
import { openPollCreateDialog } from '../../utils/pollCreate'
import { openProfileModal } from '../../utils/profileModal'
import AvatarViewer from '../core/AvatarViewer.vue'
import UserProfileModal from '../profile/UserProfileModal.vue'
import { CHAT_LIST_ACTIONS } from './chatWorkspace.actions.list'
import { MSG_CACHE_PREFIX } from './chatWorkspace.constants'
import { writeJSON } from './chatWorkspace.storage'
import WallpaperPickerDialog from './WallpaperPickerDialog.vue'

const PhotoViewer = defineAsyncComponent(() => import('./PhotoViewer.vue'))
const VideoViewer = defineAsyncComponent(() => import('./VideoViewer.vue'))

const props = withDefaults(
  defineProps<{
    viewerSrc: string
    videoViewer: { attachmentID: string; src: string; poster?: string; filename?: string } | null
    selectedChat: ChatItem | null
    chatMenuAnchor: { top: number; left: number; width: number; height: number } | null
    isSelectedChatMuted: boolean
    isSelectedChatPinned: boolean
    /** 'compact' = the group topics pane menu (no history/media utilities). */
    menuVariant?: 'full' | 'compact'
    /** Active messages chat (topic) id; falls back to selectedChat.id when empty. */
    messagesChatID?: string
  }>(),
  { menuVariant: 'full', messagesChatID: '' },
)

const emit = defineEmits<{
  closePhotoViewer: []
  closeVideoViewer: []
  closeChatMenu: []
  openInfo: []
  openMessageSearch: []
  toggleMuteSelectedChat: []
  leaveChat: [payload: { onSuccess: () => void; onError: (message: string) => void }]
  deleteChat: [chat: ChatItem]
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
  /** The workspace repaints the conversation background with the new chat. */
  wallpaperChanged: [chat: ChatItem]
}>()

const { t } = useI18n()
const toast = useToast()

/**
 * The workspace publishes its loaders through `CHAT_LIST_ACTIONS` (the same
 * bridge the sidebar uses), which is how this menu reaches the history reload
 * and the delete flow without any new wiring in `ChatWorkspace.vue`.
 */
const workspaceListActions = inject(CHAT_LIST_ACTIONS, null)

type MenuMode = 'root' | 'clearConfirm' | 'deleteConfirm'

const menuMode = ref<MenuMode>('root')
const confirmBusy = ref(false)
const confirmError = ref('')
const deleteForEveryone = ref(false)
const exporting = ref(false)
const wallpaperOpen = ref(false)
/** Local echo of the last applied wallpaper until the workspace repaints. */
const wallpaperOverride = ref<{ chatID: string; kind: 'none' | 'preset' | 'image'; value: string } | null>(null)

watch(
  () => props.chatMenuAnchor,
  (anchor) => {
    if (anchor) {
      menuMode.value = 'root'
      confirmError.value = ''
      return
    }
    menuMode.value = 'root'
    confirmBusy.value = false
    confirmError.value = ''
    deleteForEveryone.value = false
    exporting.value = false
  },
)

watch(
  () => props.selectedChat?.id,
  () => {
    wallpaperOpen.value = false
    wallpaperOverride.value = null
  },
)

/** The chat handed to the picker: the selected one, with the fresh wallpaper. */
const wallpaperChat = computed<ChatItem | null>(() => {
  const chat = props.selectedChat
  if (!chat) return null
  const override = wallpaperOverride.value
  if (!override || override.chatID !== (chat.id || '').trim()) return chat
  return { ...chat, wallpaper_kind: override.kind, wallpaper_value: override.value }
})

function onWallpaperChanged(updated: ChatItem) {
  const chatIDValue = (props.selectedChat?.id || updated.id || '').trim()
  if (chatIDValue) {
    wallpaperOverride.value = {
      chatID: chatIDValue,
      kind: updated.wallpaper_kind || 'none',
      value: updated.wallpaper_value || '',
    }
  }
  emit('wallpaper-changed', updated)
}

// Bot chats are 1:1 service conversations: they cannot be left, only deleted.
const isBotChat = computed(() => (props.selectedChat?.kind || '').trim() === 'bot')
/** Compact variant: the topics pane menu next to the group name. */
const isCompactMenu = computed(() => props.menuVariant === 'compact')
// Owners never leave — they delete: leaving would orphan a group, channel or
// topic the owner still controls. Covers group, standalone_channel and
// channel topics (kind 'channel' with parent_chat_id) for any non-direct chat.
const isChatOwner = computed(() => ((props.selectedChat?.viewer_role || '').trim().toLowerCase() === 'owner'))
const canDeleteChat = computed(
  () => Boolean(props.selectedChat && (props.selectedChat.is_direct || isBotChat.value || isChatOwner.value)),
)
const canLeaveChat = computed(
  () => Boolean(props.selectedChat && !props.selectedChat.is_direct && !isBotChat.value && !isChatOwner.value),
)

/** Direct chats only: groups, channels and topics have no peer profile. */
const peerUserID = computed(() => {
  const chat = props.selectedChat
  if (!chat || !chat.is_direct) return ''
  return (chat.peer_user_id || '').trim()
})
const canViewProfile = computed(() => Boolean(peerUserID.value))

const chatID = computed(() => (props.selectedChat?.id || '').trim())

/** Matches the confirm dialog wording: owned channels say "Delete channel". */
const deleteMenuLabel = computed(() => {
  const kind = (props.selectedChat?.kind || '').trim()
  if (kind === 'standalone_channel') return t('chat.delete_channel', undefined, 'Delete channel')
  if (kind === 'group') return t('chat.delete_group', undefined, 'Delete group')
  if (kind === 'channel') return t('chat.delete_topic', undefined, 'Delete topic')
  return t('chat.delete_chat', undefined, 'Delete chat')
})

/** Matches the workspace's own delete dialog wording per chat kind. */
const confirmTitle = computed(() => {
  if (menuMode.value === 'clearConfirm') return t('chat.clear_history', undefined, 'Clear history')
  const kind = (props.selectedChat?.kind || '').trim()
  if (kind === 'group') return t('chat.delete_group', undefined, 'Delete group')
  if (kind === 'standalone_channel') return t('chat.delete_channel', undefined, 'Delete channel')
  if (kind === 'channel') return t('chat.delete_topic', undefined, 'Delete topic')
  return t('chat.delete_chat', undefined, 'Delete chat')
})

const confirmText = computed(() =>
  menuMode.value === 'clearConfirm'
    ? t('chat.menu_clear_confirm', undefined, 'Clear history for me only? This cannot be undone.')
    : t('chat.menu_delete_confirm', undefined, 'Delete this chat? This cannot be undone.'),
)

const confirmBusyLabel = computed(() => {
  if (menuMode.value === 'clearConfirm') {
    return confirmBusy.value ? t('chat.menu_clearing', undefined, 'Clearing…') : t('chat.clear_history', undefined, 'Clear history')
  }
  return confirmBusy.value ? t('chat.menu_deleting', undefined, 'Deleting…') : t('chat.menu_delete', undefined, 'Delete')
})

const showDirectDeleteOptions = computed(() => Boolean(props.selectedChat?.is_direct))

function openInfo() {
  emit('closeChatMenu')
  emit('openInfo')
}

function openMessageSearch() {
  emit('closeChatMenu')
  emit('openMessageSearch')
}

function viewProfile() {
  const userID = peerUserID.value
  if (!userID) return
  emit('closeChatMenu')
  openProfileModal(userID, { name: (props.selectedChat?.title || '').trim() })
}

function toggleMute() {
  emit('closeChatMenu')
  emit('toggleMuteSelectedChat')
}

function toBeginning() {
  emit('closeChatMenu')
  scrollToChatTop()
}

function createPoll() {
  // Groups open the menu on the group row while messages belong to a topic:
  // prefer the active messages chat so the poll lands in the open topic.
  const id = (props.messagesChatID || '').trim() || chatID.value
  if (!id) return
  const opened = openPollCreateDialog(id)
  emit('closeChatMenu')
  if (!opened) {
    toast.error(t('chat.menu_poll_failed', undefined, 'Could not open the poll creator'))
  }
}

function openWallpaperPicker() {
  if (!chatID.value) return
  emit('closeChatMenu')
  wallpaperOpen.value = true
}

function slugify(value: string): string {
  const slug = (value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'chat'
}

async function exportHistory() {
  const id = chatID.value
  if (!id || exporting.value) return
  exporting.value = true
  try {
    const payload = await exportChatHistory(id)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `chat-export-${slugify(props.selectedChat?.title || '')}.json`
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(t('chat.menu_export_done', undefined, 'Chat history exported'))
    emit('closeChatMenu')
  } catch (error) {
    // Never fail silently: the row stays open and the host shows the reason.
    toast.error(error instanceof Error && error.message ? error.message : t('chat.menu_export_failed', undefined, 'Could not export chat history'))
  } finally {
    exporting.value = false
  }
}

function openClearConfirm() {
  if (!chatID.value) return
  confirmError.value = ''
  menuMode.value = 'clearConfirm'
}

function openDeleteConfirm() {
  if (!props.selectedChat) return
  confirmError.value = ''
  deleteForEveryone.value = false
  menuMode.value = 'deleteConfirm'
}

function cancelConfirm() {
  if (confirmBusy.value) return
  confirmError.value = ''
  menuMode.value = 'root'
}

function errorTextOf(error: unknown, fallbackKey: string, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return t(fallbackKey, undefined, fallback)
}

async function confirmClear() {
  const id = chatID.value
  if (!id || confirmBusy.value) return
  confirmBusy.value = true
  confirmError.value = ''
  try {
    await clearChatHistory(id)
    // The local message cache would otherwise repaint the removed history.
    writeJSON(`${MSG_CACHE_PREFIX}${id}`, [])
    // Refresh the message list + chat list through the workspace bridge.
    reloadChatList()
    scrollToChatTop()
    emit('closeChatMenu')
    toast.success(t('chat.menu_clear_done', undefined, 'History cleared for you'))
  } catch (error) {
    confirmError.value = errorTextOf(error, 'chat.clear_history_failed', 'Could not clear history')
    toast.error(confirmError.value)
  } finally {
    confirmBusy.value = false
  }
}

async function confirmDelete() {
  const chat = props.selectedChat
  if (!chat || confirmBusy.value) return
  const removeChat = workspaceListActions?.removeChat
  if (!removeChat) {
    // No workspace bridge: fall back to the workspace's own delete confirm.
    emit('closeChatMenu')
    emit('deleteChat', chat)
    return
  }
  confirmError.value = ''
  confirmBusy.value = true
  try {
    const removed = await removeChat(chat, { forEveryone: deleteForEveryone.value })
    if (!removed) {
      // The bridge already toasted the reason; keep the panel open next to it.
      confirmError.value = t('chat.menu_delete_failed', undefined, 'Could not delete the chat')
      return
    }
    emit('closeChatMenu')
    toast.success(t('chat.menu_delete_done', undefined, 'Chat deleted'))
  } catch (error) {
    confirmError.value = errorTextOf(error, 'chat.menu_delete_failed', 'Could not delete the chat')
    toast.error(confirmError.value)
  } finally {
    confirmBusy.value = false
  }
}

function leaveGroup() {
  emit('closeChatMenu')
  emit('leaveChat', {
    onSuccess: () => {},
    onError: (message: string) => {
      toast.error(message || t('chat.leave_chat_error', undefined, 'Could not leave the chat'))
    },
  })
}

/** Conservative fallback while the real menu size is not measured yet. */
const CHAT_MENU_FALLBACK_WIDTH = 280
const CHAT_MENU_EST_HEIGHT = 566
const CHAT_MENU_CLEAR_EST_HEIGHT = 176
const CHAT_MENU_DELETE_EST_HEIGHT = 236
const CHAT_MENU_GAP = 4
const CHAT_MENU_MARGIN = 8

/** Real menu element: its size drives the viewport clamping below. */
const chatMenuEl = ref<HTMLElement | null>(null)
const measuredMenuSize = ref({ width: 0, height: 0 })
/** Which mode the measurement above was taken in (root vs confirms). */
const measuredMenuMode = ref<MenuMode | ''>('')

function measureChatMenu() {
  const el = chatMenuEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.width > 0) measuredMenuSize.value.width = rect.width
  if (rect.height > 0) measuredMenuSize.value.height = rect.height
  measuredMenuMode.value = menuMode.value
}

watch([() => props.chatMenuAnchor, menuMode, isCompactMenu, () => props.selectedChat?.id], () => {
  void nextTick(() => measureChatMenu())
})

const menuEstHeight = computed(() => {
  if (menuMode.value === 'clearConfirm') return CHAT_MENU_CLEAR_EST_HEIGHT
  if (menuMode.value === 'deleteConfirm') return CHAT_MENU_DELETE_EST_HEIGHT
  return CHAT_MENU_EST_HEIGHT
})

const chatMenuStyle = computed(() => {
  const anchor = props.chatMenuAnchor
  if (!anchor) return {}
  const viewport = typeof window === 'undefined' ? { width: 1024, height: 768 } : { width: window.innerWidth, height: window.innerHeight }

  // CSS sizes the menu at min-width:214px / max-width:min(280px,100vw-16px),
  // so clamp by the measured width (280 fallback), never by a smaller guess.
  const menuWidth = measuredMenuSize.value.width > 0 ? measuredMenuSize.value.width : CHAT_MENU_FALLBACK_WIDTH
  const estHeight = menuEstHeight.value
  const menuHeight =
    measuredMenuMode.value === menuMode.value && measuredMenuSize.value.height > 0 ? measuredMenuSize.value.height : estHeight

  let top = anchor.top + CHAT_MENU_GAP
  let left = anchor.left + anchor.width - menuWidth

  const maxLeft = Math.max(CHAT_MENU_MARGIN, viewport.width - menuWidth - CHAT_MENU_MARGIN)
  left = Math.max(CHAT_MENU_MARGIN, Math.min(left, maxLeft))

  if (top + menuHeight > viewport.height - CHAT_MENU_MARGIN) {
    top = Math.max(CHAT_MENU_MARGIN, anchor.top - anchor.height - menuHeight - CHAT_MENU_GAP)
  }
  const maxTop = Math.max(CHAT_MENU_MARGIN, viewport.height - menuHeight - CHAT_MENU_MARGIN)
  top = Math.min(Math.max(top, CHAT_MENU_MARGIN), maxTop)

  return {
    top: `${top}px`,
    left: `${left}px`,
  }
})
</script>

<template>
  <div class="ovRoot">
    <AvatarViewer />
    <UserProfileModal />
    <PhotoViewer :open="Boolean(props.viewerSrc)" :src="props.viewerSrc" @close="emit('closePhotoViewer')" />
    <VideoViewer
      :open="Boolean(props.videoViewer)"
      :attachment-i-d="props.videoViewer?.attachmentID || ''"
      :src="props.videoViewer?.src || ''"
      :poster="props.videoViewer?.poster || ''"
      :filename="props.videoViewer?.filename || ''"
      @close="emit('closeVideoViewer')"
    />
    <WallpaperPickerDialog
      :open="wallpaperOpen"
      :chat="wallpaperChat"
      @close="wallpaperOpen = false"
      @wallpaper-changed="onWallpaperChanged"
    />

    <Teleport to="body">
      <transition name="cmFade">
        <div v-if="props.chatMenuAnchor" class="cmOverlay" @click="emit('closeChatMenu')" @contextmenu.prevent="emit('closeChatMenu')" />
      </transition>
      <transition name="cmPop">
        <div v-if="props.chatMenuAnchor" ref="chatMenuEl" class="chatMenu" :style="chatMenuStyle" @click.stop>
          <template v-if="menuMode === 'root'">
            <button type="button" class="chatMenuItem" @click="openInfo">
              <v-icon class="chatMenuIcon" icon="mdi-information-outline" size="17" />
              <span>{{ t('chat.chat_info') }}</span>
            </button>
            <button type="button" class="chatMenuItem" @click="openMessageSearch">
              <v-icon class="chatMenuIcon" icon="mdi-magnify" size="17" />
              <span>{{ t('chat.search') }}</span>
            </button>
            <button v-if="canViewProfile" type="button" class="chatMenuItem" @click="viewProfile">
              <v-icon class="chatMenuIcon" icon="mdi-account-outline" size="17" />
              <span>{{ t('chat.menu_view_profile', undefined, 'View profile') }}</span>
            </button>
            <button v-if="!isCompactMenu" type="button" class="chatMenuItem" @click="toggleMute">
              <v-icon class="chatMenuIcon" :icon="props.isSelectedChatMuted ? 'mdi-bell-outline' : 'mdi-bell-off-outline'" size="17" />
              <span>{{ props.isSelectedChatMuted ? t('chat.unmute') : t('chat.mute') }}</span>
            </button>

            <template v-if="!isCompactMenu">
              <div class="chatMenuSep" role="separator" />

              <button type="button" class="chatMenuItem" :disabled="!chatID" @click="toBeginning">
                <v-icon class="chatMenuIcon" icon="mdi-arrow-up-bold" size="17" />
                <span>{{ t('chat.menu_to_beginning', undefined, 'To Beginning') }}</span>
              </button>
              <button type="button" class="chatMenuItem" :disabled="!chatID" @click="createPoll">
                <v-icon class="chatMenuIcon" icon="mdi-poll" size="17" />
                <span>{{ t('chat.menu_create_poll', undefined, 'Create poll') }}</span>
              </button>
              <button type="button" class="chatMenuItem" :disabled="!chatID" @click="openWallpaperPicker">
                <v-icon class="chatMenuIcon" icon="mdi-image-outline" size="17" />
                <span>{{ t('chat.menu_set_wallpaper', undefined, 'Set Wallpaper…') }}</span>
              </button>
              <button type="button" class="chatMenuItem" :disabled="exporting || !chatID" @click="exportHistory">
                <v-icon class="chatMenuIcon" :icon="exporting ? 'mdi-progress-clock' : 'mdi-download-outline'" size="17" />
                <span>{{ exporting ? t('chat.menu_exporting', undefined, 'Exporting…') : t('chat.menu_export_history', undefined, 'Export chat history') }}</span>
              </button>
              <button type="button" class="chatMenuItem" :disabled="confirmBusy || !chatID" @click="openClearConfirm">
                <v-icon class="chatMenuIcon" icon="mdi-eraser-outline" size="17" />
                <span>{{ t('chat.clear_history', undefined, 'Clear history') }}</span>
              </button>
            </template>

            <div v-if="canLeaveChat || canDeleteChat" class="chatMenuSep" role="separator" />

            <button v-if="canLeaveChat" type="button" class="chatMenuItem chatMenuItemDanger" :disabled="confirmBusy" @click="leaveGroup">
              <v-icon class="chatMenuIcon" icon="mdi-exit-to-app" size="17" />
              <span>{{ t('chat.leave_chat') }}</span>
            </button>
            <button v-if="canDeleteChat" type="button" class="chatMenuItem chatMenuItemDanger" :disabled="confirmBusy" @click="openDeleteConfirm">
              <v-icon class="chatMenuIcon" icon="mdi-delete-outline" size="17" />
              <span>{{ deleteMenuLabel }}</span>
            </button>
          </template>

          <div v-else class="chatMenuConfirm">
            <div class="chatMenuConfirmTitle">{{ confirmTitle }}</div>
            <div class="chatMenuConfirmText">{{ confirmText }}</div>
            <template v-if="menuMode === 'deleteConfirm' && showDirectDeleteOptions">
              <div class="chatMenuConfirmText">{{ t('chat.delete_direct_hint', undefined, 'Only you will lose this chat.') }}</div>
              <label class="chatMenuConfirmCheck">
                <input v-model="deleteForEveryone" type="checkbox" :disabled="confirmBusy" />
                <span>{{ t('chat.delete_for_everyone', undefined, 'Also delete for the other person') }}</span>
              </label>
            </template>
            <div v-if="confirmError" class="chatMenuConfirmError">{{ confirmError }}</div>
            <div class="chatMenuConfirmActions">
              <button type="button" class="chatMenuConfirmBtn" :disabled="confirmBusy" @click="cancelConfirm">
                {{ t('common.cancel', undefined, 'Cancel') }}
              </button>
              <button type="button" class="chatMenuConfirmBtn danger" :disabled="confirmBusy" @click="menuMode === 'clearConfirm' ? confirmClear() : confirmDelete()">
                {{ confirmBusyLabel }}
              </button>
            </div>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ovRoot {
  position: relative;
  width: 100%;
  height: 0;
}

.cmOverlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: transparent;
}

.chatMenu {
  position: fixed;
  z-index: 91;
  min-width: 214px;
  max-width: min(280px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow-soft);
}

.cmFade-enter-active,
.cmFade-leave-active {
  transition: opacity 140ms ease;
}

.cmFade-enter-from,
.cmFade-leave-to {
  opacity: 0;
}

.cmPop-enter-active,
.cmPop-leave-active {
  transition:
    opacity 120ms ease,
    transform 140ms ease;
  transform-origin: top right;
}

.cmPop-enter-from,
.cmPop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.chatMenuItem {
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.chatMenuItem > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chatMenuIcon { flex: none; opacity: 0.72; transition: opacity 120ms ease, transform 120ms ease; }
.chatMenuItem:hover .chatMenuIcon { opacity: 1; transform: translateX(1px); }

.chatMenuItem:hover {
  background: var(--surface-soft);
}

.chatMenuItem:disabled {
  opacity: 0.55;
  cursor: default;
}

.chatMenuItem:disabled:hover {
  background: transparent;
}

.chatMenuItem:disabled:hover .chatMenuIcon {
  opacity: 0.72;
  transform: none;
}

.chatMenuItemDanger {
  color: #ef4444;
}

.chatMenuItemDanger:hover {
  background: rgba(239, 68, 68, 0.14);
}

.chatMenuSep {
  height: 1px;
  margin: 6px 10px;
  background: var(--border);
}

.chatMenuConfirm {
  display: grid;
  gap: 10px;
  padding: 8px 10px 6px;
}

.chatMenuConfirmTitle {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}

.chatMenuConfirmText {
  font-size: 13px;
  line-height: 1.35;
  color: var(--text-muted);
}

.chatMenuConfirmCheck {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
  cursor: pointer;
  user-select: none;
}

.chatMenuConfirmCheck input {
  margin: 0;
  accent-color: var(--accent);
}

.chatMenuConfirmCheck input:disabled {
  cursor: default;
}

.chatMenuConfirmError {
  font-size: 12px;
  font-weight: 700;
  color: #ef4444;
}

.chatMenuConfirmActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chatMenuConfirmBtn {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.chatMenuConfirmBtn:hover {
  background: var(--surface-soft-hover);
}

.chatMenuConfirmBtn.danger {
  border-color: transparent;
  background: #ef4444;
  color: #fff;
}

.chatMenuConfirmBtn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
