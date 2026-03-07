import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import {
  acceptChatInvite,
  addChatMembers,
  createChannel,
  createChat,
  deleteMessage,
  encodeAttachmentToken,
  getAttachment,
  getUserByID,
  ComboxClient,
  getCurrentUser,
  getLocalProfile,
  getProfileSettings,
  listChatMembers,
  listChannels,
  listChats,
  listMessages,
  leaveChat,
  markMessageRead,
  parseMessageContent,
  removeChatMember,
  searchDirectory,
  sendMessage,
  setChatMuted,
  toggleMessageReaction,
  updateChat,
  updateChatMemberRole,
  type ChatItem,
  type ChatMemberProfile,
  type MessageItem,
  type SearchResults,
} from 'combox-api'
import { mediaPipelineClient } from '../../lib/mediaPipeline/client'
import { toViewMessage } from './chatUtils'
import { hydrateAttachmentURLs } from './chatWorkspace.attachments'
import type { ViewMessage } from './chatTypes'
import { useChatRealtime } from './useChatRealtime'
import {
  CHATS_CACHE_KEY,
  EMPTY_SEARCH_RESULTS,
  GROUP_CHANNELS_CACHE_KEY,
  MSG_CACHE_PREFIX,
  PENDING_CHAT_PREFIX,
  SELECTED_CHAT_KEY,
  SELECTED_GROUP_CHANNELS_KEY,
  STATUS_CACHE_PREFIX,
  STATUS_GLOBAL_CACHE_KEY,
} from './chatWorkspace.constants'
import { asRecord, normalizeMessageOrder, normalizePeerProfile, unwrapWsPayload } from './chatWorkspace.helpers'
import {
  clearHash,
  readChatIdFromHash,
  readChatSelectionFromHash,
  readInviteTokenFromHash,
  setHashToChatId,
  setHashToChatSelection,
} from './chatWorkspace.hash'
import { enrichChatMembers } from './chatWorkspace.members'
import { readJSON, writeJSON } from './chatWorkspace.storage'
import { persistStatusToChatCache, persistStatusToGlobalCache } from './chatWorkspace.status'
import { setupWorkspaceWatchers } from './chatWorkspace.watchers'
import type {
  AttachmentView,
  ChatFilter,
  ChatMenuAnchor,
  GroupChannelItem,
  MessageStatus,
  PeerProfile,
  PendingFile,
  PresenceItem,
  WsResponseEnvelope,
} from './chatWorkspace.types'

const attachmentRequests = new Map<string, Promise<void>>()
const presenceClient = new ComboxClient()

