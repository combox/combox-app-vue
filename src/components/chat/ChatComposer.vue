<script setup lang="ts">
import type { AttachmentMeta, GIFItem } from 'combox-api'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { VoiceRecorder, voiceFileExtension, type VoiceRecording } from '../../lib/voiceRecorder'
import type { PendingFile } from '../../models/chat'
import LinkPreviewCard from './LinkPreviewCard.vue'
import PendingMediaTile from './PendingMediaTile.vue'
import TypingIndicator from './TypingIndicator.vue'
import { clearChatDraft, getChatDraft, setChatDraft } from './chatWorkspace.drafts'
import type { ViewMessage } from './chatTypes'

const INPUT_TEXTAREA_MIN_HEIGHT = 26
const INPUT_TEXTAREA_MAX_HEIGHT = 168
const VOICE_MAX_MS = 15 * 60 * 1000
const HOLD_TO_RECORD_MS = 400
// Vertical swipe distance above the mic button that counts as a lock intent (TG-style).
const LOCK_SWIPE_PX = 48

type RecordMode = 'voice' | 'round'

type MicGesture = 'idle' | 'pending' | 'holding' | 'cancelled'

type RoundPreviewState = {
  url: string
  blob: Blob
  mimeType: string
  durationMs: number
  peaks: number[]
  isVideo: boolean
}

const emit = defineEmits<{
  send: [value: string]
  sendVoice: [file: File, meta: AttachmentMeta]
  pickFiles: [files: FileList]
  removePendingFile: [id: string]
  clearReply: []
  clearEdit: []
  clearForward: []
  typing: []
}>()

const props = defineProps<{
  chatKey: string
  sending: boolean
  disabled: boolean
  pendingFiles: PendingFile[]
  replyToMessage: ViewMessage | null
  editingMessage: ViewMessage | null
  forwardMessages?: ViewMessage[] | null
  suppressReplyPreview?: boolean
}>()

const { t } = useI18n()
const ComposerEmojiGifPicker = defineAsyncComponent(() => import('./ComposerEmojiGifPicker.vue'))
const rootRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
const pickerOpen = ref(false)
const dismissedPreviewUrl = ref('')
const canSend = computed(() => !props.disabled && !props.sending && (draft.value.trim().length > 0 || props.pendingFiles.length > 0 || (props.forwardMessages?.length ?? 0) > 0))
let pickerPrefetchStarted = false
type IdleCallbackHandle = Window & { requestIdleCallback?: (cb: () => void) => number }

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)\b/i

function normalizeUrl(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function extractFirstUrl(text: string): string {
  if (!text) return ''
  const match = text.match(URL_RE)
  if (!match?.[1]) return ''
  return normalizeUrl(match[1].replace(/[.,!?;:)\]}]+$/, ''))
}

function noPreviewToken(url: string): string {
  return `[[nopreview:${encodeURIComponent(url)}]]`
}

const detectedUrl = ref('')
watch(
  draft,
  () => {
    detectedUrl.value = extractFirstUrl(draft.value)
    if (dismissedPreviewUrl.value && dismissedPreviewUrl.value !== detectedUrl.value) {
      // If URL changed, allow preview again for the new URL.
      dismissedPreviewUrl.value = ''
    }
  },
  { immediate: true },
)

function prefetchPicker() {
  if (pickerPrefetchStarted) return
  pickerPrefetchStarted = true
  void import('./ComposerEmojiGifPicker.vue')
}

function resizeTextarea() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const nextHeight = Math.max(INPUT_TEXTAREA_MIN_HEIGHT, Math.min(el.scrollHeight, INPUT_TEXTAREA_MAX_HEIGHT))
  el.style.height = `${nextHeight}px`
  el.style.overflowY = el.scrollHeight > INPUT_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
}

watch(draft, () => {
  nextTick(resizeTextarea)
  // Tell the other participants that this user is composing a message.
  if (draft.value.trim() && !props.disabled) emit('typing')
})

watch(draft, () => {
  setChatDraft(props.chatKey, draft.value)
})

watch(
  () => props.chatKey,
  () => {
    draft.value = getChatDraft(props.chatKey)
    pickerOpen.value = false
    dismissedPreviewUrl.value = ''
    recordError.value = ''
    discardRoundPreview()
    nextTick(resizeTextarea)
  },
)

watch(
  () => props.editingMessage?.raw.id || '',
  () => {
    const editing = props.editingMessage
    if (editing) {
      draft.value = editing.text || ''
    } else if (!props.replyToMessage) {
      draft.value = ''
    }
    nextTick(resizeTextarea)
  },
  { immediate: true },
)

function handleSend() {
  let outgoing = draft.value
  if (detectedUrl.value && dismissedPreviewUrl.value === detectedUrl.value) {
    outgoing = [outgoing, noPreviewToken(detectedUrl.value)].filter(Boolean).join('\n')
  }
  emit('send', outgoing)
  clearChatDraft(props.chatKey)
  if (!props.sending) {
    draft.value = ''
    dismissedPreviewUrl.value = ''
    nextTick(resizeTextarea)
  }
}

