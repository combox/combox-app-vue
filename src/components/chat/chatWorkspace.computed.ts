import { computed, type Ref } from 'vue'
import type { ChatItem, ChatMemberProfile, MessageItem } from 'combox-api'
import { toViewMessage } from './chatUtils'
import type { AttachmentView, ChatFilter, PeerProfile, PendingFile, PresenceItem } from './chatWorkspace.types'

type SetupWorkspaceComputedInput = {
  t: (key: string, params?: Record<string, string | number>, fallback?: string) => string
  chats: Ref<ChatItem[]>
  selectedChatID: Ref<string>
  invitePreviewChat: Ref<ChatItem | null>
  sidebarSearch: Ref<string>
  chatFilter: Ref<ChatFilter>
  unreadByChatId: Ref<Record<string, number>>
  mutedChatIDs: Ref<Record<string, boolean>>
  rawMessages: Ref<MessageItem[]>
  urlsByAttachment: Ref<Record<string, AttachmentView>>
  messageSearch: Ref<string>
  focusedInfoUserProfile: Ref<PeerProfile | null>
  peerProfile: Ref<PeerProfile | null>
  chatMembers: Ref<ChatMemberProfile[]>
  presenceByUserId: Ref<Record<string, PresenceItem>>
  pendingFiles: Ref<PendingFile[]>
}

export function setupWorkspaceComputed(input: SetupWorkspaceComputedInput) {
  const isGroupChannel = (chat: ChatItem): boolean => {
    const kind = (chat.kind || '').trim()
    if (kind !== 'channel') return false
    // Group "topics"/channels have a parent group id; they should not appear in the main chat list.
    return Boolean((chat.parent_chat_id || '').trim())
  }

  const selectedChat = computed(() => input.chats.value.find((chat) => chat.id === input.selectedChatID.value) || input.invitePreviewChat.value || null)
  const directPeerId = computed(() => (selectedChat.value?.is_direct ? (selectedChat.value?.peer_user_id || '').trim() : ''))
  const directoryQuery = computed(() => {
    const value = input.sidebarSearch.value.trim()
    if (!value.startsWith('@')) return ''
    return value.slice(1).trim()
  })
  const selectedFilterTab = computed(() => (input.chatFilter.value === 'all' ? 0 : input.chatFilter.value === 'direct' ? 1 : 2))
  const filteredChats = computed(() => {
    const q = input.sidebarSearch.value.trim().toLowerCase()
    const byType = input.chats.value
      .filter((chat) => !isGroupChannel(chat))
      .filter((chat) => {
        if (input.chatFilter.value === 'all') return true
        if (input.chatFilter.value === 'direct') return chat.is_direct
        return !chat.is_direct
      })
    if (!q || q.startsWith('@')) return byType
    return byType.filter((chat) => chat.title.toLowerCase().includes(q))
  })
  const unreadCounts = computed(() => {
    let all = 0
    let direct = 0
    let group = 0
    for (const chat of input.chats.value.filter((item) => !isGroupChannel(item))) {
      const unread = Math.max(0, input.unreadByChatId.value[chat.id] || 0)
      if (!unread || input.mutedChatIDs.value[chat.id]) continue
      all += 1
      if (chat.is_direct) direct += 1
      else group += 1
    }
    return { all, direct, group }
  })
  const messages = computed(() => input.rawMessages.value.map((message) => toViewMessage(message, input.urlsByAttachment.value)))
  const filteredMessages = computed(() => {
    const query = input.messageSearch.value.trim().toLowerCase()
    if (!query) return messages.value
    return messages.value.filter((message) => (message.text || '').toLowerCase().includes(query))
  })
  const hasActiveChat = computed(() => Boolean(selectedChat.value))
  const infoDisplayTitle = computed(() => {
    const source = input.focusedInfoUserProfile.value || input.peerProfile.value
    const fromPeer = `${(source?.first_name || '').trim()} ${(source?.last_name || '').trim()}`.trim()
    return fromPeer || (selectedChat.value?.title || '').trim() || 'Chat'
  })
  const chatSubtitle = computed(() => {
    if (!selectedChat.value) return ''
    if (!selectedChat.value.is_direct) {
      if ((selectedChat.value.kind || '').trim() === 'standalone_channel') {
        const count = Number(selectedChat.value.subscriber_count || input.chatMembers.value.length || 0)
        return count > 0 ? input.t('chat.subscribers', { count }, `${count} subscribers`) : ''
      }
      const count = input.chatMembers.value.length
      return count > 0 ? input.t('chat.participants', { count }, `${count} participants`) : ''
    }
    const peerID = directPeerId.value
    if (!peerID) return input.t('chat.offline')
    const presence = input.presenceByUserId.value[peerID]
    if (!presence) return input.t('chat.offline')
    if (presence.online) return input.t('chat.online')
    if (presence.last_seen_visible && presence.last_seen) {
      const d = new Date(presence.last_seen)
      if (!Number.isNaN(d.getTime())) return input.t('chat.last_seen_at', { time: d.toLocaleString() }, `last seen ${d.toLocaleString()}`)
    }
    return input.t('chat.offline')
  })
  const infoSubtitle = computed(() => {
    if (input.focusedInfoUserProfile.value?.id) {
      const presence = input.presenceByUserId.value[input.focusedInfoUserProfile.value.id]
      if (!presence) return ''
      if (presence.online) return input.t('chat.online')
      if (presence.last_seen_visible && presence.last_seen) {
        const d = new Date(presence.last_seen)
        if (!Number.isNaN(d.getTime())) return input.t('chat.last_seen_at', { time: d.toLocaleString() }, `last seen ${d.toLocaleString()}`)
      }
      return input.t('chat.offline')
    }
    return chatSubtitle.value
  })
  const uploadProgress = computed(() => {
    if (input.pendingFiles.value.length === 0) return 0
    const total = input.pendingFiles.value.reduce((sum, item) => sum + Math.max(0, Math.min(100, item.progress || 0)), 0)
    return Math.round(total / input.pendingFiles.value.length)
  })

  return {
    selectedChat,
    directPeerId,
    directoryQuery,
    selectedFilterTab,
    filteredChats,
    unreadCounts,
    messages,
    filteredMessages,
    hasActiveChat,
    infoDisplayTitle,
    chatSubtitle,
    infoSubtitle,
    uploadProgress,
  }
}
