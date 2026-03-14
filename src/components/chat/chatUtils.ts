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
  const rawRecord = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const senderUserId = String(rawRecord.sender_user_id || '').trim()
  const normalizedRaw: MessageItem = senderUserId
    ? { ...raw, user_id: senderUserId }
    : raw

  const parsed = getParsedContent(normalizedRaw.content || '')
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
    raw: normalizedRaw,
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

function detectAttachmentPreviewKind(token: { kind?: string; filename?: string; mimeType?: string }): 'gif' | 'video' | 'image' | 'audio' | 'file' {
  const kind = (token.kind || '').trim().toLowerCase()
  const filename = (token.filename || '').trim().toLowerCase()
  const mimeType = (token.mimeType || '').trim().toLowerCase()
  if (kind === 'gif' || mimeType === 'image/gif' || filename.endsWith('.gif')) return 'gif'
  if (kind === 'video') return 'video'
  if (kind === 'image') return 'image'
  if (kind === 'audio' || mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

export function summarizeMessagePreview(
  raw: string,
  labels: { gif: string; video: string; photo: string; audio: string; file: string; empty: string },
): string {
  const parsed = getParsedContent(raw || '')
  const text = (parsed.text || '').trim()
  if (text) return text
  const first = parsed.attachments[0]
  if (!first) return labels.empty
  const previewKind = detectAttachmentPreviewKind(first)
  if (previewKind === 'gif') return labels.gif
  if (previewKind === 'video') return labels.video
  if (previewKind === 'image') return labels.photo
  if (previewKind === 'audio') return labels.audio
  return labels.file
}

export function firstPreviewAttachmentId(raw: string): string {
  const parsed = getParsedContent(raw || '')
  return (parsed.attachments[0]?.id || '').trim()
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
    try {
      const parsed = new URL(raw)
      const nextHash = (parsed.hash || '').trim()
      if (nextHash) {
        const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`
        window.history.replaceState(null, '', nextUrl)
        window.dispatchEvent(new HashChangeEvent('hashchange'))
        return
      }
      window.history.replaceState(null, '', `${parsed.pathname || '/'}${parsed.search || ''}`)
      return
    } catch {
      window.location.assign(toCurrentOriginComboxUrl(raw))
      return
    }
  }
  if (raw.startsWith('/#') || raw.startsWith('#')) {
    const hash = raw.startsWith('/#') ? raw.slice(1) : raw
    const nextUrl = `${window.location.pathname}${window.location.search}${hash}`
    window.history.replaceState(null, '', nextUrl)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.open(raw, '_blank', 'noopener,noreferrer')
}
