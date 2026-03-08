<script setup lang="ts">
import * as PlyrImport from 'plyr'
import 'plyr/dist/plyr.css'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getAttachment, getAttachmentDownloadURL } from 'combox-api'
import { useI18n } from '../../i18n/i18n'

const Plyr = ((PlyrImport as unknown as { default?: unknown }).default ?? PlyrImport) as unknown as new (
  target: HTMLElement,
  options?: unknown,
) => {
  on: (event: string, callback: (...args: unknown[]) => void) => void
  play: () => void | Promise<void>
  destroy: () => void
  source: unknown
}

const props = defineProps<{
  attachmentID: string
  src: string
  poster?: string
  filename?: string
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()
const { t } = useI18n()

const viewerRef = ref<HTMLDivElement | null>(null)
const mediaHostRef = ref<HTMLDivElement | null>(null)
const mediaError = ref('')
const resolvedSrc = ref(props.src)
const isFullscreen = ref(false)
const openedAt = ref(0)

let player: InstanceType<typeof Plyr> | null = null

const youtubeId = computed(() => getYouTubeId(resolvedSrc.value))
const isYouTubeSource = computed(() => Boolean(youtubeId.value))

function filenameFromUrl(src: string): string {
  try {
    const url = new URL(src)
    const last = url.pathname.split('/').filter(Boolean).pop() || 'video.mp4'
    return decodeURIComponent(last)
  } catch {
    return 'video.mp4'
  }
}

function isHlsSource(src: string): boolean {
  return (src || '').toLowerCase().includes('.m3u8')
}

function getYouTubeId(src: string): string {
  if (!src) return ''
  try {
    const parsed = new URL(src)
    const host = parsed.hostname.toLowerCase()
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0] || ''
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id
    }
    if (host.includes('youtube.com')) {
      const byQuery = parsed.searchParams.get('v') || ''
      if (/^[a-zA-Z0-9_-]{11}$/.test(byQuery)) return byQuery
      const parts = parsed.pathname.split('/').filter(Boolean)
      const marker = parts.findIndex((part) => part === 'shorts' || part === 'embed')
      if (marker >= 0) {
        const id = parts[marker + 1] || ''
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id
      }
    }
  } catch {
    // fallback to regex parsing below
  }
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const pattern of patterns) {
    const match = src.match(pattern)
    if (match?.[1]) return match[1]
  }
  return ''
}

function destroyPlayer() {
  if (player) {
    player.destroy()
    player = null
  }
  if (mediaHostRef.value) mediaHostRef.value.innerHTML = ''
}

async function setupPlayer() {
  destroyPlayer()
  if (!props.open || !mediaHostRef.value || !resolvedSrc.value) return

  mediaError.value = ''
  const options = {
    controls: isYouTubeSource.value
      ? ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'fullscreen']
      : ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'fullscreen', 'download'],
    settings: ['captions', 'speed'],
    autoplay: isYouTubeSource.value,
    muted: isYouTubeSource.value,
    resetOnEnd: false,
    captions: {
      active: false,
      language: 'auto',
      update: true,
    },
    fullscreen: {
      enabled: true,
      fallback: true,
      iosNative: false,
    },
    youtube: {
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
    },
  }

  if (isYouTubeSource.value) {
    const host = document.createElement('div')
    host.setAttribute('data-plyr-provider', 'youtube')
    host.setAttribute('data-plyr-embed-id', youtubeId.value)
    mediaHostRef.value.appendChild(host)
    player = new Plyr(host, options)
    player.source = {
      type: 'video',
      title: props.filename?.trim() || 'YouTube',
      sources: [{ src: youtubeId.value, provider: 'youtube' as const }],
      poster: props.poster || undefined,
    }
  } else {
    const video = document.createElement('video')
    video.playsInline = true
    mediaHostRef.value.appendChild(video)
    player = new Plyr(video, options)
    player.source = {
      type: 'video',
      title: props.filename?.trim() || 'video',
      sources: [{ src: resolvedSrc.value, type: isHlsSource(resolvedSrc.value) ? 'application/x-mpegURL' : 'video/mp4' }],
      poster: props.poster || undefined,
    }
  }

  player.on('error', () => {
    mediaError.value = t('chat.video_codec_unsupported', undefined, 'Video codec is not supported in this browser.')
  })

  window.setTimeout(() => {
    Promise.resolve(player?.play()).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (error instanceof DOMException && error.name === 'NotAllowedError') return
      if (isYouTubeSource.value) return
      mediaError.value = t('chat.video_playback_failed', undefined, 'Unable to start video playback.')
    })
  }, 40)
}

async function resolveAttachmentSource() {
  resolvedSrc.value = props.src
  if (!props.open || !props.attachmentID || isYouTubeSource.value) return
  try {
    const payload = await getAttachment(props.attachmentID)
    if (payload.url) resolvedSrc.value = payload.url
  } catch {
    // keep original src
  }
}

async function onRootClick(event: MouseEvent) {
  if (event.target !== event.currentTarget) return
  if (performance.now() - openedAt.value < 220) return
  emit('close')
}

