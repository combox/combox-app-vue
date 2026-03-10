<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getSharedMediaLazyQueue } from './mediaLazyQueue'
import { preloadAndDecodeImage } from './mediaPreload'

const props = defineProps<{
  // Full-quality image URL.
  src: string
  // Optional low-quality preview URL shown first, then upgraded to `src`.
  previewSrc?: string
  alt?: string
  imgClass?: string
}>()

const ready = ref(false)
const currentSrc = ref('')
const isPreview = ref(false)
const rootEl = ref<HTMLElement | null>(null)
let cleanup: (() => void) | null = null
const queue = getSharedMediaLazyQueue()
let destroyed = false
let loadSeq = 0

async function prepare() {
  const seq = (loadSeq += 1)
  const full = (props.src || '').trim()
  const preview = (props.previewSrc || '').trim()
  if (!full && !preview) return

  const setReady = () => {
    if (destroyed || seq !== loadSeq) return
    // Batch visibility->ready flip into next frame (smoother in bursts).
    window.requestAnimationFrame(() => {
      if (destroyed || seq !== loadSeq) return
      ready.value = true
    })
  }

  try {
    if (preview && full && preview !== full) {
      // 1) Show a decoded low-quality preview ASAP.
      await preloadAndDecodeImage(preview)
      if (destroyed || seq !== loadSeq) return
      currentSrc.value = preview
      isPreview.value = true
      setReady()

      // 2) Upgrade to full quality in background.
      await preloadAndDecodeImage(full)
      if (destroyed || seq !== loadSeq) return
      currentSrc.value = full
      isPreview.value = false
      return
    }

    // No preview available: decode full image, then show.
    await preloadAndDecodeImage(full || preview)
    if (destroyed || seq !== loadSeq) return
    currentSrc.value = full || preview
    isPreview.value = false
    setReady()
  } catch {
    // If decoding fails, still try to show something.
    if (destroyed || seq !== loadSeq) return
    currentSrc.value = preview || full
    isPreview.value = Boolean(preview && full && preview !== full)
    setReady()
  }
}

function attach() {
  if (destroyed) return
  if (!rootEl.value) return
  if (cleanup) cleanup()
  ready.value = false
  currentSrc.value = ''
  isPreview.value = false

  cleanup = queue.observe({
    target: rootEl.value,
    load: prepare,
  })
}

onMounted(attach)
watch(() => [props.src, props.previewSrc] as const, attach)

onBeforeUnmount(() => {
  destroyed = true
  if (cleanup) cleanup()
  cleanup = null
})
</script>

<template>
  <span ref="rootEl" class="ldiRoot">
    <span v-if="!ready" class="ldiSkeleton" aria-hidden="true" />
    <img
      v-else
      :src="currentSrc || src"
      :alt="alt || ''"
      :class="['ldiImg', { 'is-preview': isPreview }, imgClass]"
      loading="lazy"
      decoding="async"
    />
  </span>
</template>

<style scoped>
.ldiRoot {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
}

.ldiImg {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  transition: filter 160ms ease, transform 160ms ease;
}

.ldiImg.is-preview {
  filter: blur(14px) saturate(1.12) contrast(1.06);
  transform: scale(1.06);
}

.ldiSkeleton {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.07);
  overflow: hidden;
}

html[data-theme='light'] .ldiSkeleton {
  background: rgba(0, 0, 0, 0.07);
}

.ldiSkeleton::before {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-120%);
  will-change: transform;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.26) 44%,
    transparent 100%
  );
  animation: ldiSweep 1200ms ease-in-out infinite;
}

html[data-theme='light'] .ldiSkeleton::before {
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(0, 0, 0, 0.18) 44%,
    transparent 100%
  );
}

@keyframes ldiSweep {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(120%); }
}
</style>
