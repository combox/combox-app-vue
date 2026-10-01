import { attachmentTokenFlags, parseMessageContent, type AttachmentToken, type MessageItem } from 'combox-api'
import type { ResolvedAttachment, ViewMessage } from './chatTypes'

type HydratedAttachment = Omit<ResolvedAttachment, 'id' | 'kind' | 'filename' | 'mimeType'> & {
  filename?: string
  mimeType?: string
  userMeta?: Record<string, unknown>
}
type AttachmentUrlMap = Record<string, HydratedAttachment>
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
    // The token is authoritative, but a token minted before the server knew the
    // mime (or a message the local cache rebuilt from server state) can arrive
    // empty: the hydrated record then fills the gaps instead of rendering a
    // generic file tile until the next reload.
    const effectiveToken = {
      ...token,
      filename: token.filename || hydrated?.filename || '',
      mimeType: token.mimeType || hydrated?.mimeType || '',
    }
    const marker = attachmentMarker(effectiveToken)
    return {
      id: token.id,
      filename: effectiveToken.filename,
      mimeType: effectiveToken.mimeType,
      kind: detectAttachmentPreviewKind(effectiveToken),
      url: hydrated?.url || '',
      previewUrl: hydrated?.previewUrl || '',
      width: hydrated?.width || 0,
      height: hydrated?.height || 0,
      durationMs: hydrated?.durationMs || readDurationFromMeta(hydrated?.userMeta),
      sizeBytes: hydrated?.sizeBytes || 0,
      waveform: readWaveformFromMeta(hydrated?.userMeta),
      round: marker === 'round' || readRoundFromMeta(hydrated?.userMeta),
      voice: marker === 'voice' || readVoiceFromMeta(hydrated?.userMeta),
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

function readWaveformFromMeta(userMeta: Record<string, unknown> | undefined): number[] | undefined {
  const raw = userMeta?.waveform
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const peaks = raw
    .slice(0, 1024)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.min(100, Math.round(value)))
  return peaks.length > 0 ? peaks : undefined
}

function readDurationFromMeta(userMeta: Record<string, unknown> | undefined): number {
  const raw = Number(userMeta?.duration_ms)
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

function readRoundFromMeta(userMeta: Record<string, unknown> | undefined): boolean {
  return userMeta?.round === true
}

function readVoiceFromMeta(userMeta: Record<string, unknown> | undefined): boolean {
  return userMeta?.voice === true
}

/** Distinguishes video notes ("rounds") from voice notes without user_meta. */
function attachmentMarker(token: AttachmentToken): 'round' | 'voice' | '' {
  const flags = attachmentTokenFlags(token)
  if (flags.includes('round')) return 'round'
  if (flags.includes('voice')) return 'voice'
  const name = (token.filename || '').trim().toLowerCase()
  if (name.startsWith('round-') || name.startsWith('round_') || name.startsWith('video message')) return 'round'
  if (name.startsWith('voice-') || name.startsWith('voice_') || name.startsWith('audio message')) return 'voice'
  return ''
}

function detectAttachmentPreviewKind(token: { kind?: string; filename?: string; mimeType?: string }): 'gif' | 'video' | 'image' | 'audio' | 'file' {
  const kind = (token.kind || '').trim().toLowerCase()
  const filename = (token.filename || '').trim().toLowerCase()
  const mimeType = (token.mimeType || '').trim().toLowerCase().split(';')[0].trim()
  if (kind === 'audio' || mimeType.startsWith('audio/')) return 'audio'
  if (kind === 'video' || mimeType.startsWith('video/') || mimeType === 'application/ogg' || /\.(mp4|m4v|mov|webm|ogg|mkv)$/.test(filename)) return 'video'
  if (kind === 'image' || mimeType.startsWith('image/') || /\.(jpe?g|png|webp|avif|heic|heif)$/.test(filename)) return 'image'
  if (kind === 'gif' || mimeType === 'image/gif' || filename.endsWith('.gif')) return 'gif'
  if (/\.(mp3|aac|m4a|ogg|opus|oga|flac|wav|m4b)$/.test(filename)) return 'audio'
  return 'file'
}

export type PreviewLabels = {
  gif: string
  video: string
  photo: string
  audio: string
  file: string
  empty: string
  voice?: string
  round?: string
}

/** Default length of a plain-text chat list preview before word-safe truncation. */
export const PREVIEW_MAX_LEN = 140

const PREVIEW_HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/g
const PREVIEW_DANGLING_TAG_TAIL_RE = /<[!/A-Za-z][^<>]*$/
const PREVIEW_MD_LINK_RE = /\[([^\]\n]*)\]\([^)\s]*\)/g

