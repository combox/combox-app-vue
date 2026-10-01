<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SavedTrack } from 'combox-api'
import { usePlaylist } from '../../composables/usePlaylist'
import { useChatPlayback, type ChatAudioTrack } from '../../composables/useChatPlayback'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../i18n/i18n'
import {
  getPlaylistAttachmentId,
  isLocalPlaylistUrl,
  isPermanentAttachmentError,
  resolvePlaylistTrackUrl,
} from '../../utils/playlistAttachment'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{ close: [] }>()

const { tracks, removeTrack, reorderTracks, refresh, loadFromServer } = usePlaylist()
const { state: playback, activate, enqueueTrack, toggle: togglePlayback, syncQueue, closePlayer, patchQueueTrackUrl } = useChatPlayback()
const toast = useToast()
const { t } = useI18n()

const query = ref('')
const draggingFrom = ref<number | null>(null)
const isPersisting = ref(false)
const unavailableIds = ref<Record<string, true>>({})
const resolvingId = ref('')

const filteredTracks = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return tracks.value
  return tracks.value.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(q))
})

const queueTracks = computed<ChatAudioTrack[]>(() =>
  tracks.value
    .filter((track) => {
      const url = (track.fileUrl || '').trim()
      return Boolean(url) && !url.startsWith('local://')
    })
    .map((track) => ({
      id: track.id,
      url: (track.fileUrl || '').trim(),
      title: track.title,
      artist: (track.artist || '').trim(),
      durationMs: (track.duration || 0) * 1000,
      poster: '',
    })),
)

function isCurrent(track: SavedTrack): boolean {
  return playback.currentId === track.id
}

function isPlaying(track: SavedTrack): boolean {
  return playback.currentId === track.id && playback.playing
}

function isUnavailable(track: SavedTrack): boolean {
  return Boolean(unavailableIds.value[track.id])
}

function markUnavailable(id: string): void {
  if (!id) return
  unavailableIds.value = { ...unavailableIds.value, [id]: true }
}

function clearUnavailable(id: string): void {
  if (!id || !unavailableIds.value[id]) return
  const next = { ...unavailableIds.value }
  delete next[id]
  unavailableIds.value = next
}

/** Stored presigned URLs expire: re-resolve through the stable attachment id
 *  so a track keeps playing long after it was saved, even when the source
 *  message is gone. Throws when there is no playable source left.
 */
async function resolveTrackUrl(track: SavedTrack): Promise<string> {
  const resolved = await resolvePlaylistTrackUrl(track)
  if (resolved.fresh) patchQueueTrackUrl(track.id, resolved.url)
  return resolved.url
}

/** Best-effort refresh of the queued playlist URLs so auto-advance (ended →
 *  next) does not step onto an expired presigned URL minutes later.
 */
function refreshQueueUrls(): void {
  for (const track of tracks.value) {
    const id = getPlaylistAttachmentId(track)
    if (!id) continue
    const queued = playback.queue.find((item) => item.id === track.id)
    if (!queued) continue
    void resolvePlaylistTrackUrl(track)
      .then((resolved) => {
        if (resolved.fresh) patchQueueTrackUrl(track.id, resolved.url)
      })
      .catch(() => {
        // Individual refresh failures surface on explicit play, not here.
      })
  }
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const m = Math.floor(safe / 60)
  const s = String(safe % 60).padStart(2, '0')
  return `${m}:${s}`
}

const totalDuration = computed(() => {
  let total = 0
  for (const track of tracks.value) total += track.duration || 0
  return formatDuration(total)
})

const totalSize = computed(() => {
  let bytes = 0
  for (const track of tracks.value) {
    const raw = (track.fileSize || '').trim()
    const num = Number(raw.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(num)) bytes += num * (raw.toLowerCase().includes('mb') ? 1024 * 1024 : raw.toLowerCase().includes('kb') ? 1024 : 1)
  }
  if (bytes <= 0) return ''
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
})

