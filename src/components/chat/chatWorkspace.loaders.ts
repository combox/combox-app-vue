import type { Ref } from 'vue'
import {
  getAttachment,
  getProfileSettings,
  listChannels,
  listChats,
  listMessages,
  normalizeMessageStatuses,
  parseMessageContent,
  searchDirectory,
  type ChatItem,
  type MessageItem,
  type SearchResults,
} from 'combox-api'
import { hydrateAttachmentURLs } from './chatWorkspace.attachments'
import {
  CHATS_CACHE_KEY,
  EMPTY_SEARCH_RESULTS,
  GROUP_CHANNELS_CACHE_KEY,
  MSG_CACHE_PREFIX,
  SELECTED_CHAT_KEY,
  STATUS_CACHE_PREFIX,
  STATUS_GLOBAL_CACHE_KEY,
} from './chatWorkspace.constants'
import { normalizeMessageOrder } from './chatWorkspace.helpers'
import { readJSON, writeJSON } from './chatWorkspace.storage'
import type { AttachmentView, MessageStatus } from './chatWorkspace.types'

type RequestViaWs = <T>(type: string, payload: unknown) => Promise<T>

type WorkspaceLoadersInput = {
  t: (key: string) => string
  requestViaWs: RequestViaWs
  chats: Ref<ChatItem[]>
  invitePreviewChat: Ref<ChatItem | null>
  selectedChatID: Ref<string>
  groupChannelsByGroupID: Ref<Record<string, ChatItem[]>>
  selectedGroupChannelByGroupId: Ref<Record<string, string>>
  loadingGroupChannels: Ref<boolean>
  loadingChats: Ref<boolean>
  loadingMessages: Ref<boolean>
  searchingDirectory: Ref<boolean>
  errorText: Ref<string>
  directoryResults: Ref<SearchResults>
  unreadByChatId: Ref<Record<string, number>>
  mutedChatIDs: Ref<Record<string, boolean>>
  rawMessages: Ref<MessageItem[]>
  urlsByAttachment: Ref<Record<string, AttachmentView>>
  attachmentRequests: Map<string, Promise<void>>
  messageStatusesByMessage: Ref<Record<string, MessageStatus>>
  activeMessagesChatID: Ref<string>
  hashSelectedChatID: string
  hashSelectedChannelTopicNumber: number | null
  resolveGroupChannelIdByTopicNumber: (groupIDRaw: string, topicNumberRaw: number | null | undefined) => string
  getLastCachedMessageContent: (chatIDRaw: string) => string
  getLastCachedMessageCreatedAt: (chatIDRaw: string) => string
  persistGroupSelection: () => void
}