function handleSelectEmoji(emoji: string) {
  draft.value = `${draft.value}${emoji}`
}

function handleSelectGif(item: GIFItem) {
  const url = (item.url || '').trim()
  if (!url || props.disabled || props.sending) return
  emit('send', url)
  pickerOpen.value = false
}

function handleFileChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement | null
  const files = input?.files
  if (files && files.length) emit('pickFiles', files)
  if (input) input.value = ''
}

// R8: paste with media/files in the clipboard attaches them through the same
// pickFiles -> setPendingFiles path as drag&drop / file picker, instead of
// inserting a file path as text. Plain-text paste keeps the default behavior.
function handlePaste(event: ClipboardEvent) {
  if (props.disabled || props.sending) return
  const data = event.clipboardData
  if (!data) return
  const files: File[] = []
  if (data.files && data.files.length > 0) {
    files.push(...Array.from(data.files))
  } else if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  if (files.length === 0) return
  event.preventDefault()
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  emit('pickFiles', transfer.files)
}

const RECORD_MODE_STORAGE_KEY = 'combox.composer.record_mode'

function readStoredRecordMode(): RecordMode {
  try {
    return localStorage.getItem(RECORD_MODE_STORAGE_KEY) === 'round' ? 'round' : 'voice'
  } catch {
    return 'voice'
  }
}

const recording = ref(false)
const roundMode = ref(false)
const recordModePref = ref<RecordMode>(readStoredRecordMode())
const recordingPaused = ref(false)
const elapsedMs = ref(0)
const levels = ref<number[]>([])
const recordError = ref('')
const roundPreview = ref<RoundPreviewState | null>(null)
const roundPreviewPlaying = ref(false)
const roundPreviewMs = ref(0)
const cameraStream = ref<MediaStream | null>(null)
const videoPreviewRef = ref<HTMLVideoElement | null>(null)
const audioPreviewRef = ref<HTMLAudioElement | null>(null)
const previewMedia = computed<HTMLMediaElement | null>(() => videoPreviewRef.value ?? audioPreviewRef.value)
const micButtonRef = ref<HTMLButtonElement | null>(null)
const micGesture = ref<MicGesture>('idle')
// R10: TG-style voice lock. While holding the mic, swiping up (or releasing
// over the lock button) pins the recording so it continues after release;
// send/trash then finish or discard it. Every visible control stays clickable.
const voiceLocked = ref(false)
const lockButtonRef = ref<HTMLButtonElement | null>(null)
const toast = useToast()
let voiceRecorder: VoiceRecorder | null = null
let levelUnsubscribe: (() => void) | null = null
let recordTimerHandle = 0
let recordingStopping = false
let recordingStarting = false
let startAttempt: Promise<void> | null = null
let disposed = false
let micPointerId: number | null = null
let micHoldHandle = 0
let micPressRect: DOMRect | null = null
let micCaptureTarget: HTMLElement | null = null
let previewRafHandle = 0

function formatDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function stopRecordTimer() {
  if (recordTimerHandle) {
    window.clearInterval(recordTimerHandle)
    recordTimerHandle = 0
  }
}

function resetRecordingState() {
  stopRecordTimer()
  levelUnsubscribe?.()
  levelUnsubscribe = null
  voiceRecorder = null
  recording.value = false
  roundMode.value = false
  recordingPaused.value = false
  elapsedMs.value = 0
  levels.value = []
  cameraStream.value = null
  voiceLocked.value = false
}

