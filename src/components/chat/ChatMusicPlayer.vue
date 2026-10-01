<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import {
  closePlayer,
  closeQueueList,
  cycleRate,
  cycleRepeat,
  formatPlayerTime,
  next,
  openQueueList,
  prev,
  seek,
  setVolume,
  syncQueue,
  toggle,
  toggleMute,
  toggleShuffle,
  useChatPlayback,
  type ChatAudioTrack,
} from '../../composables/useChatPlayback'

const props = defineProps<{ tracks: ChatAudioTrack[] }>()

const { t } = useI18n()
const toast = useToast()
const { state, activate } = useChatPlayback()

watch(
  () => props.tracks,
  (list) => syncQueue(list || []),
  { deep: false },
)

onMounted(() => {
  syncQueue(props.tracks || [])
})

function formatDuration(track: ChatAudioTrack): string {
  if (track.durationMs > 0) return formatPlayerTime(track.durationMs / 1000)
  return '--:--'
}

function currentTimeLabel(): string {
  return formatPlayerTime(state.time)
}

function currentDurationLabel(): string {
  return formatPlayerTime(state.duration > 0 ? state.duration : state.queue.find((item) => item.id === state.currentId)?.durationMs / 1000 || 0)
}

function onSeekClick(event: MouseEvent) {
  const line = event.currentTarget as HTMLDivElement | null
  if (!line) return
  const rect = line.getBoundingClientRect()
  const ratio = (event.clientX - rect.left) / rect.width
  seek(ratio * state.duration)
}

function onVolumeInput(event: Event) {
  setVolume(Number((event.target as HTMLInputElement).value || 0) / 100)
}

async function playTrack(track: ChatAudioTrack) {
  if (track.id === state.currentId) {
    toggle()
    return
  }
  const started = await activate(track)
  if (!started) toast.error(t('player.play_failed', undefined, 'Could not play this track'))
}

function toggleQueue() {
  if (state.listOpen) closeQueueList()
  else openQueueList()
}

const rateLabel = (): string => {
  const value = state.rate
  return Number.isInteger(value) ? `${value}x` : `${value}x`
}
</script>

<template>
  <div v-if="state.visible" class="chatPlayer" @mouseleave="closeQueueList">
    <div class="chatPlayerBar">
      <div class="chatPlayerControls">
        <button type="button" class="chatPlayerBtn" :aria-label="t('player.previous', undefined, 'Previous')" @click="prev">
          <v-icon icon="mdi-skip-previous" size="20" />
        </button>
        <button type="button" class="chatPlayerBtn chatPlayerBtnPrimary" :aria-label="state.playing ? t('player.pause', undefined, 'Pause') : t('player.play', undefined, 'Play')" @click="toggle">
          <v-icon :icon="state.playing ? 'mdi-pause' : 'mdi-play'" size="24" />
        </button>
        <button type="button" class="chatPlayerBtn" :aria-label="t('player.next', undefined, 'Next')" @click="next">
          <v-icon icon="mdi-skip-next" size="20" />
        </button>
      </div>

      <button
        type="button"
        class="chatPlayerInfo"
        :title="t('player.open_queue', undefined, 'Open queue')"
        @mouseenter="openQueueList"
        @click="toggleQueue"
      >
        <span class="chatPlayerInfoText">
          <span v-if="state.error" class="chatPlayerError">{{ t('player.play_failed_short', undefined, "Can't play the audio") }}</span>
          <template v-else>
            <span class="chatPlayerTitle">{{ state.queue.find((item) => item.id === state.currentId)?.title || t('player.no_track', undefined, 'No track') }}</span>
            <span v-if="state.queue.find((item) => item.id === state.currentId)?.artist" class="chatPlayerArtist">
              {{ state.queue.find((item) => item.id === state.currentId)?.artist }}
            </span>
          </template>
        </span>
        <span class="chatPlayerInfoIcon">
          <v-icon icon="mdi-chevron-down" size="16" />
        </span>
      </button>

      <div class="chatPlayerRight">
        <span class="chatPlayerTimer">
          {{ currentTimeLabel() }} / {{ currentDurationLabel() }}
        </span>
        <input
          class="chatPlayerVolumeInput"
          type="range"
          min="0"
          max="100"
          :value="Math.round(state.volume * 100)"
          :aria-label="t('player.volume', undefined, 'Volume')"
          @input="onVolumeInput"
        />
        <button type="button" class="chatPlayerBtn" :class="{ active: state.muted }" :aria-label="t('player.mute', undefined, 'Mute')" @click="toggleMute">
          <v-icon :icon="state.muted ? 'mdi-volume-off' : 'mdi-volume-high'" size="18" />
        </button>
        <button type="button" class="chatPlayerBtn" :class="{ active: state.shuffle }" :aria-label="t('player.shuffle', undefined, 'Shuffle')" @click="toggleShuffle">
          <v-icon icon="mdi-shuffle" size="18" />
        </button>
        <button type="button" class="chatPlayerBtn" :class="{ active: state.repeat !== 'off' }" :aria-label="t('player.repeat', undefined, 'Repeat')" @click="cycleRepeat">
          <v-icon :icon="state.repeat === 'one' ? 'mdi-repeat-once' : 'mdi-repeat'" size="18" />
        </button>
        <button type="button" class="chatPlayerRate" :title="t('player.speed', undefined, 'Playback speed')" @click="cycleRate">
          {{ rateLabel() }}
        </button>
        <button type="button" class="chatPlayerBtn" :aria-label="t('common.close', undefined, 'Close')" @click="closePlayer">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="chatPlayerProgress" :title="`${currentTimeLabel()} / ${currentDurationLabel()}`" @click="onSeekClick">
        <div class="chatPlayerProgressValue" :style="{ width: state.duration > 0 ? `${Math.min(100, (state.time / state.duration) * 100)}%` : '0%' }" />
      </div>
    </div>

    <transition name="chatPlayerList">
      <div v-show="state.listOpen" class="chatPlayerList">
        <div v-if="state.queue.length === 0" class="chatPlayerListEmpty">
          {{ t('player.empty_queue', undefined, 'No tracks in this chat yet') }}
        </div>
        <button
          v-for="track in state.queue"
          :key="track.id"
          type="button"
          class="chatPlayerListItem"
          :class="{ active: track.id === state.currentId }"
          @click="playTrack(track)"
        >
          <span class="chatPlayerListArt">
            <img v-if="track.poster" class="chatPlayerListArtImg" :src="track.poster" alt="" loading="lazy" />
            <span v-else class="chatPlayerListArtFallback">
              <v-icon icon="mdi-music-note" size="16" />
            </span>
            <span v-if="track.id === state.currentId" class="chatPlayerListArtOverlay">
              <v-icon :icon="state.playing ? 'mdi-pause' : 'mdi-play'" size="20" />
            </span>
          </span>
          <span class="chatPlayerListBody">
            <span class="chatPlayerListTitle">{{ track.title || t('player.unknown_track', undefined, 'Unknown track') }}</span>
            <span v-if="track.artist" class="chatPlayerListArtist">{{ track.artist }}</span>
          </span>
          <span class="chatPlayerListTime">
            {{ track.id === state.currentId ? `${currentTimeLabel()} / ${currentDurationLabel()}` : formatDuration(track) }}
          </span>
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.chatPlayer {
  position: relative;
  z-index: 30;
}

