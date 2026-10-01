import { getCurrentUser, getProfile, pinAttachment, updateProfile, updateSavedTracks } from 'combox-api'
import type { AuthUser, SavedTrack } from 'combox-api'
import { ref } from 'vue'
import { extractAttachmentIdFromUrl } from '../utils/playlistAttachment'

export type PlaylistTrack = SavedTrack & { attachmentId?: string }

const tracks = ref<PlaylistTrack[]>([])
const title = ref('')
const isPublic = ref(true)
let loaded = false

function readAttachmentId(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value) return ''
  return value
}

function sanitize(list: unknown): PlaylistTrack[] {
  if (!Array.isArray(list)) return []
  const out: PlaylistTrack[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    if (typeof candidate.id !== 'string' || typeof candidate.title !== 'string') continue
    const fileUrl = typeof candidate.fileUrl === 'string' ? candidate.fileUrl : ''
    let attachmentId = readAttachmentId(candidate.attachmentId)
    if (!attachmentId) attachmentId = extractAttachmentIdFromUrl(fileUrl)
    out.push({
      id: candidate.id,
      title: candidate.title,
      artist: typeof candidate.artist === 'string' ? candidate.artist : '',
      duration: typeof candidate.duration === 'number' ? candidate.duration : 0,
      fileSize: typeof candidate.fileSize === 'string' ? candidate.fileSize : '',
      fileUrl,
      addedAt: typeof candidate.addedAt === 'string' ? candidate.addedAt : '',
      ...(attachmentId ? { attachmentId } : {}),
    })
  }
  return out
}

function fromProfile(): PlaylistTrack[] {
  return sanitize(getCurrentUser()?.saved_tracks)
}

function applyMeta(profile: AuthUser | null | undefined): void {
  if (!profile) return
  title.value = typeof profile.playlist_title === 'string' ? profile.playlist_title : ''
  isPublic.value = profile.playlist_is_public !== false
}

function ensureLoaded(): void {
  if (loaded) return
  const profile = getCurrentUser()
  if (!profile) return
  loaded = true
  tracks.value = fromProfile()
  applyMeta(getCurrentUser())
}

function loadProfile(profile: AuthUser | null | undefined): void {
  if (!profile) return
  loaded = true
  tracks.value = sanitize(profile.saved_tracks)
  applyMeta(profile)
}

async function loadFromServer(): Promise<AuthUser | null> {
  try {
    const profile = await getProfile()
    loadProfile(profile)
    return profile
  } catch {
    ensureLoaded()
    return null
  }
}

function refresh(profile?: AuthUser | null): void {
  if (profile) {
    loadProfile(profile)
    return
  }
  loaded = false
  ensureLoaded()
}

function makeID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** Wire shape for PATCH /profile: only the fields the backend validates.
// The local PlaylistTrack may carry extra runtime-only fields, which the
// backend's strict decoder (DisallowUnknownFields) would reject with 400 —
// that is what broke track removal ("could not update the playlist"). */
function toWireTrack(track: PlaylistTrack): SavedTrack {
  const duration = Number(track.duration)
  const fileUrl = (track.fileUrl || '').trim()
  const wire: SavedTrack = {
    id: (track.id || '').trim(),
    title: (track.title || '').trim(),
    artist: (track.artist || '').trim(),
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    fileSize: (track.fileSize || '').trim(),
    fileUrl,
    addedAt: (track.addedAt || '').trim(),
  }
  const attachmentId = (track.attachmentId || '').trim() || extractAttachmentIdFromUrl(fileUrl)
  if (attachmentId) wire.attachmentId = attachmentId
  return wire
}

async function persist(next: PlaylistTrack[]): Promise<void> {
  const prev = tracks.value
  tracks.value = next
  try {
    // Removal never resolves attachments: a dead entry (404 on
    // media/attachments/{id}) is simply filtered out of the list and the
    // remaining tracks are saved as-is.
    const profile = await updateSavedTracks(next.map(toWireTrack))
    const serverTracks = sanitize(profile.saved_tracks)
    if (serverTracks.length) {
      // The profile store keeps fileUrl but may drop the stable attachment
      // reference; keep the locally known (pinned) ids so playback can still
      // re-resolve fresh URLs. After a reload the id is re-derived from the
      // pinned fileUrl (u/<uid>/<attachmentId>/…).
      const localById = new Map(next.map((track) => [track.id, track.attachmentId || '']))
      tracks.value = serverTracks.map((track) => {
        if (track.attachmentId) return track
        const known = localById.get(track.id) || extractAttachmentIdFromUrl(track.fileUrl)
        return known ? { ...track, attachmentId: known } : track
      })
    }
  } catch (error) {
    tracks.value = prev
    throw error
  }
}

export type NewTrackInput = {
  title: string
  artist?: string
  duration?: number
  fileSize?: string
  fileUrl?: string
  attachmentId?: string
}

function normalizeTrack(input: NewTrackInput): PlaylistTrack {
  const title = (input.title || '').trim()
  const url = (input.fileUrl || '').trim()
  const attachmentId = (input.attachmentId || '').trim() || extractAttachmentIdFromUrl(url)
  return {
    id: makeID(),
    title,
    artist: (input.artist || '').trim(),
    duration: Number(input.duration) || 0,
    fileSize: (input.fileSize || '').trim(),
    fileUrl: url,
    addedAt: new Date().toISOString(),
    ...(attachmentId ? { attachmentId } : {}),
  }
}

