import type { ComputedRef, Ref } from 'vue'
import { acceptChannelInviteLink, acceptChatInvite, getStandaloneChannel, searchDirectory, type ChatItem, type ChatMemberProfile } from 'combox-api'
import type { ViewMessage } from './chatTypes'
import { CHATS_CACHE_KEY, PENDING_CHAT_PREFIX } from './chatWorkspace.constants'
import { clearHash, readChatSelectionFromHash, readInviteLinkTokenFromHash, readInviteTokenFromHash, readPublicSlugFromHash, setHashToChatId } from './chatWorkspace.hash'
import { writeJSON } from './chatWorkspace.storage'
import type { PeerProfile } from './chatWorkspace.types'

type DirectChatClient = {
  openDirectChat(input: { recipient_user_id: string }): Promise<{ chat: ChatItem }>
}

type WorkspaceNavigationInput = {
  t: (key: string) => string
  errorText: Ref<string>
  chats: Ref<ChatItem[]>
  selectedChatID: Ref<string>
  selectedChat: ComputedRef<ChatItem | null>
  invitePreviewChat: Ref<ChatItem | null>
  focusedInfoUserProfile: Ref<PeerProfile | null>
  replyToMessage: Ref<ViewMessage | null>
  messageSearchOpen: Ref<boolean>
  messageSearch: Ref<string>
  chatMenuAnchor: Ref<unknown | null>
  groupChannelsOpen: Ref<boolean>
  selectedGroupChannelByGroupId: Ref<Record<string, string>>
  chatMembers: Ref<ChatMemberProfile[]>
  peerProfile: Ref<PeerProfile | null>
  loadChats: () => Promise<void>
  loadGroupChannels: (groupChatID: string) => Promise<void>
  loadMessages: (chatID: string) => Promise<void>
  persistGroupSelection: () => void
  resolveGroupChannelIdByTopicNumber: (groupIDRaw: string, topicNumberRaw: number | null | undefined) => string
  directChatClient: DirectChatClient
}