export function setupWorkspaceLoaders(input: WorkspaceLoadersInput) {
  async function loadChats() {
    input.loadingChats.value = true
    input.errorText.value = ''
    try {
      let result: ChatItem[] = []
      try {
        const payload = await input.requestViaWs<{ chats?: ChatItem[]; items?: ChatItem[]; error?: string }>('request.chats', {})
        result = Array.isArray(payload.chats) ? payload.chats : Array.isArray(payload.items) ? payload.items : []
      } catch {
        result = await listChats()
      }

      // Some WS implementations may omit standalone channels. Merge with REST to avoid hiding them in the UI.
      try {
        const fromRest = await listChats()
        if (Array.isArray(fromRest) && fromRest.length > 0) {
          // Treat REST as the source of truth for removals (e.g. deleted chats).
          // Then backfill anything WS returned that REST may omit.
          const byId = new Map<string, ChatItem>()
          for (const item of fromRest) {
            const id = (item.id || '').trim()
            if (!id) continue
            byId.set(id, item)
          }
          for (const item of result) {
            const id = (item.id || '').trim()
            if (!id) continue
            if (!byId.has(id)) byId.set(id, item)
          }
          result = Array.from(byId.values())
        }
      } catch {
        // keep WS/fallback result
      }

      input.chats.value = result
      writeJSON(CHATS_CACHE_KEY, input.chats.value)

      const nextSelected =
        (input.selectedChatID.value &&
          (input.chats.value.some((chat) => chat.id === input.selectedChatID.value) || input.invitePreviewChat.value?.id === input.selectedChatID.value) &&
          input.selectedChatID.value) ||
        ''

      if (input.selectedChatID.value !== nextSelected) input.selectedChatID.value = nextSelected
      writeJSON(SELECTED_CHAT_KEY, nextSelected)
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.load_chats_error')
    } finally {
      input.loadingChats.value = false
    }
  }

  async function loadNotifications() {
    try {
      const payload = await getProfileSettings()
      input.unreadByChatId.value = payload.chat_notifications?.unread_by_chat || {}
      input.mutedChatIDs.value = Object.fromEntries((payload.chat_notifications?.muted_chat_ids || []).map((id) => [id, true]))
    } catch {
      input.unreadByChatId.value = {}
      input.mutedChatIDs.value = {}
    }
  }

  async function loadGroupChannels(groupChatID: string) {
    const cleanGroupID = (groupChatID || '').trim()
    if (!cleanGroupID) return
    input.loadingGroupChannels.value = true
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
        const chatNode = input.chats.value.find((chat) => (chat.id || '').trim() === (item.id || '').trim())
        const cachedPreview = input.getLastCachedMessageContent(item.id)
        const cachedCreatedAt = input.getLastCachedMessageCreatedAt(item.id)
        return {
          ...item,
          last_message_preview: (item.last_message_preview || chatNode?.last_message_preview || cachedPreview || '').trim(),
          created_at: (item.created_at || chatNode?.created_at || cachedCreatedAt || '').trim(),
        }
      })
      input.groupChannelsByGroupID.value = {
        ...input.groupChannelsByGroupID.value,
        [cleanGroupID]: merged,
      }
      writeJSON(GROUP_CHANNELS_CACHE_KEY, input.groupChannelsByGroupID.value)
      const allowed = new Set([cleanGroupID, ...normalized.map((item) => (item.id || '').trim()).filter(Boolean)])
      const selected = (input.selectedGroupChannelByGroupId.value[cleanGroupID] || '').trim()
      const hashTarget =
        cleanGroupID === input.hashSelectedChatID
          ? input.resolveGroupChannelIdByTopicNumber(cleanGroupID, input.hashSelectedChannelTopicNumber)
          : ''
      const nextSelected = hashTarget || selected
      const isBrowsingGroup = input.selectedChatID.value === cleanGroupID
      const shouldSkipAutoSelect = isBrowsingGroup && !nextSelected
      if (!nextSelected) {
        if (!shouldSkipAutoSelect) {
          input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [cleanGroupID]: cleanGroupID }
          input.persistGroupSelection()
        }
        return
      }
      if (!allowed.has(nextSelected)) {
        if (shouldSkipAutoSelect) {
          input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [cleanGroupID]: '' }
        } else {
          input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [cleanGroupID]: cleanGroupID }
        }
        input.persistGroupSelection()
        return
      }
      if (selected !== nextSelected) {
        input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [cleanGroupID]: nextSelected }
        input.persistGroupSelection()
      }
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.load_channels_error')
    } finally {
      input.loadingGroupChannels.value = false
    }
  }

  async function loadMessages(chatID: string) {
    if (!chatID) {
      input.rawMessages.value = []
      input.messageStatusesByMessage.value = {}
      return
    }

    input.loadingMessages.value = true
    input.errorText.value = ''
    try {
      const cached = normalizeMessageOrder(readJSON<MessageItem[]>(`${MSG_CACHE_PREFIX}${chatID}`, []))
      if (cached.length > 0) {
        input.rawMessages.value = cached
        void hydrateAttachmentURLs(cached, input.urlsByAttachment, input.attachmentRequests, parseMessageContent, getAttachment)
      } else {
        input.rawMessages.value = []
      }

      const cachedStatuses = readJSON<Record<string, MessageStatus>>(`${STATUS_CACHE_PREFIX}${chatID}`, {})
      const globalStatuses = readJSON<Record<string, MessageStatus>>(STATUS_GLOBAL_CACHE_KEY, {})
      input.messageStatusesByMessage.value = cachedStatuses && typeof cachedStatuses === 'object' ? { ...globalStatuses, ...cachedStatuses } : { ...globalStatuses }

      let normalized: MessageItem[] = []
      let statuses: MessageStatus[] = []
      try {
        const payload = await input.requestViaWs<{ items?: MessageItem[]; statuses?: MessageStatus[]; next_cursor?: string; error?: string }>('request.messages', {
          chat_id: chatID,
          cursor: '',
          limit: 80,
        })
        normalized = normalizeMessageOrder(Array.isArray(payload.items) ? payload.items : [])
        statuses = Array.isArray(payload.statuses) ? payload.statuses : []
      } catch {
        const payload = await listMessages(chatID, '', 80)
        normalized = normalizeMessageOrder(Array.isArray(payload.items) ? payload.items : [])
        statuses = Array.isArray(payload.statuses) ? payload.statuses : []
      }

      input.rawMessages.value = normalized
      writeJSON(`${MSG_CACHE_PREFIX}${chatID}`, normalized)
      await hydrateAttachmentURLs(normalized, input.urlsByAttachment, input.attachmentRequests, parseMessageContent, getAttachment)

      const normalizedStatuses = normalizeMessageStatuses(statuses, chatID)
      if (normalizedStatuses.length > 0) {
        const next = { ...input.messageStatusesByMessage.value }
        for (const status of normalizedStatuses) {
          next[status.message_id] = status as MessageStatus
        }
        input.messageStatusesByMessage.value = next
        writeJSON(`${STATUS_CACHE_PREFIX}${chatID}`, next)
        writeJSON(STATUS_GLOBAL_CACHE_KEY, { ...globalStatuses, ...next })
      }

      const allowed = new Set(normalized.map((item) => item.id))
      const filtered: Record<string, MessageStatus> = {}
      for (const [id, status] of Object.entries(input.messageStatusesByMessage.value)) {
        if (allowed.has(id)) filtered[id] = status
      }
      input.messageStatusesByMessage.value = filtered
      writeJSON(`${STATUS_CACHE_PREFIX}${chatID}`, filtered)
      writeJSON(STATUS_GLOBAL_CACHE_KEY, { ...globalStatuses, ...filtered })
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.load_messages_error')
    } finally {
      input.loadingMessages.value = false
    }
  }

  async function runDirectorySearch(q: string) {
    input.errorText.value = ''
    if (!q) {
      input.directoryResults.value = EMPTY_SEARCH_RESULTS
      return
    }
    input.searchingDirectory.value = true
    try {
      let users: SearchResults['users'] = []
      let foundChats: SearchResults['chats'] = []
      try {
        const payload = await input.requestViaWs<{ users?: SearchResults['users']; chats?: SearchResults['chats']; items?: SearchResults; error?: string }>('request.search', {
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
      input.directoryResults.value = { users, chats: foundChats }
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.search_failed')
      input.directoryResults.value = EMPTY_SEARCH_RESULTS
    } finally {
      input.searchingDirectory.value = false
    }
  }

  return {
    loadChats,
    loadNotifications,
    loadGroupChannels,
    loadMessages,
    runDirectorySearch,
  }
}
