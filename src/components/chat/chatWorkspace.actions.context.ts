import { deleteMessage, getUserByID } from 'combox-api'
import { writeJSON } from './chatWorkspace.storage'

export function createContextActions(deps: any) {
  function openContextMenu(input: { x: number; y: number; message: any }) {
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
    deps.replyToMessage.value = deps.contextMenu.value.message
    deps.contextMenu.value = null
  }

  function clearReplyToMessage() {
    deps.replyToMessage.value = null
  }

  async function deleteContextMessage() {
    const target = deps.contextMenu.value?.message
    if (!target) return
    try {
      await deleteMessage(target.raw.id)
      deps.rawMessages.value = deps.rawMessages.value.filter((item: any) => item.id !== target.raw.id)
      if (deps.selectedChatID.value) {
        writeJSON(`${deps.MSG_CACHE_PREFIX}${deps.selectedChatID.value}`, deps.rawMessages.value)
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
  }

  function closeInfo() {
    deps.infoOpen.value = false
    deps.focusedInfoUserProfile.value = null
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

    const fromMembers = deps.chatMembers.value.find((item: any) => (item.user_id || '').trim() === userID)?.profile
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
        const item = items[0] as any
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

  function openChatMenu(anchor: any) {
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
