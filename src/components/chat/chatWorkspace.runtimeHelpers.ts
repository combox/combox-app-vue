import type { ComputedRef, Ref } from 'vue'
import type { ChatFilter, PendingFile } from './chatWorkspace.types'

type SetupWorkspaceRuntimeHelpersInput = {
  currentUser: { id?: string } | null
  activeGroupID: ComputedRef<string>
  activeMessagesChatID: ComputedRef<string>
  selectedGroupChannelByGroupId: Ref<Record<string, string>>
  groupChannelsOpen: Ref<boolean>
  unreadByChatId: Ref<Record<string, number>>
  chatFilter: Ref<ChatFilter>
  pendingFiles: Ref<PendingFile[]>
  processedIncomingMessageIDs: Ref<Set<string>>
  windowActive: Ref<boolean>
  isNearBottom: Ref<boolean>
  persistGroupSelection: () => void
}

export function setupWorkspaceRuntimeHelpers(input: SetupWorkspaceRuntimeHelpersInput) {
  function syncWindowActivity() {
    input.windowActive.value = document.visibilityState === 'visible' && document.hasFocus()
  }

  function selectGroupChannel(channelChatID: string) {
    const groupID = input.activeGroupID.value
    if (!groupID) return
    const clean = (channelChatID || '').trim() || groupID
    if (input.selectedGroupChannelByGroupId.value[groupID] === clean) return
    input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [groupID]: clean }
    input.persistGroupSelection()
  }

  function closeGroupChannelsPanel() {
    input.groupChannelsOpen.value = false
  }

  function applyUnreadFromIncoming(chatIDRaw: string, senderUserIDRaw: string, messageIDRaw: string) {
    const chatID = (chatIDRaw || '').trim()
    const senderUserID = (senderUserIDRaw || '').trim()
    const messageID = (messageIDRaw || '').trim()
    if (!chatID || !senderUserID) return
    if ((input.currentUser?.id || '').trim() && senderUserID === (input.currentUser?.id || '').trim()) return

    if (messageID) {
      if (input.processedIncomingMessageIDs.value.has(messageID)) return
      input.processedIncomingMessageIDs.value.add(messageID)
      if (input.processedIncomingMessageIDs.value.size > 2000) {
        input.processedIncomingMessageIDs.value.clear()
        input.processedIncomingMessageIDs.value.add(messageID)
      }
    }

    const activeChat = input.activeMessagesChatID.value.trim()
    const isActiveChat = activeChat && activeChat === chatID
    const shouldCountAsUnread = !input.windowActive.value || !isActiveChat || !input.isNearBottom.value
    if (!shouldCountAsUnread) return

    input.unreadByChatId.value = { ...input.unreadByChatId.value, [chatID]: (input.unreadByChatId.value[chatID] || 0) + 1 }
  }

  function setChatFilter(value: ChatFilter) {
    input.chatFilter.value = value
  }

  function setPendingFiles(files: FileList) {
    const next = Array.from(files)
      .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
      .map((file) => ({
        id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
      }))
    input.pendingFiles.value = [...input.pendingFiles.value, ...next].slice(0, 8)
  }

  function removePendingFile(id: string) {
    input.pendingFiles.value = input.pendingFiles.value.filter((item) => item.id !== id)
  }

  return {
    syncWindowActivity,
    selectGroupChannel,
    closeGroupChannelsPanel,
    applyUnreadFromIncoming,
    setChatFilter,
    setPendingFiles,
    removePendingFile,
  }
}
