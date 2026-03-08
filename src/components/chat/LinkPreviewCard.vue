<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { openComboxAwareUrl } from './chatUtils'

const props = defineProps<{
  url: string
  mediaOverlayOpen?: boolean
}>()

const emit = defineEmits<{
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
}>()

declare global {
  interface Window {
    YT?: {
      Player: new (
        target: HTMLElement,
        config: {
          videoId: string
          playerVars?: Record<string, string | number>
          events?: {
            onReady?: (event: { target: { getDuration?: () => number } }) => void
            onStateChange?: (event: { target: { getDuration?: () => number } }) => void
          }
        },
      ) => { destroy?: () => void }
      PlayerState?: { ENDED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

type LinkPreviewState = {
  url: string
  title: string
  description: string
  provider: string
  image: string
  durationSec?: number
}

const linkPreviewCache = new Map<string, LinkPreviewState | null>()
const linkPreviewFailedAt = new Map<string, number>()
let youtubeApiLoader: Promise<void> | null = null
const LINK_PREVIEW_RETRY_COOLDOWN_MS = 2 * 60 * 1000
const YOUTUBE_TIME_TICK_MS = 500

const normalizedUrl = computed(() => {
  const raw = (props.url || '').trim()
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
})

function parseYouTubeId(src: string): string {
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
    // fallback below
  }

  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
  ]
  for (const pattern of patterns) {
    const match = src.match(pattern)
    if (match?.[1]) return match[1]
  }
  return ''
}

const youtubeId = computed(() => parseYouTubeId(normalizedUrl.value))

const isYouTube = computed(() => Boolean(youtubeId.value))
const isGitHub = computed(() => /(^|\.)github\.com$/i.test(hostText.value))
const preview = ref<LinkPreviewState | null>(null)
const cardRef = ref<HTMLDivElement | null>(null)
const youtubeLiveHostRef = ref<HTMLDivElement | null>(null)
const youtubeLiveReady = ref(false)
const youtubeRemainingSec = ref<number | null>(null)
const youtubePlayer = ref<{ destroy?: () => void; getDuration?: () => number; getCurrentTime?: () => number } | null>(null)
const youtubeTicker = ref<number | null>(null)
const isCardVisible = ref(false)
const pageVisible = ref(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
const windowFocused = ref(typeof document === 'undefined' ? true : document.hasFocus())
const focusResumeToken = ref(0)
const youtubeLiveActive = computed(() => false)
let cardObserver: IntersectionObserver | null = null
const hostText = computed(() => {
  try {
    return new URL(normalizedUrl.value).hostname.replace(/^www\./i, '')
  } catch {
    return normalizedUrl.value
  }
})
const previewTitle = computed(() => {
  try {
    const url = new URL(normalizedUrl.value)
    return decodeURIComponent(url.pathname.replace(/^\/+/, '') || url.hostname)
  } catch {
    return normalizedUrl.value
  }
})
const youtubePoster = computed(() => (youtubeId.value ? `https://i.ytimg.com/vi/${youtubeId.value}/hqdefault.jpg` : ''))
const displayImage = computed(() => {
  if (isYouTube.value) return youtubePoster.value
  return (preview.value?.image || '').trim()
})
const displayTitle = computed(() => {
  if (isYouTube.value) return (preview.value?.title || 'YouTube video').trim()
  return (preview.value?.title || previewTitle.value).trim()
})
const displayDescription = computed(() => (preview.value?.description || '').trim())
const displayProvider = computed(() => (preview.value?.provider || hostText.value).trim())
const youtubeDurationLabel = computed(() => formatDuration(youtubeRemainingSec.value ?? preview.value?.durationSec ?? null))

function recalcCardVisibility() {
  if (!cardRef.value) {
    isCardVisible.value = false
    return
  }
  const rect = cardRef.value.getBoundingClientRect()
  const vw = window.innerWidth || document.documentElement.clientWidth || 0
  const vh = window.innerHeight || document.documentElement.clientHeight || 0
  const overlapW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0))
  const overlapH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0))
  const overlapArea = overlapW * overlapH
  const ownArea = Math.max(1, rect.width * rect.height)
  isCardVisible.value = overlapArea / ownArea >= 0.25
}

function formatDuration(totalSec: number | null): string {
  if (!totalSec || totalSec <= 0) return '--:--'
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = Math.floor(totalSec % 60)
  if (hh > 0) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function ensureYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.YT?.Player) return Promise.resolve()
  if (youtubeApiLoader) return youtubeApiLoader

  youtubeApiLoader = new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve()
    }

    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]')
    if (existing) return
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    document.head.appendChild(script)
  })
  return youtubeApiLoader
}

