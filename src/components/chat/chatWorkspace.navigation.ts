import type { ComputedRef, Ref } from 'vue'
import { acceptChannelInviteLink, acceptChatInvite, getStandaloneChannel, getUserByID, searchDirectory, type ChatItem, type ChatMemberProfile } from 'combox-api'
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
        // Re-issuing the same group id means "collapse back to the topics
        // list": drop the open channel first, otherwise the previously
        // selected channel pops right back open instead of the list.
        if ((input.selectedGroupChannelByGroupId.value[groupID] || '').trim()) {
          input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [groupID]: '' }
          input.persistGroupSelection()
        }
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
    const normalizedKind = (chat.kind || '').trim()
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

    // A directory hit may not be in the list yet (new subscription, list still
    // loading). Show it as a preview instead of injecting a synthetic chat:
    // injected rows used to survive in the chat cache as ghost "standard" chats.
    if (!input.chats.value.some((item) => item.id === chatID)) {
      input.invitePreviewChat.value = normalizedChat
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

  function pendingDirectChatID(userID: string): string {
    return `${PENDING_CHAT_PREFIX}${userID}`
  }

  async function fillPendingDirectTitle(userID: string, pendingID: string) {
    try {
      const user = await getUserByID(userID)
      const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || (user.username || '').trim()
      if (!name || input.invitePreviewChat.value?.id !== pendingID) return
      input.invitePreviewChat.value = { ...input.invitePreviewChat.value, title: name }
    } catch {
      // the preview keeps the title it was opened with
    }
  }

  // Opens a conversation without creating it server-side: the chat is created
  // on the first outgoing message (resolvePendingDirectChat).
  async function openDirectChatWithUser(userIDRaw: string, titleHint?: string) {
    const userID = (userIDRaw || '').trim()
    if (!userID) return
    const existing = input.chats.value.find((chat) => Boolean(chat.is_direct) && (chat.peer_user_id || '').trim() === userID)
    if (existing?.id) {
      await selectChat(existing.id)
      return
    }
    const pendingID = pendingDirectChatID(userID)
    const title = (titleHint || '').trim()
    input.invitePreviewChat.value = {
      id: pendingID,
      title,
      is_direct: true,
      type: 'standard',
      kind: 'direct',
      peer_user_id: userID,
      created_at: new Date().toISOString(),
    } as ChatItem
    await selectChat(pendingID)
    if (!title) void fillPendingDirectTitle(userID, pendingID)
  }

  async function adoptDirectChat(pendingID: string, chat: ChatItem) {
    const chatID = (chat?.id || '').trim()
    if (!chatID) return
    if (!input.chats.value.some((item) => item.id === chatID)) {
      input.chats.value = [chat, ...input.chats.value]
      writeJSON(CHATS_CACHE_KEY, input.chats.value)
    }
    if (input.invitePreviewChat.value?.id === pendingID) input.invitePreviewChat.value = null
    if (input.selectedChatID.value === pendingID) await selectChat(chatID)
  }

  async function resolvePendingDirectChat(pendingIDRaw: string): Promise<string> {
    const pendingID = (pendingIDRaw || '').trim()
    if (!pendingID.startsWith(PENDING_CHAT_PREFIX)) return pendingID
    const userID = pendingID.slice(PENDING_CHAT_PREFIX.length).trim()
    if (!userID) return ''

    const existing = input.chats.value.find((chat) => Boolean(chat.is_direct) && (chat.peer_user_id || '').trim() === userID)
    if (existing?.id) {
      await adoptDirectChat(pendingID, existing)
      return existing.id
    }
    try {
      const payload = await input.directChatClient.openDirectChat({ recipient_user_id: userID })
      const chat = payload.chat
      if (!chat?.id) return ''
      await adoptDirectChat(pendingID, chat)
      void input.loadChats()
      return chat.id
    } catch {
      return ''
    }
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
    const title = `${exact.first_name || ''} ${exact.last_name || ''}`.trim() || exact.username
    await openDirectChatWithUser(exact.id, title)
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
    resolvePendingDirectChat,
    acceptInviteFromHashIfNeeded,
    acceptInviteLinkFromHashIfNeeded,
    openChannelFromHashIfNeeded,
    handleHashChange,
  }
}
