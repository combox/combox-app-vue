import { buildWsUrlWithFreshToken } from 'combox-api'
import type { SearchUserResult } from 'combox-api'

type StatusPayload = { status: string; userID: string; at?: string }
type EventMeta = { type: string; chatID: string; messageID: string; id?: string }
type MessageCreatedPayload = { chatID: string; senderUserID: string; messageID: string; muted?: boolean; preview?: string }
type PresencePayload = { userID: string; online: boolean; lastSeen?: string; lastSeenVisible?: boolean }
type CallEventPayload = { callID: string; chatID: string; kind: string; startedBy: string; startedAt: string; reason?: string }

export type ProfileUpdatePayload = { userID: string; user: SearchUserResult }
export type TypingPayload = { chatID: string; userID: string }
export type ChatUpdatedPayload = { chatID: string; chat: Record<string, unknown>; updatedAt?: string }
export type MessageReactionPayload = {
  chatID: string
  messageID: string
  reactions: Array<{ emoji: string; count: number; user_ids: string[] }>
}

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
  onMessageReaction?: (payload: MessageReactionPayload) => void
  onMessageCreated?: (payload: MessageCreatedPayload) => void
  onNotificationMessageCreated?: (payload: MessageCreatedPayload) => void
  onPresenceUpdate?: (payload: PresencePayload) => void
  onTyping?: (payload: TypingPayload) => void
  onProfileUpdate?: (payload: ProfileUpdatePayload) => void
  onChatUpdated?: (payload: ChatUpdatedPayload) => void
  onCallStarted?: (payload: CallEventPayload) => void
  onCallEnded?: (payload: CallEventPayload) => void
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

function readTypingEvent(payload: unknown): TypingPayload {
  const roots = [asObject(payload)].filter(Boolean) as Record<string, unknown>[]
  if (roots.length > 0) {
    const nested = [asObject(roots[0].event), asObject(roots[0].payload), asObject(roots[0].data)].filter(Boolean) as Record<string, unknown>[]
    roots.push(...nested)
  }
  let chatID = ''
  let userID = ''
  for (const item of roots) {
    if (!chatID) {
      if (typeof item.chat_id === 'string') chatID = item.chat_id
      else if (typeof item.chatId === 'string') chatID = item.chatId
    }
    if (!userID) {
      if (typeof item.user_id === 'string') userID = item.user_id
      else if (typeof item.userId === 'string') userID = item.userId
      else if (typeof item.sender_user_id === 'string') userID = item.sender_user_id
      else if (typeof item.senderUserId === 'string') userID = item.senderUserId
    }
  }
  return { chatID: chatID.trim(), userID: userID.trim() }
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
  let preview = ''
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
    if (!preview) {
      if (typeof item.preview === 'string') preview = item.preview
      else if (typeof item.content === 'string') preview = item.content
    }
  }

  const out: MessageCreatedPayload = {
    chatID: chatID.trim(),
    senderUserID: senderUserID.trim(),
    messageID: messageID.trim(),
  }
  const cleanPreview = preview.trim()
  if (cleanPreview) out.preview = cleanPreview
  return out
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
  let lastSeenVisible: boolean | undefined

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

  const out: PresencePayload = {
    userID: userID.trim(),
    online,
    lastSeen: lastSeen.trim() || undefined,
  }
  // Absent frames must not overwrite the visibility fetched over REST.
  if (lastSeenVisible !== undefined) out.lastSeenVisible = lastSeenVisible
  return out
}

function readCallEvent(payload: unknown): CallEventPayload {
  const roots = [asObject(payload)].filter(Boolean) as Record<string, unknown>[]
  if (roots.length > 0) {
    const nested = [asObject(roots[0].event), asObject(roots[0].payload), asObject(roots[0].data)].filter(Boolean) as Record<string, unknown>[]
    roots.push(...nested)
  }

  let callID = ''
  let chatID = ''
  let kind = ''
  let startedBy = ''
  let startedAt = ''
  let reason = ''
  for (const item of roots) {
    if (!callID) {
      if (typeof item.call_id === 'string') callID = item.call_id
      else if (typeof item.callID === 'string') callID = item.callID
      else if (typeof item.id === 'string') callID = item.id
    }
    if (!chatID) {
      if (typeof item.chat_id === 'string') chatID = item.chat_id
      else if (typeof item.chatId === 'string') chatID = item.chatId
    }
    if (!kind && typeof item.kind === 'string') kind = item.kind
    if (!startedBy) {
      if (typeof item.started_by === 'string') startedBy = item.started_by
      else if (typeof item.startedBy === 'string') startedBy = item.startedBy
    }
    if (!startedAt && typeof item.started_at === 'string') startedAt = item.started_at
    if (!reason && typeof item.reason === 'string') reason = item.reason
  }

  return { callID, chatID, kind, startedBy, startedAt, reason }
}

