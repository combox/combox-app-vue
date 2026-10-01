<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { resolveAudioMeta } from '../../utils/audioMetadata'
import { activate, enqueueTrack, seek as playerSeek, toggle, useChatPlayback } from '../../composables/useChatPlayback'
import { usePlaylist } from '../../composables/usePlaylist'
import { useToast } from '../../composables/useToast'
import { extractAttachmentIdFromUrl } from '../../utils/playlistAttachment'

const props = defineProps<{
  src: string
  attachmentId?: string
  poster?: string
  pending?: boolean
  title?: string
  artist?: string
  durationMs?: number
  waveform?: number[]
  round?: boolean
  /** Voice note: hide the file name/extension, show a generic label instead. Regular audio files keep their name. */
  voice?: boolean
}>()

const { t } = useI18n()
const toast = useToast()
const { state } = useChatPlayback()
const playlist = usePlaylist()

const resolvedTitle = ref('')
const resolvedArtist = ref('')
const smoothTime = ref(0)

let rafHandle = 0
let lastTickTs = 0

// The chat queue keys tracks by attachment id, this component by file URL:
// resolve our own queue entry by URL so both agree on what is "active".
const trackId = computed(() => {
  const queued = state.queue.find((item) => item.url && item.url === props.src)
  if (queued) return queued.id
  return props.src || `local:${props.title || props.artist || ''}`
})
const isActive = computed(() => Boolean(props.src) && state.currentId === trackId.value)
const isPlaying = computed(() => isActive.value && state.playing)
const time = computed(() => (isActive.value ? state.time : 0))
const duration = computed(() => {
  if (isActive.value && state.duration > 0) return state.duration
  if (props.durationMs && props.durationMs > 0) return props.durationMs / 1000
  return 0
})
const displayTime = computed(() => (isActive.value ? smoothTime.value : 0))
const progress = computed(() => (duration.value > 0 ? (displayTime.value / duration.value) * 100 : 0))
const peaks = computed(() => {
  const values = Array.isArray(props.waveform) ? props.waveform.filter((value) => Number.isFinite(value)) : []
  return values.length > 1 ? values.slice(0, 1024) : []
})
const playedRatio = computed(() => Math.min(1, Math.max(0, progress.value / 100)))
// The locally known queue entry wins: a filename attached to the message or
// ID3 tags read from the file only fill in what we do not already know.
const queuedTrack = computed(() => state.queue.find((item) => item.id === trackId.value))
// Voice/round notes never expose the backing file name (no "voice-123.ogg"
// like in a file manager): Telegram-style generic label + duration only.
// Plain audio files are untouched and keep their file/ID3 name.
const isVoiceNote = computed(() => Boolean(props.voice || props.round))
const voiceLabel = computed(() => t('chat.audio_message', undefined, 'Voice message'))
const statusTitle = computed(() => {
  if (isVoiceNote.value) return voiceLabel.value
  return (
    queuedTrack.value?.title ||
    props.title ||
    resolvedTitle.value ||
    t('chat.audio_message', undefined, 'Audio message')
  )
})
const artistLabel = computed(() => {
  if (isVoiceNote.value) return ''
  return queuedTrack.value?.artist || props.artist || resolvedArtist.value || ''
})
const ringStyle = computed(() => ({ ['--ring' as string]: `${Math.round(playedRatio.value * 3600) / 10}deg` }))

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const min = Math.floor(total / 60)
  const rest = total % 60
  return `${min}:${String(rest).padStart(2, '0')}`
}

function stopProgressLoop() {
  if (rafHandle) {
    cancelAnimationFrame(rafHandle)
    rafHandle = 0
  }
  lastTickTs = 0
}

function progressTick(ts: number) {
  rafHandle = requestAnimationFrame(progressTick)
  const target = time.value
  if (!lastTickTs) {
    lastTickTs = ts
    smoothTime.value = target
    return
  }
  const dt = Math.min(0.5, (ts - lastTickTs) / 1000)
  lastTickTs = ts
  if (!isPlaying.value) {
    smoothTime.value = target
    return
  }
  const rate = Number.isFinite(state.rate) && state.rate > 0 ? state.rate : 1
  let next = smoothTime.value + dt * rate
  const drift = target - next
  if (Math.abs(drift) > 1) {
    next = target
  } else {
    next += drift * Math.min(1, dt * 3)
  }
  const total = duration.value
  if (total > 0) next = Math.min(next, total)
  smoothTime.value = Math.max(0, next)
}

function startProgressLoop() {
  if (rafHandle) return
  lastTickTs = 0
  rafHandle = requestAnimationFrame(progressTick)
}

