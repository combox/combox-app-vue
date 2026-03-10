<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const videoDurationCache = new Map<string, number>()

const props = withDefaults(
  defineProps<{
    attachmentID: string
    src: string
    poster?: string
    durationMs?: number
    width?: number
    height?: number
    caption?: string
    filename?: string
    showFilename?: boolean
    disableLivePreview?: boolean
    preventLivePreviewStart?: boolean
  }>(),
  {
    poster: '',
    durationMs: 0,
    width: 0,
    height: 0,
    caption: '',
    filename: '',
    showFilename: false,
    disableLivePreview: false,
    preventLivePreviewStart: false,
  },
)

const emit = defineEmits<{
  open: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
}>()

let activeLivePreviewOwner = ''

const rootRef = ref<HTMLButtonElement | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)
const isVisible = ref(false)
const loadLive = ref(false)
const frameReady = ref(false)
const resolvedDurationMs = ref(props.durationMs > 0 ? props.durationMs : 0)
const durationLabel = ref(formatDuration(props.durationMs > 0 ? props.durationMs : 0))
const aspectRatio = ref(props.width > 0 && props.height > 0 ? props.width / props.height : 16 / 9)

const liveLoadTimer = ref<number | null>(null)
const intersectionObserver = ref<IntersectionObserver | null>(null)
const normalizedRatio = computed(() => (Number.isFinite(aspectRatio.value) && aspectRatio.value > 0 ? aspectRatio.value : 16 / 9))
const isPortrait = computed(() => normalizedRatio.value < 0.92)
const targetWidth = computed(() => {
  if (isPortrait.value) return 300
  if (normalizedRatio.value > 1.55) return 460
  return 480
})
const isTinyPoster = computed(() => Boolean(props.poster && /(?:^|[/?])tiny\.jpe?g(?:$|[?&])/i.test(props.poster)))

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '--:--'
  const totalSec = Math.floor(ms / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  if (hh > 0) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function isHlsSource(src: string): boolean {
  return (src || '').toLowerCase().includes('.m3u8')
}

function clearLiveTimer() {
  if (liveLoadTimer.value) {
    window.clearTimeout(liveLoadTimer.value)
    liveLoadTimer.value = null
  }
}

function applyDuration(nextMs?: number) {
  if (!nextMs || nextMs <= 0) return
  videoDurationCache.set(props.src, nextMs)
  if (resolvedDurationMs.value !== nextMs) resolvedDurationMs.value = nextMs
  durationLabel.value = formatDuration(nextMs)
}

async function resolveHlsDurationMs(manifestURL: string, maxDepth = 2): Promise<number | null> {
  const visited = new Set<string>()

  const resolveURL = (base: string, next: string) => {
    try {
      return new URL(next, base).toString()
    } catch {
      return next
    }
  }

  const parseMediaPlaylistDuration = (raw: string) => {
    let total = 0
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('#EXTINF:')) continue
      const val = Number.parseFloat(line.slice(8).split(',')[0] || '')
      if (Number.isFinite(val) && val > 0) total += val
    }
    return total > 0 ? Math.floor(total * 1000) : null
  }

  const walk = async (url: string, depth: number): Promise<number | null> => {
    if (depth > maxDepth || visited.has(url)) return null
    visited.add(url)
    const resp = await fetch(url, { credentials: 'include' })
    if (!resp.ok) return null
    const text = await resp.text()
    if (!text || !text.includes('#EXTM3U')) return null

    const mediaDuration = parseMediaPlaylistDuration(text)
    if (mediaDuration) return mediaDuration

    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const line = (lines[i] || '').trim()
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue
      let next = ''
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = (lines[j] || '').trim()
        if (!candidate || candidate.startsWith('#')) continue
        next = candidate
        break
      }
      if (!next) continue
      const nested = await walk(resolveURL(url, next), depth + 1)
      if (nested) return nested
    }
    return null
  }

  try {
    return await walk(manifestURL, 0)
  } catch {
    return null
  }
}

function stopAndResetVideo(unloadSource: boolean) {
  const video = videoRef.value
  if (!video) return
  video.pause()
  video.currentTime = 0
  if (unloadSource) {
    video.removeAttribute('src')
    video.load()
  }
}

function releaseLivePreview() {
  clearLiveTimer()
  frameReady.value = false
  loadLive.value = false
  durationLabel.value = formatDuration(resolvedDurationMs.value)
  stopAndResetVideo(true)
  if (activeLivePreviewOwner === props.attachmentID) activeLivePreviewOwner = ''
}

function syncAspectRatioFromPoster() {
  if (!props.poster) return
  const img = new Image()
  img.src = props.poster
  img.onload = () => {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      aspectRatio.value = img.naturalWidth / img.naturalHeight
    }
  }
}

watch(
  () => [props.width, props.height, props.src] as const,
  () => {
    if (props.width > 0 && props.height > 0) {
      aspectRatio.value = props.width / props.height
      return
    }
    aspectRatio.value = 16 / 9
  },
  { immediate: true },
)