function readProfileUpdate(payload: unknown): ProfileUpdatePayload | null {
  const root = asObject(payload)
  if (!root) return null
  const nested = asObject(root.event) ?? asObject(root.payload) ?? asObject(root.data)
  const profile = asObject(root.profile) ?? asObject(root.user) ?? nested ?? root
  let userID = ''
  if (typeof root.user_id === 'string') userID = root.user_id
  if (!userID && typeof profile.user_id === 'string') userID = profile.user_id
  if (!userID && typeof profile.id === 'string') userID = profile.id
  userID = userID.trim()
  if (!userID) return null
  return { userID, user: profile as unknown as SearchUserResult }
}

function readChatUpdated(payload: unknown): ChatUpdatedPayload | null {
  const root = asObject(payload)
  if (!root) return null
  const chat = asObject(root.chat)
  let chatID = ''
  if (typeof root.chat_id === 'string') chatID = root.chat_id
  if (!chatID && chat && typeof chat.id === 'string') chatID = chat.id
  chatID = chatID.trim()
  if (!chatID || !chat) return null
  const updatedAt = typeof root.updated_at === 'string' ? root.updated_at : undefined
  return { chatID, chat, updatedAt }
}

function readMessageReaction(payload: unknown): MessageReactionPayload | null {
  const root = asObject(payload)
  if (!root) return null
  const nested = asObject(root.event) ?? asObject(root.payload) ?? asObject(root.data) ?? root
  const src = { ...root, ...nested } as Record<string, unknown>
  const chatID = String(src.chat_id || src.chatId || '').trim()
  const messageID = String(src.message_id || src.messageId || '').trim()
  if (!chatID || !messageID) return null
  const rawReactions = Array.isArray(src.reactions) ? (src.reactions as unknown[]) : []
  const reactions = rawReactions
    .map((item) => {
      const node = asObject(item)
      if (!node) return null
      const emoji = String(node.emoji || '').trim()
      if (!emoji) return null
      const userIdsRaw = Array.isArray(node.user_ids)
        ? node.user_ids
        : Array.isArray(node.userIds)
          ? node.userIds
          : []
      const user_ids = (userIdsRaw as unknown[]).map((id) => String(id || '').trim()).filter(Boolean)
      const countRaw = Number(node.count)
      const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : user_ids.length
      return { emoji, count, user_ids }
    })
    .filter(Boolean) as Array<{ emoji: string; count: number; user_ids: string[] }>
  return { chatID, messageID, reactions }
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

  // A tab restored from bfcache (or woken after a freeze) can lose its socket
  // without ever firing `close`, leaving wsConnected stale and presence dead.
  const ensureConnected = () => {
    if (runtime.stopped) return
    const state = runtime.socket ? runtime.socket.readyState : WebSocket.CLOSED
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return
    const stale = runtime.socket
    runtime.socket = null
    if (stale) {
      stale.onopen = null
      stale.onmessage = null
      stale.onerror = null
      stale.onclose = null
      try {
        stale.close()
      } catch {
        // ignore
      }
    }
    runtime.reconnectDelay = 500
    void start()
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
      if ((type === 'message.created' || type === 'message.updated' || type === 'message.deleted') && chatID) {
        scheduleMessagesReload(chatID)
      }
      // Reactions carry their own authoritative payload (see
      // ToggleMessageReaction publish). Patching in place avoids a full
      // messages reload, which remounts MessageMedia, resets its lazy-observer
      // state and re-renders skeletons — the "reaction kills the photo" shape.
      // The patch itself lives in actions.message (which owns rawMessages);
      // here we only broadcast, never reload.
      if (type === 'message.reaction') {
        const reaction = readMessageReaction(payload)
        if (reaction) {
          if (args.onMessageReaction) args.onMessageReaction(reaction)
          try {
            window.dispatchEvent(new CustomEvent('combox:message-reaction', { detail: reaction }))
          } catch {
            // event bus is best-effort
          }
        }
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
      if (type === 'call.started' && args.onCallStarted) {
        const call = readCallEvent(payload)
        if (call.callID || call.chatID) args.onCallStarted(call)
      }
      if (type === 'call.ended' && args.onCallEnded) {
        const call = readCallEvent(payload)
        if (call.callID || call.chatID) args.onCallEnded(call)
      }
      if (type === 'typing' && args.onTyping) {
        const typing = readTypingEvent(payload)
        if (typing.chatID && typing.userID) args.onTyping(typing)
      }
      if (type === 'presence.update' && args.onPresenceUpdate) {
        const presence = readPresence(payload)
        if (presence.userID) args.onPresenceUpdate(presence)
      }
      if (type === 'profile.update' && args.onProfileUpdate) {
        const update = readProfileUpdate(payload)
        if (update) args.onProfileUpdate(update)
      }
      if (type === 'chat.updated' && args.onChatUpdated) {
        const update = readChatUpdated(payload)
        if (update) args.onChatUpdated(update)
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
      if (runtime.stopped) return
      if (!wsURL) {
        // No URL yet (session still refreshing / backend briefly unreachable).
        // Keep retrying instead of silently giving up on the connection.
        runtime.wsAttempt += 1
        scheduleReconnect()
        return
      }
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

  return { start, stop, sendRequest, sendEvent, ensureConnected }
}
