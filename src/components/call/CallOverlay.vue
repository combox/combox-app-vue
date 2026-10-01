<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentUser } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { avatarColorFor } from '../../utils/avatarColor'
import StreamMediaElement from './StreamMediaElement.vue'
import {
  activeCall,
  callError,
  callIdentity,
  callLive,
  callMedia,
  callNote,
  callParticipants,
  callStatus,
  hangup,
  minimizeCall,
  remoteStreams,
  selfStream,
  toggleCamera,
  toggleMic,
  toggleScreenShare,
} from './callSession'

type CallMember = { user_id: string; display_name: string; avatar_src?: string }

const props = defineProps<{
  title: string
  avatarText?: string
  avatarSrc?: string
  members?: CallMember[]
}>()

const emit = defineEmits<{
  hangup: []
}>()

const { t } = useI18n()

const elapsedSeconds = ref(0)
let timer: number | null = null
let startedAt = 0

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer)
  timer = null
  if (hideTimer !== null) window.clearTimeout(hideTimer)
  hideTimer = null
})

const formattedElapsed = computed(() => {
  const total = elapsedSeconds.value
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const memberIndex = computed(() => {
  const index = new Map<string, CallMember>()
  for (const member of props.members ?? []) index.set(member.user_id, member)
  return index
})

type View = {
  userID: string
  isSelf: boolean
  displayName: string
  avatarSrc: string
  cameraStream: MediaStream | null
  screenStream: MediaStream | null
  audioStream: MediaStream | null
  micOn: boolean
  speaking: boolean
}

const currentUserID = getCurrentUser()?.id ?? ''

function isSelfUser(userID: string): boolean {
  return Boolean(currentUserID) && userID === currentUserID
}

// A track that is not delivering frames renders as a black rectangle, so only
// streams that are actually alive are ever handed to a <video> element.
function liveVideo(stream: MediaStream | null, isSelf: boolean): boolean {
  if (!stream) return false
  return stream.getVideoTracks().some((track) => {
    if (track.readyState !== 'live' || track.muted) return false
    return isSelf ? track.enabled : true
  })
}

function hasLiveAudio(stream: MediaStream | null): boolean {
  if (!stream) return false
  return stream.getAudioTracks().some((track) => track.readyState === 'live' && !track.muted)
}

// The overlay shows the frozen call identity only: switching chats mid-call
// must not rename it, so props (fed from the current chat) are a fallback
// for the store, never the other way round.
const displayTitle = computed(() => callIdentity.value?.title || props.title || t('call.title', undefined, 'Call'))
const displayAvatarText = computed(
  () => callIdentity.value?.avatarText || props.avatarText || (displayTitle.value || 'C').slice(0, 1).toUpperCase(),
)
const displayAvatarSrc = computed(() => callIdentity.value?.avatarSrc || props.avatarSrc || '')

// Unknown participants must never render as a raw id/UUID: they fall back to
// the frozen call title, which is always a real name.
const fallbackTitle = computed(() => displayTitle.value.trim() || t('call.participant', undefined, 'Participant'))

const views = computed<View[]>(() =>
  callParticipants.value.map((participant) => {
    const isSelf = isSelfUser(participant.user_id)
    const remote = remoteStreams.value[participant.user_id]
    const member = memberIndex.value.get(participant.user_id)
    const camera = isSelf ? selfStream.value : (remote?.camera ?? null)
    const screen = isSelf ? null : (remote?.screen ?? null)
    const audio = isSelf ? null : (remote?.audio ?? null)
    const cameraAllowed = isSelf ? callMedia.value.camera : participant.media?.camera !== false
    const screenAllowed = !isSelf && participant.media?.screen !== false
    return {
      userID: participant.user_id,
      isSelf,
      displayName: member?.display_name || (isSelf ? t('call.you', undefined, 'You') : fallbackTitle.value),
      avatarSrc: member?.avatar_src || displayAvatarSrc.value || '',
      cameraStream: cameraAllowed && liveVideo(camera, isSelf) ? camera : null,
      screenStream: screenAllowed && liveVideo(screen, false) ? screen : null,
      audioStream: hasLiveAudio(audio) ? audio : null,
      micOn: participant.media?.mic ?? true,
      speaking: participant.media?.speaking ?? false,
    }
  }),
)

const remoteViews = computed(() => views.value.filter((view) => !view.isSelf))

// A full interface only makes sense once somebody else is actually there;
// before that the panel stays in the compact ringing state.
const isLive = computed(() => callStatus.value === 'active' && remoteViews.value.length > 0)

// The timer measures an answered call only: while the other side has not
// joined yet the call is still being placed, so no elapsed time is shown.
watch(
  isLive,
  (live) => {
    if (live && timer === null) {
      startedAt = Date.now()
      timer = window.setInterval(() => {
        elapsedSeconds.value = Math.floor((Date.now() - startedAt) / 1000)
      }, 1000)
    }
    if (!live && timer !== null) {
      window.clearInterval(timer)
      timer = null
      elapsedSeconds.value = 0
    }
  },
  { immediate: true },
)

const hasScreenStage = computed(() => remoteViews.value.some((view) => view.screenStream !== null))
const screenView = computed(() => remoteViews.value.find((view) => view.screenStream !== null) ?? null)

const cameraViews = computed<View[]>(() => views.value.filter((view) => view.cameraStream !== null))
// In avatar mode the first remote participant is drawn big in the body, so the
// strip may only carry the *other* participants — never a duplicate of it.
const avatarStrip = computed(() => {
  const cameraIDs = new Set(cameraViews.value.map((view) => view.userID))
  const primaryID = cameraViews.value.length === 0 ? (remoteViews.value[0]?.userID ?? '') : ''
  return remoteViews.value.filter((view) => !cameraIDs.has(view.userID) && view.userID !== primaryID)
})
const primaryAvatar = computed(() => (cameraViews.value.length === 0 ? (remoteViews.value[0] ?? null) : null))

const waitingLabel = computed(() =>
  activeCall.value?.kind === 'broadcast' || callLive.value
    ? t('call.waiting_peers', undefined, 'Waiting for participants…')
    : t('call.calling', undefined, 'Calling…'),
)

const statusLabel = computed(() => {
  if (callNote.value === 'no_answer') return t('call.no_answer', undefined, 'No answer')
  if (callNote.value === 'declined') return t('call.declined', undefined, 'Call declined')
  if (callNote.value === 'ended') return t('call.ended_note', undefined, 'Call ended')
  switch (callStatus.value) {
    case 'connecting':
    case 'joining':
      return t('call.connecting', undefined, 'Connecting…')
    case 'failed':
      return callError.value || t('call.failed', undefined, 'Call failed')
    case 'active':
      return isLive.value ? formattedElapsed.value : waitingLabel.value
    default:
      return formattedElapsed.value
  }
})

const participantCount = computed(() => views.value.length)

function onHangup() {
  emit('hangup')
  hangup()
}

async function onToggleScreen() {
  await toggleScreenShare()
}

// -- immersive screen mode (click the stream: chrome collapses) ------------

const immersive = ref(false)
const controlsVisible = ref(true)
const rootEl = ref<HTMLElement | null>(null)
let hideTimer: number | null = null

function scheduleChromeHide(): void {
  if (hideTimer !== null) window.clearTimeout(hideTimer)
  hideTimer = null
  if (!immersive.value) return
  hideTimer = window.setTimeout(() => {
    controlsVisible.value = false
    hideTimer = null
  }, 2500)
}

function onPointerActivity(): void {
  if (!immersive.value) return
  controlsVisible.value = true
  scheduleChromeHide()
}

function setImmersive(next: boolean): void {
  if (immersive.value === next) return
  immersive.value = next
  controlsVisible.value = true
  scheduleChromeHide()
}

function leaveFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined)
  }
}

