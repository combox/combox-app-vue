import { computed, type Ref } from 'vue'
import type { ChatItem, ChatMemberProfile, MessageItem } from 'combox-api'
import { toViewMessage } from './chatUtils'
import { formatRelativeTime, useRelativeClock } from '../../utils/relativeTime'
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
  typingByChat: Ref<Record<string, Record<string, number>>>
}

export function setupWorkspaceComputed(input: SetupWorkspaceComputedInput) {
  const relativeClock = useRelativeClock()
  const isGroupChannel = (chat: ChatItem): boolean => {
    const kind = (chat.kind || '').trim()
    if (kind !== 'channel') return false
    // Group "topics"/channels have a parent group id; they should not appear in the main chat list.
    return Boolean((chat.parent_chat_id || '').trim())
  }
  const isDirectChat = (chat: ChatItem): boolean => {
    const kind = (chat.kind || '').trim()
    if (kind === 'standalone_channel') return false
    // Service/bot notifications ("Combox service notifications") belong to Direct.
    return Boolean(chat.is_direct) || kind === 'bot'
  }
  const isStandaloneChannel = (chat: ChatItem): boolean => (chat.kind || '').trim() === 'standalone_channel'

  const selectedChat = computed(() => input.chats.value.find((chat) => chat.id === input.selectedChatID.value) || input.invitePreviewChat.value || null)
  const directPeerId = computed(() => (selectedChat.value?.is_direct ? (selectedChat.value?.peer_user_id || '').trim() : ''))
  const directoryQuery = computed(() => input.sidebarSearch.value.trim())
  const selectedFilterTab = computed(() => (input.chatFilter.value === 'all' ? 0 : input.chatFilter.value === 'direct' ? 1 : input.chatFilter.value === 'channel' ? 2 : 3))
  const filteredChats = computed(() => {
    const byType = input.chats.value
      .filter((chat) => !isGroupChannel(chat))
      .filter((chat) => {
        if (input.chatFilter.value === 'all') return true
        if (input.chatFilter.value === 'direct') return isDirectChat(chat)
        if (input.chatFilter.value === 'channel') return isStandaloneChannel(chat)
        if (input.chatFilter.value === 'group') return (chat.kind || '').trim() === 'group'
        return true
      })
    // The directory search also runs for plain text, so the local list is
    // filtered by title/slug on every query (a leading "@" only switches the
    // backend lookup to username/slug prefix matching).
    const q = input.sidebarSearch.value.trim().replace(/^@+/, '').toLowerCase()
    if (!q) return byType
    return byType.filter((chat) => (chat.title || '').toLowerCase().includes(q) || (chat.public_slug || '').toLowerCase().includes(q))
  })
  const unreadCounts = computed(() => {
    let all = 0
    let direct = 0
    let channel = 0
    let group = 0
    for (const chat of input.chats.value.filter((item) => !isGroupChannel(item))) {
      if (chat.archived) continue
      const unread = Math.max(0, input.unreadByChatId.value[chat.id] || 0)
      if (!unread || input.mutedChatIDs.value[chat.id]) continue
      all += 1
      if (isDirectChat(chat)) direct += 1
      else if (isStandaloneChannel(chat)) channel += 1
      else group += 1
    }
    return { all, direct, channel, group }
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
  /** Live typing state for the selected chat: keys are peer user ids (self excluded). */
  const selectedTypingUserIds = computed(() => {
    const chatID = (input.selectedChatID.value || '').trim()
    if (!chatID) return [] as string[]
    return Object.keys(input.typingByChat.value[chatID] || {})
  })
  const chatSubtitle = computed(() => {
    if (!selectedChat.value) return ''
    if (!selectedChat.value.is_direct) {
      if ((selectedChat.value.kind || '').trim() === 'bot') {
        return input.t('chat.bot_subtitle', {}, 'System bot')
      }
      if ((selectedChat.value.kind || '').trim() === 'standalone_channel') {
        const count = Number(selectedChat.value.subscriber_count || input.chatMembers.value.length || 0)
        return count > 0 ? input.t('chat.subscribers', { count }, `${count} subscribers`) : ''
      }
      const count = input.chatMembers.value.length
      return count > 0 ? input.t('chat.participants', { count }, `${count} participants`) : ''
    }
    const peerID = directPeerId.value
    if (!peerID) return input.t('chat.offline')
    // "typing…" outranks "online"/"last seen" while the peer is composing.
    if (selectedTypingUserIds.value.length > 0) return input.t('chat.typing', undefined, 'typing')
    const presence = input.presenceByUserId.value[peerID]
    if (!presence) return input.t('chat.offline')
    if (presence.online) return input.t('chat.online')
    if (presence.last_seen_visible && presence.last_seen) {
      const relative = formatRelativeTime(presence.last_seen, relativeClock.value)
      if (relative) return input.t('chat.last_seen_at', { time: relative }, `last seen ${relative}`)
    }
    return input.t('chat.offline')
  })
  const infoSubtitle = computed(() => {
    if (input.focusedInfoUserProfile.value?.id) {
      const focusedID = input.focusedInfoUserProfile.value.id
      if (selectedTypingUserIds.value.includes(focusedID)) return input.t('chat.typing', undefined, 'typing')
      const presence = input.presenceByUserId.value[focusedID]
      if (!presence) return ''
      if (presence.online) return input.t('chat.online')
      if (presence.last_seen_visible && presence.last_seen) {
        const relative = formatRelativeTime(presence.last_seen, relativeClock.value)
        if (relative) return input.t('chat.last_seen_at', { time: relative }, `last seen ${relative}`)
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