export function setupWorkspaceNavigation(input: WorkspaceNavigationInput) {
  async function selectChat(chatID: string) {
    if (chatID === input.selectedChatID.value) {
      const selected = input.chats.value.find((chat) => chat.id === chatID)
      const groupID = selected && (selected.kind || '').trim() === 'group' ? selected.id : ''
      if (groupID) {
        if (!input.groupChannelsOpen.value) input.groupChannelsOpen.value = true
        await input.loadGroupChannels(groupID)
      }
      return
    }
    input.selectedChatID.value = chatID
    input.invitePreviewChat.value = input.chats.value.find((chat) => chat.id === chatID) || input.invitePreviewChat.value
    input.focusedInfoUserProfile.value = null
    input.replyToMessage.value = null
    input.messageSearchOpen.value = false
    input.messageSearch.value = ''
    input.chatMenuAnchor.value = null

    if (chatID) {
      const selected = input.chats.value.find((chat) => chat.id === chatID)
      const kind = (selected?.kind || '').trim()
      if (kind === 'group') {
        input.groupChannelsOpen.value = true
        // Do not auto-select any topic when opening a group; show the topics list only.
        if ((input.selectedGroupChannelByGroupId.value[chatID] || '').trim()) {
          input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [chatID]: '' }
          input.persistGroupSelection()
        }
        await input.loadGroupChannels(chatID)
      } else {
        input.groupChannelsOpen.value = false
      }
    } else {
      input.groupChannelsOpen.value = false
    }
  }

  async function selectDirectoryChat(chat: Partial<ChatItem> & { id: string; title: string; kind?: string }) {
    const chatID = (chat.id || '').trim()
    if (!chatID) return
    const rawKind = (chat.kind || '').trim()
  const normalizedKind = rawKind
    const normalizedChat = {
      id: chatID,
      title: (chat.title || '').trim() || 'Channel',
      is_direct: false,
      type: chat.type || 'standard',
      kind: normalizedKind || 'standalone_channel',
      is_public: chat.is_public ?? (normalizedKind === 'standalone_channel'),
      public_slug: chat.public_slug,
      viewer_role: chat.viewer_role,
      subscriber_count: chat.subscriber_count,
      avatar_data_url: chat.avatar_data_url,
      avatar_gradient: chat.avatar_gradient,
      last_message_preview: chat.last_message_preview,
      created_at: chat.created_at || new Date().toISOString(),
    } as ChatItem
    const isPublicPreviewOnly =
      (normalizedChat.kind || '').trim() === 'standalone_channel' &&
      !String(normalizedChat.viewer_role || '').trim() &&
      !input.chats.value.some((item) => item.id === chatID)

    if (isPublicPreviewOnly) {
      input.invitePreviewChat.value = normalizedChat
    } else if (!input.chats.value.some((item) => item.id === chatID)) {
      input.chats.value = [normalizedChat, ...input.chats.value]
      writeJSON(CHATS_CACHE_KEY, input.chats.value)
    }
    if ((normalizedChat.kind || '').trim() === 'standalone_channel') {
      try {
        input.invitePreviewChat.value = await getStandaloneChannel(chatID)
      } catch {
        // keep preview fallback
      }
    }
    await selectChat(chatID)
  }

  async function openDirectChatWithUser(userIDRaw: string) {
    const userID = (userIDRaw || '').trim()
    if (!userID) return
    const existing = input.chats.value.find((chat) => Boolean(chat.is_direct) && (chat.peer_user_id || '').trim() === userID)
    if (existing?.id) {
      await selectChat(existing.id)
      return
    }
    const payload = await input.directChatClient.openDirectChat({ recipient_user_id: userID })
    if (!input.chats.value.some((item) => item.id === payload.chat.id)) {
      input.chats.value = [payload.chat, ...input.chats.value]
      writeJSON(CHATS_CACHE_KEY, input.chats.value)
    }
    await input.loadChats()
    await selectChat(payload.chat.id)
  }

  async function openDirectChatByUsername(usernameRaw: string) {
    const username = (usernameRaw || '').trim().replace(/^@+/, '').toLowerCase()
    if (!username) return
    const fromMembers = input.chatMembers.value.find((item) => ((item.profile?.username || '').trim().toLowerCase() === username))
    if (fromMembers?.user_id) {
      await openDirectChatWithUser(fromMembers.user_id)
      return
    }
    const peerID = (input.peerProfile.value?.id || '').trim()
    const peerUsername = (input.peerProfile.value?.username || '').trim().toLowerCase()
    if (peerID && peerUsername === username) {
      await openDirectChatWithUser(peerID)
      return
    }
    const results = await searchDirectory({ q: username, scope: 'users', limit: 20 } as never)
    const exact = (results.users || []).find((item) => (item.username || '').trim().toLowerCase() === username)
    if (!exact?.id) return
    await openDirectChatWithUser(exact.id)
  }

  async function acceptInviteFromHashIfNeeded() {
    const token = readInviteTokenFromHash()
    if (!token) return
    try {
      const payload = await acceptChatInvite(token)
      await input.loadChats()
      if (payload.chat?.id) {
        input.selectedChatID.value = payload.chat.id
        setHashToChatId(payload.chat.id)
        await input.loadMessages(payload.chat.id)
      } else {
        clearHash()
      }
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.accept_invite_error')
      clearHash()
    }
  }

  async function acceptInviteLinkFromHashIfNeeded() {
    const token = readInviteLinkTokenFromHash()
    if (!token) return
    try {
      const payload = await acceptChannelInviteLink(token)
      await input.loadChats()
      if (payload.chat?.id) {
        input.invitePreviewChat.value = payload.chat
        input.selectedChatID.value = payload.chat.id
        setHashToChatId(payload.chat.id)
        await input.loadMessages(payload.chat.id)
      } else {
        clearHash()
      }
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.accept_invite_error')
      clearHash()
    }
  }

  async function openChannelFromHashIfNeeded() {
    const slug = readPublicSlugFromHash()
    if (!slug) return
    try {
      const results = await searchDirectory({ q: `@${slug}`, scope: 'all', limit: 20 } as never)
      const found = (results.chats || []).find((chat) => ((chat.public_slug || '').trim().replace(/^@+/, '').toLowerCase() === slug.toLowerCase()))
      if (!found?.id) {
        clearHash()
        return
      }
      input.invitePreviewChat.value = {
        id: found.id,
        title: found.title,
        is_direct: false,
        type: 'standard',
        kind: found.kind || 'standalone_channel',
        is_public: true,
        public_slug: found.public_slug,
        created_at: new Date().toISOString(),
      }
      await selectDirectoryChat(found as Partial<ChatItem> & { id: string; title: string; kind?: string })
      setHashToChatId(found.id)
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.search_failed')
      clearHash()
    }
  }

  const handleHashChange = async () => {
    if (readInviteTokenFromHash()) {
      void acceptInviteFromHashIfNeeded()
      return
    }
    if (readInviteLinkTokenFromHash()) {
      void acceptInviteLinkFromHashIfNeeded()
      return
    }
    if (readPublicSlugFromHash()) {
      void openChannelFromHashIfNeeded()
      return
    }
    const selection = readChatSelectionFromHash(PENDING_CHAT_PREFIX)
    const fromHash = selection.chatID
    if (!fromHash) {
      input.selectedChatID.value = ''
      return
    }
    if (!input.chats.value.some((chat) => chat.id === fromHash)) return
    if (input.selectedChatID.value !== fromHash) input.selectedChatID.value = fromHash
    const target = input.chats.value.find((chat) => chat.id === fromHash)
    if ((target?.kind || '').trim() !== 'group') {
      input.groupChannelsOpen.value = false
      return
    }
    input.groupChannelsOpen.value = true
    await input.loadGroupChannels(fromHash)
    const nextChannelID = input.resolveGroupChannelIdByTopicNumber(fromHash, selection.channelTopicNumber)
    if ((input.selectedGroupChannelByGroupId.value[fromHash] || '').trim() !== nextChannelID) {
      input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [fromHash]: nextChannelID }
      input.persistGroupSelection()
    }
  }

  return {
    selectChat,
    selectDirectoryChat,
    openDirectChatWithUser,
    openDirectChatByUsername,
    acceptInviteFromHashIfNeeded,
    acceptInviteLinkFromHashIfNeeded,
    openChannelFromHashIfNeeded,
    handleHashChange,
  }
}