watch(
  () => [isActive.value, isPlaying.value],
  ([active, playing]) => {
    if (active && playing) {
      startProgressLoop()
      return
    }
    stopProgressLoop()
    smoothTime.value = time.value
  },
  { immediate: true },
)

watch(time, () => {
  if (!isPlaying.value) smoothTime.value = time.value
})

onBeforeUnmount(stopProgressLoop)

async function togglePlayback() {
  if (props.pending || !props.src) return
  if (isActive.value) {
    toggle()
    return
  }
  const started = await activate(currentTrackInput())
  if (!started) toast.error(t('player.play_failed', undefined, 'Could not play this track'))
}

function currentTrackInput() {
  return {
    id: trackId.value,
    url: props.src,
    title: statusTitle.value,
    artist: artistLabel.value,
    durationMs: props.durationMs || 0,
    poster: props.poster || '',
  }
}

function seek(event: MouseEvent) {
  const line = event.currentTarget as HTMLDivElement | null
  if (!line || !isActive.value || !duration.value || props.pending || !props.src) return
  const rect = line.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  playerSeek(ratio * duration.value)
}

async function loadMeta() {
  // Voice notes show the generic label: never resolve file/ID3 names for them.
  if (isVoiceNote.value) {
    resolvedTitle.value = ''
    resolvedArtist.value = ''
    return
  }
  const fallback = props.title || props.artist || ''
  const meta = await resolveAudioMeta(props.src, fallback)
  if (!meta) return
  if (props.title) {
    if (!resolvedArtist.value && !props.artist) resolvedArtist.value = meta.artist
    return
  }
  resolvedTitle.value = meta.title || resolvedTitle.value
  if (!resolvedArtist.value) resolvedArtist.value = meta.artist
}

const menu = ref({ open: false, x: 0, y: 0 })
const MENU_WIDTH = 208
const MENU_HEIGHT = 176
const MENU_MARGIN = 8

const menuStyle = computed(() => ({ left: `${menu.value.x}px`, top: `${menu.value.y}px` }))

function openMenu(event: MouseEvent) {
  // Never show the browser menu on audio; while the file is still uploading
  // fall back to the regular message menu instead.
  event.preventDefault()
  if (props.pending || !props.src) return
  event.stopPropagation()
  const x = Math.max(MENU_MARGIN, Math.min(event.clientX, window.innerWidth - MENU_WIDTH - MENU_MARGIN))
  const y = Math.max(MENU_MARGIN, Math.min(event.clientY, window.innerHeight - MENU_HEIGHT - MENU_MARGIN))
  menu.value = { open: true, x, y }
}

function closeMenu() {
  if (!menu.value.open) return
  menu.value.open = false
}

async function menuTogglePlayback() {
  closeMenu()
  await togglePlayback()
}

function menuEnqueue() {
  const queued = enqueueTrack(currentTrackInput())
  closeMenu()
  if (queued) toast.info(t('player.queued', undefined, 'Track added to the queue'))
  else toast.error(t('player.play_failed', undefined, 'Could not add this track to the queue'))
}

async function menuSaveToPlaylist() {
  const attachmentId = (props.attachmentId || '').trim() || extractAttachmentIdFromUrl(props.src)
  const input = { title: statusTitle.value.trim(), artist: artistLabel.value.trim(), duration: Math.round(duration.value) || 0, fileUrl: props.src, ...(attachmentId ? { attachmentId } : {}) }
  closeMenu()
  if (!input.title) {
    toast.error(t('player.save_failed', undefined, 'Could not save the track'))
    return
  }
  if (!attachmentId && !(props.src || '').trim()) {
    toast.error(t('player.save_failed', undefined, 'Could not save the track'))
    return
  }
  try {
    const saved = await playlist.addTrack(input)
    if (saved) {
      toast.success(t('player.saved_to_playlist', { count: 1 }, 'Track saved to your playlist'))
      return
    }
    if (playlist.isSaved(input)) toast.info(t('player.already_saved', undefined, 'Track is already in your playlist'))
    else toast.error(t('player.save_failed', undefined, 'Could not save the track'))
  } catch {
    toast.error(t('player.save_failed', undefined, 'Could not save the track'))
  }
}

function menuCopyLink() {
  const url = props.src
  closeMenu()
  if (!navigator.clipboard?.writeText) return
  void navigator.clipboard
    .writeText(url)
    .then(() => toast.success(t('player.link_copied', undefined, 'Link copied')))
    .catch(() => toast.error(t('player.copy_failed', undefined, 'Could not copy the link')))
}

function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