async function onDownloadClick(event: Event) {
  const target = event.target as HTMLElement | null
  if (!target) return
  const anchor = target.closest('.plyr__control[data-plyr="download"]') as HTMLButtonElement | null
  if (!anchor) return
  event.preventDefault()
  try {
    let downloadSrc = resolvedSrc.value
    let downloadName = props.filename?.trim() || filenameFromUrl(resolvedSrc.value)
    if (isYouTubeSource.value) return
    if (isHlsSource(resolvedSrc.value) && props.attachmentID) {
      const download = await getAttachmentDownloadURL(props.attachmentID)
      downloadSrc = download.url
      if (download.filename?.trim()) downloadName = download.filename.trim()
    }
    const trigger = (href: string) => {
      const link = document.createElement('a')
      link.href = href
      link.download = downloadName
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }

    try {
      const response = await fetch(downloadSrc)
      if (!response.ok) throw new Error('download_failed')
      const blob = await response.blob()
      const objectURL = URL.createObjectURL(blob)
      trigger(objectURL)
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
    } catch {
      trigger(downloadSrc)
    }
  } catch {
    mediaError.value = t('chat.video_download_failed', undefined, 'Unable to download video file.')
  }
}

function onFullscreenChange() {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

watch(
  () => props.src,
  (value) => {
    resolvedSrc.value = value
  },
  { immediate: true },
)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      viewerRef.value?.removeEventListener('click', onDownloadClick)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      destroyPlayer()
      return
    }
    openedAt.value = performance.now()
    await resolveAttachmentSource()
    await nextTick()
    await setupPlayer()
    viewerRef.value?.addEventListener('click', onDownloadClick)
    document.addEventListener('fullscreenchange', onFullscreenChange)
  },
  { immediate: true },
)

watch(
  () => [resolvedSrc.value, props.poster, props.filename] as const,
  async () => {
    if (!props.open) return
    await nextTick()
    await setupPlayer()
  },
)

onBeforeUnmount(() => {
  viewerRef.value?.removeEventListener('click', onDownloadClick)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  destroyPlayer()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" ref="viewerRef" class="video-viewer-overlay" :class="{ 'video-viewer-overlay--fullscreen': isFullscreen }" @click="onRootClick">
      <div class="video-viewer-content" :class="{ 'video-viewer-content--youtube': isYouTubeSource }">
        <div ref="mediaHostRef" />
        <div v-if="mediaError" class="video-viewer-error">{{ mediaError }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.video-viewer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  z-index: 1600;
  padding: 2vh 2vw;
  margin: 0;
  display: grid;
  place-items: center;
}

.video-viewer-content {
  width: fit-content;
  height: fit-content;
  max-width: min(92vw, 1500px);
  max-height: min(88vh, 900px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  position: relative;
  overflow: hidden;
}

.video-viewer-content :deep(.plyr) {
  width: auto !important;
  height: auto !important;
  min-width: min(92vw, 560px);
  max-width: min(92vw, 1500px) !important;
  max-height: min(88vh, 900px) !important;
  background: transparent !important;
  --plyr-video-background: transparent;
  display: inline-block;
  margin: 0 auto;
}

.video-viewer-content :deep(.plyr__video-wrapper) {
  width: auto !important;
  height: auto !important;
  min-width: min(92vw, 560px);
  max-width: min(92vw, 1500px) !important;
  max-height: min(88vh, 900px) !important;
  background: transparent !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-viewer-content :deep(video) {
  width: auto !important;
  height: auto !important;
  max-width: min(92vw, 1500px) !important;
  max-height: calc(min(88vh, 900px) - 56px) !important;
  object-fit: contain !important;
  margin: 0 auto;
  display: block;
}

.video-viewer-content :deep(.plyr__controls) {
  min-width: min(92vw, 560px);
  width: 100%;
  box-sizing: border-box;
}

.video-viewer-content--youtube {
  width: min(94vw, 1280px);
  height: auto;
  max-height: 88vh;
}

.video-viewer-content--youtube :deep(.plyr) {
  width: min(94vw, 1280px) !important;
  min-width: min(94vw, 780px) !important;
  max-width: min(94vw, 1280px) !important;
  height: auto !important;
}

.video-viewer-content--youtube :deep(.plyr__video-wrapper) {
  width: 100% !important;
  aspect-ratio: 16 / 9 !important;
  min-height: auto !important;
}

.video-viewer-content--youtube :deep(iframe) {
  width: 100% !important;
  height: 100% !important;
}

.video-viewer-content :deep(.plyr__control),
.video-viewer-content :deep(.plyr__controls),
.video-viewer-content :deep(.plyr__control svg),
.video-viewer-content :deep(.plyr__progress input[type='range']) {
  transition: none !important;
  animation: none !important;
  box-shadow: none !important;
}

.video-viewer-overlay--fullscreen {
  padding: 0 !important;
  place-items: stretch !important;
}

.video-viewer-overlay--fullscreen .video-viewer-content {
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
}

.video-viewer-overlay--fullscreen .video-viewer-content :deep(.plyr),
.video-viewer-content :deep(.plyr.plyr--fullscreen-active) {
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
}

.video-viewer-overlay--fullscreen .video-viewer-content :deep(.plyr__video-wrapper),
.video-viewer-content :deep(.plyr.plyr--fullscreen-active .plyr__video-wrapper) {
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
}

.video-viewer-overlay--fullscreen .video-viewer-content :deep(video),
.video-viewer-content :deep(.plyr.plyr--fullscreen-active video) {
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  object-fit: contain !important;
}

.video-viewer-error {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  padding: 8px 10px;
  font-size: 13px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
</style>
