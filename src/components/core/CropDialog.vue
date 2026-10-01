<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'

// Strict avatar-crop contract (shared with MyAccountSettings + AuthFlow):
//   props: { open: boolean; src: string }
//   emits: confirm(blob: Blob) with a SQUARE blob, cancel().
// The preview is DOM + CSS transforms (drag/zoom/rotate); the export is
// canvas-based (no new dependencies): the same transform is replayed on a
// square canvas so the confirmed Blob is exactly what the circle showed.
const props = defineProps<{
  open: boolean
  src: string
}>()

const emit = defineEmits<{
  confirm: [blob: Blob]
  cancel: []
}>()

const { t, locale } = useI18n()
const isRu = computed(() => locale.value === 'ru')

const titleText = computed(() => t('crop.title', undefined, isRu.value ? 'Новое фото' : 'New photo'))
const hintText = computed(() =>
  t(
    'crop.hint',
    undefined,
    isRu.value ? 'Перетащите фото, масштаб — колесом или слайдером' : 'Drag to position, scroll or slider to zoom',
  ),
)
const cancelText = computed(() => t('crop.cancel', undefined, isRu.value ? 'Отмена' : 'Cancel'))
const rotateText = computed(() => t('crop.rotate', undefined, isRu.value ? 'Повернуть' : 'Rotate'))
const setPhotoText = computed(() => t('crop.set_photo', undefined, isRu.value ? 'Установить фото' : 'Set photo'))
const zoomText = computed(() => t('crop.zoom', undefined, isRu.value ? 'Масштаб' : 'Zoom'))

const ZOOM_MIN = 1
const ZOOM_MAX = 3
const OUTPUT_PX = 512

const viewportRef = ref<HTMLDivElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

const boxPx = ref(0)
const imgW = ref(0)
const imgH = ref(0)
const imgLoaded = ref(false)
const zoom = ref(1)
const rotation = ref(0)
const tx = ref(0)
const ty = ref(0)
const busy = ref(false)

let dragging = false
let lastX = 0
let lastY = 0
let resizeBound = false

// Cover scale so the inscribed circle is always filled at zoom=1.
// Symmetric in w/h, so it stays valid after 90°/270° rotation.
const baseScale = computed(() => {
  if (!imgLoaded.value || imgW.value <= 0 || imgH.value <= 0 || boxPx.value <= 0) return 1
  return Math.max(boxPx.value / imgW.value, boxPx.value / imgH.value)
})

const scaleScreen = computed(() => baseScale.value * zoom.value)

const imgStyle = computed(() => {
  if (!imgLoaded.value) return { visibility: 'hidden' } as const
  const w = Math.max(1, Math.round(imgW.value * scaleScreen.value))
  const h = Math.max(1, Math.round(imgH.value * scaleScreen.value))
  return {
    width: `${w}px`,
    height: `${h}px`,
    transform: `translate(${tx.value}px, ${ty.value}px) rotate(${rotation.value}deg)`,
  } as const
})

const canConfirm = computed(() => props.open && imgLoaded.value && !busy.value && !!props.src)

function measure(): void {
  const el = viewportRef.value
  if (!el) return
  const w = Math.round(el.clientWidth || 0)
  if (w > 0) boxPx.value = w
}

function onWindowResize(): void {
  if (!props.open) return
  measure()
  clampPan()
}

// Displayed (axis-aligned bounding) size after rotation: 90°/270° swaps w/h.
function displayedSize(): { dw: number; dh: number } {
  const s = scaleScreen.value
  if (rotation.value % 180 !== 0) return { dw: imgH.value * s, dh: imgW.value * s }
  return { dw: imgW.value * s, dh: imgH.value * s }
}

function clampPan(): void {
  if (!imgLoaded.value || boxPx.value <= 0) return
  const { dw, dh } = displayedSize()
  const maxTx = Math.max(0, (dw - boxPx.value) / 2)
  const maxTy = Math.max(0, (dh - boxPx.value) / 2)
  if (tx.value > maxTx) tx.value = maxTx
  if (tx.value < -maxTx) tx.value = -maxTx
  if (ty.value > maxTy) ty.value = maxTy
  if (ty.value < -maxTy) ty.value = -maxTy
}

