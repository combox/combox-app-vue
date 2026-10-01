<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  stream: MediaStream | null
  kind: 'video' | 'audio'
  objectFit?: 'cover' | 'contain'
}>()

const element = ref<HTMLVideoElement | HTMLAudioElement | null>(null)

// play() rejects while the element is still settling (fresh srcObject) and
// whenever the autoplay policy says no; swallowing that once used to leave a
// permanent black rectangle until the next stream change. Retry instead.
let retryTimer: number | null = null
let stamp = 0

function stopRetries(): void {
  if (retryTimer !== null) window.clearTimeout(retryTimer)
  retryTimer = null
  stamp += 1
}

function schedulePlay(target: HTMLVideoElement | HTMLAudioElement, delay: number, token: number): void {
  if (token !== stamp) return
  retryTimer = window.setTimeout(() => {
    if (token !== stamp) return
    void target.play().catch(() => schedulePlay(target, Math.min(delay * 2, 2000), token))
  }, delay)
}

async function attach(target: HTMLVideoElement | HTMLAudioElement | null, stream: MediaStream | null): Promise<void> {
  if (!target) return
  stopRetries()
  if (target.srcObject !== stream) target.srcObject = stream
  if (!stream) return
  const token = stamp
  try {
    await target.play()
  } catch {
    if (token === stamp) schedulePlay(target, 200, token)
  }
}

watch(
  () => [props.stream, element.value] as const,
  ([stream, target]) => {
    void attach(target, stream)
  },
  { immediate: true },
)

onBeforeUnmount(stopRetries)
</script>

<template>
  <!-- Always muted: the audio of a stream is played by the dedicated <audio>
       element next to it, and an unmuted <video> is exactly what the browser
       refuses to autoplay (black tile until some click unlocks playback). -->
  <video
    v-if="kind === 'video'"
    ref="element"
    class="streamEl"
    autoplay
    playsinline
    muted
    :style="{ objectFit: objectFit ?? 'cover' }"
  />
  <audio v-else ref="element" class="streamAudio" autoplay />
</template>

<style scoped>
.streamEl {
  width: 100%;
  height: 100%;
  display: block;
  background: #0b0d12;
  border-radius: inherit;
}

.streamAudio {
  display: none;
}
</style>
