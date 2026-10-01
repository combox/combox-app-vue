import type { ComputedRef, InjectionKey, Ref } from 'vue'
import {
  clearChatHistory,
  deleteChannel,
  deleteChat as deleteChatRequest,
  markChatAsRead,
  setChatArchived,
  setChatPinned,
  type ChatItem,
  type ChatMemberProfile,
  type MessageItem,
} from 'combox-api'
import { useToast } from '../../composables/useToast'
import { MSG_CACHE_PREFIX } from './chatWorkspace.constants'
import { writeJSON } from './chatWorkspace.storage'

export const CHAT_LIST_ACTIONS: InjectionKey<ChatListActions> = Symbol('combox:chat-list-actions')

export type ChatListActionsInput = {
  t: (key: string, params?: Record<string, string | number>, fallback?: string) => string
  unreadByChatId: Ref<Record<string, number>>
  rawMessages: Ref<MessageItem[]>
  activeMessagesChatID: ComputedRef<string>
  patchChatLocally: (chatID: string, patch: Partial<ChatItem>) => void
  loadChats: () => Promise<void>
  loadMessages: (chatID: string) => Promise<void>
  /** Present on `WorkspaceActionsInput`: used by `removeChat` to unwind the open chat. */
  selectedChatID: Ref<string>
  infoOpen: Ref<boolean>
  chatMembers: Ref<ChatMemberProfile[]>
  selectedGroupChannelByGroupId: Ref<Record<string, string>>
  loadGroupChannels: (groupChatID: string) => Promise<void>
  persistGroupSelection: () => void
  clearHash: () => void
}

export type PinnedOrderItem = { chat_id: string; order: number }

export type RemoveChatOptions = { forEveryone?: boolean }

export type ChatListActions = {
  toggleArchived: (chat: ChatItem) => Promise<boolean>
  togglePinned: (chat: ChatItem, scope?: string) => Promise<boolean>
  reorderPinned: (scope: string, items: PinnedOrderItem[]) => Promise<boolean>
  markRead: (chat: ChatItem) => Promise<boolean>
  clearHistory: (chat: ChatItem) => Promise<boolean>
  /** Re-reads the open chat's history (the workspace loader) and refreshes previews. */
  reloadActiveChat: () => Promise<void>
  /** Removes a chat the viewer deleted from the three-dot chat menu. */
  removeChat: (chat: ChatItem, options?: RemoveChatOptions) => Promise<boolean>
}

const PIN_SCOPES = new Set(['all', 'direct', 'channel', 'group'])

function normalizePinScope(scopeRaw?: string): string {
  const scope = (scopeRaw || '').trim()
  return PIN_SCOPES.has(scope) ? scope : 'all'
}

