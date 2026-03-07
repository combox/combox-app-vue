<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  src: string
}>()

const emit = defineEmits<{
  close: []
}>()

const MIN_SCALE = 0.5
const MAX_SCALE = 5
const SCALE_STEP = 0.2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const scale = ref(1)
const rotation = ref(0)
const offset = ref({ x: 0, y: 0 })
const dragging = ref(false)
const dragState = ref({ startX: 0, startY: 0, originX: 0, originY: 0 })
const openedAt = ref(0)

const cursorStyle = computed(() => {
  if (scale.value <= 1) return 'zoom-in'
  return dragging.value ? 'grabbing' : 'grab'
})

function resetView() {
  scale.value = 1
  rotation.value = 0
  offset.value = { x: 0, y: 0 }
}

function zoomTo(next: number) {
  scale.value = clamp(next, MIN_SCALE, MAX_SCALE)
  if (scale.value <= 1) offset.value = { x: 0, y: 0 }
}

function rotateRight() {
  rotation.value = (rotation.value + 90) % 360
}

function closeIfAllowed() {
  if (performance.now() - openedAt.value < 220) return
  emit('close')
}

function handleBackgroundClick(event: MouseEvent) {
  if (event.target !== event.currentTarget) return
  closeIfAllowed()
}

function handleStageClick(event: MouseEvent) {
  if (event.target !== event.currentTarget) return
  closeIfAllowed()
}

function handleWheel(event: WheelEvent) {
  event.preventDefault()
  const direction = event.deltaY > 0 ? -1 : 1
  zoomTo(scale.value + direction * SCALE_STEP)
}

function handleDoubleClick() {
  if (scale.value === 1) zoomTo(2)
  else resetView()
}

function handleMouseDown(event: MouseEvent) {
  if (scale.value <= 1) return
  dragging.value = true
  dragState.value = {
    startX: event.clientX,
    startY: event.clientY,
    originX: offset.value.x,
    originY: offset.value.y,
  }
}

function handleMouseMove(event: MouseEvent) {
  if (!dragging.value) return
  const dx = event.clientX - dragState.value.startX
  const dy = event.clientY - dragState.value.startY
  offset.value = { x: dragState.value.originX + dx, y: dragState.value.originY + dy }
}

function stopDrag() {
  dragging.value = false
}

function download() {
  const url = (props.src || '').trim()
  if (!url) return
  const name = (() => {
    try {
      const parsed = new URL(url)
      return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'image')
    } catch {
      return 'image'
    }
  })()

  const trigger = (href: string) => {
    const link = document.createElement('a')
    link.href = href
    link.download = name
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  void fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error('download_failed')
      return response.blob()
    })
    .then((blob) => {
      const objectURL = URL.createObjectURL(blob)
      trigger(objectURL)
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
    })
    .catch(() => {
      trigger(url)
    })
}

watch(
  () => [props.open, props.src] as const,
  ([open]) => {
    if (!open) return
    openedAt.value = performance.now()
    resetView()
  },
)

onBeforeUnmount(() => {
  stopDrag()
})
</script>

<template>
  <v-dialog :model-value="open" max-width="1400" fullscreen scrim="black" @update:model-value="(v) => (!v ? emit('close') : undefined)">
    <div class="pvRoot" @click="handleBackgroundClick" @wheel.passive="false" @wheel="handleWheel" @mousemove="handleMouseMove" @mouseup="stopDrag" @mouseleave="stopDrag">
      <div class="pvToolbar">
        <v-btn icon variant="text" color="white" size="small" @click="zoomTo(scale - SCALE_STEP)">
          <v-icon icon="mdi-magnify-minus-outline" />
        </v-btn>
        <v-btn icon variant="text" color="white" size="small" @click="resetView">
          <v-icon icon="mdi-restart" />
        </v-btn>
        <v-btn icon variant="text" color="white" size="small" @click="zoomTo(scale + SCALE_STEP)">
          <v-icon icon="mdi-magnify-plus-outline" />
        </v-btn>
        <v-btn icon variant="text" color="white" size="small" @click="rotateRight">
          <v-icon icon="mdi-rotate-right" />
        </v-btn>
        <v-btn icon variant="text" color="white" size="small" @click="download">
          <v-icon icon="mdi-download" />
        </v-btn>
        <v-btn icon variant="text" color="white" size="small" @click="emit('close')">
          <v-icon icon="mdi-close" />
        </v-btn>
      </div>

      <div class="pvStage" @dblclick="handleDoubleClick" @click="handleStageClick">
        <img
          v-if="src"
          :src="src"
          alt=""
          class="pvImage"
          draggable="false"
          @mousedown.prevent="handleMouseDown"
          @click.stop
          :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`, cursor: cursorStyle }"
        />
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.pvRoot {
  height: 100%;
  width: 100%;
  background: rgba(0, 0, 0, 0.9);
  position: relative;
}

.pvStage {
  height: 100%;
  width: 100%;
  display: grid;
  place-items: center;
}

.pvImage {
  max-width: 95vw;
  max-height: 92vh;
  object-fit: contain;
}

.pvToolbar {
  position: absolute;
  top: 8px;
  right: 10px;
  display: flex;
  gap: 6px;
  align-items: center;
  z-index: 2;
}
</style>
