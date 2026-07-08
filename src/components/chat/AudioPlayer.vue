<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Hls from 'hls.js'
import { useI18n } from '../../i18n/i18n'
import { parseAudioTags } from '../../utils/audioTags'

const props = defineProps<{
  src: string
  poster?: string
  pending?: boolean
  title?: string
  artist?: string
  durationMs?: number
}>()

const { t } = useI18n()

const audioRef = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const duration = ref(0)
const time = ref(0)
const metaTitle = ref('')
const metaArtist = ref('')
let hlsInstance: Hls | null = null
let tagController: AbortController | null = null

const resolvedTitle = computed(() => metaTitle.value || props.title || '')
const resolvedArtist = computed(() => metaArtist.value || props.artist || '')

const progress = computed(() => (duration.value > 0 ? (time.value / duration.value) * 100 : 0))

function isHlsSource(url: string): boolean {
  return /\.(m3u8|m3u)(\?|#|$)/i.test(url)
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const min = Math.floor(total / 60)
  const rest = total % 60
  return `${min}:${String(rest).padStart(2, '0')}`
}

function destroyHls() {
  if (hlsInstance) {
    hlsInstance.destroy()
    hlsInstance = null
  }
}

function abortTags() {
  if (tagController) {
    tagController.abort()
    tagController = null
  }
}

function loadTags(url: string) {
  abortTags()
  tagController = new AbortController()
  parseAudioTags(url, tagController.signal)
    .then((tags) => {
      if (tags.title) metaTitle.value = tags.title
      if (tags.artist) metaArtist.value = tags.artist
    })
    .catch(() => {})
}

function attachSource() {
  destroyHls()
  const audio = audioRef.value
  if (!audio || !props.src || props.pending) return

  if (isHlsSource(props.src) && Hls.isSupported()) {
    hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: false })
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      if (data.levels && data.levels[0] && Number.isFinite(data.levels[0].duration)) {
        duration.value = data.levels[0].duration
      }
    })
    hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        hlsInstance?.destroy()
        hlsInstance = null
      }
    })
    hlsInstance.loadSource(props.src)
    hlsInstance.attachMedia(audio)
  } else {
    audio.src = props.src
    audio.load()
  }

  if (!isHlsSource(props.src)) loadTags(props.src)
}

function onLoadedMetadata(event: Event) {
  const d = (event.target as HTMLAudioElement).duration
  if (Number.isFinite(d) && d > 0) duration.value = d
  else if (props.durationMs && props.durationMs > 0) duration.value = props.durationMs / 1000
}

function onDurationChange(event: Event) {
  const d = (event.target as HTMLAudioElement).duration
  if (Number.isFinite(d) && d > 0) duration.value = d
  else if (props.durationMs && props.durationMs > 0) duration.value = props.durationMs / 1000
}

async function togglePlayback() {
  const node = audioRef.value
  if (!node || props.pending || !props.src) return
  try {
    if (node.paused) await node.play()
    else node.pause()
  } catch {
    playing.value = false
  }
}

function seek(event: MouseEvent) {
  const node = audioRef.value
  const line = event.currentTarget as HTMLDivElement | null
  if (!node || !line || !duration.value || props.pending || !props.src) return
  const rect = line.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  node.currentTime = ratio * duration.value
}

watch([() => props.src, () => props.pending], attachSource, { flush: 'post' })
onMounted(attachSource)
onBeforeUnmount(() => {
  destroyHls()
  abortTags()
})
</script>

<template>
  <div class="audioPlayer">
    <audio
      v-if="props.src"
      ref="audioRef"
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="onDurationChange"
      @timeupdate="(event) => (time = (event.target as HTMLAudioElement).currentTime || 0)"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
    />
    <button type="button" class="audioToggle" :disabled="props.pending || !props.src" @click="togglePlayback">
      <v-icon :icon="playing ? 'mdi-pause' : 'mdi-play'" size="18" />
    </button>
    <div class="audioCoverWrap">
      <img v-if="poster" class="audioCover" :src="poster" alt="audio preview" />
      <div v-else class="audioCover audioCoverPlaceholder">
        <v-icon icon="mdi-music-note" size="20" />
      </div>
    </div>
    <div class="audioBody">
      <div class="audioMeta">
        <div class="audioTitle">{{ resolvedTitle || t('chat.audio_message', undefined, 'Audio message') }}</div>
        <div v-if="resolvedArtist" class="audioArtist">{{ resolvedArtist }}</div>
      </div>
      <div class="audioLine" :class="{ pending: props.pending || !props.src }" @click="seek">
        <div class="audioLineValue" :style="{ width: `${progress}%` }" />
      </div>
    </div>
    <div class="audioTime">
      {{ props.pending || !props.src ? '--:--' : `${formatTime(time)} / ${formatTime(duration)}` }}
    </div>
  </div>
</template>

<style scoped>
.audioPlayer {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 10px;
  min-width: 260px;
  min-height: 44px;
}

.audioToggle {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-strong);
  background: var(--surface-strong);
  color: var(--text);
  cursor: pointer;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, border-color 120ms ease;
}

.audioToggle:hover:not(:disabled) {
  background: var(--surface-soft-hover);
  border-color: var(--accent);
}

.audioToggle:disabled {
  opacity: 0.5;
  cursor: default;
}

.audioCoverWrap {
  width: 40px;
  height: 40px;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  display: grid;
  place-items: center;
}

.audioCover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.audioCoverPlaceholder {
  background: var(--surface-soft);
  color: var(--text-muted);
}

.audioBody {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.audioMeta {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.audioTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audioArtist {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  transition: width 80ms linear;
}

.audioTime {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