watch(
  () => menu.value.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onMenuKeydown)
      window.addEventListener('scroll', closeMenu, true)
      window.addEventListener('resize', closeMenu)
    } else {
      window.removeEventListener('keydown', onMenuKeydown)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('resize', closeMenu)
    }
  },
)

function releaseMenu() {
  window.removeEventListener('keydown', onMenuKeydown)
  window.removeEventListener('scroll', closeMenu, true)
  window.removeEventListener('resize', closeMenu)
}

onBeforeUnmount(releaseMenu)

watch([() => props.src, () => props.pending], () => {
  smoothTime.value = 0
  resolvedTitle.value = ''
  resolvedArtist.value = ''
  closeMenu()
  void loadMeta()
}, { flush: 'post' })

watch(
  () => [props.title, props.artist],
  () => {
    void loadMeta()
  },
)

onMounted(() => {
  void loadMeta()
})
</script>

<template>
  <div v-if="props.round" class="roundPlayer" :class="{ error: isActive && state.error }" @contextmenu="openMenu">
    <button
      type="button"
      class="roundArt"
      :disabled="props.pending || !props.src"
      :style="ringStyle"
      :aria-label="isPlaying ? t('player.pause', undefined, 'Pause') : t('player.play', undefined, 'Play')"
      @click="togglePlayback"
    >
      <img v-if="poster" class="roundArtImg" :src="poster" alt="round preview" />
      <span v-else class="roundArtDisc" aria-hidden="true" />
      <span class="roundArtToggle" aria-hidden="true">
        <v-icon :icon="isPlaying ? 'mdi-pause' : 'mdi-play'" size="30" />
      </span>
    </button>
    <div class="roundMeta">
      <div v-if="isActive && state.error" class="roundTime roundErrorText">
        {{ t('player.play_failed_short', undefined, "Can't play the audio") }}
      </div>
      <div v-else class="roundTime">
        {{ props.pending || !props.src ? '--:--' : `${formatTime(displayTime)} / ${formatTime(duration)}` }}
      </div>
    </div>
  </div>

  <div v-else class="audioPlayer" :class="{ error: isActive && state.error }" @contextmenu="openMenu">
    <button
      type="button"
      class="audioArt"
      :disabled="props.pending || !props.src"
      :aria-label="isPlaying ? t('player.pause', undefined, 'Pause') : t('player.play', undefined, 'Play')"
      @click="togglePlayback"
    >
      <img v-if="poster" class="audioArtImg" :src="poster" alt="audio preview" />
      <div v-else class="audioArtImg audioArtPlaceholder">
        <v-icon icon="mdi-music-note" size="22" />
      </div>
      <span class="audioArtDim" aria-hidden="true" />
      <span class="audioArtToggle" aria-hidden="true">
        <v-icon :icon="isPlaying ? 'mdi-pause' : 'mdi-play'" size="22" />
      </span>
    </button>
    <div class="audioBody">
      <div class="audioMeta">
        <div class="audioTitle" :title="statusTitle">{{ statusTitle }}</div>
        <div v-if="artistLabel" class="audioArtist">{{ artistLabel }}</div>
        <div v-else-if="isActive && state.error" class="audioArtist audioErrorText">
          {{ t('player.play_failed_short', undefined, "Can't play the audio") }}
        </div>
      </div>
      <div
        class="audioLine"
        :class="{ pending: props.pending || !props.src || !isActive, wave: peaks.length > 0 }"
        @click="seek"
      >
        <div v-if="peaks.length > 0" class="audioWave" aria-hidden="true">
          <span
            v-for="(peak, index) in peaks"
            :key="index"
            class="audioWaveBar"
            :class="{ played: playedRatio > index / peaks.length }"
            :style="{ height: `${Math.max(4, Math.min(100, peak))}%` }"
          />
        </div>
        <div v-else class="audioLineValue" :style="{ width: `${progress}%` }" />
      </div>
    </div>
    <div class="audioSide">
      <div class="audioTime">
        {{ props.pending || !props.src ? '--:--' : `${formatTime(displayTime)} / ${formatTime(duration)}` }}
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="menu.open" class="audioCtxOverlay" @click="closeMenu" @contextmenu.prevent="closeMenu" />
    <div v-if="menu.open" class="audioCtxMenu" :style="menuStyle" @click.stop>
      <button type="button" class="audioCtxItem" @click="menuTogglePlayback">
        <v-icon :icon="isPlaying ? 'mdi-pause' : 'mdi-play'" size="16" />
        <span>{{ isPlaying ? t('player.pause', undefined, 'Pause') : t('player.play', undefined, 'Play') }}</span>
      </button>
      <button type="button" class="audioCtxItem" @click="menuEnqueue">
        <v-icon icon="mdi-playlist-plus" size="16" />
        <span>{{ t('player.play_next', undefined, 'Play next') }}</span>
      </button>
      <button type="button" class="audioCtxItem" @click="menuSaveToPlaylist">
        <v-icon icon="mdi-heart-plus" size="16" />
        <span>{{ t('chat.save_to_playlist', undefined, 'Save to playlist') }}</span>
      </button>
      <button type="button" class="audioCtxItem" @click="menuCopyLink">
        <v-icon icon="mdi-link-variant" size="16" />
        <span>{{ t('player.copy_link', undefined, 'Copy link') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.audioPlayer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  width: min(300px, 100%);
  min-height: 46px;
}

.audioArt {
  position: relative;
  width: 44px;
  height: 44px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  overflow: hidden;
  cursor: pointer;
  background: var(--surface-soft);
  color: #fff;
  display: block;
  outline: 0;
}

.audioArt:disabled {
  cursor: default;
}

.audioArtImg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.audioArtPlaceholder {
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #fff;
}

.audioArtDim {
  position: absolute;
  inset: 0;
  background: rgba(9, 13, 22, 0.35);
  transition: background 140ms ease;
}

.audioArt:hover .audioArtDim {
  background: rgba(9, 13, 22, 0.22);
}

.audioArtToggle {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  opacity: 0.95;
  transition: transform 120ms ease, opacity 120ms ease;
}

.audioArt:hover .audioArtToggle {
  transform: scale(1.08);
}

.audioArt:active .audioArtToggle {
  transform: scale(0.94);
  opacity: 0.85;
}

.audioArt:disabled .audioArtToggle,
.audioArt:disabled .audioArtDim {
  opacity: 0.5;
}

.audioBody {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.audioMeta {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.audioTitle {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audioArtist {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audioErrorText {
  color: #ef4444;
}

.audioLine {
  position: relative;
  height: 6px;
  background: var(--border-strong);
  cursor: pointer;
  border-radius: 999px;
}

.audioLine.pending {
  cursor: default;
}

.audioLineValue {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  border-radius: 999px;
}

.audioTime {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.audioSide {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.audioLine.wave {
  height: 28px;
  background: transparent;
  border-radius: 8px;
}

.audioWave {
  position: absolute;
  inset: 0 8px 0 0;
  display: flex;
  align-items: center;
  gap: 1.5px;
  overflow: hidden;
}

.audioWaveBar {
  flex: 1 1 0;
  min-width: 1px;
  border-radius: 2px;
  background: var(--border-strong);
  transition: background 90ms linear;
}

.audioWaveBar.played {
  background: var(--accent);
}

.audioPlayer.error .audioLineValue {
  background: #ef4444;
}

.roundPlayer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 6px 4px 4px;
  min-width: 0;
  --round-size: 240px;
}

.roundArt {
  position: relative;
  width: var(--round-size);
  height: var(--round-size);
  max-width: 100%;
  aspect-ratio: 1;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  display: block;
  outline: 0;
  background: conic-gradient(var(--accent) var(--ring, 0deg), var(--border-strong) 0deg);
}

.roundArt:disabled {
  cursor: default;
  opacity: 0.6;
}

.roundArtImg {
  position: absolute;
  left: 7px;
  top: 7px;
  width: calc(100% - 14px);
  height: calc(100% - 14px);
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.roundArtDisc {
  position: absolute;
  inset: 7px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
}

.roundArtToggle {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  opacity: 0.96;
  transition: transform 120ms ease, opacity 120ms ease;
}

.roundArt:hover:not(:disabled) .roundArtToggle {
  transform: scale(1.06);
}

.roundArt:active:not(:disabled) .roundArtToggle {
  transform: scale(0.94);
  opacity: 0.85;
}

.roundMeta {
  display: grid;
  gap: 1px;
  justify-items: center;
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 560px) {
  .roundPlayer { --round-size: min(240px, 64vw); }
}

.roundTime {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.roundErrorText {
  color: #ef4444;
}

.roundPlayer.error .roundArt {
  background: conic-gradient(#ef4444 var(--ring, 0deg), var(--border-strong) 0deg);
}

.audioCtxOverlay {
  position: fixed;
  inset: 0;
  z-index: 1090;
}

.audioCtxMenu {
  position: fixed;
  z-index: 1091;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 208px;
  padding: 6px;
  background: var(--surface-strong);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(16px);
}

.audioCtxItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.audioCtxItem:hover {
  background: var(--surface-soft-hover, var(--surface-soft));
}
</style>
