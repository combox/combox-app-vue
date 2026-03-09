<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AudioPlayer from './AudioPlayer.vue'
import type { ResolvedAttachment } from './chatTypes'
import VideoPlayer from './VideoPlayer.vue'

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
let io: IntersectionObserver | null = null
const isNearViewport = ref(false)

const isGif = computed(() => {
  const type = (props.attachment.mimeType || '').toLowerCase()
  const name = (props.attachment.filename || '').toLowerCase()
  const url = (props.attachment.url || '').toLowerCase()
  return type.includes('gif') || name.endsWith('.gif') || url.includes('.gif')
})

const pageVisible = ref(document.visibilityState === 'visible')

const shouldFreezeAnimatedMedia = computed(() => isGif.value && (props.mediaOverlayOpen || !pageVisible.value))

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
    io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        const near = Boolean(entry && entry.isIntersecting)
        if (near === isNearViewport.value) return
        isNearViewport.value = near
        if (near) scheduleFullImageLoad()
      },
      { root: null, rootMargin: '600px 0px', threshold: 0.01 },
    )
    if (rootEl.value) io.observe(rootEl.value)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (io) {
    io.disconnect()
    io = null
  }
})

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
    :style="imageSizeStyle()"
    :disabled="!attachment.url"
    @click="attachment.url && emit('openImage', attachment.url)"
    ref="rootEl"
  >
    <template v-if="imageSrc">
      <img
        :src="imageSrc"
        :class="['media-image', { 'is-preview': !fullLoaded && Boolean(attachment.previewUrl) }]"
        :alt="attachment.filename || 'image'"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
      />
      <span v-if="!fullLoaded && Boolean(attachment.previewUrl)" class="media-image-blur" aria-hidden="true" />
    </template>
    <div v-else class="media-placeholder">
      <span class="media-placeholder-label">{{ attachment.filename || 'image' }}</span>
    </div>
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
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: #e6e6e6;
  overflow: hidden;
  cursor: pointer;
}

.media-image-wrap:disabled {
  cursor: default;
}

.media-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 0;
}

.media-image.is-preview {
  filter: blur(0.4px);
  transform: scale(1.01);
}

.media-image-blur {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
}

.media-placeholder,
.media-video-placeholder {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--media-target-width);
  aspect-ratio: var(--media-aspect-ratio);
  min-height: 120px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background:
    linear-gradient(135deg, rgba(0, 0, 0, 0.04), rgba(0, 0, 0, 0.08)),
    #ececec;
  overflow: hidden;
}

.media-placeholder-label {
  max-width: calc(100% - 24px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.58);
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