function stopYoutubeTicker() {
  if (!youtubeTicker.value) return
  window.clearInterval(youtubeTicker.value)
  youtubeTicker.value = null
}

function refreshYoutubeRemaining() {
  const player = youtubePlayer.value
  if (!player?.getDuration || !player.getCurrentTime) return
  const duration = Math.floor(player.getDuration() || 0)
  const current = Math.floor(player.getCurrentTime() || 0)
  if (duration > 0) youtubeRemainingSec.value = Math.max(0, duration - current)
}

function destroyYoutubePlayer() {
  stopYoutubeTicker()
  youtubeLiveReady.value = false
  youtubeRemainingSec.value = null
  try {
    youtubePlayer.value?.destroy?.()
  } catch {
    // noop
  }
  youtubePlayer.value = null
  if (youtubeLiveHostRef.value) youtubeLiveHostRef.value.innerHTML = ''
}

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url)
    if (!/^(www\.)?github\.com$/i.test(parsed.hostname)) return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const owner = parts[0]
    const repo = parts[1].replace(/\.git$/i, '')
    if (!owner || !repo) return null
    return { owner, repo }
  } catch {
    return null
  }
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewState | null> {
  if (!url) return null
  if (linkPreviewCache.has(url)) return linkPreviewCache.get(url) ?? null
  const lastFailure = linkPreviewFailedAt.get(url)
  if (typeof lastFailure === 'number' && Date.now() - lastFailure < LINK_PREVIEW_RETRY_COOLDOWN_MS) {
    return null
  }

  const githubRepo = parseGitHubRepo(url)
  if (githubRepo) {
    try {
      const { owner, repo } = githubRepo
      const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
      if (!response.ok) {
        linkPreviewFailedAt.set(url, Date.now())
        return null
      }
      const payload = (await response.json()) as { full_name?: string; description?: string }
      const next: LinkPreviewState = {
        url,
        title: payload.full_name?.trim() || `${owner}/${repo}`,
        description: payload.description?.trim() || 'GitHub repository',
        provider: 'GitHub',
        image: `https://opengraph.githubassets.com/1/${owner}/${repo}`,
      }
      linkPreviewCache.set(url, next)
      linkPreviewFailedAt.delete(url)
      return next
    } catch {
      linkPreviewFailedAt.set(url, Date.now())
      return null
    }
  }
  linkPreviewCache.set(url, null)
  return null
}

watch(
  normalizedUrl,
  async (url) => {
    if (!url) {
      preview.value = null
      return
    }
    if (isYouTube.value) {
      try {
        const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
        const response = await fetch(endpoint)
        if (!response.ok) throw new Error('oembed_failed')
        const payload = (await response.json()) as { title?: string; author_name?: string; provider_name?: string; thumbnail_url?: string }
        preview.value = {
          url,
          title: (payload.title || 'YouTube video').trim(),
          description: (payload.author_name || '').trim(),
          provider: (payload.provider_name || 'YouTube').trim(),
          image: (payload.thumbnail_url || youtubePoster.value || '').trim(),
          durationSec: preview.value?.durationSec,
        }
      } catch {
        preview.value = {
          url,
          title: 'YouTube video',
          description: '',
          provider: 'YouTube',
          image: youtubePoster.value,
          durationSec: preview.value?.durationSec,
        }
      }
      return
    }
    preview.value = await fetchLinkPreview(url)
  },
  { immediate: true },
)

watch(
  () => [youtubeLiveActive.value, youtubeId.value, youtubeLiveHostRef.value, focusResumeToken.value] as const,
  async ([active, id, host]) => {
    if (!active || !id || !host) {
      destroyYoutubePlayer()
      return
    }
    await ensureYouTubeIframeApi()
    if (!youtubeLiveActive.value || !youtubeId.value || !youtubeLiveHostRef.value || !window.YT?.Player) return

    destroyYoutubePlayer()
    youtubePlayer.value = new window.YT.Player(youtubeLiveHostRef.value, {
      videoId: id,
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 0,
        loop: 1,
        playlist: id,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        iv_load_policy: 3,
        fs: 0,
        disablekb: 1,
      },
      events: {
        onReady: (event) => {
          event.target.mute?.()
          event.target.playVideo?.()
          youtubeLiveReady.value = true
          const duration = Math.floor(event.target.getDuration?.() || 0)
          if (duration > 0) {
            youtubeRemainingSec.value = duration
            preview.value = { ...(preview.value || { url: normalizedUrl.value, title: 'YouTube video', description: 'YouTube', provider: 'YouTube', image: youtubePoster.value }), durationSec: duration }
          }
          stopYoutubeTicker()
          refreshYoutubeRemaining()
          youtubeTicker.value = window.setInterval(refreshYoutubeRemaining, YOUTUBE_TIME_TICK_MS)
        },
        onStateChange: (event) => {
          if (event.data === window.YT?.PlayerState?.ENDED) event.target.playVideo?.()
        },
      },
    }) as unknown as { destroy?: () => void; getDuration?: () => number; getCurrentTime?: () => number }
  },
  { immediate: true, flush: 'post' },
)