export function useChatWorkspace() {
  const { t } = useI18n()
  const cachedChats = readJSON<ChatItem[]>(CHATS_CACHE_KEY, [])
  const persistedSelectedChatID = readJSON<string>(SELECTED_CHAT_KEY, '')
  const persistedSelectedGroupChannels = readJSON<Record<string, string>>(SELECTED_GROUP_CHANNELS_KEY, {})
  const cachedGroupChannelsByGroupID = readJSON<Record<string, ChatItem[]>>(GROUP_CHANNELS_CACHE_KEY, {})
  const hashSelection = readChatSelectionFromHash(PENDING_CHAT_PREFIX)
  const hashSelectedChatID = hashSelection.chatID
  const hashSelectedChannelTopicNumber = hashSelection.channelTopicNumber

  // Migration note:
  // Older builds could persist a channel id as SELECTED_CHAT_KEY.
  // In option B, selectedChatID must point to the group root. The channel selection is stored separately.
  const resolveInitialSelection = () => {
    const raw =
      (hashSelectedChatID && cachedChats.some((chat) => chat.id === hashSelectedChatID) && hashSelectedChatID) ||
      (persistedSelectedChatID && cachedChats.some((chat) => chat.id === persistedSelectedChatID) && persistedSelectedChatID) ||
      ''
    if (!raw) return { selectedChatID: '', selectedGroupChannels: persistedSelectedGroupChannels }
    const found = cachedChats.find((c) => c.id === raw)
    if (!found) return { selectedChatID: raw, selectedGroupChannels: persistedSelectedGroupChannels }
    const kind = (found.kind || '').trim()
    if (kind !== 'channel') return { selectedChatID: raw, selectedGroupChannels: persistedSelectedGroupChannels }
    const parentID = (found.parent_chat_id || '').trim()
    if (!parentID) return { selectedChatID: raw, selectedGroupChannels: persistedSelectedGroupChannels }
    return {
      selectedChatID: parentID,
      selectedGroupChannels: { ...persistedSelectedGroupChannels, [parentID]: found.id },
    }
  }

  const initialSelection = resolveInitialSelection()
  const initialSelectedChatID = initialSelection.selectedChatID
  const selectedGroupChannelByGroupId = ref<Record<string, string>>(initialSelection.selectedGroupChannels)
  const initialSelectedChannelID = (initialSelectedChatID && (initialSelection.selectedGroupChannels[initialSelectedChatID] || '').trim()) || ''
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
  const photoViewerSrc = ref('')
  const videoViewer = ref<{ attachmentID: string; src: string; poster?: string; filename?: string } | null>(null)
  const infoOpen = ref(false)
  const chatMenuAnchor = ref<ChatMenuAnchor | null>(null)
  const peerProfile = ref<PeerProfile | null>(null)
  const focusedInfoUserProfile = ref<PeerProfile | null>(null)
  const chatMembers = ref<ChatMemberProfile[]>([])
  const groupChannelsByGroupID = ref<Record<string, ChatItem[]>>(cachedGroupChannelsByGroupID)
  const loadingGroupChannels = ref(false)
  const loadingChats = ref(false)
  const loadingMessages = ref(false)
  const searchingDirectory = ref(false)
  const sending = ref(false)
  const errorText = ref('')
  const readReportedMessageIDs = ref(new Set<string>())

  const windowActive = ref(true)
  const isNearBottom = ref(true)
  const processedIncomingMessageIDs = ref(new Set<string>())
  const wsConnected = ref(false)
  const presenceByUserId = ref<Record<string, PresenceItem>>({})

  const syncWindowActivity = () => {
    windowActive.value = document.visibilityState === 'visible' && document.hasFocus()
  }
  let presencePingTimer: number | null = null
  let lastPresencePingAt = 0

  const selectedChat = computed(() => chats.value.find((chat) => chat.id === selectedChatID.value) || null)
  const activeGroupID = computed(() => {
    const active = selectedChat.value
    if (!active) return ''
    return (active.kind || '').trim() === 'group' ? active.id : ''
  })

  const activeMessagesChatID = computed(() => {
    const active = selectedChat.value
    if (!active) return ''
    const kind = (active.kind || '').trim()
    if (kind !== 'group') return active.id
    const groupID = active.id
    const channelID = (selectedGroupChannelByGroupId.value[groupID] || '').trim()
    return channelID || groupID
  })

  function syncGroupChannelsPreviewFromChats(chatIDRaw: string) {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return
    const updated = chats.value.find((c) => c.id === chatID)
    if (!updated) return

    const nextByGroup: Record<string, ChatItem[]> = { ...groupChannelsByGroupID.value }
    let touched = false
    for (const [groupID, items] of Object.entries(groupChannelsByGroupID.value)) {
      const idx = items.findIndex((it) => it.id === chatID)
      if (idx < 0) continue
      const nextItems = items.slice()
      nextItems[idx] = {
        ...nextItems[idx],
        last_message_preview: (updated as any).last_message_preview || nextItems[idx].last_message_preview,
      } as ChatItem
      nextByGroup[groupID] = nextItems
      touched = true
    }
    if (touched) groupChannelsByGroupID.value = nextByGroup
  }

  function updateGroupChannelPreview(channelChatIDRaw: string, previewRaw: string, createdAtRaw?: string) {
    const channelChatID = (channelChatIDRaw || '').trim()
    if (!channelChatID) return
    const groupID = findGroupIDByChannelID(channelChatID)
    if (!groupID) return
    const items = groupChannelsByGroupID.value[groupID] || []
    const idx = items.findIndex((item) => (item.id || '').trim() === channelChatID)
    if (idx < 0) return
    const nextItems = items.slice()
    nextItems[idx] = {
      ...nextItems[idx],
      last_message_preview: (previewRaw || '').trim() || nextItems[idx].last_message_preview,
      created_at: (createdAtRaw || '').trim() || nextItems[idx].created_at,
    } as ChatItem
    groupChannelsByGroupID.value = { ...groupChannelsByGroupID.value, [groupID]: nextItems }
    writeJSON(GROUP_CHANNELS_CACHE_KEY, groupChannelsByGroupID.value)
  }

  function getLastCachedMessageContent(chatIDRaw: string): string {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return ''
    if (activeMessagesChatID.value === chatID && rawMessages.value.length > 0) {
      return (rawMessages.value[rawMessages.value.length - 1]?.content || '').trim()
    }
    const cached = normalizeMessageOrder(readJSON<MessageItem[]>(`${MSG_CACHE_PREFIX}${chatID}`, []))
    return (cached[cached.length - 1]?.content || '').trim()
  }

  function getLastCachedMessageCreatedAt(chatIDRaw: string): string {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return ''
    if (activeMessagesChatID.value === chatID && rawMessages.value.length > 0) {
      return (rawMessages.value[rawMessages.value.length - 1]?.created_at || '').trim()
    }
    const cached = normalizeMessageOrder(readJSON<MessageItem[]>(`${MSG_CACHE_PREFIX}${chatID}`, []))
    return (cached[cached.length - 1]?.created_at || '').trim()
  }

  function findGroupIDByChannelID(chatIDRaw: string): string {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return ''
    for (const [groupID, items] of Object.entries(groupChannelsByGroupID.value)) {
      if (groupID === chatID) return groupID
      if (items.some((item) => (item.id || '').trim() === chatID)) return groupID
    }
    const direct = chats.value.find((chat) => (chat.id || '').trim() === chatID)
    if ((direct?.kind || '').trim() === 'channel') return (direct?.parent_chat_id || '').trim()
    return ''
  }
  const groupChannelsOpen = ref(Boolean(initialSelectedChatID && cachedChats.find((chat) => chat.id === initialSelectedChatID && (chat.kind || '').trim() === 'group')))
  const showGroupChannelsPanel = computed(() => groupChannelsOpen.value && Boolean(activeGroupID.value))
  const selectedGroupChannelID = computed(() => {
    const groupID = activeGroupID.value
    if (!groupID) return ''
    const channelID = (selectedGroupChannelByGroupId.value[groupID] || '').trim()
    return channelID || groupID
  })
  const visibleGroupChannels = computed<GroupChannelItem[]>(() => {
    const groupID = activeGroupID.value
    if (!groupID) return []
    const groupRoot = chats.value.find((chat) => chat.id === groupID)
    const channels = groupChannelsByGroupID.value[groupID] || []
    const source = channels.length > 0
      ? channels
      : groupRoot
        ? [groupRoot]
        : []
    return source.map<GroupChannelItem>((item) => {
      const isGeneral = Boolean(item.is_general) || item.id === groupID || (item.topic_number || 0) === 1
      const chatNode = chats.value.find((chat) => chat.id === item.id)
      const fallbackPreview = getLastCachedMessageContent(item.id)
      const fallbackCreatedAt = getLastCachedMessageCreatedAt(item.id)
      return {
        id: item.id,
        title: isGeneral ? 'General' : item.title,
        channel_type: item.channel_type,
        topicNumber: item.topic_number || (isGeneral ? 1 : undefined),
        unread: Math.max(0, unreadByChatId.value[item.id] || 0),
        isGeneral,
        lastPreview: isGeneral
          ? groupRoot?.last_message_preview || item.last_message_preview || chatNode?.last_message_preview || fallbackPreview || ''
          : item.last_message_preview || chatNode?.last_message_preview || fallbackPreview || '',
        createdAt: isGeneral
          ? groupRoot?.created_at || item.created_at || chatNode?.created_at || fallbackCreatedAt || ''
          : item.created_at || chatNode?.created_at || fallbackCreatedAt || '',
      }
    })
  })

  function resolveGroupChannelIdByTopicNumber(groupIDRaw: string, topicNumberRaw: number | null | undefined): string {
    const groupID = (groupIDRaw || '').trim()
    const topicNumber = Number(topicNumberRaw || 0)
    if (!groupID) return ''
    if (!Number.isInteger(topicNumber) || topicNumber <= 1) return groupID
    const match = (groupChannelsByGroupID.value[groupID] || []).find((item) => Number(item.topic_number || 0) === topicNumber)
    return (match?.id || '').trim() || groupID
  }

  function resolveSelectedGroupTopicNumber(groupIDRaw: string, channelIDRaw: string): number | null {
    const groupID = (groupIDRaw || '').trim()
    const channelID = (channelIDRaw || '').trim()
    if (!groupID) return null
    if (!channelID || channelID === groupID) return 1
    const match = (groupChannelsByGroupID.value[groupID] || []).find((item) => (item.id || '').trim() === channelID)
    const topicNumber = Number(match?.topic_number || 0)
    return Number.isInteger(topicNumber) && topicNumber > 0 ? topicNumber : null
  }
  const directPeerId = computed(() => (selectedChat.value?.is_direct ? (selectedChat.value?.peer_user_id || '').trim() : ''))
  const directoryQuery = computed(() => {
    const value = sidebarSearch.value.trim()
    if (!value.startsWith('@')) return ''
    return value.slice(1).trim()
  })
  const selectedFilterTab = computed(() => (chatFilter.value === 'all' ? 0 : chatFilter.value === 'direct' ? 1 : 2))
  const baseChats = computed(() => chats.value.filter((chat) => (chat.kind || '').trim() !== 'channel'))
  const filteredChats = computed(() => {
    const q = sidebarSearch.value.trim().toLowerCase()
    const byType = baseChats.value.filter((chat) => {
      if (chatFilter.value === 'all') return true
      if (chatFilter.value === 'direct') return chat.is_direct
      return !chat.is_direct
    })
    if (!q || q.startsWith('@')) return byType
    return byType.filter((chat) => chat.title.toLowerCase().includes(q))
  })
  const unreadCounts = computed(() => {
    let all = 0
    let direct = 0
    let group = 0
    for (const chat of baseChats.value) {
      const unread = Math.max(0, unreadByChatId.value[chat.id] || 0)
      if (!unread || mutedChatIDs.value[chat.id]) continue
      all += 1
      if (chat.is_direct) direct += 1
      else group += 1
    }
    return { all, direct, group }
  })
  const messages = computed(() => rawMessages.value.map((message) => toViewMessage(message, urlsByAttachment.value)))
  const filteredMessages = computed(() => {
    const query = messageSearch.value.trim().toLowerCase()
    if (!query) return messages.value
    return messages.value.filter((message) => (message.text || '').toLowerCase().includes(query))
  })
  const hasActiveChat = computed(() => Boolean(selectedChat.value))
  const infoDisplayTitle = computed(() => {
    const source = focusedInfoUserProfile.value || peerProfile.value
    const fromPeer = `${(source?.first_name || '').trim()} ${(source?.last_name || '').trim()}`.trim()
    return fromPeer || (selectedChat.value?.title || '').trim() || 'Chat'
  })
  const chatSubtitle = computed(() => {
    if (!selectedChat.value) return ''
    if (!selectedChat.value.is_direct) {
      const count = chatMembers.value.length
      return count > 0 ? t('chat.participants', { count }, `${count} participants`) : ''
    }
    const peerID = directPeerId.value
    if (!peerID) return t('chat.offline')
    const presence = presenceByUserId.value[peerID]
    if (!presence) return t('chat.offline')
    if (presence.online) return t('chat.online')
    if (presence.last_seen_visible && presence.last_seen) {
      const d = new Date(presence.last_seen)
      if (!Number.isNaN(d.getTime())) return t('chat.last_seen_at', { time: d.toLocaleString() }, `last seen ${d.toLocaleString()}`)
    }
    return t('chat.offline')
  })
  const infoSubtitle = computed(() => {
    if (focusedInfoUserProfile.value?.id) {
      const presence = presenceByUserId.value[focusedInfoUserProfile.value.id]
      if (!presence) return ''
      if (presence.online) return t('chat.online')
      if (presence.last_seen_visible && presence.last_seen) {
        const d = new Date(presence.last_seen)
        if (!Number.isNaN(d.getTime())) return t('chat.last_seen_at', { time: d.toLocaleString() }, `last seen ${d.toLocaleString()}`)
      }
      return t('chat.offline')
    }
    return chatSubtitle.value
  })
  const uploadProgress = computed(() => {
    if (pendingFiles.value.length === 0) return 0
    const total = pendingFiles.value.reduce((sum, item) => sum + Math.max(0, Math.min(100, item.progress || 0)), 0)
    return Math.round(total / pendingFiles.value.length)
  })

  async function refreshChatMembers(chatID: string) {
    const cleanChatID = (chatID || '').trim()
    if (!cleanChatID) {
      chatMembers.value = []
      return
    }
    const items = await listChatMembers(cleanChatID)
    chatMembers.value = await enrichChatMembers(items)
  }

  const { start, stop, sendRequest, sendEvent } = useChatRealtime({
    getSelectedChatID: () => activeMessagesChatID.value,
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
          void refreshChatMembers(eventChatID)
        }
      }

      if (eventChatID && Object.keys(chatNode).length > 0) {
        chats.value = chats.value.map((item) => {
          if (item.id !== eventChatID) return item
          return {
            ...item,
            ...(chatNode as unknown as Partial<ChatItem>),
          }
        })
        writeJSON(CHATS_CACHE_KEY, chats.value)
      }
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
      updateGroupChannelPreview(payload.chatID, (payload as any).preview || (payload as any).content || '', (payload as any).createdAt || (payload as any).created_at || '')
      window.setTimeout(() => syncGroupChannelsPreviewFromChats(payload.chatID), 220)
      const groupID = findGroupIDByChannelID(payload.chatID)
      if (groupID) window.setTimeout(() => { void loadGroupChannels(groupID) }, 220)
    },
    onNotificationMessageCreated: (payload) => {
      applyUnreadFromIncoming(payload.chatID, payload.senderUserID, payload.messageID)
      updateGroupChannelPreview(payload.chatID, (payload as any).preview || (payload as any).content || '', (payload as any).createdAt || (payload as any).created_at || '')
      window.setTimeout(() => syncGroupChannelsPreviewFromChats(payload.chatID), 220)
      const groupID = findGroupIDByChannelID(payload.chatID)
      if (groupID) window.setTimeout(() => { void loadGroupChannels(groupID) }, 220)
    },
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

  async function requestViaWs<T>(type: string, payload: unknown): Promise<T> {
    const raw = (await sendRequest(type, payload)) as WsResponseEnvelope<T> | T
    const unwrapped = unwrapWsPayload<T>(raw)
    const asObj = asRecord(unwrapped as unknown)
    if (typeof asObj.error === 'string' && asObj.error) throw new Error(asObj.error)
    return unwrapped
  }

  function sendPresencePing(force = false) {
    if (!wsConnected.value) return
    const now = Date.now()
    if (!force && now - lastPresencePingAt < 3000) return
    if (!sendEvent('presence.ping', {})) return
    lastPresencePingAt = now
  }

  function startPresenceHeartbeat() {
    if (presencePingTimer) window.clearInterval(presencePingTimer)
    presencePingTimer = window.setInterval(() => {
      if (!windowActive.value) return
      sendPresencePing(false)
    }, 5000)
  }

  function stopPresenceHeartbeat() {
    if (!presencePingTimer) return
    window.clearInterval(presencePingTimer)
    presencePingTimer = null
  }

  function handlePresenceActivity() {
    syncWindowActivity()
    if (windowActive.value) sendPresencePing(true)
  }

  async function loadChats() {
    loadingChats.value = true
    errorText.value = ''
    try {
      let result: ChatItem[] = []
      try {
        const payload = await requestViaWs<{ chats?: ChatItem[]; items?: ChatItem[]; error?: string }>('request.chats', {})
        result = Array.isArray(payload.chats) ? payload.chats : Array.isArray(payload.items) ? payload.items : []
      } catch {
        result = await listChats()
      }

      chats.value = result
      writeJSON(CHATS_CACHE_KEY, result)

      const fromHash = readChatIdFromHash(PENDING_CHAT_PREFIX)
      const nextSelected =
        (fromHash && result.some((chat) => chat.id === fromHash) && fromHash) ||
        (selectedChatID.value && result.some((chat) => chat.id === selectedChatID.value) && selectedChatID.value) ||
        ''

      if (selectedChatID.value !== nextSelected) selectedChatID.value = nextSelected
      writeJSON(SELECTED_CHAT_KEY, nextSelected)
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.load_chats_error')
    } finally {
      loadingChats.value = false
    }
  }

  async function loadNotifications() {
    try {
      const payload = await getProfileSettings()
      unreadByChatId.value = payload.chat_notifications?.unread_by_chat || {}
      mutedChatIDs.value = Object.fromEntries((payload.chat_notifications?.muted_chat_ids || []).map((id) => [id, true]))
    } catch {
      unreadByChatId.value = {}
      mutedChatIDs.value = {}
    }
  }

  async function loadGroupChannels(groupChatID: string) {
    const cleanGroupID = (groupChatID || '').trim()
    if (!cleanGroupID) return
    loadingGroupChannels.value = true
    try {
      const items = await listChannels(cleanGroupID)
      const normalized = (items || []).slice().sort((a, b) => {
        const leftTopic = Number(a.topic_number || 0)
        const rightTopic = Number(b.topic_number || 0)
        if (leftTopic > 0 && rightTopic > 0 && leftTopic !== rightTopic) return leftTopic - rightTopic
        const left = new Date(a.created_at || 0).getTime()
        const right = new Date(b.created_at || 0).getTime()
        if (Number.isNaN(left) || Number.isNaN(right)) return 0
        return left - right
      })
      const merged = normalized.map((item) => {
        const chatNode = chats.value.find((chat) => (chat.id || '').trim() === (item.id || '').trim())
        const cachedPreview = getLastCachedMessageContent(item.id)
        const cachedCreatedAt = getLastCachedMessageCreatedAt(item.id)
        return {
          ...item,
          last_message_preview: (item.last_message_preview || chatNode?.last_message_preview || cachedPreview || '').trim(),
          created_at: (item.created_at || chatNode?.created_at || cachedCreatedAt || '').trim(),
        }
      })
      groupChannelsByGroupID.value = {
        ...groupChannelsByGroupID.value,
        [cleanGroupID]: merged,
      }
      writeJSON(GROUP_CHANNELS_CACHE_KEY, groupChannelsByGroupID.value)
      const allowed = new Set([cleanGroupID, ...normalized.map((item) => (item.id || '').trim()).filter(Boolean)])
      const selected = (selectedGroupChannelByGroupId.value[cleanGroupID] || '').trim()
      const hashTarget =
        cleanGroupID === hashSelectedChatID
          ? resolveGroupChannelIdByTopicNumber(cleanGroupID, hashSelectedChannelTopicNumber)
          : ''
      const nextSelected = hashTarget || selected || cleanGroupID
      if (!nextSelected || !allowed.has(nextSelected)) {
        selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [cleanGroupID]: cleanGroupID }
        writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
        return
      }
      if (selected !== nextSelected) {
        selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [cleanGroupID]: nextSelected }
        writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
      }
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.load_channels_error')
    } finally {
      loadingGroupChannels.value = false
    }
  }

  async function loadMessages(chatID: string) {
    if (!chatID) {
      rawMessages.value = []
      messageStatusesByMessage.value = {}
      return
    }

    loadingMessages.value = true
    errorText.value = ''
    try {
      const cached = normalizeMessageOrder(readJSON<MessageItem[]>(`${MSG_CACHE_PREFIX}${chatID}`, []))
      if (cached.length > 0) {
        rawMessages.value = cached
        void hydrateAttachmentURLs(cached, urlsByAttachment, attachmentRequests, parseMessageContent, getAttachment)
      } else {
        rawMessages.value = []
      }

      const cachedStatuses = readJSON<Record<string, MessageStatus>>(`${STATUS_CACHE_PREFIX}${chatID}`, {})
      const globalStatuses = readJSON<Record<string, MessageStatus>>(STATUS_GLOBAL_CACHE_KEY, {})
      if (cachedStatuses && typeof cachedStatuses === 'object') {
        messageStatusesByMessage.value = { ...globalStatuses, ...cachedStatuses }
      } else {
        messageStatusesByMessage.value = { ...globalStatuses }
      }

      let normalized: MessageItem[] = []
      try {
        const payload = await requestViaWs<{ items?: MessageItem[]; next_cursor?: string; error?: string }>('request.messages', {
          chat_id: chatID,
          cursor: '',
          limit: 80,
        })
        normalized = normalizeMessageOrder(Array.isArray(payload.items) ? payload.items : [])
      } catch {
        const payload = await listMessages(chatID, '', 80)
        normalized = normalizeMessageOrder(Array.isArray(payload.items) ? payload.items : [])
      }

      rawMessages.value = normalized
      writeJSON(`${MSG_CACHE_PREFIX}${chatID}`, normalized)
      await hydrateAttachmentURLs(normalized, urlsByAttachment, attachmentRequests, parseMessageContent, getAttachment)

      const allowed = new Set(normalized.map((item) => item.id))
      const filtered: Record<string, MessageStatus> = {}
      for (const [id, status] of Object.entries(messageStatusesByMessage.value)) {
        if (allowed.has(id)) filtered[id] = status
      }
      messageStatusesByMessage.value = filtered
      writeJSON(`${STATUS_CACHE_PREFIX}${chatID}`, filtered)
      writeJSON(STATUS_GLOBAL_CACHE_KEY, { ...globalStatuses, ...filtered })
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.load_messages_error')
    } finally {
      loadingMessages.value = false
    }
  }

  async function runDirectorySearch(q: string) {
    errorText.value = ''
    if (!q) {
      directoryResults.value = EMPTY_SEARCH_RESULTS
      return
    }
    searchingDirectory.value = true
    try {
      let users: SearchResults['users'] = []
      let foundChats: SearchResults['chats'] = []
      try {
        const payload = await requestViaWs<{ users?: SearchResults['users']; chats?: SearchResults['chats']; items?: SearchResults; error?: string }>('request.search', {
          q,
          scope: 'directory',
          limit: 20,
        })
        users = Array.isArray(payload.users) ? payload.users : Array.isArray(payload.items?.users) ? payload.items.users : []
        foundChats = Array.isArray(payload.chats) ? payload.chats : Array.isArray(payload.items?.chats) ? payload.items.chats : []
      } catch {
        const payload = await searchDirectory({ q, scope: 'directory', limit: 20 } as never)
        users = Array.isArray(payload.users) ? payload.users : []
        foundChats = Array.isArray(payload.chats) ? payload.chats : []
      }
      directoryResults.value = { users, chats: foundChats }
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.search_failed')
      directoryResults.value = EMPTY_SEARCH_RESULTS
    } finally {
      searchingDirectory.value = false
    }
  }

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

  async function selectChat(chatID: string) {
    if (chatID === selectedChatID.value) {
      const selected = chats.value.find((chat) => chat.id === chatID)
      const groupID = selected && (selected.kind || '').trim() === 'group' ? selected.id : ''
      if (groupID) {
        if (!groupChannelsOpen.value) groupChannelsOpen.value = true
        await loadGroupChannels(groupID)
        if (!selectedGroupChannelByGroupId.value[groupID]) {
          selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [groupID]: groupID }
          writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
        }
      }
      return
    }
    selectedChatID.value = chatID
    focusedInfoUserProfile.value = null
    replyToMessage.value = null
    messageSearchOpen.value = false
    messageSearch.value = ''
    chatMenuAnchor.value = null

    if (chatID) {
      const selected = chats.value.find((chat) => chat.id === chatID)
      const kind = (selected?.kind || '').trim()
      if (kind === 'group') {
        groupChannelsOpen.value = true
        await loadGroupChannels(chatID)
        const existing = (selectedGroupChannelByGroupId.value[chatID] || '').trim()
        if (!existing) {
          selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [chatID]: chatID }
          writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
        }
      } else {
        groupChannelsOpen.value = false
      }
    } else {
      groupChannelsOpen.value = false
    }
  }

  function selectGroupChannel(channelChatID: string) {
    const groupID = activeGroupID.value
    if (!groupID) return
    const clean = (channelChatID || '').trim() || groupID
    if (selectedGroupChannelByGroupId.value[groupID] === clean) return
    selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [groupID]: clean }
    writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
  }

  function closeGroupChannelsPanel() {
    groupChannelsOpen.value = false
  }

  function applyUnreadFromIncoming(chatIDRaw: string, senderUserIDRaw: string, messageIDRaw: string) {
    const chatID = (chatIDRaw || '').trim()
    const senderUserID = (senderUserIDRaw || '').trim()
    const messageID = (messageIDRaw || '').trim()
    if (!chatID || !senderUserID) return
    if ((currentUser?.id || '').trim() && senderUserID === (currentUser?.id || '').trim()) return

    if (messageID) {
      if (processedIncomingMessageIDs.value.has(messageID)) return
      processedIncomingMessageIDs.value.add(messageID)
      if (processedIncomingMessageIDs.value.size > 2000) {
        processedIncomingMessageIDs.value.clear()
        processedIncomingMessageIDs.value.add(messageID)
      }
    }

    const activeChat = activeMessagesChatID.value.trim()
    const isActiveChat = activeChat && activeChat === chatID
    const shouldCountAsUnread = !windowActive.value || !isActiveChat || !isNearBottom.value
    if (!shouldCountAsUnread) return

    unreadByChatId.value = { ...unreadByChatId.value, [chatID]: (unreadByChatId.value[chatID] || 0) + 1 }
  }

  function setChatFilter(value: ChatFilter) {
    chatFilter.value = value
  }

  function setPendingFiles(files: FileList) {
    const next = Array.from(files)
      .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
      .map((file) => ({
        id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
      }))
    pendingFiles.value = [...pendingFiles.value, ...next].slice(0, 8)
  }

  function removePendingFile(id: string) {
    pendingFiles.value = pendingFiles.value.filter((item) => item.id !== id)
  }

  async function sendDraft(draft: string) {
    const chatID = activeMessagesChatID.value
    const text = draft.trim()
    if (!chatID) return false
    if (!text && pendingFiles.value.length === 0) return false

    sending.value = true
    errorText.value = ''
    try {
      const uploaded = await Promise.all(
        pendingFiles.value.map(async (pending) => {
          const up = await mediaPipelineClient.uploadFile({
            file: pending.file,
            onProgress: (percent) => {
              pendingFiles.value = pendingFiles.value.map((item) => (item.id === pending.id ? { ...item, progress: percent } : item))
            },
          })
          return {
            id: up.attachment.id,
            token: encodeAttachmentToken({
              id: up.attachment.id,
              filename: up.attachment.filename,
              mimeType: up.attachment.mime_type,
              kind: up.attachment.kind,
            }),
          }
        }),
      )

      const content = [text, uploaded.map((item) => item.token).join(' ')].filter(Boolean).join('\n')
      const replyToMessageID = (replyToMessage.value?.raw.id || '').trim()
      const created = await sendMessage(chatID, content, uploaded.map((item) => item.id), replyToMessageID)
      rawMessages.value = [...rawMessages.value, created]
      await hydrateAttachmentURLs([created], urlsByAttachment, attachmentRequests, parseMessageContent, getAttachment)
      writeJSON(`${MSG_CACHE_PREFIX}${chatID}`, rawMessages.value)
      updateGroupChannelPreview(chatID, created.content || content, created.created_at)

      pendingFiles.value = []
      replyToMessage.value = null
      unreadByChatId.value = { ...unreadByChatId.value, [chatID]: 0 }
      const groupID = findGroupIDByChannelID(chatID)
      if (groupID) void loadGroupChannels(groupID)

      window.setTimeout(() => {
        void loadMessages(chatID)
      }, 160)

      return true
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.send_failed_runtime')
      return false
    } finally {
      sending.value = false
    }
  }

  async function reactToMessage(messageID: string, emoji: string) {
    try {
      const result = await toggleMessageReaction(messageID, emoji)
      rawMessages.value = rawMessages.value.map((item) => (item.id === messageID ? { ...item, reactions: result.reactions || [] } : item))
      if (activeMessagesChatID.value) writeJSON(`${MSG_CACHE_PREFIX}${activeMessagesChatID.value}`, rawMessages.value)
      contextMenu.value = null
      contextReactionAnchor.value = null
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.reaction_failed')
    }
  }

  async function markMessagesRead(chatID: string, messageIDs: string[]) {
    const cleanChatID = chatID.trim()
    const pending = messageIDs.filter((id) => id && !readReportedMessageIDs.value.has(id))
    if (!cleanChatID || pending.length === 0) return

    for (const messageID of pending) readReportedMessageIDs.value.add(messageID)
    const results = await Promise.allSettled(pending.map((messageID) => markMessageRead(messageID)))
    const successful = results
      .map((result, index) => ({ result, messageID: pending[index] }))
      .filter((item): item is { result: PromiseFulfilledResult<any>; messageID: string } => item.result.status === 'fulfilled')

    if (successful.length > 0) {
      const next = { ...messageStatusesByMessage.value }
      for (const item of successful) {
        const result = item.result.value
        if (!result?.message_id) continue
        next[result.message_id] = {
          message_id: result.message_id,
          chat_id: result.chat_id || cleanChatID,
          user_id: result.user_id || currentUser?.id || '',
          status: result.status || 'read',
          updated_at: result.updated_at || new Date().toISOString(),
        }
      }
      messageStatusesByMessage.value = next
      writeJSON(`${STATUS_CACHE_PREFIX}${cleanChatID}`, next)
      writeJSON(STATUS_GLOBAL_CACHE_KEY, { ...readJSON<Record<string, MessageStatus>>(STATUS_GLOBAL_CACHE_KEY, {}), ...next })
      unreadByChatId.value = { ...unreadByChatId.value, [cleanChatID]: 0 }
    }

    for (let i = 0; i < results.length; i += 1) {
      if (results[i].status === 'rejected') {
        readReportedMessageIDs.value.delete(pending[i])
      }
    }
  }

  function openContextMenu(input: { x: number; y: number; message: ViewMessage }) {
    contextMenu.value = input
  }

  function closeContextMenu() {
    contextMenu.value = null
  }

  function openContextReactionPicker() {
    if (!contextMenu.value) return
    contextReactionAnchor.value = {
      x: contextMenu.value.x,
      y: contextMenu.value.y,
      messageId: contextMenu.value.message.raw.id,
    }
    contextMenu.value = null
  }

  function closeContextReactionPicker() {
    contextReactionAnchor.value = null
  }

  function selectReactionFromPicker(emoji: string) {
    const messageId = contextReactionAnchor.value?.messageId || ''
    if (!messageId) return
    void reactToMessage(messageId, emoji)
    contextReactionAnchor.value = null
  }

  function copyContextMessage() {
    const text = contextMenu.value?.message.text || ''
    if (text) void navigator.clipboard.writeText(text)
    contextMenu.value = null
  }

  function replyFromContextMenu() {
    if (!contextMenu.value) return
    replyToMessage.value = contextMenu.value.message
    contextMenu.value = null
  }

  function clearReplyToMessage() {
    replyToMessage.value = null
  }

  async function deleteContextMessage() {
    const target = contextMenu.value?.message
    if (!target) return
    try {
      await deleteMessage(target.raw.id)
      rawMessages.value = rawMessages.value.filter((item) => item.id !== target.raw.id)
      if (activeMessagesChatID.value) {
        writeJSON(`${MSG_CACHE_PREFIX}${activeMessagesChatID.value}`, rawMessages.value)
      }
      contextMenu.value = null
      void loadChats()
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.delete_failed')
    }
  }

  function openPhotoViewer(src: string) {
    photoViewerSrc.value = (src || '').trim()
  }

  function closePhotoViewer() {
    photoViewerSrc.value = ''
  }

  function openVideoViewer(input: { attachmentID: string; src: string; poster?: string; filename?: string }) {
    videoViewer.value = input
  }

  function closeVideoViewer() {
    videoViewer.value = null
  }

  function openInfo() {
    focusedInfoUserProfile.value = null
    infoOpen.value = true
    chatMenuAnchor.value = null
  }

  function closeInfo() {
    infoOpen.value = false
    focusedInfoUserProfile.value = null
  }

  async function openInfoForUser(userIDRaw: string) {
    const userID = (userIDRaw || '').trim()
    if (!userID) return
    if ((currentUser?.id || '').trim() === userID) return

    if (selectedChat.value?.is_direct && (directPeerId.value || '').trim() === userID) {
      focusedInfoUserProfile.value = null
      infoOpen.value = true
      chatMenuAnchor.value = null
      return
    }

    const fromMembers = chatMembers.value.find((item) => (item.user_id || '').trim() === userID)?.profile
    const normalizedFromMembers = normalizePeerProfile(fromMembers || null)
    if (normalizedFromMembers) {
      focusedInfoUserProfile.value = normalizedFromMembers
    } else {
      try {
        const profile = await getUserByID(userID)
        const normalized = normalizePeerProfile(profile)
        if (normalized) focusedInfoUserProfile.value = normalized
      } catch {
        focusedInfoUserProfile.value = null
      }
    }

    try {
      const items = await presenceClient.getPresence([userID])
      if (Array.isArray(items) && items.length > 0) {
        const item = items[0] as any
        presenceByUserId.value = {
          ...presenceByUserId.value,
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

    infoOpen.value = true
    chatMenuAnchor.value = null
  }

  function openMessageSearch() {
    messageSearchOpen.value = true
    chatMenuAnchor.value = null
  }

  function closeMessageSearch() {
    messageSearchOpen.value = false
    messageSearch.value = ''
  }

  function openChatMenu(anchor: ChatMenuAnchor) {
    chatMenuAnchor.value = anchor
  }

  function closeChatMenu() {
    chatMenuAnchor.value = null
  }

  function openSidebarSettings() {
    sidebarPanel.value = 'settings'
  }

  function closeSidebarSettings() {
    sidebarPanel.value = 'chats'
  }

  async function createGroupChat(title: string, memberIDs: string[] = []) {
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return
    const cleanMemberIDs = Array.from(new Set(memberIDs.map((id) => (id || '').trim()).filter(Boolean)))
    try {
      const payload = await createChat({ title: cleanTitle, member_ids: cleanMemberIDs, type: 'standard' })
      await loadChats()
      if (payload.chat?.id) {
        await selectChat(payload.chat.id)
        await loadGroupChannels(payload.chat.id)
        selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [payload.chat.id]: payload.chat.id }
        writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
      }
      sidebarPanel.value = 'chats'
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.create_group_error')
      throw error
    }
  }

  async function createChannelForSelectedGroup(title: string, channelType?: 'text' | 'voice') {
    const active = selectedChat.value
    const groupID =
      (active?.parent_chat_id || '').trim() ||
      ((active && (active.kind || '').trim() === 'group' ? active.id : '') || '').trim()
    if (!groupID) return
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return
    try {
      const payload = await createChannel(groupID, { title: cleanTitle, channel_type: channelType || 'text' })
      await loadChats()
      await loadGroupChannels(groupID)
      if (payload.chat?.id) {
        selectedChatID.value = groupID
        groupChannelsOpen.value = true
        selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [groupID]: payload.chat.id }
        writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
      }
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.create_channel_error')
    }
  }

  async function toggleMuteSelectedChat() {
    const chatID = selectedChatID.value
    if (!chatID) return
    const nextMuted = !Boolean(mutedChatIDs.value[chatID])
    mutedChatIDs.value = { ...mutedChatIDs.value, [chatID]: nextMuted }
    try {
      const payload = await setChatMuted(chatID, nextMuted)
      unreadByChatId.value = payload.unread_by_chat || {}
      mutedChatIDs.value = Object.fromEntries((payload.muted_chat_ids || []).map((id) => [id, true]))
    } catch (error) {
      mutedChatIDs.value = { ...mutedChatIDs.value, [chatID]: !nextMuted }
      errorText.value = error instanceof Error ? error.message : t('chat.mute_failed')
    }
  }

  async function updateSelectedGroupProfile(input: { title: string; avatarDataUrl?: string | null }) {
    const active = selectedChat.value
    const chatID = (active?.id || '').trim()
    if (!chatID || !active || active.is_direct) return

    const cleanTitle = (input.title || '').trim()
    if (!cleanTitle) {
      errorText.value = t('chat.group_title_required')
      throw new Error(t('chat.group_title_required'))
    }

    try {
      const payload = await updateChat(chatID, {
        title: cleanTitle,
        avatar_data_url: typeof input.avatarDataUrl === 'string' ? input.avatarDataUrl : undefined,
      })
      const updatedChat = payload.chat
      chats.value = chats.value.map((item) => (item.id === updatedChat.id ? { ...item, ...updatedChat } : item))
      writeJSON(CHATS_CACHE_KEY, chats.value)
      if (selectedChatID.value === updatedChat.id) {
        selectedChatID.value = updatedChat.id
      }
      await refreshChatMembers(chatID)
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.update_group_error')
      throw error
    }
  }

  async function leaveSelectedChat() {
    const active = selectedChat.value
    const chatID = (active?.id || '').trim()
    if (!chatID || !active || active.is_direct) return
    try {
      await leaveChat(chatID)
      if (selectedChatID.value === chatID) {
        selectedChatID.value = ''
        rawMessages.value = []
        chatMembers.value = []
        infoOpen.value = false
      }
      await loadChats()
      clearHash()
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.leave_chat_error')
      throw error
    }
  }

  async function addMembersToSelectedGroup(memberIDs: string[]) {
    const chatID = (selectedChat.value?.id || '').trim()
    if (!chatID) return
    try {
      const items = await addChatMembers(chatID, memberIDs)
      chatMembers.value = await enrichChatMembers(items)
      void loadChats()
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.add_participants_error')
      throw error
    }
  }

  async function updateSelectedGroupMemberRole(userID: string, role: 'member' | 'moderator' | 'admin') {
    const chatID = (selectedChat.value?.id || '').trim()
    if (!chatID) return
    try {
      const items = await updateChatMemberRole(chatID, userID, role)
      chatMembers.value = await enrichChatMembers(items)
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.update_role_error')
      throw error
    }
  }

  async function removeSelectedGroupMember(userID: string) {
    const chatID = (selectedChat.value?.id || '').trim()
    if (!chatID) return
    try {
      const items = await removeChatMember(chatID, userID)
      chatMembers.value = await enrichChatMembers(items)
      void loadChats()
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.remove_participant_error')
      throw error
    }
  }

  async function acceptInviteFromHashIfNeeded() {
    const token = readInviteTokenFromHash()
    if (!token) return
    try {
      const payload = await acceptChatInvite(token)
      await loadChats()
      if (payload.chat?.id) {
        selectedChatID.value = payload.chat.id
        setHashToChatId(payload.chat.id)
        await loadMessages(payload.chat.id)
      } else {
        clearHash()
      }
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.accept_invite_error')
      clearHash()
    }
  }

  watch(
    () => [selectedChatID.value, selectedGroupChannelID.value] as const,
    ([chatID, channelID]) => {
      writeJSON(SELECTED_CHAT_KEY, chatID || '')
      if (!chatID) {
        clearHash()
        return
      }
      const selected = chats.value.find((chat) => chat.id === chatID)
      if ((selected?.kind || '').trim() === 'group') {
        const topicNumber = resolveSelectedGroupTopicNumber(chatID, channelID)
        setHashToChatSelection(chatID, topicNumber || 1)
        return
      }
      setHashToChatId(chatID)
    },
  )

  watch(activeMessagesChatID, (chatID) => {
    readReportedMessageIDs.value.clear()
    if (chatID) unreadByChatId.value = { ...unreadByChatId.value, [chatID]: 0 }
    void loadMessages(chatID)
  })

  watch(activeGroupID, (groupID) => {
    if (!groupID) {
      groupChannelsOpen.value = false
      return
    }
    groupChannelsOpen.value = true
    void loadGroupChannels(groupID)
  })

  watch(
    () => [selectedChatID.value, messageStatusesByMessage.value] as const,
    ([chatID, statuses]) => {
      writeJSON(STATUS_GLOBAL_CACHE_KEY, statuses)
      if (!chatID) return
      writeJSON(`${STATUS_CACHE_PREFIX}${chatID}`, statuses)
    },
    { deep: true },
  )

  watch(rawMessages, (items) => {
    if (!activeMessagesChatID.value) return
    writeJSON(`${MSG_CACHE_PREFIX}${activeMessagesChatID.value}`, items)
  })

  const handleHashChange = async () => {
    if (readInviteTokenFromHash()) {
      void acceptInviteFromHashIfNeeded()
      return
    }
    const selection = readChatSelectionFromHash(PENDING_CHAT_PREFIX)
    const fromHash = selection.chatID
    if (!fromHash) {
      selectedChatID.value = ''
      return
    }
    if (!chats.value.some((chat) => chat.id === fromHash)) return
    if (selectedChatID.value !== fromHash) selectedChatID.value = fromHash
    const target = chats.value.find((chat) => chat.id === fromHash)
    if ((target?.kind || '').trim() !== 'group') {
      groupChannelsOpen.value = false
      return
    }
    groupChannelsOpen.value = true
    await loadGroupChannels(fromHash)
    const nextChannelID = resolveGroupChannelIdByTopicNumber(fromHash, selection.channelTopicNumber)
    if ((selectedGroupChannelByGroupId.value[fromHash] || '').trim() !== nextChannelID) {
      selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [fromHash]: nextChannelID }
      writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
    }
  }

  onMounted(async () => {
    if (rawMessages.value.length > 0) {
      void hydrateAttachmentURLs(rawMessages.value, urlsByAttachment, attachmentRequests, parseMessageContent, getAttachment)
    }
    window.addEventListener('hashchange', handleHashChange)
    syncWindowActivity()
    window.addEventListener('focus', handlePresenceActivity)
    window.addEventListener('blur', syncWindowActivity)
    document.addEventListener('visibilitychange', handlePresenceActivity)
    document.addEventListener('pointerdown', handlePresenceActivity)
    document.addEventListener('keydown', handlePresenceActivity)

    await loadNotifications()
    await loadChats()
    await acceptInviteFromHashIfNeeded()
    writeJSON(GROUP_CHANNELS_CACHE_KEY, groupChannelsByGroupID.value)
    if (selectedChatID.value && rawMessages.value.length === 0) {
      void loadMessages(activeMessagesChatID.value || selectedChatID.value)
    }
    void start()
  })

  onUnmounted(() => {
    window.removeEventListener('hashchange', handleHashChange)
    window.removeEventListener('focus', handlePresenceActivity)
    window.removeEventListener('blur', syncWindowActivity)
    document.removeEventListener('visibilitychange', handlePresenceActivity)
    document.removeEventListener('pointerdown', handlePresenceActivity)
    document.removeEventListener('keydown', handlePresenceActivity)
    stopPresenceHeartbeat()
    stop()
  })

  return {
    currentUser,
    localProfile,
    selectedChatID,
    selectedChat,
    hasActiveChat,
    chats,
    filteredChats,
    messages,
    filteredMessages,
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
    pendingFiles,
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
    directPeerId,
    infoDisplayTitle,
    infoSubtitle,
    chatSubtitle,
    activeGroupID,
    showGroupChannelsPanel,
    selectedGroupChannelID,
    visibleGroupChannels,
    loadingGroupChannels,
    wsConnected,
    setChatFilter,
    selectChat,
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
    sendRequest,
  }
}