function toggleImmersive(): void {
  const next = !immersive.value
  setImmersive(next)
  // Real fullscreen, not just a wider panel: the stream has to reach every
  // edge of the display, otherwise the shared screen stays letterboxed
  // inside a framed dialog no matter how the chrome is styled.
  try {
    if (next) rootEl.value?.requestFullscreen().catch(() => undefined)
    else leaveFullscreen()
  } catch {
    // No fullscreen permission: the CSS immersive mode still applies.
  }
}

function onFullscreenChange(): void {
  // Esc (or any other external exit) must fall back to the normal layout.
  if (!document.fullscreenElement && immersive.value) setImmersive(false)
}

watch(hasScreenStage, (value) => {
  if (!value && immersive.value) {
    setImmersive(false)
    leaveFullscreen()
  }
})

onMounted(() => document.addEventListener('fullscreenchange', onFullscreenChange))
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  leaveFullscreen()
})
</script>

<template>
  <Teleport to="body">
    <div ref="rootEl" class="callRoot" :class="{ fullscreen: immersive && hasScreenStage }" role="dialog" aria-modal="true" :aria-label="t('call.active', undefined, 'Call')" @mousemove="onPointerActivity">
      <div class="callPanel" :class="{ ringing: !isLive, immersive: immersive && hasScreenStage }">
        <header class="callHeader" :class="{ chromeHidden: immersive && hasScreenStage && !controlsVisible }">
          <div class="callIdentity">
            <div v-if="displayAvatarSrc" class="callHeaderAvatar">
              <img class="callHeaderAvatarImg" :src="displayAvatarSrc" alt="" />
            </div>
            <div v-else class="callHeaderAvatarFallback" :style="{ background: avatarColorFor(displayTitle) }">{{ displayAvatarText || '?' }}</div>
            <div class="callHeaderMeta">
              <div class="callHeaderTitle">{{ displayTitle }}</div>
              <div class="callHeaderSub">{{ participantCount }}</div>
            </div>
          </div>
          <div class="callHeaderRight">
            <span class="callTimer">{{ statusLabel }}</span>
            <button
              type="button"
              class="callHeaderBtn"
              :aria-label="t('call.minimize', undefined, 'Minimize')"
              :title="t('call.minimize', undefined, 'Minimize')"
              @click="minimizeCall()"
            >
              <v-icon icon="mdi-window-minimize" size="18" />
            </button>
          </div>
        </header>

        <div class="callBody">
          <div v-if="!isLive" class="callRing">
            <div class="callRingAvatar">
              <img v-if="displayAvatarSrc" class="callRingAvatarImg" :src="displayAvatarSrc" alt="" />
              <div v-else class="callRingAvatarFallback" :style="{ background: avatarColorFor(displayTitle) }">{{ displayAvatarText || '?' }}</div>
            </div>
            <div class="callRingName">{{ displayTitle }}</div>
            <div class="callRingStatus">{{ statusLabel }}</div>
            <button
              type="button"
              class="callCtrl hangup callRingHangup"
              :aria-label="t('call.hangup', undefined, 'Hang up')"
              :title="t('call.hangup', undefined, 'Hang up')"
              @click="onHangup"
            >
              <v-icon icon="mdi-phone-hangup" size="22" />
            </button>
          </div>

          <template v-else>
            <div
              v-if="hasScreenStage && screenView"
              class="callStage"
              :class="{ immersive: immersive }"
              role="button"
              tabindex="0"
              @click="toggleImmersive"
              @keydown.enter.prevent="toggleImmersive"
            >
              <StreamMediaElement :stream="screenView.screenStream" kind="video" object-fit="contain" />
              <div class="callStageFoot">
                <v-icon icon="mdi-monitor" size="14" />
                <span>{{ screenView.displayName }}</span>
              </div>
            </div>

            <div v-if="cameraViews.length" class="callGrid" :class="{ inStage: hasScreenStage }">
              <div
                v-for="view in cameraViews"
                :key="view.userID"
                class="callTile"
                :class="{ speaking: view.speaking, self: view.isSelf, muted: !view.micOn }"
              >
                <StreamMediaElement
                  :key="`${view.userID}-camera`"
                  :stream="view.cameraStream"
                  kind="video"
                  object-fit="cover"
                />
                <StreamMediaElement v-if="view.audioStream" :stream="view.audioStream" kind="audio" />
                <div class="callTileFoot">
                  <span class="callTileName">{{ view.displayName }}</span>
                  <v-icon v-if="!view.micOn" icon="mdi-microphone-off" size="14" class="callTileMicOff" />
                </div>
              </div>
            </div>

            <div v-else class="callAvatarStage">
              <div v-if="primaryAvatar" class="callAvatarBig">
                <img v-if="primaryAvatar.avatarSrc" class="callAvatarBigImg" :src="primaryAvatar.avatarSrc" alt="" />
                <div v-else class="callAvatarBigFallback" :style="{ background: avatarColorFor(primaryAvatar.userID || primaryAvatar.displayName || '') }">{{ (primaryAvatar.displayName || '?').slice(0, 1).toUpperCase() }}</div>
                <div class="callAvatarBigName">{{ primaryAvatar.displayName }}</div>
              </div>
              <!-- The <video> elements are muted (they only carry pictures), so
                   a camera-less peer needs its own audio element here or the
                   whole stage is silent. -->
              <StreamMediaElement v-if="primaryAvatar?.audioStream" :stream="primaryAvatar.audioStream" kind="audio" />
            </div>

            <div v-if="avatarStrip.length" class="callAvatarRow">
              <div
                v-for="view in avatarStrip"
                :key="view.userID"
                class="callAvatarChip"
                :class="{ speaking: view.speaking, muted: !view.micOn }"
              >
                <img v-if="view.avatarSrc" class="callAvatarChipImg" :src="view.avatarSrc" alt="" />
                <div v-else class="callAvatarChipFallback" :style="{ background: avatarColorFor(view.userID || view.displayName || '') }">{{ (view.displayName || '?').slice(0, 1).toUpperCase() }}</div>
                <span class="callAvatarChipName">{{ view.displayName }}</span>
                <v-icon v-if="!view.micOn" icon="mdi-microphone-off" size="12" class="callTileMicOff" />
                <StreamMediaElement v-if="view.audioStream" :stream="view.audioStream" kind="audio" />
              </div>
            </div>
          </template>
        </div>

        <!-- Controls belong to a live call only: the ringing state already
             has its single hangup button, duplicating them there is noise. -->
        <footer v-if="isLive" class="callControls" :class="{ chromeHidden: immersive && hasScreenStage && !controlsVisible }">
          <button
            type="button"
            class="callCtrl"
            :class="{ off: !callMedia.mic }"
            :aria-label="t('call.toggle_mic', undefined, 'Toggle microphone')"
            :title="t('call.toggle_mic', undefined, 'Toggle microphone')"
            @click="toggleMic()"
          >
            <v-icon :icon="callMedia.mic ? 'mdi-microphone' : 'mdi-microphone-off'" size="20" />
          </button>
          <button
            type="button"
            class="callCtrl"
            :class="{ off: !callMedia.camera }"
            :aria-label="t('call.toggle_camera', undefined, 'Toggle camera')"
            :title="t('call.toggle_camera', undefined, 'Toggle camera')"
            @click="toggleCamera()"
          >
            <v-icon :icon="callMedia.camera ? 'mdi-video' : 'mdi-video-off'" size="20" />
          </button>
          <button
            type="button"
            class="callCtrl"
            :class="{ active: callMedia.screen }"
            :aria-label="t('call.share_screen', undefined, 'Share screen')"
            :title="t('call.share_screen', undefined, 'Share screen')"
            @click="onToggleScreen"
          >
            <v-icon icon="mdi-monitor-share" size="20" />
          </button>
          <button
            v-if="hasScreenStage"
            type="button"
            class="callCtrl"
            :class="{ active: immersive }"
            :aria-label="t('call.immersive', undefined, 'Fullscreen stream')"
            :title="t('call.immersive', undefined, 'Fullscreen stream')"
            @click="toggleImmersive"
          >
            <v-icon :icon="immersive ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'" size="20" />
          </button>
          <button type="button" class="callCtrl hangup" :aria-label="t('call.hangup', undefined, 'Hang up')" :title="t('call.hangup', undefined, 'Hang up')" @click="onHangup">
            <v-icon icon="mdi-phone-hangup" size="20" />
          </button>
        </footer>

        <div v-if="callStatus === 'failed' && callError" class="callError">{{ callError }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.callRoot {
  position: fixed;
  inset: 0;
  z-index: 88;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(6, 8, 13, 0.72);
  backdrop-filter: blur(8px);
}

/* Immersive (fullscreen) mode: the dialog framing goes away completely so
   the shared screen reaches the edges of the display. */
.callRoot.fullscreen {
  padding: 0;
  background: #000;
  backdrop-filter: none;
}

.callPanel {
  position: relative;
  width: min(980px, 100%);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 20px;
  overflow: hidden;
  background: var(--surface, #12151d);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
}

.callPanel.immersive {
  width: min(1280px, 100%);
}

.callRoot.fullscreen .callPanel,
.callRoot.fullscreen .callPanel.immersive {
  width: 100%;
  height: 100%;
  max-height: none;
  border-radius: 0;
  border: 0;
  box-shadow: none;
}

.callHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  transition: opacity 0.18s ease;
}

.callIdentity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.callHeaderAvatar,
.callHeaderAvatarFallback {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 auto;
}

.callHeaderAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.callHeaderAvatarFallback {
  display: grid;
  place-items: center;
  background: var(--avatar-fallback, #3b4252);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.callHeaderTitle {
  font-size: 15px;
  font-weight: 800;
  color: var(--text, #e8ecf5);
}

.callHeaderSub {
  font-size: 12px;
  color: var(--text-muted, #8b93a7);
}

.callHeaderRight {
  display: flex;
  align-items: center;
  gap: 8px;
}

.callHeaderBtn {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: var(--surface-soft, rgba(255, 255, 255, 0.08));
  color: var(--text-soft, #9aa4b8);
}

.callHeaderBtn:hover {
  color: var(--text, #e8ecf5);
}

.callTimer {
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-soft, #9aa4b8);
}

.callBody {
  position: relative;
  flex: 1;
  min-height: 260px;
  display: flex;
  flex-direction: column;
}

.callRing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 20px 24px;
}

.callRingAvatar {
  width: 132px;
  height: 132px;
  border-radius: 50%;
  overflow: hidden;
}

.callRingAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.callRingAvatarFallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--avatar-fallback, #3b4252);
  color: #fff;
  font-size: 46px;
  font-weight: 800;
}

.callRingName {
  font-size: 20px;
  font-weight: 800;
  color: var(--text, #e8ecf5);
}

.callRingStatus {
  font-size: 14px;
  color: var(--text-muted, #8b93a7);
}

.callRingHangup {
  margin-top: 10px;
}

.callStage {
  position: relative;
  flex: 1;
  min-height: 320px;
  background: #000;
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: pointer;
}

.callStageFoot {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(9, 11, 16, 0.72);
  color: #e8ecf5;
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
}

.callGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  padding: 14px;
  align-content: start;
  overflow: auto;
}

/* Next to the stage the participants sit in their own strip: overlaying them
   on the shared screen used to cover its right third. */
.callGrid.inStage {
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  padding: 10px 14px 14px;
  overflow-x: auto;
  overflow-y: hidden;
  align-items: stretch;
}

.callGrid.inStage .callTile {
  flex: 0 0 auto;
  width: min(220px, 30vw);
}

/* In fullscreen the stream owns the whole surface; participant tiles come
   back only in the normal layout. */
.callRoot.fullscreen .callGrid.inStage {
  display: none;
}

/* The avatar stage shares the body's flex with the stream, so it claimed the
   lower half of a fullscreen share (a grey void plus one avatar) and hid the
   broadcast behind it. display:none only drops the visuals: the <audio>
   elements living inside these blocks keep playing. */
.callRoot.fullscreen .callAvatarStage,
.callRoot.fullscreen .callAvatarRow {
  display: none;
}

.callTile {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 14px;
  overflow: hidden;
  background: #0b0d12;
  border: 2px solid transparent;
  display: grid;
  place-items: center;
}

.callTile.speaking {
  border-color: #2ecc71;
}

.callTile.muted {
  opacity: 0.9;
}

.callTile.self .callTileFoot {
  background: rgba(9, 11, 16, 0.6);
}

.callTileFoot {
  position: absolute;
  left: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(9, 11, 16, 0.72);
  color: #e8ecf5;
  font-size: 12px;
  font-weight: 700;
  max-width: calc(100% - 16px);
}

.callTileName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.callTileMicOff {
  color: #ff7b8a;
}

.callAvatarStage {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}

.callAvatarBig {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.callAvatarBigImg {
  width: 168px;
  height: 168px;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.4);
}

.callAvatarBigFallback {
  width: 168px;
  height: 168px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--avatar-fallback, #3b4252);
  color: #fff;
  font-size: 58px;
  font-weight: 800;
}

.callAvatarBigName {
  font-size: 17px;
  font-weight: 800;
  color: var(--text, #e8ecf5);
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.callAvatarRow {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0 14px 14px;
}

.callAvatarChip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border-radius: 999px;
  background: var(--surface-soft, rgba(255, 255, 255, 0.06));
  border: 2px solid transparent;
  color: var(--text, #e8ecf5);
  font-size: 12px;
  font-weight: 700;
}

.callAvatarChip.speaking {
  border-color: #2ecc71;
}

.callAvatarChipImg {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  object-fit: cover;
}

.callAvatarChipFallback {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--avatar-fallback, #3b4252);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
}

.callAvatarChipName {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.callControls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 14px;
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  transition: opacity 0.18s ease;
  background: var(--surface, #12151d);
}

/* Immersive chrome floats over the stream as two small pills instead of
   full-width bands that used to paint over the shared desktop. */
.callPanel.immersive .callHeader {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 10px;
  z-index: 3;
  padding: 0;
  background: transparent;
  border-bottom-color: transparent;
  pointer-events: none;
}

.callPanel.immersive .callIdentity,
.callPanel.immersive .callHeaderRight {
  pointer-events: auto;
  background: rgba(9, 11, 16, 0.72);
  border-radius: 999px;
}

.callPanel.immersive .callIdentity {
  padding: 6px 14px 6px 6px;
}

.callPanel.immersive .callHeaderRight {
  padding: 5px 6px 5px 12px;
}

.callPanel.immersive .callControls {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  padding: 8px 12px;
  background: rgba(9, 11, 16, 0.72);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  border-radius: 999px;
}

.callHeader.chromeHidden,
.callControls.chromeHidden,
.callHeader.chromeHidden .callIdentity,
.callHeader.chromeHidden .callHeaderRight {
  opacity: 0;
  pointer-events: none;
}

.callCtrl {
  width: 46px;
  height: 46px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: var(--surface-soft, rgba(255, 255, 255, 0.08));
  color: var(--text, #e8ecf5);
  transition: background 0.12s ease, color 0.12s ease, transform 0.12s ease;
}

.callCtrl:hover {
  background: var(--surface-soft-hover, rgba(255, 255, 255, 0.14));
  transform: translateY(-1px);
}

.callCtrl.off {
  background: #e0465a;
  color: #fff;
}

.callCtrl.active {
  background: #3a86ff;
  color: #fff;
}

.callCtrl.hangup {
  background: #e0465a;
  color: #fff;
}

.callError {
  padding: 8px 14px 12px;
  text-align: center;
  color: #ff8f9c;
  font-size: 12px;
}
</style>