async function toggleTrack(track: SavedTrack) {
  if (playback.currentId === track.id) {
    togglePlayback()
    return
  }
  if (isUnavailable(track)) {
    toast.error(t('player.track_unavailable', undefined, 'This track is no longer available and cannot be played'))
    return
  }
  const storedUrl = (track.fileUrl || '').trim()
  if (isLocalPlaylistUrl(storedUrl) && !getPlaylistAttachmentId(track)) {
    toast.error(t('player.no_url', undefined, 'No playable source for this track'))
    return
  }
  resolvingId.value = track.id
  try {
    const url = await resolveTrackUrl(track)
    clearUnavailable(track.id)
    syncQueue(queueTracks.value)
    patchQueueTrackUrl(track.id, url)
    try {
      const started = await activate({
        id: track.id,
        url,
        title: track.title,
        artist: (track.artist || '').trim(),
        durationMs: (track.duration || 0) * 1000,
        poster: '',
      })
      if (!started) toast.error(t('player.play_failed', undefined, 'Could not play this track'))
      else refreshQueueUrls()
    } catch {
      toast.error(t('player.play_failed', undefined, 'Could not play this track'))
    }
  } catch (error) {
    if (isPermanentAttachmentError(error) || (error instanceof Error && (error.message === 'no_source' || error.message === 'attachment_not_found'))) {
      markUnavailable(track.id)
      toast.error(t('player.track_unavailable', undefined, 'This track is no longer available and cannot be played'))
    } else {
      toast.error(t('player.play_failed', undefined, 'Could not play this track'))
    }
  } finally {
    if (resolvingId.value === track.id) resolvingId.value = ''
  }
}

async function queueNext(track: SavedTrack) {
  if (isUnavailable(track)) {
    toast.error(t('player.track_unavailable', undefined, 'This track is no longer available and cannot be played'))
    return
  }
  const storedUrl = (track.fileUrl || '').trim()
  if (isLocalPlaylistUrl(storedUrl) && !getPlaylistAttachmentId(track)) {
    toast.error(t('player.no_url', undefined, 'No playable source for this track'))
    return
  }
  try {
    const url = await resolveTrackUrl(track)
    clearUnavailable(track.id)
    const queued = enqueueTrack({
      id: track.id,
      url,
      title: track.title,
      artist: (track.artist || '').trim(),
      durationMs: (track.duration || 0) * 1000,
      poster: '',
    })
    if (queued) toast.info(t('player.queued', undefined, 'Track added to the queue'))
    else toast.error(t('player.play_failed', undefined, 'Could not play this track'))
  } catch (error) {
    if (isPermanentAttachmentError(error) || (error instanceof Error && (error.message === 'no_source' || error.message === 'attachment_not_found'))) {
      markUnavailable(track.id)
      toast.error(t('player.track_unavailable', undefined, 'This track is no longer available and cannot be played'))
    } else {
      toast.error(t('player.play_failed', undefined, 'Could not play this track'))
    }
  }
}

function handleDragStart(index: number, event: DragEvent) {
  draggingFrom.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    try {
      event.dataTransfer.setData('text/plain', String(index))
    } catch {
      // ignore
    }
  }
}

