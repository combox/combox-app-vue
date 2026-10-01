import { computed, onScopeDispose, provide, ref, watch, watchEffect } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import {
  getAttachment,
  getUserByID,
  ComboxClient,
  getCurrentUser,
  getLocalProfile,
  parseMessageContent,
  saveLocalProfile,
  searchDirectory,
  type ChatInviteLink,
  type ChatItem,
  type ChatMemberProfile,
  type MessageItem,
  type SearchResults,
  type SearchUserResult,
} from 'combox-api'
import type { ViewMessage } from './chatTypes'
import { summarizeMessagePreview } from './chatUtils'
import { useChatRealtime, type ProfileUpdatePayload } from './useChatRealtime'
import { handleCallEnded, handleCallStarted, setCallTitleResolver } from '../call/callSession'
import {
  CHATS_CACHE_KEY,
  EMPTY_SEARCH_RESULTS,
  MSG_CACHE_PREFIX,
  PENDING_CHAT_PREFIX,
  SELECTED_CHAT_KEY,
  SELECTED_GROUP_CHANNELS_KEY,
  STATUS_CACHE_PREFIX,
  STATUS_GLOBAL_CACHE_KEY,
} from './chatWorkspace.constants'
import { asRecord, normalizeMessageOrder, normalizePeerProfile } from './chatWorkspace.helpers'
import { clearHash, readChatSelectionFromHash } from './chatWorkspace.hash'
import { setupWorkspaceGroupState } from './chatWorkspace.groupState'
import { setupWorkspaceComputed } from './chatWorkspace.computed'
import { setupWorkspaceLifecycle } from './chatWorkspace.lifecycle'
import { setupWorkspaceLoaders } from './chatWorkspace.loaders'
import { setupWorkspaceActions } from './chatWorkspace.actions'
import { CHAT_LIST_ACTIONS } from './chatWorkspace.actions.list'
import { createContextActions } from './chatWorkspace.actions.context'
import { enrichChatMembers } from './chatWorkspace.members'
import { setupWorkspaceMeta } from './chatWorkspace.meta'
import { setupWorkspaceNavigation } from './chatWorkspace.navigation'
import { setupWorkspacePresence } from './chatWorkspace.presence'
import { setupWorkspaceTyping, type TypingMap } from './chatWorkspace.typing'
import { setupWorkspaceRuntimeHelpers } from './chatWorkspace.runtimeHelpers'
import { installNotificationHooks, notificationsEnabled, notificationNotice, tryPlayMessageSound, tryShowDesktopNotification } from './chatWorkspace.notifications'
import { readJSON, writeJSON } from './chatWorkspace.storage'
import { persistStatusToChatCache, persistStatusToGlobalCache } from './chatWorkspace.status'
import { setupWorkspaceWatchers } from './chatWorkspace.watchers'
import type {
  AttachmentView,
  ChatFilter,
  ChatMenuAnchor,
  MessageStatus,
  PeerProfile,
  PendingFile,
  PresenceItem,
} from './chatWorkspace.types'

const attachmentRequests = new Map<string, Promise<void>>()
const notifiedMessageIDs = new Set<string>()
let notificationPermissionSurfaced = false
const presenceClient = new ComboxClient()
const directChatClient = new ComboxClient()
const toast = useToast()

function readEventPreview(payload: Record<string, unknown>): string {
  if (typeof payload.preview === 'string' && payload.preview.trim()) return payload.preview
  if (typeof payload.content === 'string' && payload.content.trim()) return payload.content
  return ''
}

function readEventCreatedAt(payload: Record<string, unknown>): string {
  if (typeof payload.createdAt === 'string' && payload.createdAt.trim()) return payload.createdAt
  if (typeof payload.created_at === 'string' && payload.created_at.trim()) return payload.created_at
  return ''
}

function sanitizeSharedChatPatch(chat: Record<string, unknown>): Partial<ChatItem> {
  const next = { ...chat }
  delete next.archived
  delete next.pinned
  return next as Partial<ChatItem>
}

