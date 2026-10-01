<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { activeCall, callParticipants, callStatus, hangup, isCallBusy, startCall } from '../call/callSession'

const props = defineProps<{
  chatID: string
  title: string
  /** Optional avatar shown on the room badge. */
  avatarSrc?: string
}>()

const emit = defineEmits<{
  openUser: [userID: string]
}>()

const { t } = useI18n()

const inThisRoom = computed(() => {
  const active = activeCall.value
  return Boolean(active && (active.chatID || '').trim() && (active.chatID || '').trim() === (props.chatID || '').trim())
})

const inAnotherCall = computed(() => isCallBusy.value && !inThisRoom.value)

const connectedCount = computed(() => {
  if (!inThisRoom.value) return 0
  const ids = new Set<string>()
  for (const participant of callParticipants.value) {
    const id = (participant.user_id || '').trim()
    if (id) ids.add(id)
  }
  return ids.size
})

const rows = computed(() => {
  if (!inThisRoom.value) return []
  const seen = new Set<string>()
  const out: Array<{ id: string; muted: boolean; speaking: boolean }> = []
  for (const participant of callParticipants.value) {
    const id = (participant.user_id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      muted: participant.media?.mic === false,
      speaking: Boolean(participant.media?.speaking),
    })
  }
  return out
})

const busyLabel = computed(() => {
  const status = callStatus.value
  if (status === 'connecting') return t('call.connecting', undefined, 'Connecting…')
  if (status === 'joining') return t('call.joining', undefined, 'Joining…')
  return ''
})

function joinVoice() {
  if (inAnotherCall.value) return
  // A voice channel is joined as an already-live room (Discord-style), not
  // dialled: `live` only changes client UI/timeout behaviour, the wire kind
  // stays 'group' because the server rejects any other value. The identity
  // is frozen explicitly so the call keeps this room's name.
  const title = (props.title || '').trim() || t('chat.voice_channel', undefined, 'Voice channel')
  void startCall({
    chatID: props.chatID,
    kind: 'group',
    live: true,
    identity: {
      title,
      avatarSrc: props.avatarSrc || '',
      avatarText: (title || 'C').slice(0, 1).toUpperCase(),
    },
  })
}

function leaveVoice() {
  hangup()
}
</script>

<template>
  <section class="voiceRoom">
    <div class="voiceRoomCard">
      <div class="voiceRoomBadge" :class="{ live: inThisRoom }">
        <img v-if="avatarSrc" class="voiceRoomAvatar" :src="avatarSrc" alt="" />
        <v-icon v-else :icon="inThisRoom ? 'mdi-volume-high' : 'mdi-volume-high-outline'" size="34" />
        <span v-if="inThisRoom" class="voiceRoomPulse" aria-hidden="true" />
      </div>

      <h3 class="voiceRoomTitle">{{ title || t('chat.voice_channel', undefined, 'Voice channel') }}</h3>
      <p class="voiceRoomHint">
        {{
          inThisRoom
            ? t('chat.voice_connected_hint', undefined, 'You are connected to the voice channel')
            : t('chat.voice_hint', undefined, 'Join to talk live with everyone in this channel')
        }}
      </p>

      <div v-if="inThisRoom" class="voiceRoomGrid">
        <p v-if="rows.length === 0" class="voiceRoomEmpty">
          {{ busyLabel || t('chat.voice_waiting', undefined, 'Waiting for others…') }}
        </p>
        <button
          v-for="row in rows"
          :key="row.id"
          type="button"
          class="voiceSeat"
          :class="{ speaking: row.speaking }"
          @click="emit('openUser', row.id)"
        >
          <span class="voiceSeatDot" :class="{ muted: row.muted }" aria-hidden="true">
            <v-icon :icon="row.muted ? 'mdi-microphone-off' : 'mdi-microphone'" size="13" />
          </span>
          <span class="voiceSeatLabel">{{ row.id }}</span>
        </button>
      </div>

      <div class="voiceRoomActions">
        <button
          v-if="!inThisRoom"
          type="button"
          class="voiceJoinBtn"
          :disabled="inAnotherCall || Boolean(busyLabel)"
          @click="joinVoice"
        >
          <v-icon icon="mdi-phone-in-talk" size="18" />
          <span>{{ busyLabel || t('chat.voice_join', undefined, 'Join voice') }}</span>
        </button>
        <button v-else type="button" class="voiceLeaveBtn" @click="leaveVoice">
          <v-icon icon="mdi-phone-hangup" size="18" />
          <span>{{ t('chat.voice_leave', undefined, 'Leave voice') }}</span>
        </button>
      </div>

      <p v-if="inAnotherCall" class="voiceRoomBusy">
        {{ t('chat.voice_busy', undefined, 'You are in another call. Leave it first.') }}
      </p>
      <p v-if="inThisRoom && connectedCount > 0" class="voiceRoomCount">
        {{ t('chat.voice_connected', { count: connectedCount }, '{count} connected') }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.voiceRoom {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  overflow: auto;
}

.voiceRoomCard {
  width: min(520px, 100%);
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 30px 26px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--surface-soft);
  text-align: center;
  animation: voicePop 220ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

.voiceRoomBadge {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  overflow: hidden;
}

.voiceRoomBadge.live {
  background: color-mix(in srgb, #22c55e 22%, transparent);
  color: #22c55e;
}

.voiceRoomAvatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.voiceRoomPulse {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, #22c55e 60%, transparent);
  animation: voicePulse 1.8s ease-out infinite;
  pointer-events: none;
}

.voiceRoomTitle {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.voiceRoomHint {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  max-width: 42ch;
}

.voiceRoomGrid {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
}

.voiceRoomEmpty {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-muted);
}

.voiceSeat {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px 7px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: inherit;
  cursor: pointer;
  max-width: 100%;
  transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
}

.voiceSeat:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.voiceSeat.speaking {
  border-color: #22c55e;
  background: color-mix(in srgb, #22c55e 12%, transparent);
}

.voiceSeatDot {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
  flex: 0 0 auto;
}

.voiceSeatDot.muted {
  background: color-mix(in srgb, #ef4444 24%, transparent);
  color: #ef4444;
}

.voiceSeatLabel {
  font-size: 12.5px;
  max-width: 14ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voiceRoomActions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

.voiceJoinBtn,
.voiceLeaveBtn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 20px;
  border: 0;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  transition: transform 140ms ease, filter 140ms ease, opacity 140ms ease;
}

.voiceJoinBtn {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
}

.voiceLeaveBtn {
  background: #ef4444;
}

.voiceJoinBtn:disabled {
  opacity: 0.55;
  cursor: default;
}

.voiceJoinBtn:hover:not(:disabled),
.voiceLeaveBtn:hover {
  transform: translateY(-1px);
  filter: brightness(1.05);
}

.voiceRoomBusy,
.voiceRoomCount {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-muted);
}

@keyframes voicePop {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes voicePulse {
  0% {
    transform: scale(0.9);
    opacity: 0.85;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
}

@media (max-width: 560px) {
  .voiceRoomCard {
    padding: 24px 16px;
    gap: 12px;
  }
}
</style>
