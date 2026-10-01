import type { Ref } from 'vue'

/** How long a peer stays marked as typing after the last heartbeat. */
const TYPING_TTL_MS = 5000
/** Minimum gap between two outgoing typing frames (the server throttles too). */
const SEND_MIN_GAP_MS = 2000
const PRUNE_INTERVAL_MS = 1000

export type TypingMap = Record<string, Record<string, number>>

type SetupWorkspaceTypingInput = {
  wsConnected: Ref<boolean>
  sendEvent: (type: string, payload: unknown) => boolean
  typingByChat: Ref<TypingMap>
  getSelfUserID: () => string
  ensureConnected?: () => void
}

export function setupWorkspaceTyping(input: SetupWorkspaceTypingInput) {
  const subscribedChats = new Set<string>()
  let lastSentAt = 0
  let pruneTimer: number | null = null

  function prune() {
    const now = Date.now()
    const current = input.typingByChat.value
    let changed = false
    const next: TypingMap = {}
    for (const chatID of Object.keys(current)) {
      const users = current[chatID]
      if (!users) continue
      const kept: Record<string, number> = {}
      for (const userID of Object.keys(users)) {
        if ((users[userID] || 0) > now) kept[userID] = users[userID]
      }
      if (Object.keys(kept).length > 0) next[chatID] = kept
      else changed = true
    }
    if (!changed) {
      for (const chatID of Object.keys(next)) {
        if (Object.keys(next[chatID]).length !== Object.keys(current[chatID] || {}).length) {
          changed = true
          break
        }
      }
    }
    if (changed) input.typingByChat.value = next
    if (Object.keys(next).length === 0) stopPrune()
  }

  function startPrune() {
    if (pruneTimer !== null) return
    pruneTimer = window.setInterval(prune, PRUNE_INTERVAL_MS)
  }

  function stopPrune() {
    if (pruneTimer === null) return
    window.clearInterval(pruneTimer)
    pruneTimer = null
  }

  /** Called on every keystroke in the composer; throttled before hitting the socket. */
  function noteTyping(chatID: string) {
    const id = (chatID || '').trim()
    if (!id || !input.wsConnected.value) return
    const now = Date.now()
    if (now - lastSentAt < SEND_MIN_GAP_MS) return
    lastSentAt = now
    if (!input.sendEvent('typing', { chat_id: id })) input.ensureConnected?.()
  }

  function subscribe(chatID: string) {
    const id = (chatID || '').trim()
    if (!id || subscribedChats.has(id)) return
    subscribedChats.add(id)
    if (input.wsConnected.value) input.sendEvent('chat.subscribe', { chat_id: id })
  }

  function unsubscribe(chatID: string) {
    const id = (chatID || '').trim()
    if (!id || !subscribedChats.delete(id)) return
    if (input.wsConnected.value) input.sendEvent('chat.unsubscribe', { chat_id: id })
  }

  /** Socket sessions do not survive a reconnect: rejoin every tracked chat. */
  function resubscribeAll() {
    for (const chatID of subscribedChats) input.sendEvent('chat.subscribe', { chat_id: chatID })
  }

  function recordTyping(chatID: string, userID: string) {
    const chat = (chatID || '').trim()
    const user = (userID || '').trim()
    if (!chat || !user || user === input.getSelfUserID()) return
    const now = Date.now()
    const users = { ...(input.typingByChat.value[chat] || {}) }
    users[user] = now + TYPING_TTL_MS
    input.typingByChat.value = { ...input.typingByChat.value, [chat]: users }
    startPrune()
  }

  function clearChat(chatID: string) {
    const chat = (chatID || '').trim()
    if (!chat || !input.typingByChat.value[chat]) return
    const next = { ...input.typingByChat.value }
    delete next[chat]
    input.typingByChat.value = next
  }

  function dispose() {
    stopPrune()
    if (input.wsConnected.value) {
      for (const chatID of subscribedChats) input.sendEvent('chat.unsubscribe', { chat_id: chatID })
    }
    subscribedChats.clear()
    input.typingByChat.value = {}
  }

  return {
    noteTyping,
    subscribe,
    unsubscribe,
    resubscribeAll,
    recordTyping,
    clearChat,
    dispose,
  }
}
