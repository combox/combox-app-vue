import { deleteMessage, getUserByID, type ChatItem, type ChatMemberProfile } from 'combox-api'
import type { ComputedRef, Ref } from 'vue'
import { writeJSON } from './chatWorkspace.storage'
import { MSG_CACHE_PREFIX } from './chatWorkspace.constants'
import type { ChatMenuAnchor, PeerProfile } from './chatWorkspace.types'
import type { ViewMessage } from './chatTypes'

type PresenceClientLike = {
  getPresence: (userIds: string[]) => Promise<Array<Record<string, unknown>>>
}

type PresenceSnapshot = {
  online: boolean
  last_seen?: string
  last_seen_visible?: boolean
}

type CreateContextActionsInput = {
  currentUser: { id?: string } | null
  selectedChat: ComputedRef<ChatItem | null>
  directPeerId: ComputedRef<string>
  activeMessagesChatID: ComputedRef<string>
  contextMenu: Ref<{ x: number; y: number; message: ViewMessage } | null>
  contextReactionAnchor: Ref<{ x: number; y: number; messageId: string } | null>
  replyToMessage: Ref<ViewMessage | null>
  editingMessage: Ref<ViewMessage | null>
  pendingFiles: Ref<Array<{ id: string; file: File; progress: number }>>
  rawMessages: Ref<Array<{ id: string } & Record<string, unknown>>>
  photoViewerSrc: Ref<string>
  videoViewer: Ref<{ attachmentID: string; src: string; poster?: string; filename?: string } | null>
  infoOpen: Ref<boolean>
  chatMenuAnchor: Ref<ChatMenuAnchor | null>
  focusedInfoUserProfile: Ref<PeerProfile | null>
  peerProfile: Ref<PeerProfile | null>
  chatMembers: Ref<ChatMemberProfile[]>
  removedChatMembers: Ref<ChatMemberProfile[]>
  selectedChatInviteLinks: Ref<unknown[]>
  messageSearchOpen: Ref<boolean>
  messageSearch: Ref<string>
  sidebarPanel: Ref<'chats' | 'settings'>
  presenceByUserId: Ref<Record<string, { user_id: string; online: boolean; last_seen?: string; last_seen_visible?: boolean }>>
  presenceClient: PresenceClientLike
  reactToMessage: (messageID: string, emoji: string) => Promise<void> | void
  loadChats: () => Promise<void>
  errorText: Ref<string>
  refreshSelectedChannel: (chatID: string) => Promise<void>
  refreshRemovedChatMembers: (chatID: string) => Promise<void>
  refreshSelectedChatInviteLinks: (chatID: string) => Promise<void>
  normalizePeerProfile: (input: unknown) => PeerProfile | null
}