function trackAttachmentId(track: PlaylistTrack | NewTrackInput): string {
  const explicit = typeof (track as { attachmentId?: unknown }).attachmentId === 'string' ? ((track as { attachmentId: string }).attachmentId || '').trim() : ''
  if (explicit) return explicit
  return extractAttachmentIdFromUrl((track as { fileUrl?: unknown }).fileUrl)
}

function isDuplicate(next: PlaylistTrack): boolean {
  const nextAttachment = trackAttachmentId(next)
  return tracks.value.some((track) => {
    if (nextAttachment && trackAttachmentId(track) === nextAttachment) return true
    // A re-pinned source gets a fresh copy id and a fresh presigned URL, so
    // the id/URL checks above miss it: match on stable metadata instead.
    // Guarded by duration/size so two different same-titled files still save.
    if (
      next.title &&
      track.title === next.title &&
      (track.artist || '') === (next.artist || '') &&
      next.duration > 0 &&
      track.duration === next.duration &&
      Boolean(next.fileSize) &&
      track.fileSize === next.fileSize
    ) {
      return true
    }
    if (track.title !== next.title) return false
    if (next.fileUrl && track.fileUrl && track.fileUrl !== next.fileUrl) return false
    return true
  })
}

function formatPinnedFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes)} B`
}

/** Server-side pin: exchange the source attachment id for an owned copy.
 *  Returns null when pinning is impossible (no id, or the backend refused);
 *  callers fall back to saving the source reference as before.
 */
async function pinSourceCopy(sourceId: string): Promise<{ attachmentId: string; fileUrl: string; duration: number; fileSize: string } | null> {
  const id = (sourceId || '').trim()
  if (!id) return null
  try {
    const pinned = await pinAttachment(id)
    const attachmentId = (pinned.attachment?.id || '').trim()
    const fileUrl = (pinned.url || '').trim()
    if (!attachmentId || !fileUrl) return null
    const durationMs = Number(pinned.attachment?.duration_ms) || 0
    const sizeBytes = Number(pinned.attachment?.size_bytes) || 0
    return {
      attachmentId,
      fileUrl,
      duration: durationMs > 0 ? Math.round(durationMs / 1000) : 0,
      fileSize: sizeBytes > 0 ? formatPinnedFileSize(sizeBytes) : '',
    }
  } catch {
    return null
  }
}

async function addTrack(input: NewTrackInput): Promise<PlaylistTrack | null> {
  ensureLoaded()
  const title = (input.title || '').trim()
  if (!title) return null
  const url = (input.fileUrl || '').trim()
  const attachmentId = (input.attachmentId || '').trim() || extractAttachmentIdFromUrl(url)
  // Never persist dead entries: without a stored URL and without a stable
  // attachment reference the track could never be resolved to a fresh source.
  if ((!url || url.startsWith('local://')) && !attachmentId) return null
  const next = normalizeTrack({ ...input, title })
  if (isDuplicate(next)) return null
  // The owned copy survives deletion of the source message/chat: resolve
  // through ownership instead of chat membership from now on.
  let toSave = next
  if (attachmentId) {
    const pinned = await pinSourceCopy(attachmentId)
    if (pinned) {
      toSave = {
        ...next,
        attachmentId: pinned.attachmentId,
        fileUrl: pinned.fileUrl,
        duration: next.duration > 0 ? next.duration : pinned.duration,
        fileSize: next.fileSize || pinned.fileSize,
      }
      if (isDuplicate(toSave)) return null
    }
  }
  await persist([...tracks.value, toSave])
  return toSave
}

async function removeTrack(id: string): Promise<void> {
  ensureLoaded()
  await persist(tracks.value.filter((track) => track.id !== id))
}

async function reorderTracks(from: number, to: number): Promise<void> {
  ensureLoaded()
  if (from < 0 || from >= tracks.value.length) return
  const target = to < 0 ? 0 : to >= tracks.value.length ? tracks.value.length - 1 : to
  if (from === target) return
  const next = [...tracks.value]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  await persist(next)
}

async function replaceTracks(next: PlaylistTrack[]): Promise<void> {
  ensureLoaded()
  await persist(sanitize(next).slice(0, 500))
}

async function setMeta(meta: { title?: string; isPublic?: boolean }): Promise<void> {
  ensureLoaded()
  const prevTitle = title.value
  const prevPublic = isPublic.value
  const payload: { playlist_title?: string; playlist_is_public?: boolean } = {}
  if (meta.title !== undefined) {
    title.value = meta.title
    payload.playlist_title = meta.title
  }
  if (meta.isPublic !== undefined) {
    isPublic.value = meta.isPublic
    payload.playlist_is_public = meta.isPublic
  }
  try {
    const profile = await updateProfile(payload)
    applyMeta(profile)
  } catch (error) {
    title.value = prevTitle
    isPublic.value = prevPublic
    throw error
  }
}

function isSaved(input: NewTrackInput): boolean {
  ensureLoaded()
  const title = (input.title || '').trim()
  if (!title) return false
  const attachmentId = (input.attachmentId || '').trim() || extractAttachmentIdFromUrl(input.fileUrl)
  if (attachmentId) {
    if (tracks.value.some((track) => trackAttachmentId(track) === attachmentId)) return true
  }
  return tracks.value.some((track) => track.title === title)
}

export function usePlaylist() {
  ensureLoaded()
  return {
    tracks,
    title,
    isPublic,
    setMeta,
    addTrack,
    removeTrack,
    reorderTracks,
    replaceTracks,
    isSaved,
    refresh,
    loadFromServer,
  }
}
