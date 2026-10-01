<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getCurrentUser } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { avatarColorFor } from '../../utils/avatarColor'
import StreamMediaElement from './StreamMediaElement.vue'
import { activeCall, callIdentity, callLive, callMedia, callNote, callParticipants, callStatus, hangup, remoteStreams, restoreCall } from './callSession'

const props = defineProps<{
  title: string
  avatarText?: string
  avatarSrc?: string
}>()

const emit = defineEmits<{
  restore: []
}>()

const { t } = useI18n()

// Frozen call identity wins over props (fed from the current chat):
// switching chats mid-call must not rename the bar.
const displayTitle = computed(() => callIdentity.value?.title || props.title || t('call.title', undefined, 'Call'))
const displayAvatarText = computed(
  () => callIdentity.value?.avatarText || props.avatarText || (displayTitle.value || 'C').slice(0, 1).toUpperCase(),
)
const displayAvatarSrc = computed(() => callIdentity.value?.avatarSrc || props.avatarSrc || '')

const elapsedSeconds = ref(0)
let timer: number | null = null
let startedAt = 0

const currentUserID = getCurrentUser()?.id ?? ''
const hasRemote = computed(() => callParticipants.value.some((participant) => participant.user_id !== currentUserID))
// The bar counts the answered call only; while ringing it says so instead.
const answered = computed(() => callStatus.value === 'active' && hasRemote.value)

watch(
  answered,
  (value) => {
    if (value && timer === null) {
      startedAt = Date.now()
      timer = window.setInterval(() => {
        elapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000)
      }, 1000)
    }
    if (!value && timer !== null) {
      window.clearInterval(timer)
      timer = null
      elapsedSeconds.value = 0
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
  timer = null
})

const statusLabel = computed(() => {
  if (callNote.value === 'no_answer') return t('call.no_answer', undefined, 'No answer')
  if (callNote.value === 'declined') return t('call.declined', undefined, 'Call declined')
  if (callNote.value === 'ended') return t('call.ended_note', undefined, 'Call ended')
  if (callStatus.value !== 'active') return t('call.connecting', undefined, 'Connecting…')
  if (!answered.value) {
    return activeCall.value?.kind === 'broadcast' || callLive.value
      ? t('call.waiting_peers', undefined, 'Waiting for participants…')
      : t('call.calling', undefined, 'Calling…')
  }
  const total = elapsedSeconds.value
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})

// A shared screen keeps playing in the collapsed bar as a small preview.
const screenStream = computed<MediaStream | null>(() => {
  for (const [userID, entry] of Object.entries(remoteStreams.value)) {
    if (userID === '') continue
    const stream = entry.screen
    if (!stream) continue
    if (stream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted)) return stream
  }
  return null
})

const micOn = computed(() => callMedia.value.mic)
const participantCount = computed(() => callParticipants.value.length)

function onRestore() {
  emit('restore')
  restoreCall()
}
</script>

<template>
  <div class="miniBar" role="status">
    <button type="button" class="miniAvatarBtn" :aria-label="t('call.restore', undefined, 'Restore call')" @click="onRestore">
      <img v-if="displayAvatarSrc" class="miniAvatarImg" :src="displayAvatarSrc" alt="" />
      <div v-else class="miniAvatarFallback" :style="{ background: avatarColorFor(displayTitle) }">{{ displayAvatarText || '?' }}</div>
    </button>

    <button type="button" class="miniMeta" :aria-label="t('call.restore', undefined, 'Restore call')" @click="onRestore">
      <span class="miniTitle">{{ displayTitle }}</span>
      <span class="miniSub">
        <v-icon :icon="micOn ? 'mdi-microphone' : 'mdi-microphone-off'" size="12" />
        {{ statusLabel }} · {{ participantCount }}
      </span>
    </button>

    <button
      v-if="screenStream"
      type="button"
      class="miniPreview"
      :aria-label="t('call.restore', undefined, 'Restore call')"
      title="Screen"
      @click="onRestore"
    >
      <StreamMediaElement :stream="screenStream" kind="video" object-fit="cover" />
    </button>

    <button
      type="button"
      class="miniBtn expand"
      :aria-label="t('call.restore', undefined, 'Restore call')"
      :title="t('call.restore', undefined, 'Restore call')"
      @click="onRestore"
    >
      <v-icon icon="mdi-window-maximize" size="18" />
    </button>
    <button
      type="button"
      class="miniBtn hangup"
      :aria-label="t('call.hangup', undefined, 'Hang up')"
      :title="t('call.hangup', undefined, 'Hang up')"
      @click="hangup()"
    >
      <v-icon icon="mdi-phone-hangup" size="18" />
    </button>
  </div>
</template>

<style scoped>
.miniBar {
  position: fixed;
  /* Below the sticky conversation header (63px + margins): the bar must never
     cover the chat title it would otherwise be renamed after. */
  top: 74px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 87;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 999px;
  background: rgba(12, 15, 22, 0.94);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}

.miniAvatarBtn {
  width: 34px;
  height: 34px;
  border: 0;
  padding: 0;
  border-radius: 50%;
  overflow: hidden;
  background: transparent;
  cursor: pointer;
  flex: 0 0 auto;
}

.miniAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.miniAvatarFallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--avatar-fallback, #3b4252);
  color: #fff;
  font-size: 14px;
  font-weight: 800;
}

.miniMeta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
  min-width: 0;
  max-width: 220px;
}

.miniTitle {
  font-size: 13px;
  font-weight: 800;
  color: #e8ecf5;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.miniSub {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #9aa4b8;
  font-variant-numeric: tabular-nums;
}

.miniPreview {
  width: 76px;
  height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  overflow: hidden;
  padding: 0;
  background: #000;
  cursor: pointer;
}

.miniBtn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.08);
  color: #e8ecf5;
}

.miniBtn:hover {
  background: rgba(255, 255, 255, 0.16);
}

.miniBtn.hangup {
  background: #e0465a;
  color: #fff;
}
</style>