.chatPlayerBar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 52px;
  padding: 0 14px;
  background: var(--surface, rgba(24, 25, 32, 0.98));
  border-bottom: 1px solid var(--border-strong);
}

.chatPlayerControls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.chatPlayerBtn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.chatPlayerBtn:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.chatPlayerBtn.active {
  color: var(--accent);
}

.chatPlayerBtnPrimary {
  width: 38px;
  height: 38px;
  background: var(--accent);
  color: #fff;
}

.chatPlayerBtnPrimary:hover {
  background: var(--accent);
  color: #fff;
  filter: brightness(1.1);
}

.chatPlayerInfo {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  margin: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: inherit;
}

.chatPlayerInfo:hover {
  background: var(--surface-soft);
}

.chatPlayerInfoText {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.chatPlayerTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chatPlayerArtist {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chatPlayerError {
  font-size: 12px;
  color: #ef4444;
}

.chatPlayerInfoIcon {
  display: grid;
  place-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
}

.chatPlayerRight {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.chatPlayerTimer {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.chatPlayerVolumeInput {
  width: 64px;
  accent-color: var(--accent);
  cursor: pointer;
}

.chatPlayerRate {
  min-width: 38px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease;
}

.chatPlayerRate:hover {
  background: var(--surface-soft-hover);
}

.chatPlayerProgress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 4px;
  background: var(--border-strong);
  cursor: pointer;
}

.chatPlayerProgressValue {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent);
  transition: width 100ms linear;
}

.chatPlayerList {
  position: absolute;
  top: 100%;
  right: 10px;
  left: 10px;
  max-height: 320px;
  overflow-y: auto;
  padding: 14px 6px 6px;
  background: var(--surface-strong);
  color: var(--text);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-soft);
  scrollbar-width: thin;
}

.chatPlayerList::-webkit-scrollbar {
  width: 6px;
}

.chatPlayerList::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 999px;
}

.chatPlayerListEmpty {
  padding: 18px 12px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.chatPlayerListItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 8px;
  margin: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.chatPlayerListItem:hover {
  background: var(--surface-soft);
}

.chatPlayerListItem.active {
  background: var(--surface-selected);
}

.chatPlayerListArt {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 9px;
  overflow: hidden;
  flex-shrink: 0;
}

.chatPlayerListArtImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.chatPlayerListArtFallback {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: #fff;
}

.chatPlayerListArtOverlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(9, 13, 22, 0.45);
  color: #fff;
}

.chatPlayerListBody {
  display: grid;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}

.chatPlayerListTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chatPlayerListArtist {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chatPlayerListTime {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex-shrink: 0;
}

.chatPlayerList-enter-active,
.chatPlayerList-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.chatPlayerList-enter-from,
.chatPlayerList-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>