function resetState(): void {
  zoom.value = 1
  rotation.value = 0
  tx.value = 0
  ty.value = 0
  busy.value = false
  dragging = false
  imgLoaded.value = false
  imgW.value = 0
  imgH.value = 0
}

function onImgLoad(event: Event): void {
  const el = event.target as HTMLImageElement | null
  const w = el?.naturalWidth || 0
  const h = el?.naturalHeight || 0
  if (!w || !h) {
    imgLoaded.value = false
    return
  }
  imgW.value = w
  imgH.value = h
  imgLoaded.value = true
  measure()
  clampPan()
}

function onImgError(): void {
  imgLoaded.value = false
}

function setZoom(next: number): void {
  if (!imgLoaded.value) return
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next))
  zoom.value = clamped
  clampPan()
}

function onSliderInput(event: Event): void {
  const el = event.target as HTMLInputElement | null
  if (!el) return
  setZoom(Number.parseFloat(el.value || '1'))
}

function onWheel(event: WheelEvent): void {
  if (!imgLoaded.value || busy.value) return
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  setZoom(zoom.value * factor)
}

function rotatePhoto(): void {
  if (!imgLoaded.value || busy.value) return
  rotation.value = (rotation.value + 90) % 360
  clampPan()
}

function onPointerDown(event: PointerEvent): void {
  if (!imgLoaded.value || busy.value) return
  if (event.button !== 0 && event.pointerType === 'mouse') return
  dragging = true
  lastX = event.clientX
  lastY = event.clientY
  try {
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  } catch {
    // setPointerCapture is best-effort; drag still works via move/up.
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging || !imgLoaded.value || busy.value) return
  tx.value += event.clientX - lastX
  ty.value += event.clientY - lastY
  lastX = event.clientX
  lastY = event.clientY
  clampPan()
}

function endDrag(): void {
  dragging = false
}

function onCancel(): void {
  if (busy.value) return
  emit('cancel')
}

function onConfirm(): void {
  const source = imgRef.value
  if (!canConfirm.value || !source || !imgLoaded.value) return
  busy.value = true
  try {
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_PX
    canvas.height = OUTPUT_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      busy.value = false
      return
    }
    // Replay the preview transform at export resolution. Preview centers the
    // image at (boxCenter + tx/ty) with width/height = natural * scaleScreen
    // rotated around its center; k maps preview px -> output px.
    const k = boxPx.value > 0 ? OUTPUT_PX / boxPx.value : 1
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, OUTPUT_PX, OUTPUT_PX)
    ctx.translate(OUTPUT_PX / 2 + tx.value * k, OUTPUT_PX / 2 + ty.value * k)
    ctx.rotate((rotation.value * Math.PI) / 180)
    const outScale = scaleScreen.value * k
    ctx.scale(outScale, outScale)
    ctx.drawImage(source, -imgW.value / 2, -imgH.value / 2, imgW.value, imgH.value)
    canvas.toBlob(
      (blob) => {
        busy.value = false
        if (blob) emit('confirm', blob)
      },
      'image/png',
    )
  } catch {
    busy.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') onCancel()
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetState()
      window.addEventListener('keydown', onKeydown)
      if (!resizeBound) {
        window.addEventListener('resize', onWindowResize)
        resizeBound = true
      }
      void nextTick(() => {
        measure()
        clampPan()
      })
    } else {
      window.removeEventListener('keydown', onKeydown)
      dragging = false
      busy.value = false
    }
  },
  { immediate: true },
)

