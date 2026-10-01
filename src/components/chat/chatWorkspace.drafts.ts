import { ref } from 'vue'

const STORAGE_KEY = 'combox.chat_drafts.v1'
const FLUSH_DELAY_MS = 250

function readAll(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Unsent text, per conversation, shared by the composer and the chat list. */
export const chatDrafts = ref<Record<string, string>>(readAll())

let flushTimer: number | null = null

function flush() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chatDrafts.value))
  } catch {
    // Private mode / quota exceeded: drafts simply stay in memory.
  }
}

function scheduleFlush() {
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_DELAY_MS)
}

export function getChatDraft(chatID: string): string {
  const id = (chatID || '').trim()
  if (!id) return ''
  return chatDrafts.value[id] || ''
}

export function setChatDraft(chatID: string, text: string): void {
  const id = (chatID || '').trim()
  if (!id) return
  const next = text || ''
  if ((chatDrafts.value[id] || '') === next) return
  const map = { ...chatDrafts.value }
  if (next.trim()) map[id] = next
  else delete map[id]
  chatDrafts.value = map
  scheduleFlush()
}

export function clearChatDraft(chatID: string): void {
  setChatDraft(chatID, '')
}

export function chatDraftPreview(text: string): string {
  const flat = (text || '').replace(/\s+/g, ' ').trim()
  if (flat.length <= 90) return flat
  return `${flat.slice(0, 89)}…`
}
