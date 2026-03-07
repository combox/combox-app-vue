import { readJSON, writeJSON } from './chatWorkspace.storage'
import type { MessageStatus } from './chatWorkspace.types'

export function persistStatusToChatCache(statusCachePrefix: string, chatID: string, status: MessageStatus) {
  const cleanChatID = (chatID || '').trim()
  if (!cleanChatID || !status.message_id) return
  const key = `${statusCachePrefix}${cleanChatID}`
  const cached = readJSON<Record<string, MessageStatus>>(key, {})
  const next = { ...cached, [status.message_id]: status }
  writeJSON(key, next)
}

export function persistStatusToGlobalCache(globalStatusKey: string, status: MessageStatus) {
  if (!status.message_id) return
  const cached = readJSON<Record<string, MessageStatus>>(globalStatusKey, {})
  const next = { ...cached, [status.message_id]: status }
  writeJSON(globalStatusKey, next)
}