export function createChatListActions(input: ChatListActionsInput): ChatListActions {
  const toast = useToast()

  function chatIDOf(chat: ChatItem): string {
    return (chat?.id || '').trim()
  }

  function fail(messageKey: string, fallback: string) {
    toast.error(input.t(messageKey, undefined, fallback))
  }

  async function toggleArchived(chat: ChatItem): Promise<boolean> {
    const chatID = chatIDOf(chat)
    if (!chatID) return false
    const next = !chat.archived
    input.patchChatLocally(chatID, { archived: next })
    try {
      const updated = await setChatArchived(chatID, next)
      input.patchChatLocally(chatID, { archived: typeof updated.archived === 'boolean' ? updated.archived : next })
      return true
    } catch {
      input.patchChatLocally(chatID, { archived: !next })
      fail('chat.archive_failed', 'Could not update archive state')
      return false
    }
  }

  async function togglePinned(chat: ChatItem, scopeRaw?: string): Promise<boolean> {
    const chatID = chatIDOf(chat)
    if (!chatID) return false
    const scope = normalizePinScope(scopeRaw)
    const next = !chat.pinned
    const order = next ? Date.now() : 0
    input.patchChatLocally(chatID, { pinned: next, pin_scope: scope, pin_order: order })
    try {
      const updated = await setChatPinned(chatID, next, { scope, order })
      input.patchChatLocally(chatID, {
        pinned: typeof updated.pinned === 'boolean' ? updated.pinned : next,
        pin_scope: updated.pin_scope || scope,
        pin_order: typeof updated.pin_order === 'number' ? updated.pin_order : order,
      })
      return true
    } catch {
      input.patchChatLocally(chatID, { pinned: !next, pin_scope: chat.pin_scope || 'all', pin_order: chat.pin_order || 0 })
      fail('chat.pin_failed', 'Could not update pinned state')
      return false
    }
  }

  async function reorderPinned(scopeRaw: string, items: PinnedOrderItem[]): Promise<boolean> {
    const scope = normalizePinScope(scopeRaw)
    const targets = items.filter((item) => (item.chat_id || '').trim() && Number.isFinite(item.order))
    if (targets.length === 0) return true
    for (const item of targets) {
      input.patchChatLocally(item.chat_id, { pinned: true, pin_scope: scope, pin_order: item.order })
    }
    try {
      await Promise.all(targets.map((item) => setChatPinned(item.chat_id, true, { scope, order: item.order })))
      return true
    } catch {
      void input.loadChats()
      fail('chat.pin_failed', 'Could not update pinned state')
      return false
    }
  }

  async function markRead(chat: ChatItem): Promise<boolean> {
    const chatID = chatIDOf(chat)
    if (!chatID) return false
    const previous = input.unreadByChatId.value
    input.unreadByChatId.value = { ...previous, [chatID]: 0 }
    try {
      await markChatAsRead(chatID)
      return true
    } catch {
      input.unreadByChatId.value = previous
      fail('chat.mark_read_failed', 'Could not mark chat as read')
      return false
    }
  }

  async function clearHistory(chat: ChatItem): Promise<boolean> {
    const chatID = chatIDOf(chat)
    if (!chatID) return false
    try {
      await clearChatHistory(chatID)
    } catch {
      fail('chat.clear_history_failed', 'Could not clear history')
      return false
    }
    writeJSON(`${MSG_CACHE_PREFIX}${chatID}`, [])
    if (input.activeMessagesChatID.value.trim() === chatID) {
      input.rawMessages.value = []
      await input.loadMessages(chatID)
    }
    void input.loadChats()
    return true
  }

  /**
   * The three-dot chat menu's "Clear history" / reload bridge: the message list
   * itself never fetches history (it is prop driven), so it reuses the workspace
   * loader here instead of pretending to own a fetch of its own.
   */
  async function reloadActiveChat(): Promise<void> {
    const chatID = input.activeMessagesChatID.value.trim()
    if (chatID) await input.loadMessages(chatID)
    void input.loadChats()
  }

  /** Mirrors the workspace's own delete confirm: API call, then a full unwind. */
  async function removeChat(chat: ChatItem, options: RemoveChatOptions = {}): Promise<boolean> {
    const chatID = chatIDOf(chat)
    if (!chatID) return false
    const parentID = (chat.parent_chat_id || '').trim()
    try {
      const kind = (chat.kind || '').trim()
      if (kind === 'channel' && parentID) {
        await deleteChannel(parentID, chatID)
        await input.loadGroupChannels(parentID)
        if ((input.selectedGroupChannelByGroupId.value[parentID] || '') === chatID) {
          input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [parentID]: parentID }
          input.persistGroupSelection()
        }
      } else {
        await deleteChatRequest(chatID, Boolean(chat.is_direct) && options.forEveryone ? { forEveryone: true } : undefined)
        if (kind === 'group') {
          input.selectedGroupChannelByGroupId.value = Object.fromEntries(
            Object.entries(input.selectedGroupChannelByGroupId.value || {}).filter(([id]) => id !== chatID),
          )
          input.persistGroupSelection()
        }
      }
    } catch {
      fail('chat.request_failed', 'Request failed')
      return false
    }

    writeJSON(`${MSG_CACHE_PREFIX}${chatID}`, [])
    if (input.selectedChatID.value.trim() === chatID) {
      input.selectedChatID.value = ''
      input.rawMessages.value = []
      input.chatMembers.value = []
      input.infoOpen.value = false
      input.clearHash()
    }
    void input.loadChats()
    return true
  }

  return {
    toggleArchived,
    togglePinned,
    reorderPinned,
    markRead,
    clearHistory,
    reloadActiveChat,
    removeChat,
  }
}
