import { buildWsUrlWithFreshToken } from 'combox-api'

type StatusPayload = { status: string; userID: string; at?: string }
type EventMeta = { type: string; chatID: string; messageID: string; id?: string }
type MessageCreatedPayload = { chatID: string; senderUserID: string; messageID: string; muted?: boolean }
type PresencePayload = { userID: string; online: boolean; lastSeen?: string; lastSeenVisible?: boolean }

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timeoutId: number | null
}

type UseChatRealtimeArgs = {
  getSelectedChatID: () => string
  getAdditionalChatIDs?: () => string[]
  reloadChats: () => Promise<void>
  reloadMessages: (chatID: string) => Promise<void>
  onChatEvent?: (payload: { type: string; chatID: string; raw: unknown }) => void
  onMessageDeleted: (messageID: string, chatID: string) => void
  onMessageStatus: (messageID: string, chatID: string, status: StatusPayload) => void
  onMessageCreated?: (payload: MessageCreatedPayload) => void
  onNotificationMessageCreated?: (payload: MessageCreatedPayload) => void
  onPresenceUpdate?: (payload: PresencePayload) => void
  onConnectionStateChange?: (connected: boolean) => void
  onRequestResponse?: (id: string, payload: unknown) => void
}

type RealtimeRuntime = {
  socket: WebSocket | null
  reconnectTimer: number | null
  chatsReloadTimer: number | null
  messagesReloadTimer: number | null
  reconnectDelay: number
  wsAttempt: number
  stopped: boolean
  pendingRequests: Map<string, PendingRequest>
  nextRequestId: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readRealtimeEventMeta(payload: unknown): EventMeta {
  const roots = [asObject(payload)].filter(Boolean) as Record<string, unknown>[]
  if (roots.length > 0) {
    const nested = [asObject(roots[0].event), asObject(roots[0].payload), asObject(roots[0].data)].filter(Boolean) as Record<string, unknown>[]
    roots.push(...nested)
  }
  let type = ''
  let chatID = ''
  let messageID = ''
  let id = ''
  for (const item of roots) {
    if (!id && typeof item.id === 'string') id = item.id
    if (!type) {
      if (typeof item.type === 'string') type = item.type
      else if (typeof item.event_type === 'string') type = item.event_type
      else if (typeof item.event === 'string') type = item.event
    }
    if (!chatID) {
      if (typeof item.chat_id === 'string') chatID = item.chat_id
      else if (typeof item.chatId === 'string') chatID = item.chatId
      else {
        const message = asObject(item.message)
        const chat = asObject(item.chat)
        if (message && typeof message.chat_id === 'string') chatID = message.chat_id
        else if (chat && typeof chat.id === 'string') chatID = chat.id
      }
    }
    if (!messageID) {
      if (typeof item.message_id === 'string') messageID = item.message_id
      else if (typeof item.messageId === 'string') messageID = item.messageId
      else {
        const message = asObject(item.message)
        if (message && typeof message.id === 'string') messageID = message.id
      }
    }
  }
  return { type, chatID, messageID, id }
}

function readRealtimeStatus(payload: unknown): StatusPayload {
  const roots = [asObject(payload)].filter(Boolean) as Record<string, unknown>[]
  if (roots.length > 0) {
    const nested = [asObject(roots[0].event), asObject(roots[0].payload), asObject(roots[0].data)].filter(Boolean) as Record<string, unknown>[]
    roots.push(...nested)
  }
  let status = ''
  let userID = ''
  let at = ''
  for (const item of roots) {
    if (!status && typeof item.status === 'string') status = item.status
    if (!userID) {
      if (typeof item.user_id === 'string') userID = item.user_id
      else if (typeof item.userId === 'string') userID = item.userId
    }
    if (!at && typeof item.at === 'string') at = item.at
  }
  return { status: status.trim().toLowerCase(), userID: userID.trim(), at: at.trim() || undefined }
}

function readMessageCreated(payload: unknown): MessageCreatedPayload {
  const roots = [asObject(payload)].filter(Boolean) as Record<string, unknown>[]
  if (roots.length > 0) {
    const nested = [asObject(roots[0].event), asObject(roots[0].payload), asObject(roots[0].data)].filter(Boolean) as Record<string, unknown>[]
    roots.push(...nested)
  }

  let chatID = ''
  let senderUserID = ''
  let messageID = ''
  for (const item of roots) {
    if (!chatID) {
      if (typeof item.chat_id === 'string') chatID = item.chat_id
      else if (typeof item.chatId === 'string') chatID = item.chatId
      else {
        const message = asObject(item.message)
        if (message && typeof message.chat_id === 'string') chatID = message.chat_id
        else if (message && typeof message.chatId === 'string') chatID = message.chatId
      }
    }
    if (!senderUserID) {
      if (typeof item.sender_user_id === 'string') senderUserID = item.sender_user_id
      else if (typeof item.senderUserId === 'string') senderUserID = item.senderUserId
      else if (typeof item.user_id === 'string') senderUserID = item.user_id
      else if (typeof item.userId === 'string') senderUserID = item.userId
    }
    if (!messageID) {
      if (typeof item.message_id === 'string') messageID = item.message_id
      else if (typeof item.messageId === 'string') messageID = item.messageId
      else {
        const message = asObject(item.message)
        if (message && typeof message.id === 'string') messageID = message.id
      }
    }
  }

  return { chatID: chatID.trim(), senderUserID: senderUserID.trim(), messageID: messageID.trim() }
}

function readPresence(payload: unknown): PresencePayload {
  const roots = [asObject(payload)].filter(Boolean) as Record<string, unknown>[]
  if (roots.length > 0) {
    const nested = [asObject(roots[0].event), asObject(roots[0].payload), asObject(roots[0].data)].filter(Boolean) as Record<string, unknown>[]
    roots.push(...nested)
  }

  let userID = ''
  let online = false
  let hasOnline = false
  let lastSeen = ''
  let lastSeenVisible = true

  for (const item of roots) {
    if (!userID) {
      if (typeof item.user_id === 'string') userID = item.user_id
      else if (typeof item.userId === 'string') userID = item.userId
    }
    if (!hasOnline && typeof item.online === 'boolean') {
      online = item.online
      hasOnline = true
    }
    if (!lastSeen && typeof item.last_seen === 'string') lastSeen = item.last_seen
    if (typeof item.last_seen_visible === 'boolean') lastSeenVisible = item.last_seen_visible
  }

  return {
    userID: userID.trim(),
    online,
    lastSeen: lastSeen.trim() || undefined,
    lastSeenVisible,
  }
}

export function useChatRealtime(args: UseChatRealtimeArgs) {
  const runtime: RealtimeRuntime = {
    socket: null,
    reconnectTimer: null,
    chatsReloadTimer: null,
    messagesReloadTimer: null,
    reconnectDelay: 500,
    wsAttempt: 0,
    stopped: true,
    pendingRequests: new Map(),
    nextRequestId: 1,
  }

  const clearTimers = () => {
    if (runtime.reconnectTimer) window.clearTimeout(runtime.reconnectTimer)
    if (runtime.chatsReloadTimer) window.clearTimeout(runtime.chatsReloadTimer)
    if (runtime.messagesReloadTimer) window.clearTimeout(runtime.messagesReloadTimer)
    runtime.reconnectTimer = null
    runtime.chatsReloadTimer = null
    runtime.messagesReloadTimer = null
  }

  const sendRequest = <T = unknown>(type: string, payload: unknown): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      if (!runtime.socket || runtime.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }
      const id = `req_${runtime.nextRequestId++}`
      const timeoutId = window.setTimeout(() => {
        const pending = runtime.pendingRequests.get(id)
        if (!pending) return
        runtime.pendingRequests.delete(id)
        pending.reject(new Error(`WebSocket request timeout: ${type}`))
      }, 8000)
      runtime.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeoutId })
      const body = asObject(payload)
      runtime.socket.send(JSON.stringify({ type, id, ...body }))
    })
  }

  const sendEvent = (type: string, payload: unknown): boolean => {
    if (!runtime.socket || runtime.socket.readyState !== WebSocket.OPEN) return false
    const body = asObject(payload)
    runtime.socket.send(JSON.stringify({ type, ...body }))
    return true
  }

  const scheduleReconnect = () => {
    if (runtime.stopped) return
    if (runtime.reconnectTimer) window.clearTimeout(runtime.reconnectTimer)
    runtime.reconnectTimer = window.setTimeout(() => {
      runtime.reconnectTimer = null
      void start()
    }, runtime.reconnectDelay)
    runtime.reconnectDelay = Math.min(runtime.reconnectDelay * 2, 5000)
  }

  const scheduleMessagesReload = (chatID: string) => {
    const selectedChatID = (args.getSelectedChatID() || '').trim()
    const additional = (args.getAdditionalChatIDs?.() || []).map((id) => (id || '').trim()).filter(Boolean)
    if (!chatID) return
    if (chatID !== selectedChatID && !additional.includes(chatID)) return
    if (runtime.messagesReloadTimer) window.clearTimeout(runtime.messagesReloadTimer)
    runtime.messagesReloadTimer = window.setTimeout(() => {
      runtime.messagesReloadTimer = null
      void args.reloadMessages(chatID)
    }, 120)
  }

  const handleInboundPayload = (raw: string) => {
    try {
      const payload = JSON.parse(raw)
      const { type, chatID, messageID, id } = readRealtimeEventMeta(payload)
      if (type === 'message.created' || type === 'chat.created' || type === 'chat.updated' || type === 'chat.member_added' || type === 'chat.member_removed') {
        if (runtime.chatsReloadTimer) window.clearTimeout(runtime.chatsReloadTimer)
        runtime.chatsReloadTimer = window.setTimeout(() => {
          runtime.chatsReloadTimer = null
          void args.reloadChats()
        }, 120)
      }
      if ((type === 'chat.created' || type === 'chat.updated' || type === 'chat.member_added' || type === 'chat.member_removed') && chatID && args.onChatEvent) {
        args.onChatEvent({ type, chatID, raw: payload })
      }
      if ((type === 'message.created' || type === 'message.updated' || type === 'message.reaction' || type === 'message.deleted') && chatID) {
        scheduleMessagesReload(chatID)
      }
      if (type === 'message.created' && args.onMessageCreated) {
        const created = readMessageCreated(payload)
        if (created.chatID) args.onMessageCreated(created)
      }
      if (type === 'notification' && args.onNotificationMessageCreated) {
        const root = asObject(payload)
        const kind = typeof root?.kind === 'string' ? root.kind.trim().toLowerCase() : ''
        if (kind === 'message.created') {
          const inner = root?.payload
          const created = readMessageCreated(inner)
          const muted = Boolean(root && (root as Record<string, unknown>).muted === true)
          if (created.chatID) args.onNotificationMessageCreated({ ...created, muted })
        }
      }
      if (type === 'presence.update' && args.onPresenceUpdate) {
        const presence = readPresence(payload)
        if (presence.userID) args.onPresenceUpdate(presence)
      }
      if (type === 'message.deleted' && chatID && messageID && chatID === args.getSelectedChatID()) {
        args.onMessageDeleted(messageID, chatID)
      }
      if (type === 'message.status' && chatID && messageID) {
        const status = readRealtimeStatus(payload)
        if (status.status) args.onMessageStatus(messageID, chatID, status)
      }
      if (id) {
        const pending = runtime.pendingRequests.get(id)
        if (pending) {
          runtime.pendingRequests.delete(id)
          if (pending.timeoutId) window.clearTimeout(pending.timeoutId)
          pending.resolve(payload)
        }
        if (args.onRequestResponse) args.onRequestResponse(id, payload)
      }
    } catch {
      // ignore malformed payload
    }
  }

  const onInboundEvent = (event: MessageEvent) => {
    if (typeof event.data === 'string') {
      handleInboundPayload(event.data)
      return
    }
    if (event.data instanceof Blob) {
      void event.data.text().then(handleInboundPayload).catch(() => {})
    }
  }

  const start = async () => {
    if (runtime.socket && (runtime.socket.readyState === WebSocket.OPEN || runtime.socket.readyState === WebSocket.CONNECTING)) return
    runtime.stopped = false
    try {
      const forceRefresh = runtime.wsAttempt > 0 && runtime.wsAttempt % 3 === 0
      const wsURL = await buildWsUrlWithFreshToken(undefined, forceRefresh)
      if (runtime.stopped || !wsURL) return
      const socket = new WebSocket(wsURL)
      runtime.socket = socket
      socket.onopen = () => {
        args.onConnectionStateChange?.(true)
        runtime.reconnectDelay = 500
        runtime.wsAttempt = 0
        void args.reloadChats()
        const selectedChatID = (args.getSelectedChatID() || '').trim()
        if (selectedChatID) void args.reloadMessages(selectedChatID)
        const additional = (args.getAdditionalChatIDs?.() || []).map((id) => (id || '').trim()).filter(Boolean)
        for (const chatID of additional) {
          if (chatID && chatID !== selectedChatID) void args.reloadMessages(chatID)
        }
      }
      socket.onmessage = onInboundEvent
      socket.onerror = () => {
        args.onConnectionStateChange?.(false)
      }
      socket.onclose = () => {
        args.onConnectionStateChange?.(false)
        runtime.socket = null
        runtime.wsAttempt += 1
        if (!runtime.stopped) scheduleReconnect()
      }
    } catch {
      args.onConnectionStateChange?.(false)
      runtime.socket = null
      runtime.wsAttempt += 1
      scheduleReconnect()
    }
  }

  const stop = () => {
    runtime.stopped = true
    clearTimers()
    args.onConnectionStateChange?.(false)
    for (const [, pending] of runtime.pendingRequests) {
      if (pending.timeoutId) window.clearTimeout(pending.timeoutId)
      pending.reject(new Error('WebSocket stopped'))
    }
    runtime.pendingRequests.clear()
    const socket = runtime.socket
    runtime.socket = null
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close()
  }

  return { start, stop, sendRequest, sendEvent }
}