function handleDragOver(index: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

async function handleDrop(index: number, event: DragEvent) {
  event.preventDefault()
  const from = draggingFrom.value
  draggingFrom.value = null
  if (from === null || from === index) return
  isPersisting.value = true
  try {
    await reorderTracks(from, index)
  } catch {
    toast.error(t('player.save_failed', undefined, 'Could not update the playlist'))
  } finally {
    isPersisting.value = false
  }
}

async function handleRemove(id: string) {
  isPersisting.value = true
  try {
    await removeTrack(id)
    clearUnavailable(id)
    if (playback.currentId === id) closePlayer()
  } catch {
    toast.error(t('player.save_failed', undefined, 'Could not update the playlist'))
  } finally {
    isPersisting.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    query.value = ''
    refresh()
    void loadFromServer()
  },
)

watch(
  () => playback.error,
  (failed) => {
    if (failed && props.open) toast.error(t('player.play_failed', undefined, 'Could not play this track'))
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="plOverlay" @click.self="emit('close')">
      <div class="plModal" role="dialog" aria-modal="true">
        <header class="plHeader">
          <div class="plHeaderTitleWrap">
            <div class="plHeaderIcon"><v-icon icon="mdi-music-note" size="20" /></div>
            <div>
              <div class="plTitle">{{ t('player.your_playlist', undefined, 'Your playlist') }}</div>
              <div v-if="tracks.length > 0" class="plMeta">
                {{ tracks.length }} {{ t('player.tracks', undefined, 'tracks') }} · {{ totalSize }} · {{ totalDuration }}
              </div>
            </div>
          </div>
          <button type="button" class="plClose" :aria-label="t('chat.close')" @click="emit('close')">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </header>

        <div v-if="tracks.length > 0" class="plSearch">
          <v-icon icon="mdi-magnify" size="18" class="plSearchIcon" />
          <input
            v-model="query"
            type="text"
            class="plSearchInput"
            :placeholder="t('player.search', undefined, 'Search in playlist')"
          />
        </div>

        <div v-if="isPersisting" class="plBusy"><v-progress-linear indeterminate color="primary" /></div>

        <div class="plBody">
          <div v-if="tracks.length === 0" class="plEmpty">
            <div class="plEmptyIcon"><v-icon icon="mdi-music-note-plus" size="34" /></div>
            <div class="plEmptyTitle">{{ t('player.empty_title', undefined, 'No tracks yet') }}</div>
            <div class="plEmptyText">
              {{ t('player.empty_hint', undefined, 'Right-click an audio message in any chat and choose "Save to playlist".') }}
            </div>
          </div>

          <div v-else-if="filteredTracks.length === 0" class="plEmpty">
            <div class="plEmptyText">{{ t('player.no_results', undefined, 'Nothing found') }}</div>
          </div>

          <div v-else class="plList">
            <div
              v-for="(track, index) in filteredTracks"
              :key="track.id"
              class="plRow"
              :class="{ playing: isCurrent(track), dragging: draggingFrom === index, unavailable: isUnavailable(track) }"
              draggable="true"
              @dragstart="handleDragStart(index, $event)"
              @dragover="handleDragOver(index, $event)"
              @drop="handleDrop(index, $event)"
              @dragend="draggingFrom = null"
            >
              <button
                type="button"
                class="plPlayBtn"
                :disabled="resolvingId === track.id"
                :aria-label="isPlaying(track) ? t('player.pause', undefined, 'Pause') : t('player.play', undefined, 'Play')"
                @click="toggleTrack(track)"
              >
                <span v-if="!isPlaying(track)" class="plPlayIcon mdi mdi-play" />
                <span v-else class="plBars" aria-hidden="true">
                  <span class="plBar" />
                  <span class="plBar" />
                  <span class="plBar" />
                </span>
              </button>

              <div class="plRowMain">
                <div class="plRowTitle">{{ track.title }}</div>
                <div class="plRowArtist">{{ track.artist || t('player.unknown_artist', undefined, 'Unknown artist') }}</div>
                <div v-if="isUnavailable(track)" class="plRowUnavailable">{{ t('player.unavailable', undefined, 'Unavailable — the audio file was deleted') }}</div>
              </div>

              <div class="plRowMeta">
                <span v-if="isCurrent(track) && playback.duration > 0" class="plRowDuration">{{ formatDuration(Math.min(playback.time, playback.duration)) }} / {{ formatDuration(playback.duration) }}</span>
                <span v-else-if="track.duration > 0" class="plRowDuration">{{ formatDuration(track.duration) }}</span>
              </div>

              <button
                type="button"
                class="plEnqueue"
                :aria-label="t('player.play_next', undefined, 'Play next')"
                @click.stop="queueNext(track)"
              >
                <v-icon icon="mdi-playlist-plus" size="16" />
              </button>

              <button type="button" class="plRemove" :aria-label="t('player.remove', undefined, 'Remove from playlist')" @click="handleRemove(track.id)">
                <v-icon icon="mdi-close" size="16" />
              </button>
            </div>
          </div>
        </div>

        <div class="plFooter">
          <div class="plFooterHint">
            {{ t('player.drag_hint', undefined, 'Hold a track to reorder it') }}
          </div>
          <button type="button" class="plDone" @click="emit('close')">{{ t('common.done', undefined, 'Done') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.plOverlay {
  position: fixed;
  inset: 0;
  z-index: 9900;
  background: var(--scrim);
  backdrop-filter: blur(var(--scrim-blur));
  display: grid;
  place-items: center;
  padding: 16px;
}

.plModal {
  width: min(520px, 100%);
  max-height: min(640px, calc(100dvh - 32px));
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--surface-strong) 90%, #000);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border);
  border-radius: 24px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  animation: plPop 180ms ease-out;
}

@keyframes plPop {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.plHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border);
}

.plHeaderTitleWrap {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.plHeaderIcon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent-strong);
  flex: 0 0 auto;
}

.plTitle {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.plMeta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
}

.plClose {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.plClose:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.plSearch {
  position: relative;
  margin: 12px 18px 4px;
}

.plSearchIcon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.plSearchInput {
  width: 100%;
  height: 42px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 14px;
  padding: 0 14px 0 40px;
  outline: 0;
  font-size: 14px;
}

.plSearchInput:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.plBusy {
  padding: 0 18px;
}

.plBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 12px 12px;
  scrollbar-width: thin;
}

.plList {
  display: grid;
  gap: 4px;
}

.plRow {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 10px;
  border-radius: 16px;
  cursor: grab;
  user-select: none;
  transition: background 120ms ease;
}

.plRow:hover {
  background: var(--surface-soft);
}

.plRow.dragging {
  opacity: 0.45;
}

.plRow.playing {
  background: var(--accent-soft);
}

.plRow.unavailable {
  opacity: 0.72;
}

.plRow.unavailable .plPlayBtn {
  background: var(--surface-soft);
  color: var(--text-muted);
}

.plRowUnavailable {
  margin-top: 2px;
  font-size: 11px;
  font-weight: 700;
  color: #ef4444;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plPlayBtn {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft-hover);
  color: var(--text);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}

.plRow.playing .plPlayBtn {
  background: var(--accent);
  color: #fff;
}

.plPlayIcon {
  font-size: 16px;
}

.plBars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 16px;
}

.plBar {
  width: 3px;
  border-radius: 2px;
  background: #fff;
  animation: plBar 900ms ease-in-out infinite;
}

.plBar:nth-child(1) {
  height: 60%;
}

.plBar:nth-child(2) {
  height: 100%;
  animation-delay: 150ms;
}

.plBar:nth-child(3) {
  height: 40%;
  animation-delay: 300ms;
}

@keyframes plBar {
  0%,
  100% {
    transform: scaleY(1);
  }
  50% {
    transform: scaleY(0.45);
  }
}

.plRowMain {
  flex: 1 1 auto;
  min-width: 0;
}

.plRowTitle {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plRowArtist {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plRowMeta {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.plEnqueue {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
  flex: 0 0 auto;
}

.plRow:hover .plEnqueue,
.plRow.playing .plEnqueue {
  opacity: 1;
}

.plEnqueue:hover {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.plRemove {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
  flex: 0 0 auto;
}

.plRow:hover .plRemove {
  opacity: 1;
}

.plRemove:hover {
  background: var(--danger-soft, rgba(239, 68, 68, 0.12));
  color: #ef4444;
}

.plEmpty {
  display: grid;
  justify-items: center;
  gap: 8px;
  text-align: center;
  padding: 44px 24px;
}

.plEmptyIcon {
  width: 64px;
  height: 64px;
  border-radius: 24px;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.plEmptyTitle {
  font-size: 16px;
  font-weight: 800;
}

.plEmptyText {
  max-width: 34ch;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted);
}

.plFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

.plFooterHint {
  font-size: 12px;
  color: var(--text-muted);
}

.plDone {
  min-height: 38px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.plDone:hover {
  background: var(--accent-strong);
}

@media (max-width: 560px) {
  .plFooterHint {
    display: none;
  }
}
</style>