import { parseMessageContent, type MessageItem } from 'combox-api'
import type { ResolvedAttachment, ViewMessage } from './chatTypes'

type AttachmentUrlMap = Record<string, Omit<ResolvedAttachment, 'id' | 'filename' | 'mimeType' | 'kind'>>
type ParsedCacheEntry = ReturnType<typeof parseMessageContent>

const parsedContentCache = new Map<string, ParsedCacheEntry>()

function getParsedContent(raw: string): ParsedCacheEntry {
  const key = raw || ''
  const cached = parsedContentCache.get(key)
  if (cached) return cached
  const parsed = parseMessageContent(key)
  if (parsedContentCache.size > 500) {
    const firstKey = parsedContentCache.keys().next().value
    if (firstKey) parsedContentCache.delete(firstKey)
  }
  parsedContentCache.set(key, parsed)
  return parsed
}

export function toViewMessage(raw: MessageItem, urlsByAttachment: AttachmentUrlMap): ViewMessage {
  const parsed = getParsedContent(raw.content || '')
  const attachments: ResolvedAttachment[] = parsed.attachments.map((token) => {
    const hydrated = urlsByAttachment[token.id]
    return {
      id: token.id,
      filename: token.filename || '',
      mimeType: token.mimeType || '',
      kind: token.kind || 'file',
      url: hydrated?.url || '',
      previewUrl: hydrated?.previewUrl || '',
      width: hydrated?.width || 0,
      height: hydrated?.height || 0,
      durationMs: hydrated?.durationMs || 0,
    }
  })

  return {
    raw,
    text: parsed.text || '',
    attachments,
  }
}

export function formatMessageTime(dateLike: string): string {
  if (!dateLike) return ''
  const date = new Date(dateLike)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function normalizeAvatarSrc(src: string): string {
  const value = (src || '').trim()
  if (!value) return ''
  if (value.startsWith('data:')) return value
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  return ''
}

export function isComboxHost(hostnameRaw: string): boolean {
  const hostname = (hostnameRaw || '').trim().toLowerCase()
  return hostname === 'combox.local' || hostname.endsWith('.combox.local')
}

export function isComboxUrl(urlRaw: string): boolean {
  const raw = (urlRaw || '').trim()
  if (!raw) return false
  try {
    const parsed = new URL(raw)
    return isComboxHost(parsed.hostname)
  } catch {
    return false
  }
}

export function toCurrentOriginComboxUrl(urlRaw: string): string {
  const raw = (urlRaw || '').trim()
  if (!raw) return raw
  try {
    const parsed = new URL(raw)
    if (!isComboxHost(parsed.hostname)) return raw
    const next = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`
    return `${window.location.origin}${next}`
  } catch {
    return raw
  }
}

export function openComboxAwareUrl(urlRaw: string): void {
  const raw = (urlRaw || '').trim()
  if (!raw) return
  if (isComboxUrl(raw)) {
    window.location.assign(toCurrentOriginComboxUrl(raw))
    return
  }
  window.open(raw, '_blank', 'noopener,noreferrer')
}