export function useChatWorkspace() {
  const { t } = useI18n()
  const cachedChats = readJSON<ChatItem[]>(CHATS_CACHE_KEY, [])
  const persistedSelectedChatID = readJSON<string>(SELECTED_CHAT_KEY, '')
  const persistedSelectedGroupChannels = readJSON<Record<string, string>>(SELECTED_GROUP_CHANNELS_KEY, {})
  const hashSelectedChatID = readChatSelectionFromHash(PENDING_CHAT_PREFIX).chatID
  const initialSelectedChatID = (() => {
    const raw =
      (hashSelectedChatID && cachedChats.some((chat) => chat.id === hashSelectedChatID) && hashSelectedChatID) ||
      (persistedSelectedChatID && cachedChats.some((chat) => chat.id === persistedSelectedChatID) && persistedSelectedChatID) ||
      ''
    if (!raw) return ''
    const found = cachedChats.find((c) => c.id === raw)
    if (!found) return raw
    return (found.kind || '').trim() === 'channel' ? (found.parent_chat_id || '').trim() || raw : raw
  })()
  const initialSelectedChannelID = (initialSelectedChatID && (persistedSelectedGroupChannels[initialSelectedChatID] || '').trim()) || ''
  const initialActiveMessagesChatID = initialSelectedChannelID || initialSelectedChatID
  const cachedMessages = initialActiveMessagesChatID ? normalizeMessageOrder(readJSON<MessageItem[]>(`${MSG_CACHE_PREFIX}${initialActiveMessagesChatID}`, [])) : []

  const currentUser = getCurrentUser()
  const localProfile = getLocalProfile()
  const chats = ref<ChatItem[]>(cachedChats)
  const rawMessages = ref<MessageItem[]>(cachedMessages)
  const selectedChatID = ref(initialSelectedChatID)
  const sidebarSearch = ref('')
  const chatFilter = ref<ChatFilter>('all')
  const sidebarPanel = ref<'chats' | 'settings'>('chats')
  const messageSearchOpen = ref(false)
  const messageSearch = ref('')
  const pendingFiles = ref<PendingFile[]>([])
  const urlsByAttachment = ref<Record<string, AttachmentView>>({})
  const directoryResults = ref<SearchResults>(EMPTY_SEARCH_RESULTS)
  const unreadByChatId = ref<Record<string, number>>({})
  const mutedChatIDs = ref<Record<string, boolean>>({})
  const messageStatusesByMessage = ref<Record<string, MessageStatus>>(readJSON<Record<string, MessageStatus>>(STATUS_GLOBAL_CACHE_KEY, {}))
  const contextMenu = ref<{ x: number; y: number; message: ViewMessage } | null>(null)
  const contextReactionAnchor = ref<{ x: number; y: number; messageId: string } | null>(null)
  const replyToMessage = ref<ViewMessage | null>(null)
  const editingMessage = ref<ViewMessage | null>(null)
  const photoViewerSrc = ref('')
  const videoViewer = ref<{ attachmentID: string; src: string; poster?: string; filename?: string } | null>(null)
  const infoOpen = ref(false)
  const chatMenuAnchor = ref<ChatMenuAnchor | null>(null)
  const peerProfile = ref<PeerProfile | null>(null)
  const focusedInfoUserProfile = ref<PeerProfile | null>(null)
  const chatMembers = ref<ChatMemberProfile[]>([])
  const removedChatMembers = ref<ChatMemberProfile[]>([])
  const selectedChatInviteLinks = ref<ChatInviteLink[]>([])
  const invitePreviewChat = ref<ChatItem | null>(null)
  const loadingGroupChannels = ref(false)
  const loadingChats = ref(false)
  const loadingMessages = ref(false)
  const searchingDirectory = ref(false)
  const sending = ref(false)
  const errorText = ref('')
  let errorClearTimer: number | null = null

  watch(errorText, (value) => {
    if (errorClearTimer) {
      window.clearTimeout(errorClearTimer)
      errorClearTimer = null
    }
    if (!value) return
    errorClearTimer = window.setTimeout(() => {
      errorClearTimer = null
      if (errorText.value === value) errorText.value = ''
    }, 6000)
  })

  onScopeDispose(() => {
    if (errorClearTimer) {
      window.clearTimeout(errorClearTimer)
      errorClearTimer = null
    }
  })
  const readReportedMessageIDs = ref(new Set<string>())

  const windowActive = ref(true)
  const isNearBottom = ref(true)
  const processedIncomingMessageIDs = ref(new Set<string>())
  const wsConnected = ref(false)
  const profileUpdate = ref<ProfileUpdatePayload | null>(null)
  const presenceByUserId = ref<Record<string, PresenceItem>>({})
  const realtimeExtraChatIDs = ref<string[]>([])
  const typingByChat = ref<TypingMap>({})
  let handleTypingEvent: ((payload: { chatID: string; userID: string }) => void) | null = null
  const {
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
  } = setupWorkspaceComputed({
    t,
    chats,
    selectedChatID,
    invitePreviewChat,
    sidebarSearch,
    chatFilter,
    unreadByChatId,
    mutedChatIDs,
    rawMessages,
    urlsByAttachment,
    messageSearch,
    focusedInfoUserProfile,
    peerProfile,
    chatMembers,
    presenceByUserId,
    pendingFiles,
    typingByChat,
  })
  const {
    selectedGroupChannelByGroupId,
    groupChannelsByGroupID,
    groupChannelsOpen,
    activeGroupID,
    selectedGroupChannelID,
    activeMessagesChatID,
    showGroupChannelsPanel,
    visibleGroupChannels,
    hashSelectedChannelTopicNumber,
    findGroupIDByChannelID,
    syncGroupChannelsPreviewFromChats,
    updateGroupChannelPreview,
    getLastCachedMessageContent,
    getLastCachedMessageCreatedAt,
    resolveGroupChannelIdByTopicNumber,
    resolveSelectedGroupTopicNumber,
    persistGroupSelection,
  } = setupWorkspaceGroupState({
    chats,
    selectedChat,
    unreadByChatId,
  })

  watchEffect(() => {
    const base = 'ComBox'
    const activeID = activeMessagesChatID.value.trim()
    if (typeof document === 'undefined') return
    if (!activeID) {
      document.title = base
      return
    }
    const chat = chats.value.find((item) => (item.id || '').trim() === activeID)
    const name = (chat?.title || '').trim()
    document.title = name ? `${base} | ${name}` : base
  })

  const {
    patchChatLocally,
    refreshChatMembers,
    refreshRemovedChatMembers,
    refreshSelectedChatInviteLinks,
    refreshSelectedChannel,
  } = setupWorkspaceMeta({
    chats,
    invitePreviewChat,
    chatMembers,
    removedChatMembers,
    selectedChatInviteLinks,
  })
  const {
    syncWindowActivity,
    selectGroupChannel,
    closeGroupChannelsPanel,
    applyUnreadFromIncoming,
    setChatFilter,
    setPendingFiles,
    removePendingFile,
  } = setupWorkspaceRuntimeHelpers({
    currentUser,
    activeGroupID,
    activeMessagesChatID,
    selectedGroupChannelByGroupId,
    groupChannelsOpen,
    unreadByChatId,
    chatFilter,
    pendingFiles,
    processedIncomingMessageIDs,
    windowActive,
    isNearBottom,
    persistGroupSelection,
  })

  const { start, stop, sendRequest, sendEvent, ensureConnected } = useChatRealtime({
    getSelectedChatID: () => activeMessagesChatID.value,
    getAdditionalChatIDs: () => realtimeExtraChatIDs.value,
    reloadChats: async () => {
      await loadChats()
      await loadNotifications()
    },
    reloadMessages: async (chatID: string) => {
      await loadMessages(chatID)
    },
    onConnectionStateChange: (connected) => {
      wsConnected.value = connected
    },
    onChatEvent: ({ type, chatID, raw }) => {
      const root = asRecord(raw)
      const payload = asRecord(root.payload)
      const eventChat = asRecord(payload.chat)
      const fallbackChat = asRecord(root.chat)
      const chatNode = Object.keys(eventChat).length > 0 ? eventChat : fallbackChat
      const eventChatID =
        (typeof chatNode.id === 'string' && chatNode.id.trim()) ||
        (typeof payload.chat_id === 'string' && payload.chat_id.trim()) ||
        (typeof root.chat_id === 'string' && root.chat_id.trim()) ||
        chatID

      if (eventChatID) {
        if (eventChatID === selectedChatID.value && (type === 'chat.member_added' || type === 'chat.member_removed' || type === 'chat.updated')) {
          const isChannel = (selectedChat.value?.kind || '').trim() === 'standalone_channel'
          const role = (selectedChat.value?.viewer_role || '').trim().toLowerCase()
          if (!isChannel || role === 'owner' || role === 'admin') {
            void refreshChatMembers(eventChatID)
          }
        }
      }

      if (eventChatID && Object.keys(chatNode).length > 0) {
        chats.value = chats.value.map((item) => {
          if (item.id !== eventChatID) return item
          return {
            ...item,
            ...sanitizeSharedChatPatch(chatNode),
          }
        })
        writeJSON(CHATS_CACHE_KEY, chats.value)
      }
    },
    onChatUpdated: ({ chatID, chat }) => {
      patchChatLocally(chatID, sanitizeSharedChatPatch(chat))
    },
    onProfileUpdate: (payload) => {
      const userID = (payload.userID || '').trim()
      if (!userID) return
      const incoming: SearchUserResult = { ...payload.user, id: (payload.user?.id || '').trim() || userID }
      const isSelf = (currentUser?.id || '').trim() === userID
      if (isSelf) {
        saveLocalProfile({
          firstName: incoming.first_name || '',
          lastName: incoming.last_name || '',
          birthDate: incoming.birth_date || undefined,
          avatarDataUrl: incoming.avatar_data_url || '',
          gradient: incoming.avatar_gradient || '',
        })
      }
      if ((peerProfile.value?.id || '').trim() === userID) {
        peerProfile.value = normalizePeerProfile(incoming)
      }
      if ((focusedInfoUserProfile.value?.id || '').trim() === userID) {
        focusedInfoUserProfile.value = normalizePeerProfile(incoming)
      }
      if (chatMembers.value.some((member) => (member.user_id || '').trim() === userID)) {
        chatMembers.value = chatMembers.value.map((member) =>
          (member.user_id || '').trim() === userID ? { ...member, profile: incoming } : member,
        )
      }
      if (directoryResults.value.users.some((user) => (user.id || '').trim() === userID)) {
        directoryResults.value = {
          ...directoryResults.value,
          users: directoryResults.value.users.map((user) =>
            (user.id || '').trim() === userID ? { ...user, ...incoming } : user,
          ),
        }
      }
      const directPatch: Partial<ChatItem> = {}
      const display = `${(incoming.first_name || '').trim()} ${(incoming.last_name || '').trim()}`.trim() || (incoming.username || '').trim()
      if (display) directPatch.title = display
      if ('avatar_data_url' in incoming) directPatch.avatar_data_url = incoming.avatar_data_url
      if ('avatar_gradient' in incoming) directPatch.avatar_gradient = incoming.avatar_gradient
      if (Object.keys(directPatch).length > 0) {
        for (const chat of chats.value) {
          if (!chat.is_direct) continue
          if ((chat.peer_user_id || '').trim() !== userID) continue
          patchChatLocally(chat.id, directPatch)
        }
      }
      profileUpdate.value = { userID, user: incoming }
    },
    onMessageDeleted: (messageID) => {
      rawMessages.value = rawMessages.value.filter((item) => item.id !== messageID)
      if (activeMessagesChatID.value) {
        writeJSON(`${MSG_CACHE_PREFIX}${activeMessagesChatID.value}`, rawMessages.value)
        const next = { ...messageStatusesByMessage.value }
        delete next[messageID]
        messageStatusesByMessage.value = next
        writeJSON(`${STATUS_CACHE_PREFIX}${activeMessagesChatID.value}`, next)
      }
    },
    onMessageStatus: (messageID, chatID, status) => {
      const normalized: MessageStatus = {
        message_id: messageID,
        chat_id: chatID || selectedChatID.value || '',
        user_id: status.userID || '',
        status: status.status,
        updated_at: status.at || new Date().toISOString(),
      }

      persistStatusToChatCache(STATUS_CACHE_PREFIX, normalized.chat_id, normalized)
      persistStatusToGlobalCache(STATUS_GLOBAL_CACHE_KEY, normalized)

      if (activeMessagesChatID.value && normalized.chat_id === activeMessagesChatID.value) {
        messageStatusesByMessage.value = {
          ...messageStatusesByMessage.value,
          [messageID]: normalized,
        }
        writeJSON(`${STATUS_CACHE_PREFIX}${activeMessagesChatID.value}`, messageStatusesByMessage.value)
      }
    },
    onMessageCreated: (payload) => {
      applyUnreadFromIncoming(payload.chatID, payload.senderUserID, payload.messageID)
      updateGroupChannelPreview(payload.chatID, readEventPreview(payload as Record<string, unknown>), readEventCreatedAt(payload as Record<string, unknown>))
      window.setTimeout(() => syncGroupChannelsPreviewFromChats(payload.chatID), 220)
      const groupID = findGroupIDByChannelID(payload.chatID)
      if (groupID) window.setTimeout(() => { void loadGroupChannels(groupID) }, 220)
    },
    onNotificationMessageCreated: (payload) => {
      const chatID = (payload.chatID || '').trim()
      const messageID = (payload.messageID || '').trim()

      applyUnreadFromIncoming(payload.chatID, payload.senderUserID, payload.messageID)
      updateGroupChannelPreview(payload.chatID, readEventPreview(payload as Record<string, unknown>), readEventCreatedAt(payload as Record<string, unknown>))
      window.setTimeout(() => syncGroupChannelsPreviewFromChats(payload.chatID), 220)
      const groupID = findGroupIDByChannelID(payload.chatID)
      if (groupID) window.setTimeout(() => { void loadGroupChannels(groupID) }, 220)

      const mutedByEvent = Boolean(payload.muted)
      if (chatID && mutedByEvent && !mutedChatIDs.value[chatID]) {
        mutedChatIDs.value = { ...mutedChatIDs.value, [chatID]: true }
      }

      if (!chatID || mutedByEvent || mutedChatIDs.value[chatID]) return
      const senderID = (payload.senderUserID || '').trim()
      if (senderID && senderID === (currentUser?.id || '').trim()) return
      if (!notificationsEnabled.value) return
      if (messageID) {
        if (notifiedMessageIDs.has(messageID)) return
        notifiedMessageIDs.add(messageID)
        if (notifiedMessageIDs.size > 500) notifiedMessageIDs.clear()
      }

      const activeChatID = activeMessagesChatID.value.trim()
      if (windowActive.value && activeChatID === chatID) return

      const chat = chats.value.find((c) => (c.id || '').trim() === chatID)
      const title = ((chat?.title || '').trim() || 'ComBox').slice(0, 80)
      // The preview still contains [[att:…]] tokens: parse them instead of
      // letting a bare attachment id reach the user's notification body.
      const rawPreview =
        (payload.preview || '').trim() ||
        (chat?.last_message_preview || '').trim()
      const body = summarizeMessagePreview(rawPreview, {
        gif: t('chat.gif'),
        video: t('chat.video'),
        photo: t('chat.photo'),
        audio: t('chat.audio'),
        file: t('chat.file'),
        empty: t('chat.new_message', undefined, 'New message'),
        voice: t('chat.audio_message', undefined, 'Voice message'),
        round: t('chat.video_message', undefined, 'Video message'),
      }).slice(0, 160)
      tryPlayMessageSound()
      void tryShowDesktopNotification({ title, body, chatID }).then((result) => {
        if (result !== 'denied' && result !== 'unsupported') return
        if (notificationPermissionSurfaced) return
        notificationPermissionSurfaced = true
        const notice = notificationNotice.value
        if (notice) toast.error(notice)
      })
    },
    onCallStarted: (payload) => {
      handleCallStarted(payload)
    },
    onCallEnded: (payload) => {
      handleCallEnded(payload)
    },
    onTyping: (payload) => handleTypingEvent?.(payload),
    onPresenceUpdate: (payload) => {
      presenceByUserId.value = {
        ...presenceByUserId.value,
        [payload.userID]: {
          user_id: payload.userID,
          online: Boolean(payload.online),
          last_seen: payload.lastSeen || presenceByUserId.value[payload.userID]?.last_seen,
          last_seen_visible: payload.lastSeenVisible ?? presenceByUserId.value[payload.userID]?.last_seen_visible ?? true,
        },
      }
    },
  })

  setCallTitleResolver((chatID) => chats.value.find((item) => item.id === chatID)?.title ?? '')

  const {
    requestViaWs,
    sendPresencePing,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    handlePresenceActivity,
  } = setupWorkspacePresence({
    wsConnected,
    syncWindowActivity,
    sendRequest,
    sendEvent,
    ensureConnected,
  })

  const typing = setupWorkspaceTyping({
    wsConnected,
    sendEvent,
    typingByChat,
    getSelfUserID: () => (currentUser?.id || '').trim(),
    ensureConnected,
  })
  handleTypingEvent = (payload) => typing.recordTyping(payload.chatID, payload.userID)

  watch(
    wsConnected,
    (connected) => {
      // A fresh socket has no chat subscriptions yet.
      if (connected) {
        typing.resubscribeAll()
        typing.subscribe(activeMessagesChatID.value)
      }
    },
    { immediate: true },
  )
  watch(activeMessagesChatID, (chatID, previous) => {
    if (previous && previous !== chatID) typing.unsubscribe(previous)
    typing.subscribe(chatID)
  })
  onScopeDispose(() => typing.dispose())

  const { loadChats, loadNotifications, loadGroupChannels, loadMessages, runDirectorySearch } = setupWorkspaceLoaders({
    t,
    requestViaWs,
    chats,
    invitePreviewChat,
    selectedChatID,
    groupChannelsByGroupID,
    selectedGroupChannelByGroupId,
    loadingGroupChannels,
    loadingChats,
    loadingMessages,
    searchingDirectory,
    errorText,
    directoryResults,
    unreadByChatId,
    mutedChatIDs,
    rawMessages,
    urlsByAttachment,
    attachmentRequests,
    messageStatusesByMessage,
    activeMessagesChatID,
    hashSelectedChatID,
    hashSelectedChannelTopicNumber,
    resolveGroupChannelIdByTopicNumber,
    getLastCachedMessageContent,
    getLastCachedMessageCreatedAt,
    persistGroupSelection,
  })

  setupWorkspaceWatchers({
    directoryQuery,
    runDirectorySearch,
    selectedChat,
    chatMembers,
    refreshChatMembers,
    directPeerId,
    peerProfile,
    getUserByIDFn: getUserByID,
    searchDirectoryFn: (input) => searchDirectory(input as never),
    normalizePeerProfileFn: normalizePeerProfile,
    wsConnected,
    sendEvent,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    sendPresencePing,
    presenceClient,
    presenceByUserId,
  })
  const {
    selectChat,
    selectDirectoryChat,
    openDirectChatWithUser,
    openDirectChatByUsername,
    resolvePendingDirectChat,
    acceptInviteFromHashIfNeeded,
    acceptInviteLinkFromHashIfNeeded,
    handleHashChange,
  } = setupWorkspaceNavigation({
    t,
    errorText,
    chats,
    selectedChatID,
    selectedChat,
    invitePreviewChat,
    focusedInfoUserProfile,
    replyToMessage,
    messageSearchOpen,
    messageSearch,
    chatMenuAnchor,
    groupChannelsOpen,
    selectedGroupChannelByGroupId,
    chatMembers,
    peerProfile,
    loadChats,
    loadGroupChannels,
    loadMessages,
    persistGroupSelection,
    resolveGroupChannelIdByTopicNumber,
    directChatClient,
  })
  const {
    sendDraft,
    reactToMessage,
    markMessagesRead: markMessagesReadImpl,
    createGroupChat,
    createChannelForSelectedGroup,
    toggleMuteSelectedChat,
    createStandaloneChannelChat,
    subscribeSelectedChannel,
    unsubscribeSelectedChannel,
    createSelectedChatInviteLink,
    updateSelectedGroupProfile,
    leaveSelectedChat,
    addMembersToSelectedGroup,
    updateSelectedGroupMemberRole,
    removeSelectedGroupMember,
    toggleArchived,
    togglePinned,
    reorderPinned,
    markRead,
    clearHistory,
    reloadActiveChat,
    removeChat,
  } = setupWorkspaceActions({
    t,
    currentUser,
    selectedChat,
    activeMessagesChatID,
    pendingFiles,
    editingMessage,
    replyToMessage,
    rawMessages,
    urlsByAttachment,
    attachmentRequests,
    messageStatusesByMessage,
    unreadByChatId,
    mutedChatIDs,
    sending,
    errorText,
    chats,
    invitePreviewChat,
    selectedChatID,
    selectedGroupChannelByGroupId,
    groupChannelsOpen,
    infoOpen,
    chatMembers,
    removedChatMembers,
    selectedChatInviteLinks,
    loadChats,
    loadGroupChannels,
    loadMessages,
    resolvePendingDirectChat,
    selectChat,
    refreshChatMembers,
    refreshSelectedChatInviteLinks,
    enrichChatMembers,
    updateGroupChannelPreview,
    findGroupIDByChannelID,
    persistGroupSelection,
    clearHash,
    patchChatLocally,
  })

  provide(CHAT_LIST_ACTIONS, {
    toggleArchived,
    togglePinned,
    reorderPinned,
    markRead,
    clearHistory,
    reloadActiveChat,
    removeChat,
  })

  installNotificationHooks((chatID) => {
    void selectChat(chatID)
  })

  function markMessagesRead(chatID: string, messageIDs: string[]) {
    return markMessagesReadImpl(chatID, messageIDs, readReportedMessageIDs)
  }

  const {
    openContextMenu,
    closeContextMenu,
    openContextReactionPicker,
    closeContextReactionPicker,
    selectReactionFromPicker,
    copyContextMessage,
    replyFromContextMenu,
    beginReplyToMessage,
    clearReplyToMessage,
    editFromContextMenu,
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
  } = createContextActions({
    currentUser,
    selectedChat,
    directPeerId,
    activeMessagesChatID,
    contextMenu,
    contextReactionAnchor,
    replyToMessage,
    editingMessage,
    pendingFiles,
    rawMessages,
    photoViewerSrc,
    videoViewer,
    infoOpen,
    chatMenuAnchor,
    focusedInfoUserProfile,
    peerProfile,
    chatMembers,
    removedChatMembers,
    selectedChatInviteLinks,
    messageSearchOpen,
    messageSearch,
    sidebarPanel,
    presenceByUserId,
    presenceClient,
    reactToMessage,
    loadChats,
    errorText,
    refreshSelectedChannel,
    refreshRemovedChatMembers,
    refreshSelectedChatInviteLinks,
    normalizePeerProfile,
  })

  const _runtime = setupWorkspaceLifecycle({
    chats,
    selectedChatID,
    selectedGroupChannelID,
    activeMessagesChatID,
    activeGroupID,
    groupChannelsOpen,
    groupChannelsByGroupID,
    messageStatusesByMessage,
    rawMessages,
    unreadByChatId,
    readReportedMessageIDs,
    urlsByAttachment,
    attachmentRequests,
    handleHashChange,
    handlePresenceActivity,
    syncWindowActivity,
    stopPresenceHeartbeat,
    resolveSelectedGroupTopicNumber,
    loadMessages,
    loadGroupChannels,
    loadNotifications,
    loadChats,
    acceptInviteFromHashIfNeeded,
    acceptInviteLinkFromHashIfNeeded,
    start,
    stop,
    parseMessageContent,
    getAttachment,
  })
  void _runtime

  return {
    currentUser,
    localProfile,
    selectedChatID,
    activeMessagesChatID,
    selectedChat,
    hasActiveChat,
    chats,
    filteredChats,
    messages,
    filteredMessages,
    rawMessages,
    sidebarSearch,
    selectedFilterTab,
    messageSearchOpen,
    messageSearch,
    unreadCounts,
    unreadByChatId,
    mutedChatIDs,
    messageStatusesByMessage,
    chatFilter,
    sidebarPanel,
    isNearBottom,
    contextMenu,
    contextReactionAnchor,
    replyToMessage,
    editingMessage,
    pendingFiles,
    urlsByAttachment,
    uploadProgress,
    directoryQuery,
    directoryResults,
    loadingChats,
    loadingMessages,
    searchingDirectory,
    sending,
    errorText,
    photoViewerSrc,
    videoViewer,
    infoOpen,
    chatMenuAnchor,
    peerProfile,
    focusedInfoUserProfile,
    chatMembers,
    removedChatMembers,
    selectedChatInviteLinks,
    directPeerId,
    infoDisplayTitle,
    infoSubtitle,
    chatSubtitle,
    activeGroupID,
    showGroupChannelsPanel,
    selectedGroupChannelID,
    selectedGroupChannelByGroupId,
    visibleGroupChannels,
    loadingGroupChannels,
    wsConnected,
    profileUpdate,
    realtimeExtraChatIDs,
    typingByChat,
    noteTyping: typing.noteTyping,
    setChatFilter,
    selectChat,
    selectDirectoryChat,
    openDirectChatWithUser,
    openDirectChatByUsername,
    setPendingFiles,
    removePendingFile,
    sendDraft,
    reactToMessage,
    markMessagesRead,
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
    openInfoForUser,
    closeInfo,
    openMessageSearch,
    closeMessageSearch,
    openChatMenu,
    closeChatMenu,
    openSidebarSettings,
    closeSidebarSettings,
    closeGroupChannelsPanel,
    selectGroupChannel,
    createGroupChat,
    createChannelForSelectedGroup,
    createStandaloneChannelChat,
    updateSelectedGroupProfile,
    leaveSelectedChat,
    canCreateChannel: computed(() => {
      const active = selectedChat.value
      if (!active) return false
      if ((active.kind || '').trim() === 'group') return true
      if ((active.parent_chat_id || '').trim()) return true
      return false
    }),
    addMembersToSelectedGroup,
    updateSelectedGroupMemberRole,
    removeSelectedGroupMember,
    toggleMuteSelectedChat,
    subscribeSelectedChannel,
    unsubscribeSelectedChannel,
    createSelectedChatInviteLink,
    loadChats,
    loadGroupChannels,
    loadMessages,
    persistGroupSelection,
    clearHash,
    sendRequest,
    sendEvent,
  }
}
