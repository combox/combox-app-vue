import { getAttachment } from 'combox-api'
import type { SavedTrack } from 'combox-api'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const OBJECT_KEY_RE = /\/u\/[^/?#]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i

export type PlaylistTrackLike = Pick<SavedTrack, 'fileUrl'> & {
  attachmentId?: unknown
}

/** Presigned MinIO playback URLs expire (2h), but the object key embeds the
 *  stable attachment id: `u/<userID>/<attachmentID>/<filename>`. Extract it so
 *  a playlist entry can be re-resolved long after the stored URL has died —
 *  even when the source chat message was deleted (soft delete keeps the file).
 */
export function extractAttachmentIdFromUrl(url: unknown): string {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return ''
  if (raw.startsWith('attachment://')) {
    const id = raw.slice('attachment://'.length).split(/[/?#]/)[0]?.trim() || ''
    return id
  }
  const keyed = raw.match(OBJECT_KEY_RE)
  if (keyed?.[1]) return keyed[1].toLowerCase()
  try {
    const parsed = new URL(raw)
    const hit = parsed.pathname.match(UUID_RE)
    if (hit) return hit[0].toLowerCase()
  } catch {
    const hit = raw.match(UUID_RE)
    if (hit) return hit[0].toLowerCase()
  }
  return ''
}

export function getPlaylistAttachmentId(track: PlaylistTrackLike | null | undefined): string {
  if (!track || typeof track !== 'object') return ''
  const explicit = (track as { attachmentId?: unknown }).attachmentId
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  return extractAttachmentIdFromUrl((track as { fileUrl?: unknown }).fileUrl)
}

export function isLocalPlaylistUrl(url: unknown): boolean {
  const raw = typeof url === 'string' ? url.trim() : ''
  return !raw || raw.startsWith('local://')
}

/** True when the entry has something worth trying: a stable attachment id or
 *  a stored (possibly still fresh) remote URL.
 */
export function hasResolvablePlaylistSource(track: PlaylistTrackLike | null | undefined): boolean {
  if (!track) return false
  if (getPlaylistAttachmentId(track)) return true
  const url = typeof (track as { fileUrl?: unknown }).fileUrl === 'string' ? ((track as { fileUrl: string }).fileUrl || '').trim() : ''
  return Boolean(url) && !url.startsWith('local://')
}

export function isPermanentAttachmentError(error: unknown): boolean {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code).toLowerCase() : ''
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || '').toLowerCase()
  const hay = `${code} ${message}`
  return (
    hay.includes('not_found') || hay.includes('notfound') || hay.includes('forbidden') || hay.includes('gone') || hay.includes(' 404') || hay.includes(' 403')
  )
}

export type ResolvedPlaylistUrl =
  | { url: string; fresh: true }
  | { url: string; fresh: false }

/** Resolve the playable URL for a playlist entry. A stable attachment id always
 *  wins: it yields a fresh presigned URL even when the stored one has expired
 *  or the source message is gone. Legacy entries without an id fall back to the
 *  stored URL (which may still work while it is fresh).
 */
export async function resolvePlaylistTrackUrl(track: PlaylistTrackLike): Promise<ResolvedPlaylistUrl> {
  const id = getPlaylistAttachmentId(track)
  if (id) {
    const payload = await getAttachment(id)
    const fresh = (payload?.url || '').trim()
    if (!fresh) throw new Error('attachment_not_found')
    return { url: fresh, fresh: true }
  }
  const fallback = typeof (track as { fileUrl?: unknown }).fileUrl === 'string' ? ((track as { fileUrl: string }).fileUrl || '').trim() : ''
  if (!fallback || fallback.startsWith('local://')) throw new Error('no_source')
  return { url: fallback, fresh: false }
}
