<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AudioPlayer from './AudioPlayer.vue'
import type { ResolvedAttachment } from './chatTypes'
import VideoPlayer from './VideoPlayer.vue'
import { getSharedMediaLazyQueue } from './mediaLazyQueue'

const props = defineProps<{
  attachment: ResolvedAttachment
  mediaOverlayOpen: boolean
}>()

const emit = defineEmits<{
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
}>()

const rootEl = ref<HTMLElement | null>(null)
const imageSrc = ref(props.attachment.previewUrl || props.attachment.url)
const fullLoaded = ref(!props.attachment.previewUrl)
let preloadImage: HTMLImageElement | null = null
const isNearViewport = ref(false)
const thumbLoaded = ref(false)
let cleanupVisibility: (() => void) | null = null
const mediaQueue = getSharedMediaLazyQueue()
let destroyed = false

const isGif = computed(() => {
  const type = (props.attachment.mimeType || '').toLowerCase()
  const name = (props.attachment.filename || '').toLowerCase()
  const url = (props.attachment.url || '').toLowerCase()
  return type.includes('gif') || name.endsWith('.gif') || url.includes('.gif')
})

const pageVisible = ref(document.visibilityState === 'visible')

const shouldFreezeAnimatedMedia = computed(() => isGif.value && (props.mediaOverlayOpen || !pageVisible.value))
const isPreviewMode = computed(() => Boolean(props.attachment.previewUrl) && !fullLoaded.value)

const numericWidth = () => (props.attachment.width > 0 ? props.attachment.width : 0)
const numericHeight = () => (props.attachment.height > 0 ? props.attachment.height : 0)

const lockedDims = ref<{ width: number; height: number }>({ width: numericWidth() || 0, height: numericHeight() || 0 })

watch(
  () => props.attachment.id,
  () => {
    lockedDims.value = { width: numericWidth() || 0, height: numericHeight() || 0 }
  },
  { immediate: true },
)

function resetImageState() {
  imageSrc.value = props.attachment.previewUrl || props.attachment.url
  fullLoaded.value = !props.attachment.previewUrl
  thumbLoaded.value = false
}

function cleanupPreload() {
  if (!preloadImage) return
  preloadImage.onload = null
  preloadImage.onerror = null
  preloadImage = null
}

function scheduleFullImageLoad() {
  cleanupPreload()
  if (!props.attachment.url) return

  if (!isNearViewport.value) return

  if (shouldFreezeAnimatedMedia.value) {
    imageSrc.value = props.attachment.previewUrl || props.attachment.url
    fullLoaded.value = !props.attachment.previewUrl
    return
  }

  if (!props.attachment.previewUrl || props.attachment.previewUrl === props.attachment.url) {
    imageSrc.value = props.attachment.url
    fullLoaded.value = true
    return
  }
  preloadImage = new Image()
  preloadImage.decoding = 'async'
  preloadImage.src = props.attachment.url
  preloadImage.onload = () => {
    if (destroyed) return
    imageSrc.value = props.attachment.url
    fullLoaded.value = true
    cleanupPreload()
  }
  preloadImage.onerror = () => {
    cleanupPreload()
  }
}

watch(
  () => [props.attachment.previewUrl, props.attachment.url, props.mediaOverlayOpen],
  () => {
    resetImageState()
    scheduleFullImageLoad()
  },
  { immediate: true },
)

watch(
  () => shouldFreezeAnimatedMedia.value,
  (freeze) => {
    if (!freeze) {
      scheduleFullImageLoad()
      return
    }
    cleanupPreload()
    imageSrc.value = props.attachment.previewUrl || props.attachment.url
    fullLoaded.value = !props.attachment.previewUrl
  },
)

onBeforeUnmount(cleanupPreload)

function onVisibilityChange() {
  pageVisible.value = document.visibilityState === 'visible'
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)

  if (props.attachment.kind === 'image') {
    if (rootEl.value) {
      cleanupVisibility = mediaQueue.observe(
        {
          target: rootEl.value,
          load: () => {
            isNearViewport.value = true
            scheduleFullImageLoad()
          },
        },
        (visible) => {
          if (visible === isNearViewport.value) return
          isNearViewport.value = visible
          if (visible) scheduleFullImageLoad()
        },
      )
    }
  }
})

onBeforeUnmount(() => {
  destroyed = true
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (cleanupVisibility) cleanupVisibility()
  cleanupVisibility = null
})

function maybeUpdateDimsFromImage(el: HTMLImageElement | null) {
  if (!el) return
  const w = el.naturalWidth || 0
  const h = el.naturalHeight || 0
  if (!w || !h) return

  // If backend metadata is missing/zero (common for GIFs), use the real dimensions
  // so aspect-ratio matches and we don't get giant letterboxing.
  const current = lockedDims.value
  if (current.width !== w || current.height !== h) {
    lockedDims.value = { width: w, height: h }
  }
}

function onImageLoad(event: Event) {
  maybeUpdateDimsFromImage(event.target as HTMLImageElement | null)
  thumbLoaded.value = true
}