function onVisibilityChange() {
  pageVisible.value = document.visibilityState === 'visible'
  if (pageVisible.value) {
    recalcCardVisibility()
    focusResumeToken.value += 1
  }
}

function onWindowFocus() {
  windowFocused.value = true
  recalcCardVisibility()
  focusResumeToken.value += 1
}

function onWindowBlur() {
  windowFocused.value = false
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('blur', onWindowBlur)
  if (cardRef.value && typeof IntersectionObserver !== 'undefined') {
    cardObserver = new IntersectionObserver(
      ([entry]) => {
        isCardVisible.value = Boolean(entry && entry.isIntersecting && entry.intersectionRatio >= 0.25)
      },
      { threshold: [0, 0.25, 0.4], rootMargin: '100px 0px 100px 0px' },
    )
    cardObserver.observe(cardRef.value)
  } else {
    isCardVisible.value = true
  }
  recalcCardVisibility()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('blur', onWindowBlur)
  cardObserver?.disconnect()
  cardObserver = null
  destroyYoutubePlayer()
})

function open() {
  if (!normalizedUrl.value) return
  if (isYouTube.value) {
    destroyYoutubePlayer()
    emit('openVideo', {
      attachmentID: '',
      src: normalizedUrl.value,
      poster: youtubePoster.value,
      filename: displayTitle.value || hostText.value,
    })
    return
  }
  openComboxAwareUrl(normalizedUrl.value)
}
</script>

<template>
  <div
    ref="cardRef"
    class="lpCard"
    :class="{ youtube: isYouTube }"
    role="button"
    tabindex="0"
    @click="open"
    @keydown.enter.prevent="open"
    @keydown.space.prevent="open"
  >
    <div v-if="displayImage" class="lpMedia">
      <img :src="displayImage" alt="" class="lpThumb" />
      <div v-if="isYouTube && youtubeLiveActive" class="lpYoutubeLive" :class="{ 'is-visible': youtubeLiveReady }">
        <div ref="youtubeLiveHostRef" class="lpYoutubePlayer" />
      </div>
      <div v-if="isYouTube && youtubeDurationLabel !== '--:--'" class="lpDurationBadge">{{ youtubeDurationLabel }}</div>
      <div v-if="isYouTube" class="lpPlayBadge">
        <v-icon icon="mdi-play" size="26" />
      </div>
    </div>
    <div v-if="!(isGitHub && displayImage)" class="lpBody">
      <div class="lpHost">{{ displayProvider }}</div>
      <div class="lpTitle">{{ displayTitle }}</div>
      <div v-if="displayDescription" class="lpDesc">{{ displayDescription }}</div>
    </div>
  </div>
</template>

<style scoped>
.lpCard {
  width: 100%;
  max-width: 420px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(255, 255, 255, 0.78);
  padding: 0;
  display: grid;
  gap: 0;
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  border-radius: 4px;
}

.lpMedia {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  max-height: 236px;
  overflow: hidden;
  background: #ddd;
}

.lpThumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.lpPlayBadge {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
}

.lpDurationBadge {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 12px;
  line-height: 1;
  font-weight: 700;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 10px;
  padding: 3px 7px;
  font-variant-numeric: tabular-nums;
}

.lpYoutubeLive {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease-in-out;
}

.lpYoutubeLive.is-visible {
  opacity: 1;
}

.lpYoutubePlayer,
.lpYoutubePlayer iframe {
  width: 100%;
  height: 100%;
  border: 0;
}

.lpBody {
  padding: 8px 10px 10px;
  min-width: 0;
}

.lpHost {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.56);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lpTitle {
  margin-top: 2px;
  font-size: 15px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.86);
  line-height: 1.25;
  word-break: break-word;
}

.lpDesc {
  margin-top: 4px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.62);
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

</style>