watch(
  () => [props.durationMs, props.src] as const,
  () => {
    const propDuration = props.durationMs > 0 ? props.durationMs : 0
    const cachedDuration = videoDurationCache.get(props.src) || 0
    const nextDuration = propDuration || cachedDuration
    if (nextDuration > 0) {
      videoDurationCache.set(props.src, nextDuration)
      resolvedDurationMs.value = nextDuration
      durationLabel.value = formatDuration(nextDuration)
      return
    }
    resolvedDurationMs.value = 0
    durationLabel.value = '--:--'
  },
  { immediate: true },
)

watch(
  () => props.poster,
  () => {
    syncAspectRatioFromPoster()
  },
  { immediate: true },
)

watch(
  () => [isVisible.value, props.disableLivePreview, props.preventLivePreviewStart, props.attachmentID, resolvedDurationMs.value] as const,
  () => {
    clearLiveTimer()

    if (props.disableLivePreview || !isVisible.value || document.visibilityState !== 'visible') {
      releaseLivePreview()
      return
    }

    if (props.preventLivePreviewStart) {
      if (!frameReady.value) loadLive.value = false
      return
    }

    if (activeLivePreviewOwner && activeLivePreviewOwner !== props.attachmentID) {
      loadLive.value = false
      return
    }

    liveLoadTimer.value = window.setTimeout(() => {
      activeLivePreviewOwner = props.attachmentID
      loadLive.value = true
      liveLoadTimer.value = null
    }, 140)
  },
)

watch(
  () => [props.disableLivePreview, props.durationMs, props.src] as const,
  async (_, __, onCleanup) => {
    if (props.disableLivePreview) return
    if (props.durationMs > 0 || videoDurationCache.has(props.src)) return

    const probe = document.createElement('video')
    let cancelled = false
    probe.preload = 'metadata'
    probe.muted = true
    probe.playsInline = true

    const onLoadedMetadata = () => {
      if (cancelled) return
      const duration = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 0
      if (duration > 0) applyDuration(Math.floor(duration * 1000))
    }

    probe.addEventListener('loadedmetadata', onLoadedMetadata)
    probe.src = props.src
    probe.load()

    if (isHlsSource(props.src)) {
      const ms = await resolveHlsDurationMs(props.src)
      if (!cancelled && ms && ms > 0) applyDuration(ms)
    }

    onCleanup(() => {
      cancelled = true
      probe.removeEventListener('loadedmetadata', onLoadedMetadata)
      probe.removeAttribute('src')
      probe.load()
    })
  },
  { immediate: true },
)

function bindLiveVideoEvents(video: HTMLVideoElement | null) {
  if (!video || !loadLive.value) return () => {}

  const updateRemaining = () => {
    const totalSecFromState = resolvedDurationMs.value > 0 ? Math.floor(resolvedDurationMs.value / 1000) : 0
    const totalSec = totalSecFromState || (Number.isFinite(video.duration) && video.duration > 0 ? Math.floor(video.duration) : 0)
    if (!totalSec) return
    const current = Number.isFinite(video.currentTime) && video.currentTime > 0 ? Math.floor(video.currentTime) : 0
    durationLabel.value = formatDuration(Math.max(0, totalSec - current) * 1000)
  }

  const onLoadedData = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      aspectRatio.value = video.videoWidth / video.videoHeight
    }
    if (Number.isFinite(video.duration) && video.duration > 0) {
      applyDuration(Math.floor(video.duration * 1000))
    }
    frameReady.value = true
    video.currentTime = 0
    updateRemaining()
    void video.play().catch(() => {})
  }

  const onTimeUpdate = () => updateRemaining()
  const onEnded = () => {
    video.currentTime = 0
    updateRemaining()
  }

  video.addEventListener('loadeddata', onLoadedData)
  video.addEventListener('timeupdate', onTimeUpdate)
  video.addEventListener('ended', onEnded)
  return () => {
    video.removeEventListener('loadeddata', onLoadedData)
    video.removeEventListener('timeupdate', onTimeUpdate)
    video.removeEventListener('ended', onEnded)
  }
}

let cleanupLiveBindings: (() => void) | null = null

watch(
  () => [loadLive.value, videoRef.value] as const,
  () => {
    if (cleanupLiveBindings) {
      cleanupLiveBindings()
      cleanupLiveBindings = null
    }
    cleanupLiveBindings = bindLiveVideoEvents(videoRef.value)
  },
  { flush: 'post' },
)

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') {
    releaseLivePreview()
    return
  }
  if (!props.disableLivePreview && isVisible.value) {
    if (activeLivePreviewOwner && activeLivePreviewOwner !== props.attachmentID) return
    activeLivePreviewOwner = props.attachmentID
    loadLive.value = true
  }
}

function onWindowBlur() {
  releaseLivePreview()
}

function recalcVisibleState() {
  const root = rootRef.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  const vw = window.innerWidth || document.documentElement.clientWidth || 0
  const vh = window.innerHeight || document.documentElement.clientHeight || 0
  const overlapW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0))
  const overlapH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0))
  const overlapArea = overlapW * overlapH
  const ownArea = Math.max(1, rect.width * rect.height)
  isVisible.value = overlapArea / ownArea >= 0.2
}

