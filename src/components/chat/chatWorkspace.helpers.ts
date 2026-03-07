import type { MessageItem } from 'combox-api'
import type { PeerProfile } from './chatWorkspace.types'

export function normalizeMessageOrder(items: MessageItem[]): MessageItem[] {
  if (items.length < 2) return items
  const first = new Date(items[0].created_at).getTime()
  const last = new Date(items[items.length - 1].created_at).getTime()
  if (Number.isNaN(first) || Number.isNaN(last)) return items
  return first > last ? items.slice().reverse() : items
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function unwrapWsPayload<T>(raw: unknown): T {
  const root = asRecord(raw)
  const payload = asRecord(root.payload)
  return ((Object.keys(payload).length > 0 ? payload : root) as unknown) as T
}

export function normalizePeerProfile(input: unknown): PeerProfile | null {
  const root = asRecord(input)
  const profile = asRecord(root.profile)
  const pick = (key: string): string => {
    const fromRoot = root[key]
    if (typeof fromRoot === 'string') return fromRoot.trim()
    const fromProfile = profile[key]
    if (typeof fromProfile === 'string') return fromProfile.trim()
    return ''
  }
  const id = pick('id')
  const username = pick('username')
  const first_name = pick('first_name')
  const last_name = pick('last_name')
  const email = pick('email')
  const birth_date = pick('birth_date')
  const avatar_data_url = pick('avatar_data_url')
  if (!id && !username && !first_name && !email) return null
  return {
    id,
    username,
    first_name: first_name || undefined,
    last_name: last_name || undefined,
    email: email || undefined,
    birth_date: birth_date || undefined,
    avatar_data_url: avatar_data_url || undefined,
  }
}