/**
 * Strips markdown syntax for one-line chat list previews: fenced code blocks
 * (fence lines are dropped, inner code is kept), inline code, bold / italic /
 * strike / spoiler markers, `[text](url)` links (kept as `text`), headings,
 * quotes, list markers and explicit HTML tags. `a < b` style comparisons are
 * left alone — only letter-led tags are removed. The result is collapsed to a
 * single line and truncated at a word boundary with `…`.
 */
export function stripMarkdownForPreview(text: string, maxLen = PREVIEW_MAX_LEN): string {
  let out = text || ''
  // Fenced code blocks: drop the fence lines, keep the code itself.
  out = out.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*$/gm, '')
  // Inline code spans keep their content.
  out = out.replace(/`([^`\n]+)`/g, '$1')
  // Links keep their label.
  out = out.replace(PREVIEW_MD_LINK_RE, '$1')
  // Bold / strike / spoiler markers.
  out = out.replace(/(\*\*|~~|\|\|)([\s\S]*?)\1/g, '$2')
  // Italic with `*`, guarded so `a*b` survives.
  out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
  // Underline / italic with `__` / `_`: `__` never splits words, single `_`
  // only strips when it is not word-internal (keeps `snake_case_names`).
  out = out.replace(/__([^_\n]+?)__/g, '$1')
  out = out.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '$1')
  // Backslash-escaped punctuation (`\*` -> `*`).
  out = out.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
  // Block markers at line starts: headings, quotes, list items, rules.
  out = out
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '')
    .replace(/^[ \t]{0,3}\d{1,9}[.)][ \t]+/gm, '')
    .replace(/^[ \t]{0,3}(-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
  // Explicit HTML tags only (`<b>`, `</a>`, `<br/>`); `a < b` is untouched.
  // Bounded fixpoint: a single global replace can re-create a tag from
  // fragments (e.g. `<sc<script>ript>` -> `<script>`), so repeat until stable.
  for (let i = 0; i < 5; i++) {
    const next = out.replace(PREVIEW_HTML_TAG_RE, '')
    if (next === out) break
    out = next
  }
  // Drop a trailing unterminated `<...` / `<!--...` fragment (`<script`, `<!--x`).
  // `<` followed by space/digit (e.g. `a < b`) is preserved.
  out = out.replace(PREVIEW_DANGLING_TAG_TAIL_RE, '')
  // One line, single spaces.
  out = out.replace(/\s+/g, ' ').trim()
  if (out.length > maxLen && maxLen > 0) {
    const cut = out.slice(0, maxLen)
    const lastSpace = cut.lastIndexOf(' ')
    const base = lastSpace > maxLen * 0.5 ? cut.slice(0, lastSpace) : cut
    out = `${base.trimEnd()}…`
  }
  return out
}

export function summarizeMessagePreview(raw: string, labels: PreviewLabels): string {
  const parsed = getParsedContent(raw || '')
  const text = (parsed.text || '').trim()
  if (text) return text
  const first = parsed.attachments[0]
  if (!first) return labels.empty
  const marker = attachmentMarker(first)
  if (marker === 'round') return labels.round || labels.video
  if (marker === 'voice') return labels.voice || labels.audio
  const previewKind = detectAttachmentPreviewKind(first)
  if (previewKind === 'gif') return labels.gif
  if (previewKind === 'video') return labels.video
  if (previewKind === 'image') return labels.photo
  if (previewKind === 'audio') return labels.audio
  return labels.file
}

export type PreviewKind = 'gif' | 'video' | 'image' | 'audio' | 'file' | 'round' | 'voice' | 'none'

/**
 * Drops the leading `"<sender>: "` a group preview carries so the chat list can
 * render the author as its own styled span instead of one flat "Name: text"
 * string. An empty sender leaves the preview untouched; a preview that is only
 * the bare sender name (a group message with an empty body) becomes empty.
 */
export function splitSenderPreview(preview: string, senderName: string): string {
  const raw = preview || ''
  const name = (senderName || '').trim()
  if (!name) return raw
  if (raw.trim() === name) return ''
  const prefix = `${name}:`
  if (!raw.startsWith(prefix)) return raw
  const rest = raw.slice(prefix.length)
  return rest.startsWith(' ') ? rest.slice(1) : rest
}

/** What the chat list thumbnail should show for the newest message. */
export function firstPreviewAttachment(raw: string): { id: string; kind: PreviewKind } {
  const parsed = getParsedContent(raw || '')
  const first = parsed.attachments[0]
  if (!first) return { id: '', kind: 'none' }
  const marker = attachmentMarker(first)
  if (marker === 'round') return { id: first.id, kind: 'round' }
  if (marker === 'voice') return { id: first.id, kind: 'voice' }
  return { id: first.id, kind: detectAttachmentPreviewKind(first) }
}

export function firstPreviewAttachmentId(raw: string): string {
  const parsed = getParsedContent(raw || '')
  return (parsed.attachments[0]?.id || '').trim()
}

const FILE_ICON_RULES: Array<{ test: RegExp; icon: string }> = [
  { test: /\.pdf$/, icon: 'mdi-file-pdf-box' },
  { test: /\.(doc|docx|odt|rtf|pages)$/, icon: 'mdi-file-word-box' },
  { test: /\.(xls|xlsx|ods|csv|numbers)$/, icon: 'mdi-file-excel-box' },
  { test: /\.(ppt|pptx|odp|key)$/, icon: 'mdi-file-powerpoint-box' },
  { test: /\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/, icon: 'mdi-folder-zip' },
  { test: /\.(txt|md|log)$/, icon: 'mdi-file-document-outline' },
  { test: /\.(json|xml|yml|yaml|js|jsx|ts|tsx|html|css|scss|py|go|rs|java|c|cpp|h|sh|sql)$/, icon: 'mdi-file-code-box' },
  { test: /\.(apk|exe|msi|deb|rpm|dmg)$/, icon: 'mdi-package-variant-closed' },
  { test: /\.(ttf|otf|woff|woff2)$/, icon: 'mdi-format-font' },
  { test: /\.(wav|mp3|flac|aac|m4a|ogg|opus)$/, icon: 'mdi-music-box-outline' },
  { test: /\.(mp4|mkv|avi|mov|webm|m4v)$/, icon: 'mdi-file-video-outline' },
  { test: /\.(png|jpe?g|gif|webp|avif|svg|heic)$/, icon: 'mdi-file-image-outline' },
]

/** Material icon for an attachment whose media kind is "file". */
export function attachmentFileIcon(filename: string): string {
  const name = (filename || '').trim().toLowerCase()
  for (const rule of FILE_ICON_RULES) {
    if (rule.test.test(name)) return rule.icon
  }
  return 'mdi-file-outline'
}

/** Short uppercase extension label ("PDF", "DOCX", "ZIP"). */
export function attachmentExtLabel(filename: string): string {
  const name = (filename || '').trim()
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return ''
  const ext = name.slice(dot + 1)
  return ext.length <= 5 ? ext.toUpperCase() : ''
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const rounded = index === 0 ? Math.round(value) : value >= 100 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[index]}`
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