function imageSizeStyle() {
  const width = lockedDims.value.width || 320
  const height = lockedDims.value.height || 320
  return {
    ['--media-target-width' as string]: `${Math.max(180, Math.min(420, width))}px`,
    ['--media-aspect-ratio' as string]: `${width} / ${height}`,
  }
}

function videoSizeStyle() {
  const width = lockedDims.value.width || 320
  const height = lockedDims.value.height || 180
  return {
    ['--media-target-width' as string]: `${Math.max(180, Math.min(420, width))}px`,
    ['--media-aspect-ratio' as string]: `${width} / ${height}`,
  }
}
</script>

<template>
  <button
    v-if="attachment.kind === 'image'"
    type="button"
    class="media-image-wrap"
    :class="{ 'is-preview': isPreviewMode }"
    :style="imageSizeStyle()"
    :disabled="!attachment.url"
    @click="attachment.url && emit('openImage', attachment.url)"
    ref="rootEl"
  >
    <div class="media-skeleton" :class="{ loaded: thumbLoaded }" aria-hidden="true" />
    <template v-if="imageSrc && isNearViewport">
      <img
        :src="imageSrc"
        :class="['media-image', { loaded: thumbLoaded, 'is-preview': !fullLoaded && Boolean(attachment.previewUrl) }]"
        :alt="attachment.filename || 'image'"
        loading="lazy"
        decoding="async"
        @load="onImageLoad"
      />
      <span v-if="isPreviewMode" class="media-progress" aria-hidden="true" />
    </template>
  </button>

  <VideoPlayer
    v-else-if="attachment.kind === 'video' && attachment.url"
    :attachment-i-d="attachment.id"
    :src="attachment.url"
    :poster="attachment.previewUrl"
    :duration-ms="attachment.durationMs"
    :width="attachment.width"
    :height="attachment.height"
    :caption="attachment.filename"
    :filename="attachment.filename"
    :prevent-live-preview-start="mediaOverlayOpen"
    @open="emit('openVideo', $event)"
  />

  <div v-else-if="attachment.kind === 'video'" class="media-video-placeholder" :style="videoSizeStyle()">
    <span class="media-placeholder-label">{{ attachment.filename || 'video' }}</span>
  </div>

  <AudioPlayer v-else-if="attachment.kind === 'audio'" :src="attachment.url" :poster="attachment.previewUrl" :pending="!attachment.url" />

  <a v-else-if="attachment.url" class="file-link" :href="attachment.url" target="_blank" rel="noreferrer">
    {{ attachment.filename || 'file' }}
  </a>

  <div v-else class="file-link file-placeholder">
    {{ attachment.filename || 'file' }}
  </div>
</template>

<style scoped>
.media-image-wrap {
  position: relative;
  display: block;
  width: var(--media-target-width);
  aspect-ratio: var(--media-aspect-ratio);
  content-visibility: auto;
  contain: layout paint size;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  overflow: hidden;
  cursor: pointer;
}

.media-image-wrap.is-preview::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 100% at 70% 12%, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 52%),
    linear-gradient(180deg, rgba(10, 14, 20, 0.22), rgba(10, 14, 20, 0.34));
  opacity: 0.9;
}

.media-image-wrap:disabled {
  cursor: default;
}

.media-skeleton {
  position: absolute;
  inset: 0;
  background: rgba(148, 163, 184, 0.12);
  overflow: hidden;
}

html[data-theme='dark'] .media-skeleton {
  background: rgba(255, 255, 255, 0.06);
}

.media-skeleton::before {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-120%);
  will-change: transform;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.24) 44%,
    transparent 100%
  );
  animation: mmSweep 1100ms ease-in-out infinite;
}

html[data-theme='light'] .media-skeleton::before {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 0, 0, 0.18) 44%,
    transparent 100%
  );
}

.media-skeleton.loaded {
  opacity: 0;
  animation: none;
}

.media-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  border-radius: 0;
  opacity: 0;
  transition: opacity 160ms ease;
}

.media-image.loaded {
  opacity: 1;
}

.media-image.is-preview {
  filter: blur(16px) saturate(1.12) contrast(1.06);
  transform: scale(1.06);
  opacity: 0.92;
}

.media-progress {
  position: absolute;
  right: 10px;
  top: 10px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: rgba(255, 255, 255, 0.95);
  animation: mediaSpin 780ms linear infinite;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
  pointer-events: none;
}

html[data-theme='light'] .media-progress {
  border: 2px solid rgba(0, 0, 0, 0.18);
  border-top-color: rgba(0, 0, 0, 0.72);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.12);
}

@keyframes mediaSpin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes mmSweep {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(120%); }
}

.media-placeholder,
.media-video-placeholder {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--media-target-width);
  aspect-ratio: var(--media-aspect-ratio);
  min-height: 120px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  overflow: hidden;
}

.media-placeholder-label {
  max-width: calc(100% - 24px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted);
}

.file-link {
  color: inherit;
  text-decoration: underline;
}

.file-placeholder {
  display: inline-block;
  min-width: 140px;
}
</style>
