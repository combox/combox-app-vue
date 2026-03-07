<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  src: string
  poster?: string
  pending?: boolean
}>()

const audioRef = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const duration = ref(0)
const time = ref(0)

const progress = computed(() => (duration.value > 0 ? (time.value / duration.value) * 100 : 0))

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const min = Math.floor(sec / 60)
  const rest = Math.floor(sec % 60)
  return `${String(min).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function togglePlayback() {
  const node = audioRef.value
  if (!node || props.pending || !props.src) return
  if (node.paused) {
    void node.play()
    playing.value = true
  } else {
    node.pause()
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
</script>

<template>
  <div class="audioPlayer">
    <audio
      v-if="props.src"
      ref="audioRef"
      :src="props.src"
      preload="metadata"
      @loadedmetadata="(event) => (duration = (event.target as HTMLAudioElement).duration || 0)"
      @timeupdate="(event) => (time = (event.target as HTMLAudioElement).currentTime || 0)"
      @ended="playing = false"
    />
    <button type="button" class="audioToggle" :disabled="props.pending || !props.src" @click="togglePlayback">
      <v-icon :icon="playing ? 'mdi-pause' : 'mdi-play'" size="18" />
    </button>
    <div class="audioCoverWrap">
      <img v-if="poster" class="audioCover" :src="poster" alt="audio preview" />
      <div v-else class="audioCover audioCoverPlaceholder" />
    </div>
    <div class="audioLine" :class="{ pending: props.pending || !props.src }" @click="seek">
      <div class="audioLineValue" :style="{ width: `${progress}%` }" />
    </div>
    <div class="audioTime">{{ props.pending || !props.src ? '--:-- / --:--' : `${formatTime(time)} / ${formatTime(duration)}` }}</div>
  </div>
</template>

<style scoped>
.audioPlayer {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 8px;
  min-width: 260px;
  min-height: 36px;
}

.audioToggle {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  cursor: pointer;
}

.audioToggle:disabled {
  opacity: 0.5;
  cursor: default;
}

.audioCoverWrap {
  width: 36px;
  height: 36px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.audioCover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.audioCoverPlaceholder {
  background: #e0e0e0;
}

.audioLine {
  position: relative;
  height: 6px;
  background: rgba(0, 0, 0, 0.12);
  cursor: pointer;
}

.audioLine.pending {
  cursor: default;
}

.audioLineValue {
  position: absolute;
  inset: 0 auto 0 0;
  background: #1e88e5;
}

.audioTime {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
}
</style>
