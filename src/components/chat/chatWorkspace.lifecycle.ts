import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import type { ChatItem, MessageItem } from 'combox-api'
import { hydrateAttachmentURLs } from './chatWorkspace.attachments'
import { GROUP_CHANNELS_CACHE_KEY, MSG_CACHE_PREFIX, SELECTED_CHAT_KEY, STATUS_CACHE_PREFIX, STATUS_GLOBAL_CACHE_KEY } from './chatWorkspace.constants'
import { clearHash, setHashToChatId, setHashToChatSelection } from './chatWorkspace.hash'
import { writeJSON } from './chatWorkspace.storage'
import type { MessageStatus } from './chatWorkspace.types'

type SetupWorkspaceLifecycleInput = {
  chats: Ref<ChatItem[]>
  selectedChatID: Ref<string>
  selectedGroupChannelID: Ref<string>
  activeMessagesChatID: Ref<string>
  activeGroupID: Ref<string>
  groupChannelsOpen: Ref<boolean>
  groupChannelsByGroupID: Ref<Record<string, unknown[]>>
  messageStatusesByMessage: Ref<Record<string, MessageStatus>>
  rawMessages: Ref<MessageItem[]>
  unreadByChatId: Ref<Record<string, number>>
  readReportedMessageIDs: Ref<Set<string>>
  urlsByAttachment: Ref<Record<string, unknown>>
  attachmentRequests: Map<string, Promise<void>>
  handleHashChange: () => void
  handlePresenceActivity: () => void
  syncWindowActivity: () => void
  stopPresenceHeartbeat: () => void
  resolveSelectedGroupTopicNumber: (chatID: string, channelID: string) => number | null
  loadMessages: (chatID: string) => Promise<void>
  loadGroupChannels: (groupID: string) => Promise<void>
  loadNotifications: () => Promise<void>
  loadChats: () => Promise<void>
  acceptInviteFromHashIfNeeded: () => Promise<void>
  acceptInviteLinkFromHashIfNeeded: () => Promise<void>
  start: () => Promise<void>
  stop: () => void
  parseMessageContent: (content: string) => unknown
  getAttachment: (attachmentID: string) => Promise<unknown>
}

export function setupWorkspaceLifecycle(input: SetupWorkspaceLifecycleInput) {
  watch(
    () => [input.selectedChatID.value, input.selectedGroupChannelID.value] as const,
    ([chatID, channelID]) => {
      writeJSON(SELECTED_CHAT_KEY, chatID || '')
      if (!chatID) {
        clearHash()
        return
      }
      const selected = input.chats.value.find((chat) => chat.id === chatID)
      if ((selected?.kind || '').trim() === 'group') {
        if (!channelID) {
          // When browsing a group (topics pane) keep the current URL unchanged.
          return
        }
        const topicNumber = input.resolveSelectedGroupTopicNumber(chatID, channelID)
        if (topicNumber) setHashToChatSelection(chatID, topicNumber)
        else setHashToChatId(chatID)
        return
      }
      setHashToChatId(chatID)
    },
  )

  watch(input.activeMessagesChatID, (chatID) => {
    input.readReportedMessageIDs.value.clear()
    if (chatID) input.unreadByChatId.value = { ...input.unreadByChatId.value, [chatID]: 0 }
    void input.loadMessages(chatID)
  })

  watch(input.activeGroupID, (groupID) => {
    if (!groupID) {
      input.groupChannelsOpen.value = false
      return
    }
    input.groupChannelsOpen.value = true
    void input.loadGroupChannels(groupID)
  })

  watch(
    () => [input.selectedChatID.value, input.messageStatusesByMessage.value] as const,
    ([chatID, statuses]) => {
      writeJSON(STATUS_GLOBAL_CACHE_KEY, statuses)
      if (!chatID) return
      writeJSON(`${STATUS_CACHE_PREFIX}${chatID}`, statuses)
    },
    { deep: true },
  )

  watch(input.rawMessages, (items) => {
    if (!input.activeMessagesChatID.value) return
    writeJSON(`${MSG_CACHE_PREFIX}${input.activeMessagesChatID.value}`, items)
  })

  onMounted(async () => {
    if (input.rawMessages.value.length > 0) {
      void hydrateAttachmentURLs(input.rawMessages.value, input.urlsByAttachment as never, input.attachmentRequests, input.parseMessageContent as never, input.getAttachment as never)
    }
    window.addEventListener('hashchange', input.handleHashChange)
    input.syncWindowActivity()
    window.addEventListener('focus', input.handlePresenceActivity)
    window.addEventListener('blur', input.syncWindowActivity)
    document.addEventListener('visibilitychange', input.handlePresenceActivity)
    document.addEventListener('pointerdown', input.handlePresenceActivity)
    document.addEventListener('keydown', input.handlePresenceActivity)

    await input.loadNotifications()
    await input.loadChats()
    await input.acceptInviteFromHashIfNeeded()
    await input.acceptInviteLinkFromHashIfNeeded()
    writeJSON(GROUP_CHANNELS_CACHE_KEY, input.groupChannelsByGroupID.value)
    if (input.selectedChatID.value && input.rawMessages.value.length === 0) {
      const active = input.chats.value.find((chat) => chat.id === input.selectedChatID.value)
      const isGroup = (active?.kind || '').trim() === 'group'
      const target = input.activeMessagesChatID.value || (isGroup ? '' : input.selectedChatID.value)
      if (target) void input.loadMessages(target)
    }
    void input.start()
  })

  onUnmounted(() => {
    window.removeEventListener('hashchange', input.handleHashChange)
    window.removeEventListener('focus', input.handlePresenceActivity)
    window.removeEventListener('blur', input.syncWindowActivity)
    document.removeEventListener('visibilitychange', input.handlePresenceActivity)
    document.removeEventListener('pointerdown', input.handlePresenceActivity)
    document.removeEventListener('keydown', input.handlePresenceActivity)
    input.stopPresenceHeartbeat()
    input.stop()
  })
}
