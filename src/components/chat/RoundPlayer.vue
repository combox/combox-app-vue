<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'

const props = defineProps<{
  src: string
  poster?: string
  title?: string
  durationMs?: number
}>()

const { t } = useI18n()

const videoEl = ref<HTMLVideoElement | null>(null)
const playing = ref(false)
const current = ref(0)
const duration = ref(0)
const failed = ref(false)
const ready = ref(false)

const durationSec = computed(() => {
  if (duration.value > 0) return duration.value
  if (props.durationMs && props.durationMs > 0) return props.durationMs / 1000
  return 0
})

const playedRatio = computed(() => (durationSec.value > 0 ? Math.min(1, current.value / durationSec.value) : 0))
const ringStyle = computed(() => ({ ['--ring' as string]: `${Math.round(playedRatio.value * 3600) / 10}deg` }))

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const min = Math.floor(total / 60)
  const rest = total % 60
  return `${min}:${String(rest).padStart(2, '0')}`
}

const timeLabel = computed(() => {
  if (failed.value) return t('player.play_failed_short', undefined, "Can't play the audio")
  if (!playing.value && !ready.value) return `--:--`
  return `${formatTime(current.value)} / ${formatTime(durationSec.value)}`
})

async function togglePlayback() {
  const node = videoEl.value
  if (!node || !props.src) return
  if (node.paused) {
    try {
      await node.play()
    } catch {
      failed.value = true
    }
    return
  }
  node.pause()
}

function onLoadedMetadata() {
  const node = videoEl.value
  if (!node) return
  duration.value = Number.isFinite(node.duration) ? node.duration : 0
  ready.value = true
  failed.value = false
}

function onTimeUpdate() {
  current.value = videoEl.value?.currentTime || 0
}

function onPlay() {
  playing.value = true
}

function onPause() {
  playing.value = false
}

function onEnded() {
  playing.value = false
  current.value = 0
}

function onError() {
  failed.value = true
  playing.value = false
}

// ── Seek by dragging around the ring (tap still toggles playback) ────────
const dragging = ref(false)
const dragMoved = ref(false)
let pointerStart = { x: 0, y: 0 }
let suppressClick = false

function angleAt(clientX: number, clientY: number): number | null {
  const el = videoEl.value?.parentElement
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const dx = clientX - cx
  const dy = clientY - cy
  if (Math.hypot(dx, dy) > rect.width / 2) return null
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  if (deg < 0) deg += 360
  return deg
}

function seekToAngle(deg: number) {
  const total = durationSec.value
  if (!total || total <= 0) return
  const node = videoEl.value
  if (!node) return
  node.currentTime = Math.max(0, Math.min(total, (deg / 360) * total))
  current.value = node.currentTime
}

function onArtPointerDown(event: PointerEvent) {
  if (!props.src) return
  dragging.value = true
  dragMoved.value = false
  pointerStart = { x: event.clientX, y: event.clientY }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function onArtPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  if (!dragMoved.value) {
    if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 6) return
    dragMoved.value = true
  }
  const deg = angleAt(event.clientX, event.clientY)
  if (deg === null) return
  event.preventDefault()
  seekToAngle(deg)
}

function onArtPointerUp() {
  if (!dragging.value) return
  suppressClick = dragMoved.value
  dragging.value = false
  dragMoved.value = false
}

function onArtPointerCancel() {
  dragging.value = false
  dragMoved.value = false
  suppressClick = false
}

/** Keyboard activation (Enter/Space) lands here; a completed drag is ignored. */
function onArtClick() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  void togglePlayback()
}

function onArtKeydown(event: KeyboardEvent) {
  const total = durationSec.value
  if (!total) return
  const node = videoEl.value
  if (!node) return
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 5 : -5
    node.currentTime = Math.max(0, Math.min(total, node.currentTime + delta))
    current.value = node.currentTime
  }
}

watch(
  () => props.src,
  () => {
    playing.value = false
    current.value = 0
    duration.value = 0
    ready.value = false
    failed.value = false
  },
)

onBeforeUnmount(() => {
  videoEl.value?.pause()
})
</script>

<template>
  <div class="roundPlayer">
    <button
      type="button"
      class="roundArt"
      :class="{ error: failed, ready }"
      :style="ringStyle"
      :disabled="!src"
      :aria-label="playing ? t('player.pause', undefined, 'Pause') : t('player.play', undefined, 'Play')"
      @pointerdown="onArtPointerDown"
      @pointermove="onArtPointerMove"
      @pointerup="onArtPointerUp"
      @pointercancel="onArtPointerCancel"
      @click="onArtClick"
      @keydown="onArtKeydown"
    >
      <video
        ref="videoEl"
        class="roundVideo"
        :src="src"
        :poster="poster || undefined"
        playsinline
        preload="metadata"
        @loadedmetadata="onLoadedMetadata"
        @timeupdate="onTimeUpdate"
        @play="onPlay"
        @pause="onPause"
        @ended="onEnded"
        @error="onError"
      />
      <span class="roundArtToggle" aria-hidden="true">
        <v-icon :icon="playing ? 'mdi-pause' : 'mdi-play'" size="30" />
      </span>
    </button>
    <div class="roundMeta">
      <div class="roundTime" :class="{ roundErrorText: failed }">{{ timeLabel }}</div>
      <div v-if="title" class="roundCaption">{{ title }}</div>
    </div>
  </div>
</template>

<style scoped>
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
  touch-action: none;
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

.roundArt.error {
  background: conic-gradient(#ef4444 var(--ring, 0deg), var(--border-strong) 0deg);
}

.roundVideo {
  position: absolute;
  left: 7px;
  top: 7px;
  width: calc(100% - 14px);
  height: calc(100% - 14px);
  border-radius: 50%;
  object-fit: cover;
  display: block;
  background: var(--surface-soft);
}

.roundArtToggle {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 40px;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  opacity: 0.96;
  pointer-events: none;
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

.roundCaption {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