export function createContextActions(deps: CreateContextActionsInput) {
  function openContextMenu(input: { x: number; y: number; message: ViewMessage }) {
    deps.contextMenu.value = input
  }

  function closeContextMenu() {
    deps.contextMenu.value = null
  }

  function openContextReactionPicker() {
    if (!deps.contextMenu.value) return
    deps.contextReactionAnchor.value = {
      x: deps.contextMenu.value.x,
      y: deps.contextMenu.value.y,
      messageId: deps.contextMenu.value.message.raw.id,
    }
    deps.contextMenu.value = null
  }

  function closeContextReactionPicker() {
    deps.contextReactionAnchor.value = null
  }

  function selectReactionFromPicker(emoji: string) {
    const messageId = deps.contextReactionAnchor.value?.messageId || ''
    if (!messageId) return
    void deps.reactToMessage(messageId, emoji)
    deps.contextReactionAnchor.value = null
  }

  function copyContextMessage() {
    const text = deps.contextMenu.value?.message.text || ''
    if (text) void navigator.clipboard.writeText(text)
    deps.contextMenu.value = null
  }

  function replyFromContextMenu() {
    if (!deps.contextMenu.value) return
    deps.editingMessage.value = null
    deps.replyToMessage.value = deps.contextMenu.value.message
    deps.contextMenu.value = null
  }

  function beginReplyToMessage(message: ViewMessage | null) {
    deps.editingMessage.value = null
    deps.replyToMessage.value = message
  }

  function clearReplyToMessage() {
    deps.replyToMessage.value = null
  }

  function editFromContextMenu(message: ViewMessage | null = deps.contextMenu.value?.message || null) {
    if (!message) {
      deps.editingMessage.value = null
      deps.pendingFiles.value = []
      return
    }
    deps.replyToMessage.value = null
    deps.editingMessage.value = message
    deps.pendingFiles.value = []
    deps.contextMenu.value = null
  }

  async function deleteContextMessage() {
    const target = deps.contextMenu.value?.message
    if (!target) return
    try {
      await deleteMessage(target.raw.id)
      deps.rawMessages.value = deps.rawMessages.value.filter((item) => item.id !== target.raw.id)
      if (deps.activeMessagesChatID.value) {
        writeJSON(`${MSG_CACHE_PREFIX}${deps.activeMessagesChatID.value}`, deps.rawMessages.value)
      }
      deps.contextMenu.value = null
      void deps.loadChats()
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Delete failed'
    }
  }

  function openPhotoViewer(src: string) {
    deps.photoViewerSrc.value = (src || '').trim()
  }

  function closePhotoViewer() {
    deps.photoViewerSrc.value = ''
  }

  function openVideoViewer(input: { attachmentID: string; src: string; poster?: string; filename?: string }) {
    deps.videoViewer.value = input
  }

  function closeVideoViewer() {
    deps.videoViewer.value = null
  }

  function openInfo() {
    deps.focusedInfoUserProfile.value = null
    deps.infoOpen.value = true
    deps.chatMenuAnchor.value = null
    if ((deps.selectedChat.value?.kind || '').trim() === 'standalone_channel') {
      void deps.refreshSelectedChannel(deps.selectedChat.value?.id || '')
      void deps.refreshRemovedChatMembers(deps.selectedChat.value?.id || '')
      void deps.refreshSelectedChatInviteLinks(deps.selectedChat.value?.id || '')
      return
    }
    deps.removedChatMembers.value = []
    deps.selectedChatInviteLinks.value = []
  }

  function closeInfo() {
    deps.infoOpen.value = false
    deps.focusedInfoUserProfile.value = null
    deps.removedChatMembers.value = []
    deps.selectedChatInviteLinks.value = []
  }

  async function openInfoForUser(userIDRaw: string) {
    const userID = (userIDRaw || '').trim()
    if (!userID) return
    if ((deps.currentUser?.id || '').trim() === userID) return

    if (deps.selectedChat.value?.is_direct && (deps.directPeerId.value || '').trim() === userID) {
      deps.focusedInfoUserProfile.value = null
      deps.infoOpen.value = true
      deps.chatMenuAnchor.value = null
      return
    }

    const fromMembers = deps.chatMembers.value.find((item) => (item.user_id || '').trim() === userID)?.profile
    const normalizedFromMembers = deps.normalizePeerProfile(fromMembers || null)
    if (normalizedFromMembers) {
      deps.focusedInfoUserProfile.value = normalizedFromMembers
    } else {
      try {
        const profile = await getUserByID(userID)
        const normalized = deps.normalizePeerProfile(profile)
        if (normalized) deps.focusedInfoUserProfile.value = normalized
      } catch {
        deps.focusedInfoUserProfile.value = null
      }
    }

    try {
      const items = await deps.presenceClient.getPresence([userID])
      if (Array.isArray(items) && items.length > 0) {
        const item = items[0] as PresenceSnapshot
        deps.presenceByUserId.value = {
          ...deps.presenceByUserId.value,
          [userID]: {
            user_id: userID,
            online: Boolean(item.online),
            last_seen: typeof item.last_seen === 'string' ? item.last_seen : undefined,
            last_seen_visible: typeof item.last_seen_visible === 'boolean' ? item.last_seen_visible : true,
          },
        }
      }
    } catch {
      // keep existing presence
    }

    deps.infoOpen.value = true
    deps.chatMenuAnchor.value = null
  }

  function openMessageSearch() {
    deps.messageSearchOpen.value = true
    deps.chatMenuAnchor.value = null
  }

  function closeMessageSearch() {
    deps.messageSearchOpen.value = false
    deps.messageSearch.value = ''
  }

  function openChatMenu(anchor: ChatMenuAnchor) {
    deps.chatMenuAnchor.value = anchor
  }

  function closeChatMenu() {
    deps.chatMenuAnchor.value = null
  }

  function openSidebarSettings() {
    deps.sidebarPanel.value = 'settings'
  }

  function closeSidebarSettings() {
    deps.sidebarPanel.value = 'chats'
  }

  return {
    openContextMenu,
    closeContextMenu,
    openContextReactionPicker,
    closeContextReactionPicker,
    selectReactionFromPicker,
    copyContextMessage,
    replyFromContextMenu,
    beginReplyToMessage,
    editFromContextMenu,
    clearReplyToMessage,
    deleteContextMessage,
    openPhotoViewer,
    closePhotoViewer,
    openVideoViewer,
    closeVideoViewer,
    openInfo,
    closeInfo,
    openInfoForUser,
    openMessageSearch,
    closeMessageSearch,
    openChatMenu,
    closeChatMenu,
    openSidebarSettings,
    closeSidebarSettings,
  }
}
