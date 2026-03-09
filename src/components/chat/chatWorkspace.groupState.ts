import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'
import type { ChatItem, MessageItem } from 'combox-api'
import type { GroupChannelItem } from './chatWorkspace.types'
import {
  CHATS_CACHE_KEY,
  GROUP_CHANNELS_CACHE_KEY,
  MSG_CACHE_PREFIX,
  PENDING_CHAT_PREFIX,
  SELECTED_CHAT_KEY,
  SELECTED_GROUP_CHANNELS_KEY,
} from './chatWorkspace.constants'
import { normalizeMessageOrder } from './chatWorkspace.helpers'
import { readJSON, writeJSON } from './chatWorkspace.storage'
import { readChatSelectionFromHash } from './chatWorkspace.hash'

type GroupStateInput = {
  chats: Ref<ChatItem[]>
  selectedChat: ComputedRef<ChatItem | null>
  unreadByChatId: Ref<Record<string, number>>
}

// Group/channel selection has enough cache and hash migration rules to deserve its own setup module.
export function setupWorkspaceGroupState(input: GroupStateInput) {
  const cachedChats = readJSON<ChatItem[]>(CHATS_CACHE_KEY, [])
  const persistedSelectedChatID = readJSON<string>(SELECTED_CHAT_KEY, '')
  const persistedSelectedGroupChannels = readJSON<Record<string, string>>(SELECTED_GROUP_CHANNELS_KEY, {})
  const cachedGroupChannelsByGroupID = readJSON<Record<string, ChatItem[]>>(GROUP_CHANNELS_CACHE_KEY, {})
  const hashSelection = readChatSelectionFromHash(PENDING_CHAT_PREFIX)
  const hashSelectedChatID = hashSelection.chatID
  const hashSelectedChannelTopicNumber = hashSelection.channelTopicNumber

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
  const selectedGroupChannelByGroupId = ref<Record<string, string>>(initialSelection.selectedGroupChannels)
  const groupChannelsByGroupID = ref<Record<string, ChatItem[]>>(cachedGroupChannelsByGroupID)
  const groupChannelsOpen = ref(
    Boolean(initialSelection.selectedChatID && cachedChats.find((chat) => chat.id === initialSelection.selectedChatID && (chat.kind || '').trim() === 'group')),
  )

  const activeGroupID = computed(() => {
    const active = input.selectedChat.value
    if (!active) return ''
    return (active.kind || '').trim() === 'group' ? active.id : ''
  })

  const selectedGroupChannelID = computed(() => {
    const groupID = activeGroupID.value
    if (!groupID) return ''
    const channelID = (selectedGroupChannelByGroupId.value[groupID] || '').trim()
    return channelID || groupID
  })

  const activeMessagesChatID = computed(() => {
    const active = input.selectedChat.value
    if (!active) return ''
    const kind = (active.kind || '').trim()
    if (kind !== 'group') return active.id
    const groupID = active.id
    const channelID = (selectedGroupChannelByGroupId.value[groupID] || '').trim()
    return channelID || groupID
  })

  function getLastCachedMessageContent(chatIDRaw: string): string {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return ''
    const cached = normalizeMessageOrder(readJSON<MessageItem[]>(`${MSG_CACHE_PREFIX}${chatID}`, []))
    return (cached[cached.length - 1]?.content || '').trim()
  }

  function getLastCachedMessageCreatedAt(chatIDRaw: string): string {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return ''
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
    const direct = input.chats.value.find((chat) => (chat.id || '').trim() === chatID)
    if ((direct?.kind || '').trim() === 'channel') return (direct?.parent_chat_id || '').trim()
    return ''
  }

  function syncGroupChannelsPreviewFromChats(chatIDRaw: string) {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return
    const updated = input.chats.value.find((c) => c.id === chatID)
    if (!updated) return

    const nextByGroup: Record<string, ChatItem[]> = { ...groupChannelsByGroupID.value }
    let touched = false
    for (const [groupID, items] of Object.entries(groupChannelsByGroupID.value)) {
      const idx = items.findIndex((it) => it.id === chatID)
      if (idx < 0) continue
      const nextItems = items.slice()
      nextItems[idx] = {
        ...nextItems[idx],
        last_message_preview: updated.last_message_preview || nextItems[idx].last_message_preview,
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

  const showGroupChannelsPanel = computed(() => groupChannelsOpen.value && Boolean(activeGroupID.value))

  const visibleGroupChannels = computed<GroupChannelItem[]>(() => {
    const groupID = activeGroupID.value
    if (!groupID) return []
    const groupRoot = input.chats.value.find((chat) => chat.id === groupID)
    const channels = groupChannelsByGroupID.value[groupID] || []
    const source = channels.length > 0 ? channels : groupRoot ? [groupRoot] : []
    return source.map<GroupChannelItem>((item) => {
      const isGeneral = Boolean(item.is_general) || item.id === groupID || (item.topic_number || 0) === 1
      const chatNode = input.chats.value.find((chat) => chat.id === item.id)
      const fallbackPreview = getLastCachedMessageContent(item.id)
      const fallbackCreatedAt = getLastCachedMessageCreatedAt(item.id)
      return {
        id: item.id,
        title: isGeneral ? 'General' : item.title,
        channel_type: item.channel_type,
        topicNumber: item.topic_number || (isGeneral ? 1 : undefined),
        unread: Math.max(0, input.unreadByChatId.value[item.id] || 0),
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

  function persistGroupSelection() {
    writeJSON(SELECTED_GROUP_CHANNELS_KEY, selectedGroupChannelByGroupId.value)
  }

  return {
    initialSelectedChatID: initialSelection.selectedChatID,
    selectedGroupChannelByGroupId,
    groupChannelsByGroupID,
    groupChannelsOpen,
    activeGroupID,
    selectedGroupChannelID,
    activeMessagesChatID,
    showGroupChannelsPanel,
    visibleGroupChannels,
    hashSelectedChatID,
    hashSelectedChannelTopicNumber,
    findGroupIDByChannelID,
    syncGroupChannelsPreviewFromChats,
    updateGroupChannelPreview,
    getLastCachedMessageContent,
    getLastCachedMessageCreatedAt,
    resolveGroupChannelIdByTopicNumber,
    resolveSelectedGroupTopicNumber,
    persistGroupSelection,
  }
}