function onWindowFocus() {
  recalcVisibleState()
  if (document.visibilityState !== 'visible') return
  if (props.disableLivePreview || props.preventLivePreviewStart || !isVisible.value) return
  if (activeLivePreviewOwner && activeLivePreviewOwner !== props.attachmentID) return
  activeLivePreviewOwner = props.attachmentID
  loadLive.value = true
}

onMounted(() => {
  if (rootRef.value && typeof IntersectionObserver !== 'undefined') {
    intersectionObserver.value = new IntersectionObserver(
      ([entry]) => {
        isVisible.value = Boolean(entry && entry.isIntersecting && entry.intersectionRatio >= 0.2)
      },
      { threshold: [0, 0.2, 0.35], rootMargin: '120px 0px 120px 0px' },
    )
    intersectionObserver.value.observe(rootRef.value)
  } else {
    isVisible.value = true
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('pagehide', onWindowBlur)
})

onBeforeUnmount(() => {
  clearLiveTimer()
  if (cleanupLiveBindings) cleanupLiveBindings()
  intersectionObserver.value?.disconnect()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('pagehide', onWindowBlur)
  if (activeLivePreviewOwner === props.attachmentID) activeLivePreviewOwner = ''
})
</script>

<template>
  <button
    ref="rootRef"
    type="button"
    class="video-preview"
    :data-attachment-id="attachmentID"
    :data-live-preview-id="attachmentID"
    :style="{ '--video-target-width': `${targetWidth}px`, '--video-aspect-ratio': String(normalizedRatio) }"
    @click="emit('open', { attachmentID, src, poster: poster || undefined, filename: filename || undefined })"
  >
    <div class="video-preview-media" :class="{ 'is-tiny-poster': isTinyPoster && !frameReady, 'is-loading': loadLive && !frameReady }">
      <img
        v-if="poster"
        class="video-preview-poster"
        :class="{ 'is-hidden': frameReady, 'is-blurred': !frameReady }"
        :src="poster"
        :alt="caption || 'video'"
      />
      <div v-else class="video-preview-fallback" />

      <video
        v-if="loadLive"
        ref="videoRef"
        class="video-preview-poster video-preview-live"
        :class="{ 'is-visible': frameReady }"
        :src="src"
        preload="metadata"
        muted
        playsinline
        loop
      />

      <div class="video-preview-duration">{{ durationLabel }}</div>
      <div class="video-preview-play">
        <span class="video-preview-play-inner" aria-hidden="true">
          <span v-if="loadLive && !frameReady" class="video-preview-spinner" aria-hidden="true" />
          <span class="video-preview-triangle" />
        </span>
      </div>
      <div v-if="showFilename && filename" class="video-preview-name">{{ filename }}</div>
    </div>

  </button>
</template>

<style scoped>
.video-preview {
  display: block;
  width: var(--video-target-width, 520px);
  min-width: 240px;
  max-width: 76vw;
  border: 0;
  padding: 0;
  border-radius: 14px;
  overflow: hidden;
  background: #111319;
  cursor: pointer;
  text-align: left;
}

.video-preview-media {
  position: relative;
  width: 100%;
  aspect-ratio: var(--video-aspect-ratio, 16 / 9);
  background: #000;
}

.video-preview-media.is-tiny-poster .video-preview-poster:not(.video-preview-live) {
  filter: blur(0.55px) saturate(0.9) contrast(0.94);
  transform: scale(1.006);
}

.video-preview-media::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(10, 14, 20, 0.16), rgba(10, 14, 20, 0.22));
  opacity: 0;
  transition: opacity 160ms ease;
}

.video-preview-media.is-loading::after {
  opacity: 1;
}

.video-preview-media.is-tiny-poster::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(10, 14, 20, 0.1), rgba(10, 14, 20, 0.16));
}

.video-preview-poster {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity 180ms ease-in-out;
}

.video-preview-poster.is-blurred {
  filter: blur(16px) saturate(1.06) contrast(1.04);
  transform: scale(1.05);
}

.video-preview-poster.is-hidden {
  opacity: 0;
}

.video-preview-live {
  position: absolute;
  inset: 0;
  opacity: 0;
}

.video-preview-live.is-visible {
  opacity: 1;
}

.video-preview-fallback {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 100% at 70% 15%, rgba(255, 255, 255, 0.08), transparent 45%),
    linear-gradient(135deg, #1f2432 0%, #111319 52%, #1e1728 100%);
}

.video-preview-duration {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 10px;
  padding: 2px 7px;
  font-variant-numeric: tabular-nums;
}

.video-preview-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
}

.video-preview-play-inner {
  width: 56px;
  height: 56px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  position: relative;
}

.video-preview-spinner {
  position: absolute;
  inset: -6px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.24);
  border-top-color: rgba(255, 255, 255, 0.92);
  animation: videoSpin 780ms linear infinite;
}

@keyframes videoSpin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.video-preview-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 12px 9px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.68));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.video-preview-triangle {
  width: 0;
  height: 0;
  margin-left: 4px;
  border-top: 10px solid transparent;
  border-bottom: 10px solid transparent;
  border-left: 16px solid #fff;
}

</style>