watch(
  () => props.src,
  () => {
    if (!props.open) return
    resetState()
    void nextTick(() => {
      measure()
    })
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  if (resizeBound) window.removeEventListener('resize', onWindowResize)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cropOverlay" @click.self="onCancel">
      <div class="cropDialog" role="dialog" aria-modal="true" :aria-label="titleText">
        <div class="cropTitle">{{ titleText }}</div>
        <div class="cropHint">{{ hintText }}</div>

        <div
          ref="viewportRef"
          class="cropViewport"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @pointerleave="endDrag"
          @wheel.prevent="onWheel"
        >
          <img
            v-if="src"
            ref="imgRef"
            :src="src"
            alt=""
            class="cropImg"
            :style="imgStyle"
            draggable="false"
            @load="onImgLoad"
            @error="onImgError"
          />
          <div class="cropShade" aria-hidden="true">
            <div class="cropCircle" />
          </div>
          <span class="cropCorner tl" aria-hidden="true" />
          <span class="cropCorner tr" aria-hidden="true" />
          <span class="cropCorner bl" aria-hidden="true" />
          <span class="cropCorner br" aria-hidden="true" />
        </div>

        <label class="cropZoomRow">
          <span class="cropZoomLabel">{{ zoomText }}</span>
          <input
            type="range"
            class="cropZoom"
            :min="ZOOM_MIN"
            :max="ZOOM_MAX"
            step="0.01"
            :value="zoom"
            :disabled="!imgLoaded || busy"
            :aria-label="zoomText"
            @input="onSliderInput"
          />
        </label>

        <div class="cropActions">
          <button type="button" class="cropBtn cropCancel" :disabled="busy" @click="onCancel">
            {{ cancelText }}
          </button>
          <button
            type="button"
            class="cropBtn cropRotate"
            :disabled="!imgLoaded || busy"
            :aria-label="rotateText"
            :title="rotateText"
            @click="rotatePhoto"
          >
            <v-icon icon="mdi-rotate-right" size="18" />
          </button>
          <button type="button" class="cropBtn cropPrimary" :disabled="!canConfirm" @click="onConfirm">
            {{ setPhotoText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cropOverlay {
  position: fixed;
  inset: 0;
  z-index: 9700;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(6, 8, 13, 0.66);
}

.cropDialog {
  width: min(420px, 100%);
  padding: 16px;
  border-radius: 16px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  color: var(--text);
}

.cropTitle {
  font-size: 15px;
  font-weight: 800;
}

.cropHint {
  margin-top: 4px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-muted);
}

.cropViewport {
  position: relative;
  width: min(320px, 76vw, 44dvh);
  aspect-ratio: 1;
  margin: 12px auto 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 12px;
  background: #000;
  touch-action: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}

.cropViewport:active {
  cursor: grabbing;
}

.cropImg {
  display: block;
  max-width: none;
  max-height: none;
  transform-origin: center;
  pointer-events: none;
}

.cropShade {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.cropCircle {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.62);
}

.cropCorner {
  position: absolute;
  width: 22px;
  height: 22px;
  border: 0 solid #fff;
  pointer-events: none;
}

.cropCorner.tl {
  top: 8px;
  left: 8px;
  border-top-width: 3px;
  border-left-width: 3px;
  border-top-left-radius: 6px;
}

.cropCorner.tr {
  top: 8px;
  right: 8px;
  border-top-width: 3px;
  border-right-width: 3px;
  border-top-right-radius: 6px;
}

.cropCorner.bl {
  bottom: 8px;
  left: 8px;
  border-bottom-width: 3px;
  border-left-width: 3px;
  border-bottom-left-radius: 6px;
}

.cropCorner.br {
  bottom: 8px;
  right: 8px;
  border-bottom-width: 3px;
  border-right-width: 3px;
  border-bottom-right-radius: 6px;
}

.cropZoomRow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.cropZoomLabel {
  flex: 0 0 auto;
  font-size: 12.5px;
  color: var(--text-muted);
}

.cropZoom {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--accent);
}

.cropActions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
}

.cropBtn {
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}

.cropBtn:disabled {
  opacity: 0.45;
  cursor: default;
}

.cropBtn:focus-visible,
.cropZoom:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 2px;
}

.cropCancel {
  background: var(--surface-soft);
  color: var(--text);
}

.cropRotate {
  width: 38px;
  padding: 0;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--text);
}

.cropPrimary {
  background: var(--accent);
  color: #fff;
}
</style>