function buildRecordingFileName(baseName: string, mimeType: string): string {
  const safe = (baseName || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${safe || 'Voice message'}.${voiceFileExtension(mimeType)}`
}

function startRecording(mode: RecordMode): Promise<void> {
  if (disposed || recordingStarting || recording.value || roundPreview.value || props.disabled || props.sending) {
    return Promise.resolve()
  }
  recordingStarting = true
  const attempt = runStartRecording(mode).finally(() => {
    recordingStarting = false
    if (startAttempt === attempt) startAttempt = null
  })
  startAttempt = attempt
  return attempt
}

async function runStartRecording(mode: RecordMode): Promise<void> {
  recordError.value = ''
  voiceLocked.value = false
  const instance = new VoiceRecorder()
  try {
    await instance.start({ video: mode === 'round' })
  } catch (error) {
    instance.cancel()
    recordError.value =
      error instanceof Error && error.message === 'media_unsupported'
        ? t('chat.voice_unsupported', undefined, 'Voice recording is not supported in this browser')
        : t('chat.voice_denied', undefined, 'Microphone access denied')
    return
  }
  if (disposed) {
    instance.cancel()
    return
  }
  if (mode === 'round' && !instance.hasVideo) {
    toast.info(t('chat.round_camera_fallback', undefined, 'Camera is unavailable, the round was recorded without video'))
  }
  voiceRecorder = instance
  roundMode.value = mode === 'round'
  recording.value = true
  recordingPaused.value = false
  elapsedMs.value = instance.elapsedMs
  cameraStream.value = instance.hasVideo ? instance.previewStream : null
  levelUnsubscribe = instance.subscribe((next) => {
    levels.value = next
  })
  recordTimerHandle = window.setInterval(() => {
    if (!voiceRecorder) return
    elapsedMs.value = voiceRecorder.elapsedMs
    if (elapsedMs.value >= VOICE_MAX_MS) {
      if (roundMode.value) void stopRoundRecording()
      else void finishRecording()
    }
  }, 200)
}

function toggleRecordingPause() {
  if (!voiceRecorder || !recording.value) return
  if (recordingPaused.value) {
    voiceRecorder.resume()
    recordingPaused.value = false
  } else {
    voiceRecorder.pause()
    recordingPaused.value = true
  }
}

function cancelRecording() {
  if (recordingStopping) return
  voiceRecorder?.cancel()
  recordError.value = ''
  resetRecordingState()
}

async function stopRecorder(): Promise<VoiceRecording | null> {
  const instance = voiceRecorder
  if (!instance || !recording.value || recordingStopping) return null
  recordingStopping = true
  stopRecordTimer()
  let result: VoiceRecording | null = null
  try {
    result = await instance.stop()
  } catch {
    result = null
  }
  resetRecordingState()
  recordingStopping = false
  return result
}

async function finishRecording() {
  if (!recording.value || recordingStopping || roundMode.value) return
  const result = await stopRecorder()
  if (!result) {
    recordError.value = t('chat.voice_failed', undefined, 'Voice message could not be recorded')
    return
  }
  const file = new File([result.blob], buildRecordingFileName(t('chat.audio_message', undefined, 'Voice message'), result.mimeType), {
    type: result.mimeType || 'audio/webm',
    lastModified: Date.now(),
  })
  const meta: AttachmentMeta = { duration_ms: result.durationMs, voice: true }
  if (result.peaks.length > 0) meta.waveform = result.peaks
  emit('sendVoice', file, meta)
}

async function stopRoundRecording() {
  if (!recording.value || recordingStopping || !roundMode.value) return
  const result = await stopRecorder()
  if (!result) {
    recordError.value = t('chat.round_too_short', undefined, 'The round is too short')
    return
  }
  discardRoundPreview()
  roundPreview.value = {
    url: URL.createObjectURL(result.blob),
    blob: result.blob,
    mimeType: result.mimeType,
    durationMs: result.durationMs,
    peaks: result.peaks,
    isVideo: result.mimeType.toLowerCase().startsWith('video/'),
  }
  roundPreviewMs.value = 0
  roundPreviewPlaying.value = false
}

function stopPreviewLoop() {
  if (previewRafHandle) {
    cancelAnimationFrame(previewRafHandle)
    previewRafHandle = 0
  }
}

function startPreviewLoop() {
  if (previewRafHandle) return
  const tick = () => {
    const audio = previewMedia.value
    if (!audio || audio.paused) {
      previewRafHandle = 0
      return
    }
    roundPreviewMs.value = audio.currentTime * 1000
    previewRafHandle = requestAnimationFrame(tick)
  }
  previewRafHandle = requestAnimationFrame(tick)
}

function onPreviewPlay() {
  roundPreviewPlaying.value = true
  startPreviewLoop()
}

function onPreviewPause() {
  roundPreviewPlaying.value = false
  stopPreviewLoop()
  const audio = previewMedia.value
  if (audio) roundPreviewMs.value = audio.currentTime * 1000
}

function onPreviewEnded() {
  stopPreviewLoop()
  roundPreviewPlaying.value = false
  roundPreviewMs.value = 0
  const audio = previewMedia.value
  if (audio) audio.currentTime = 0
}

function toggleRoundPreview() {
  const audio = previewMedia.value
  if (!audio) return
  if (audio.paused) {
    void audio.play().catch(() => {
      roundPreviewPlaying.value = false
      stopPreviewLoop()
    })
  } else {
    audio.pause()
  }
}

function discardRoundPreview() {
  stopPreviewLoop()
  const audio = previewMedia.value
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  const preview = roundPreview.value
  roundPreview.value = null
  roundPreviewPlaying.value = false
  roundPreviewMs.value = 0
  if (preview) URL.revokeObjectURL(preview.url)
}

function sendRoundPreview() {
  const preview = roundPreview.value
  if (!preview) return
  const file = new File([preview.blob], buildRecordingFileName(t('chat.video_message', undefined, 'Video message'), preview.mimeType), {
    type: preview.mimeType || 'audio/webm',
    lastModified: Date.now(),
  })
  const meta: AttachmentMeta = { round: true, duration_ms: Math.max(0, Math.round(preview.durationMs)) }
  if (preview.peaks.length > 0) meta.waveform = preview.peaks
  discardRoundPreview()
  emit('sendVoice', file, meta)
}

const roundRingStyle = computed(() => {
  const total = roundPreview.value?.durationMs || 0
  const ratio = total > 0 ? Math.min(1, Math.max(0, roundPreviewMs.value / total)) : 0
  return { ['--ring' as string]: `${Math.round(ratio * 3600) / 10}deg` }
})

function clearMicHold() {
  if (micHoldHandle) {
    window.clearTimeout(micHoldHandle)
    micHoldHandle = 0
  }
}

function cleanupMicListeners() {
  window.removeEventListener('pointerup', onMicWindowPointerUp)
  window.removeEventListener('pointercancel', onMicWindowPointerCancel)
  window.removeEventListener('pointermove', onMicWindowPointerMove)
}

function releaseMicCapture() {
  const target = micCaptureTarget
  const pointerId = micPointerId
  micCaptureTarget = null
  if (!target || pointerId === null) return
  try {
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
  } catch {
    // capture already released by the browser
  }
}

function endMicGesture() {
  cleanupMicListeners()
  releaseMicCapture()
  clearMicHold()
  micPointerId = null
  micPressRect = null
  micGesture.value = 'idle'
}

function lockVoiceRecording() {
  if (!recording.value || roundMode.value) return
  voiceLocked.value = true
}

function pointerOverElement(el: HTMLElement | null, x: number, y: number): boolean {
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function pointerSwipedUp(y: number): boolean {
  const rect = micPressRect
  if (!rect) return false
  return y < rect.top - LOCK_SWIPE_PX
}

function pointerInsideMic(x: number, y: number): boolean {
  const rect = micPressRect
  if (!rect) return true
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

function onMicPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary) return
  if (!canRecord.value) return
  if (micPointerId !== null || micGesture.value !== 'idle') return
  const button = micButtonRef.value
  if (!button) return
  micPressRect = button.getBoundingClientRect()
  micPointerId = event.pointerId
  micGesture.value = 'pending'
  const target = rootRef.value ?? button
  micCaptureTarget = target
  try {
    target.setPointerCapture(event.pointerId)
  } catch {
    // pointer capture is best effort
  }
  window.addEventListener('pointerup', onMicWindowPointerUp)
  window.addEventListener('pointercancel', onMicWindowPointerCancel)
  window.addEventListener('pointermove', onMicWindowPointerMove)
  clearMicHold()
  micHoldHandle = window.setTimeout(() => {
    micHoldHandle = 0
    if (micGesture.value !== 'pending' || micPointerId === null) return
    micGesture.value = 'holding'
    void startRecording(recordModePref.value)
  }, HOLD_TO_RECORD_MS)
}

function onMicWindowPointerMove(event: PointerEvent) {
  if (micPointerId !== event.pointerId) return
  if (micGesture.value === 'pending') {
    if (pointerInsideMic(event.clientX, event.clientY)) return
    // Swipe-up during the hold delay is a lock intent (TG), not a cancel:
    // keep the pending hold so the recording can start and then pin.
    if (pointerSwipedUp(event.clientY)) return
    clearMicHold()
    micGesture.value = 'cancelled'
    return
  }
  // Holding with an active voice recording: swiping up onto/above the lock
  // pins the recording (it survives the upcoming pointerup, see releaseVoiceGesture).
  if (micGesture.value === 'holding' && recording.value && !roundMode.value && !voiceLocked.value) {
    if (pointerSwipedUp(event.clientY) || pointerOverElement(lockButtonRef.value, event.clientX, event.clientY)) {
      lockVoiceRecording()
    }
  }
}

function onMicWindowPointerUp(event: PointerEvent) {
  if (micPointerId !== event.pointerId) return
  const gesture = micGesture.value
  const inside = pointerInsideMic(event.clientX, event.clientY)
  const x = event.clientX
  const y = event.clientY
  endMicGesture()
  if (gesture === 'pending') {
    if (inside && canRecord.value) toggleRecordMode()
    return
  }
  if (gesture === 'holding') void releaseVoiceGesture(inside, x, y)
}

function onMicWindowPointerCancel(event: PointerEvent) {
  if (micPointerId !== null && micPointerId !== event.pointerId) return
  endMicGesture()
}

// Release semantics (voice only; round recordings always need an explicit stop):
// - locked (swipe-up or release over the lock button) -> keep recording until send/trash.
// - released over the lock button or swiped up -> pin now and keep recording.
// - released inside the mic button -> finish and send.
// - released anywhere else (swipe-away) -> cancel, TG-style.
// A too-short recording (<400ms of audio) is rejected by the recorder and
// surfaces as an error, i.e. it is effectively discarded like in TG.
async function releaseVoiceGesture(inside: boolean, x: number, y: number) {
  const attempt = startAttempt
  if (attempt) {
    try {
      await attempt
    } catch {
      // start failures are surfaced through recordError
    }
  }
  if (!recording.value || roundMode.value) return
  if (voiceLocked.value) return
  if (pointerOverElement(lockButtonRef.value, x, y) || pointerSwipedUp(y)) {
    lockVoiceRecording()
    return
  }
  if (!inside) {
    cancelRecording()
    return
  }
  await finishRecording()
}

function toggleRecordMode() {
  recordModePref.value = recordModePref.value === 'round' ? 'voice' : 'round'
  try {
    localStorage.setItem(RECORD_MODE_STORAGE_KEY, recordModePref.value)
  } catch {
    // storage unavailable
  }
}

function onMicKeyActivate(event: KeyboardEvent) {
  if (event.repeat || !canRecord.value) return
  toggleRecordMode()
}

const micModeLabel = computed(() => {
  const mode =
    recordModePref.value === 'round'
      ? t('chat.mic_mode_round', undefined, 'Round video')
      : t('chat.mic_mode_voice', undefined, 'Voice message')
  return `${mode} · ${t('chat.mic_mode_hint', undefined, 'Tap to switch mode, hold to record')}`
})

const canRecord = computed(() => !props.disabled && !props.sending && !recording.value && !roundPreview.value)

function onDocPointerDown(event: PointerEvent) {
  if (!pickerOpen.value) return
  const target = event.target as Node | null
  if (!target) return
  if (!rootRef.value?.contains(target)) pickerOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  const preload = () => prefetchPicker()
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    ;(window as IdleCallbackHandle).requestIdleCallback?.(() => preload())
  }
})

onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('pointerdown', onDocPointerDown)
  endMicGesture()
  voiceRecorder?.cancel()
  stopRecordTimer()
  levelUnsubscribe?.()
  cameraStream.value = null
  discardRoundPreview()
})
</script>

<template>
  <div ref="rootRef" class="composer">
    <div v-if="pickerOpen" class="pickerPopover">
      <ComposerEmojiGifPicker
        :open="pickerOpen"
        @select="handleSelectEmoji"
        @select-gif="handleSelectGif"
      />
    </div>

    <div v-if="editingMessage" class="replyBar editBar">
      <div class="replyMain">
        <div class="replyAuthor">{{ t('chat.edit_message', undefined, 'Edit message') }}</div>
        <div class="replyPreview">{{ t('chat.edit_message_hint', undefined, 'Save changes or cancel editing') }}</div>
      </div>
      <button type="button" class="replyClose" @click="emit('clearEdit')">
        <v-icon icon="mdi-close" size="16" />
      </button>
    </div>

    <div v-else-if="(forwardMessages || []).length > 0" class="replyBar">
      <div class="replyMain">
        <div class="replyAuthor">{{ t('chat.forward', undefined, 'Forward') }}</div>
        <div class="replyPreview">
          {{ t('chat.forwarding_messages', { count: (forwardMessages || []).length } as any, `${(forwardMessages || []).length} messages`) }}
        </div>
      </div>
      <button type="button" class="replyClose" @click="emit('clearForward')">
        <v-icon icon="mdi-close" size="16" />
      </button>
    </div>

    <div v-else-if="replyToMessage && !suppressReplyPreview" class="replyBar">
      <div class="replyMain">
        <div class="replyAuthor">{{ t('chat.reply') }}</div>
        <div class="replyPreview">{{ replyToMessage.text || t('chat.message') }}</div>
      </div>
      <button type="button" class="replyClose" @click="emit('clearReply')">
        <v-icon icon="mdi-close" size="16" />
      </button>
    </div>

    <div v-if="pendingFiles.length > 0" class="composerFiles">
      <PendingMediaTile v-for="item in pendingFiles" :key="item.id" :item="item" @remove="emit('removePendingFile', $event)" />
    </div>

    <LinkPreviewCard
      v-if="detectedUrl && dismissedPreviewUrl !== detectedUrl"
      class="composerLinkPreview"
      :url="detectedUrl"
      :media-overlay-open="false"
      dismissible
      @dismiss="dismissedPreviewUrl = $event"
    />

    <div v-if="recordError" class="recordError">{{ recordError }}</div>

    <div v-if="recording && roundMode" class="roundFullscreen" role="dialog" aria-modal="true" :aria-label="t('chat.round_recording', undefined, 'Recording round')" aria-live="polite">
      <div class="roundFullscreenTop">
        <span class="recordDot" :class="{ paused: recordingPaused }" aria-hidden="true" />
        <span class="roundFullscreenTime">{{ formatDuration(elapsedMs) }}</span>
        <span class="roundFullscreenLabel">{{ t('chat.round_recording', undefined, 'Recording round') }}</span>
      </div>

      <div class="roundFullscreenStage" :class="{ paused: recordingPaused }">
        <video
          v-if="cameraStream"
          class="roundFullscreenVideo"
          :srcObject="cameraStream"
          autoplay
          muted
          playsinline
          aria-hidden="true"
        />
        <div v-else class="roundFullscreenNoVideo" aria-hidden="true">
          <v-icon icon="mdi-video-off" size="44" />
        </div>
        <span class="roundFullscreenPulse" aria-hidden="true" />
      </div>

      <div class="roundFullscreenControls">
        <button
          type="button"
          class="roundFullscreenBtn"
          :aria-label="t('chat.voice_cancel', undefined, 'Cancel recording')"
          :title="t('chat.voice_cancel', undefined, 'Cancel recording')"
          @click="cancelRecording"
        >
          <v-icon icon="mdi-delete-outline" size="22" />
        </button>

        <button
          type="button"
          class="roundFullscreenBtn"
          :aria-label="
            recordingPaused
              ? t('chat.voice_resume', undefined, 'Resume recording')
              : t('chat.voice_pause', undefined, 'Pause recording')
          "
          :title="
            recordingPaused
              ? t('chat.voice_resume', undefined, 'Resume recording')
              : t('chat.voice_pause', undefined, 'Pause recording')
          "
          @click="toggleRecordingPause"
        >
          <v-icon :icon="recordingPaused ? 'mdi-play' : 'mdi-pause'" size="22" />
        </button>

        <button
          type="button"
          class="roundFullscreenBtn primary"
          :aria-label="t('chat.round_stop', undefined, 'Stop recording')"
          :title="t('chat.round_stop', undefined, 'Stop recording')"
          @click="stopRoundRecording"
        >
          <v-icon icon="mdi-stop" size="22" />
        </button>
      </div>
    </div>

    <div v-else-if="recording" class="composerRow composerRowRecording" aria-live="polite">
      <button
        type="button"
        class="composerIcon recordAction"
        :aria-label="t('chat.voice_cancel', undefined, 'Cancel recording')"
        :title="t('chat.voice_cancel', undefined, 'Cancel recording')"
        @click="cancelRecording"
      >
        <v-icon icon="mdi-delete-outline" size="20" />
      </button>

      <span class="recordDot" :class="{ paused: recordingPaused }" aria-hidden="true" />

      <div class="recordMeter" aria-hidden="true">
        <span
          v-for="(level, index) in levels"
          :key="index"
          class="recordMeterBar"
          :style="{ height: `${Math.max(10, Math.round(level * 100))}%` }"
        />
      </div>

      <span class="recordTime">{{ formatDuration(elapsedMs) }}</span>

      <button
        v-if="!voiceLocked"
        ref="lockButtonRef"
        type="button"
        class="composerIcon recordAction recordLock"
        :aria-label="t('chat.voice_lock_hint', undefined, 'Swipe up or release over the lock to keep recording after release')"
        :title="t('chat.voice_lock', undefined, 'Lock recording')"
        @click="lockVoiceRecording"
      >
        <v-icon icon="mdi-lock-outline" size="20" />
      </button>
      <span v-else class="recordLocked" role="status">
        <v-icon icon="mdi-lock-outline" size="16" />
        {{ t('chat.voice_locked', undefined, 'Locked') }}
      </span>

      <button
        type="button"
        class="composerIcon recordAction"
        :aria-label="
          recordingPaused
            ? t('chat.voice_resume', undefined, 'Resume recording')
            : t('chat.voice_pause', undefined, 'Pause recording')
        "
        :title="
          recordingPaused
            ? t('chat.voice_resume', undefined, 'Resume recording')
            : t('chat.voice_pause', undefined, 'Pause recording')
        "
        @click="toggleRecordingPause"
      >
        <v-icon :icon="recordingPaused ? 'mdi-play' : 'mdi-pause'" size="20" />
      </button>

      <button
        type="button"
        class="composerSend active"
        :aria-label="t('chat.voice_send', undefined, 'Send voice message')"
        :title="t('chat.voice_send', undefined, 'Send voice message')"
        @click="finishRecording"
      >
        <v-icon icon="mdi-send" size="20" />
      </button>
    </div>

    <div v-else-if="roundPreview" class="composerRow composerRowPreview" aria-live="polite">
      <div class="roundPreview">
        <button
          type="button"
          class="roundPreviewArt"
          :style="roundRingStyle"
          :aria-label="
            roundPreviewPlaying
              ? t('chat.round_pause', undefined, 'Pause round')
              : t('chat.round_play', undefined, 'Play round')
          "
          :title="
            roundPreviewPlaying
              ? t('chat.round_pause', undefined, 'Pause round')
              : t('chat.round_play', undefined, 'Play round')
          "
          @click="toggleRoundPreview"
        >
          <video
            v-if="roundPreview.isVideo"
            ref="videoPreviewRef"
            class="roundPreviewVideo"
            :src="roundPreview.url"
            preload="auto"
            playsinline
            @play="onPreviewPlay"
            @pause="onPreviewPause"
            @ended="onPreviewEnded"
          />
          <span v-else class="roundPreviewDisc" aria-hidden="true" />
          <span class="roundPreviewToggle" aria-hidden="true">
            <v-icon :icon="roundPreviewPlaying ? 'mdi-pause' : 'mdi-play'" size="26" />
          </span>
        </button>
        <audio
          v-if="!roundPreview.isVideo"
          ref="audioPreviewRef"
          class="roundPreviewAudio"
          :src="roundPreview.url"
          preload="auto"
          @play="onPreviewPlay"
          @pause="onPreviewPause"
          @ended="onPreviewEnded"
        />
        <div class="roundPreviewMeta">
          <span class="roundPreviewLabel">{{ t('chat.round_preview', undefined, 'Round') }}</span>
          <span class="roundPreviewTime">
            {{ formatDuration(roundPreviewMs) }} / {{ formatDuration(roundPreview.durationMs) }}
          </span>
        </div>
      </div>

      <button
        type="button"
        class="composerIcon recordAction"
        :aria-label="t('chat.round_cancel', undefined, 'Discard round')"
        :title="t('chat.round_cancel', undefined, 'Discard round')"
        @click="discardRoundPreview"
      >
        <v-icon icon="mdi-delete-outline" size="20" />
      </button>

      <button
        type="button"
        class="composerSend active"
        :aria-label="t('chat.round_send', undefined, 'Send round')"
        :title="t('chat.round_send', undefined, 'Send round')"
        @click="sendRoundPreview"
      >
        <v-icon icon="mdi-send" size="20" />
      </button>
    </div>

    <div
      v-else
      class="composerRow"
      :class="{ withMic: canRecord && !draft.trim() }"
      :aria-disabled="disabled ? 'true' : 'false'"
    >
      <button
        type="button"
        class="composerIcon"
        :disabled="disabled"
        :aria-label="t('chat.emoji', undefined, 'Emoji')"
        :title="t('chat.emoji', undefined, 'Emoji')"
        @pointerenter="prefetchPicker"
        @focus="prefetchPicker"
        @click="pickerOpen = !pickerOpen"
      >
        <v-icon icon="mdi-emoticon-happy-outline" size="20" />
      </button>

      <textarea
        ref="textareaRef"
        v-model="draft"
        class="composerInput"
        :disabled="disabled"
        :placeholder="t('chat.message', undefined, 'Message')"
        :aria-label="t('chat.message', undefined, 'Message')"
        rows="1"
        spellcheck="false"
        @keydown.enter.exact.prevent="handleSend"
        @paste="handlePaste"
      />

      <button
        type="button"
        class="composerIcon"
        :disabled="disabled"
        :aria-label="t('chat.attach', undefined, 'Attach')"
        :title="t('chat.attach', undefined, 'Attach')"
        @click="fileInputRef?.click()"
      >
        <v-icon icon="mdi-paperclip" size="20" />
      </button>

      <button
        v-if="canRecord && !draft.trim()"
        ref="micButtonRef"
        type="button"
        class="composerIcon composerMic"
        :class="{ pressed: micGesture === 'pending' }"
        :disabled="disabled"
        :aria-label="micModeLabel"
        :title="micModeLabel"
        @pointerdown="onMicPointerDown"
        @keydown.enter.prevent="onMicKeyActivate"
        @keydown.space.prevent="onMicKeyActivate"
      >
        <v-icon :icon="recordModePref === 'round' ? 'mdi-video-outline' : 'mdi-microphone'" size="20" />
      </button>

      <button
        type="button"
        class="composerSend"
        :class="{ active: canSend }"
        :disabled="!canSend"
        :aria-label="t('chat.send', undefined, 'Send')"
        :title="t('chat.send', undefined, 'Send')"
        @click="handleSend"
      >
        <span v-if="sending" class="composerSendDots">
          <TypingIndicator />
        </span>
        <v-icon v-else icon="mdi-send" size="20" />
      </button>

      <input
        ref="fileInputRef"
        type="file"
        hidden
        multiple
        @change="handleFileChange"
      />
    </div>
  </div>
</template>

<style scoped>
.composer {
  width: 100%;
  max-width: none;
  display: grid;
  gap: 6px;
  padding: 6px 12px 12px;
  margin: 0;
  position: relative;
}

.pickerPopover {
  position: absolute;
  left: 10px;
  bottom: calc(100% + 8px);
  z-index: 20;
  width: min(410px, calc(100vw - 24px));
  max-width: 100%;
  animation: uiPopIn 140ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.composerFiles {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.composerLinkPreview {
  margin: 0 8px;
}

.replyBar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid rgba(74, 144, 217, 0.7);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.editBar {
  border-left-color: rgba(246, 173, 85, 0.82);
}

.replyMain {
  min-width: 0;
}

.replyAuthor {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
  line-height: 1.2;
}

.replyPreview {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.replyClose {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.composerRow {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  background: var(--msg-panel-glass);
  -webkit-backdrop-filter: blur(calc(var(--msg-glass-blur) * 0.8)) saturate(140%);
  backdrop-filter: blur(calc(var(--msg-glass-blur) * 0.8)) saturate(140%);
  border-radius: 12px;
  box-shadow: var(--shadow-soft);
}

.composerInput {
  width: 100%;
  min-height: 26px;
  max-height: 168px;
  height: 26px;
  border: 0;
  outline: 0;
  resize: none;
  overflow-y: hidden;
  background: transparent;
  padding: 0;
  font-size: 15px;
  line-height: 26px;
  font-family: inherit;
  vertical-align: middle;
}

.composerInput::placeholder {
  line-height: 26px;
  color: var(--text-muted);
}

.composerIcon,
.composerSend {
  width: 34px;
  height: 34px;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
  position: relative;
  border-radius: 12px;
}

.composerSend:disabled,
.composerIcon:disabled {
  opacity: 0.5;
  cursor: default;
}

.composerIcon:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.composerSend {
  border-radius: 12px;
  transition: background 120ms ease, color 120ms ease, transform 80ms ease;
}

.composerSend.active {
  background: var(--accent);
  color: #fff;
}

.composerSend.active:hover:not(:disabled) {
  background: var(--accent-strong);
}

.composerSend:active:not(:disabled) {
  transform: translate3d(0, 1px, 0);
}

.composerSendDots {
  display: grid;
  place-items: center;
  color: #fff;
}

.composerRow.withMic {
  grid-template-columns: auto 1fr auto auto auto;
}

.composerRowRecording {
  grid-template-columns: auto auto 1fr auto auto auto auto;
}

.recordLocked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent-strong);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 4px 10px;
  white-space: nowrap;
}

.recordLock {
  color: var(--text-soft);
}

.recordDot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  animation: recordPulse 1.5s ease-out infinite;
}

.recordDot.paused {
  animation: none;
  background: var(--text-muted);
}

@keyframes recordPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
  }
}

.recordMeter {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  min-width: 0;
  overflow: hidden;
}

.recordMeterBar {
  flex: 1 1 auto;
  min-width: 2px;
  max-width: 4px;
  height: 10%;
  border-radius: 2px;
  background: var(--accent);
  transition: height 70ms linear;
}

.recordTime {
  font-size: 13px;
  font-weight: 700;
  color: #ef4444;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.recordError {
  font-size: 12px;
  color: #ef4444;
  padding: 0 4px;
}

.recordAction:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.composerMic {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: transform 100ms ease;
}

.composerMic.pressed {
  background: var(--accent-soft);
  color: var(--accent-strong);
  transform: scale(0.9);
}

.roundFullscreen {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 24px;
  background: rgba(0, 0, 0, 0.92);
}

.roundFullscreenTop {
  display: flex;
  align-items: center;
  gap: 10px;
}

.roundFullscreenTime {
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  font-variant-numeric: tabular-nums;
}

.roundFullscreenLabel {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.72);
}

.roundFullscreenStage {
  position: relative;
  width: min(72vmin, 420px);
  height: min(72vmin, 420px);
  border-radius: 50%;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #111;
  border: 2px solid rgba(239, 68, 68, 0.65);
}

.roundFullscreenVideo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: #000;
}

.roundFullscreenNoVideo {
  color: rgba(255, 255, 255, 0.6);
  display: grid;
  place-items: center;
}

.roundFullscreenPulse {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45);
  animation: roundViewportPulse 1.6s ease-out infinite;
  pointer-events: none;
}

.roundFullscreenStage.paused .roundFullscreenPulse {
  animation: none;
  opacity: 0;
}

.roundFullscreenControls {
  display: flex;
  align-items: center;
  gap: 14px;
}

.roundFullscreenBtn {
  width: 52px;
  height: 52px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  transition: background 120ms ease, transform 80ms ease;
}

.roundFullscreenBtn:hover {
  background: rgba(255, 255, 255, 0.22);
}

.roundFullscreenBtn:active {
  transform: translate3d(0, 1px, 0);
}

.roundFullscreenBtn.primary {
  background: #ef4444;
  color: #fff;
}

.roundFullscreenBtn.primary:hover {
  background: #dc2626;
}

@keyframes roundViewportPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(239, 68, 68, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
  }
}

.composerRowPreview {
  grid-template-columns: 1fr auto auto;
}

.roundPreview {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.roundPreviewArt {
  position: relative;
  width: 72px;
  height: 72px;
  padding: 0;
  margin: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  display: block;
  outline: 0;
  flex: 0 0 auto;
  background: conic-gradient(var(--accent) var(--ring, 0deg), var(--border-strong) 0deg);
}

.roundPreviewArt:hover {
  filter: brightness(1.04);
}

.roundPreviewArt:active {
  transform: translate3d(0, 1px, 0);
}

.roundPreviewDisc {
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
}

.roundPreviewVideo {
  position: absolute;
  inset: 5px;
  width: calc(100% - 10px);
  height: calc(100% - 10px);
  border-radius: 50%;
  object-fit: cover;
  background: #000;
}

.roundPreviewToggle {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}

.roundPreviewMeta {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.roundPreviewLabel {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
}

.roundPreviewTime {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.roundPreviewAudio {
  display: none;
}
@keyframes uiPopIn {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .pickerPopover { animation: none; }
}
</style>
