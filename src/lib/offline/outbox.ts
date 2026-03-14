import { editMessage, forwardMessage, markMessageRead, sendMessage, toggleMessageReaction } from 'combox-api'
import { readJSON, writeJSON } from '../../components/chat/chatWorkspace.storage'

type OutboxAction =
  | { type: 'sendMessage'; chatID: string; content: string; attachmentIDs: string[]; replyToMessageID: string }
  | { type: 'editMessage'; chatID: string; messageID: string; content: string; attachmentIDs: string[] }
  | { type: 'toggleReaction'; messageID: string; emoji: string }
  | { type: 'markRead'; chatID: string; messageID: string }
  | { type: 'forwardMessage'; targetChatID: string; sourceMessageID: string }

export type OutboxItem = { id: string; createdAt: string; action: OutboxAction }

const OUTBOX_KEY = 'combox.offline.outbox.v1'

function nowIso() {
  return new Date().toISOString()
}

function genId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function listOutbox(): OutboxItem[] {
  return readJSON<OutboxItem[]>(OUTBOX_KEY, [])
}

function setOutbox(items: OutboxItem[]) {
  writeJSON(OUTBOX_KEY, items)
}

export function enqueueOutbox(action: OutboxAction): OutboxItem {
  const item: OutboxItem = { id: genId(), createdAt: nowIso(), action }
  const next = [...listOutbox(), item]
  setOutbox(next)
  return item
}

export function removeOutbox(id: string) {
  setOutbox(listOutbox().filter((x) => x.id !== id))
}

export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true
  if (error instanceof TypeError) return true
  if (error instanceof Error) {
    const msg = String(error.message || '').toLowerCase()
    if (msg.includes('failed to fetch')) return true
    if (msg.includes('networkerror')) return true
    if (msg.includes('load failed')) return true
  }
  return false
}

export async function flushOutbox(): Promise<{ flushed: number; remaining: number }> {
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
    return { flushed: 0, remaining: listOutbox().length }
  }

  let flushed = 0
  const items = listOutbox()
  for (const item of items) {
    try {
      const a = item.action
      if (a.type === 'sendMessage') {
        await sendMessage(a.chatID, a.content, a.attachmentIDs, a.replyToMessageID)
      } else if (a.type === 'editMessage') {
        await editMessage(a.chatID, a.messageID, a.content, a.attachmentIDs)
      } else if (a.type === 'toggleReaction') {
        await toggleMessageReaction(a.messageID, a.emoji)
      } else if (a.type === 'markRead') {
        await markMessageRead(a.chatID, a.messageID)
      } else if (a.type === 'forwardMessage') {
        await forwardMessage(a.targetChatID, a.sourceMessageID)
      }
      removeOutbox(item.id)
      flushed += 1
    } catch (error) {
      if (isOfflineError(error)) break
      removeOutbox(item.id)
    }
  }

  return { flushed, remaining: listOutbox().length }
}
