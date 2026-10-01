import { computed, ref, shallowRef } from 'vue'
import { getCurrentUser, type CallKind, type CallMediaState, type CallParticipant, type CallRole } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { CallClient, sendCallDecline, type CallJoinedInfo, type CallStatus, type CallTrackSource } from './callClient'
import { startRinging, stopRinging } from './callRinger'
import { tryShowDesktopNotification } from '../chat/chatWorkspace.notifications'

export type IncomingCall = {
  callID: string
  chatID: string
  kind: string
  startedBy: string
  startedAt: string
  reason?: string
}

/** Title/avatar of a call, frozen when it starts or when it rings. */
export type CallIdentity = {
  title: string
  avatarSrc: string
  avatarText: string
}

/** Non-blocking "a live stream is running" notice; never a call prompt. */
export type LiveNotice = {
  callID: string
  chatID: string
  identity: CallIdentity | null
}

const IDLE_MEDIA: CallMediaState = { mic: true, camera: false, screen: false, speaking: false }

/** Nobody picked up within this window -> drop the call as "no answer". */
const NO_ANSWER_TIMEOUT_MS = 60_000
/** How long a transient note ("no answer"/"call ended") stays on screen. */
const NOTE_LIFETIME_MS = 4_000

export const callStatus = ref<CallStatus>('idle')
export const activeCall = shallowRef<CallJoinedInfo | null>(null)
export const callParticipants = shallowRef<CallParticipant[]>([])
export const callMedia = ref<CallMediaState>({ ...IDLE_MEDIA })
export const selfStream = shallowRef<MediaStream | null>(null)
export const remoteStreams = shallowRef<Record<string, Partial<Record<CallTrackSource, MediaStream>>>>({})
export const incomingCall = ref<IncomingCall | null>(null)
export const callError = ref('')
/** Collapsed call state: the overlay hides and a compact bar shows instead. */
export const callMinimized = ref(false)
/** Transient status shown after the call dropped. */
export type CallNote = '' | 'no_answer' | 'declined' | 'ended'
export const callNote = ref<CallNote>('')
/** Frozen call identity: switching chats mid-call must not rename it. */
export const callIdentity = ref<CallIdentity | null>(null)
/**
 * Client-side "live room" flag (Discord-style voice channel): the call is
 * joined as an already-live room, not dialled. Never sent on the wire —
 * the server only knows p2p/group/broadcast, so this rides on kind 'group'.
 */
export const callLive = ref(false)
/** Identity of a ringing call, resolved once when it starts ringing. */
export const incomingIdentity = ref<CallIdentity | null>(null)
export const liveNotice = ref<LiveNotice | null>(null)

export const isCallBusy = computed(() => {
  const status = callStatus.value
  return status === 'connecting' || status === 'joining' || status === 'active' || status === 'ending'
})

let client: CallClient | null = null
let failed = false
let titleResolver: ((chatID: string) => string) | null = null
let identityResolver: ((chatID: string) => CallIdentity | null) | null = null
let noAnswerTimer: number | null = null
let noteTimer: number | null = null
let callNotification: Notification | null = null

const { t } = useI18n()
const toast = useToast()

/** Lets the workspace resolve a chat title for ringing/notification text. */
export function setCallTitleResolver(resolver: (chatID: string) => string): void {
  titleResolver = resolver
}

/** Lets the workspace freeze the title/avatar of a chat when a call starts. */
export function setCallIdentityResolver(resolver: (chatID: string) => CallIdentity | null): void {
  identityResolver = resolver
}

function resolveIdentity(chatID: string): CallIdentity | null {
  try {
    return identityResolver?.(chatID) ?? null
  } catch {
    return null
  }
}

function mediaErrorMessage(source: CallTrackSource): string {
  if (source === 'camera') {
    return t('call.media_error_camera', undefined, 'Camera is unavailable. Check browser permissions and that a camera is connected.')
  }
  if (source === 'screen') {
    return t('call.media_error_screen', undefined, 'Screen sharing was blocked or cancelled. Allow screen capture in the browser and try again.')
  }
  return t(
    'call.media_error_mic',
    undefined,
    'Microphone is unavailable. Check browser permissions, the default input device in system settings and that the microphone is connected.',
  )
}

function selfUserID(): string {
  return getCurrentUser()?.id ?? ''
}

function closeCallNotification(): void {
  if (!callNotification) return
  try {
    callNotification.close()
  } catch {
    // ignore
  }
  callNotification = null
}

function showTransientNote(note: 'no_answer' | 'declined' | 'ended'): void {
  callNote.value = note
  if (noteTimer !== null) window.clearTimeout(noteTimer)
  noteTimer = window.setTimeout(() => {
    noteTimer = null
    callNote.value = ''
  }, NOTE_LIFETIME_MS)
}

function clearNoAnswerWatch(): void {
  if (noAnswerTimer !== null) window.clearTimeout(noAnswerTimer)
  noAnswerTimer = null
}

function hasRemoteParticipant(): boolean {
  const self = selfUserID()
  return callParticipants.value.some((participant) => participant.user_id !== self)
}

// The caller waits for an answer; if nobody ever joins the call is dropped
// and the "no answer" note is drawn for a few seconds. Live rooms and
// broadcasts are waited in, not dialled: sitting alone must never kill them.
function startNoAnswerWatch(kind: string, live: boolean): void {
  clearNoAnswerWatch()
  if (kind === 'broadcast' || live) return
  noAnswerTimer = window.setTimeout(() => {
    noAnswerTimer = null
    if (hasRemoteParticipant() || !client) return
    showTransientNote('no_answer')
    hangup()
  }, NO_ANSWER_TIMEOUT_MS)
}

function resetStreams(): void {
  remoteStreams.value = {}
  selfStream.value = null
}

function setRemoteStream(userID: string, source: CallTrackSource, stream: MediaStream | null): void {
  const next: Record<string, Partial<Record<CallTrackSource, MediaStream>>> = { ...remoteStreams.value }
  const entry: Partial<Record<CallTrackSource, MediaStream>> = { ...(next[userID] ?? {}) }
  if (stream) entry[source] = stream
  else delete entry[source]
  if (Object.keys(entry).length === 0) delete next[userID]
  else next[userID] = entry
  remoteStreams.value = next
}

function createClient(): CallClient {
  // Handlers of an already discarded session must not clobber the state of a
  // newer call, so every callback bails out once `client` moved on.
  const alive = (): boolean => client === instance
  const instance: CallClient = new CallClient(
    {
      onStatus: (status) => {
        if (!alive()) return
        callStatus.value = status
      },
      onJoined: (info) => {
        if (!alive()) return
        activeCall.value = info
        callError.value = ''
        closeCallNotification()
        if (incomingCall.value?.callID === info.callID) clearIncomingState()
      },
      onParticipants: (participants) => {
        if (!alive()) return
        callParticipants.value = participants
        callMedia.value = client?.getMediaState() ?? callMedia.value
        if (hasRemoteParticipant()) clearNoAnswerWatch()
      },
      onMedia: (userID, media) => {
        if (!alive()) return
        const next = callParticipants.value.map((item) => (item.user_id === userID ? { ...item, media } : item))
        callParticipants.value = next
      },
      onRemoteStream: (userID, source, stream) => {
        if (!alive()) return
        setRemoteStream(userID, source, stream)
      },
      onRemoteStreamRemoved: (userID, source, stream) => {
        if (!alive()) return
        // Only the stream that is actually on screen may clear the slot. The
        // track of a stopped share can end *after* its replacement already
        // took over the same (user, source) key — that stale end must not
        // blank the fresh broadcast.
        if (stream && remoteStreams.value[userID]?.[source] !== stream) return
        setRemoteStream(userID, source, null)
      },
      onSelfStream: (stream) => {
        if (!alive()) return
        selfStream.value = stream
      },
      onMediaError: (source) => {
        if (!alive()) return
        // The device could not be acquired: snap the reported state back to
        // reality (e.g. mic off when there is no microphone) and say why.
        callMedia.value = client?.getMediaState() ?? callMedia.value
        toast.error(mediaErrorMessage(source))
      },
      onEnded: (reason) => {
        if (!alive()) return
        activeCall.value = null
        callParticipants.value = []
        callMedia.value = { ...IDLE_MEDIA }
        resetStreams()
        clearNoAnswerWatch()
        callMinimized.value = false
        callLive.value = false
        // Keep the failure visible so the overlay can show the reason instead
        // of silently disappearing; hangup() dismisses it.
        const wasFailed = failed
        callStatus.value = wasFailed ? 'failed' : 'idle'
        failed = false
        // The remote side closed the call (peer hangup or a decline by the
        // callee): say so briefly instead of the overlay vanishing out of
        // nowhere.
        if (!wasFailed && !callNote.value) showTransientNote(reason === 'declined' ? 'declined' : 'ended')
      },
      onError: (code, message) => {
        if (!alive()) return
        callError.value =
          code === 'forbidden'
            ? t('call.stream_forbidden', undefined, 'Only the channel owner and admins can start a live stream.')
            : message || code
        // Only a failure before the call is established should keep the
        // overlay stuck in a failed state; live errors are shown inline.
        if (callStatus.value === 'connecting' || callStatus.value === 'joining') failed = true
      },
    },
    selfUserID(),
  )
  return instance
}

export async function startCall(options: {
  chatID: string
  kind?: CallKind
  role?: CallRole
  video?: boolean
  e2ee?: boolean
  identity?: CallIdentity | null
  /** Live room (voice channel): already-live UI, no dial timeout. Wire kind stays 'group'. */
  live?: boolean
}): Promise<void> {
  if (isCallBusy.value) return
  callError.value = ''
  failed = false
  callNote.value = ''
  if (noteTimer !== null) {
    window.clearTimeout(noteTimer)
    noteTimer = null
  }
  callMinimized.value = false
  closeCallNotification()
  callStatus.value = 'connecting'
  stopRinging()
  incomingCall.value = null
  incomingIdentity.value = null
  liveNotice.value = null
  // Freeze the identity now: switching chats mid-call must not rename it.
  callIdentity.value = options.identity !== undefined ? options.identity : resolveIdentity(options.chatID)
  callLive.value = options.live === true
  client = createClient()
  const kind = options.kind ?? 'group'
  startNoAnswerWatch(kind, callLive.value)
  try {
    await client.start({
      chatID: options.chatID,
      kind,
      role: options.role,
      e2ee: options.e2ee,
      withAudio: true,
      withVideo: Boolean(options.video),
    })
  } catch (error) {
    clearNoAnswerWatch()
    failed = false
    callLive.value = false
    callStatus.value = 'failed'
    callError.value = error instanceof Error ? error.message : String(error)
    client = null
  }
}

export async function acceptIncoming(): Promise<void> {
  const pending = incomingCall.value
  if (!pending) return
  const kind = (pending.kind === 'broadcast' || pending.kind === 'p2p' ? pending.kind : 'group') as CallKind
  const identity = incomingIdentity.value ?? resolveIdentity(pending.chatID)
  clearIncomingState()
  // A broadcast is watched, never presented: joining one means "listen in".
  await startCall({
    chatID: pending.chatID,
    kind,
    role: kind === 'broadcast' ? 'subscriber' : undefined,
    identity,
  })
}

/** Drops the ringing state without touching the call itself. */
function clearIncomingState(): void {
  stopRinging()
  closeCallNotification()
  incomingCall.value = null
  incomingIdentity.value = null
}

export function dismissIncoming(): void {
  const pending = incomingCall.value
  clearIncomingState()
  // The callee never joined the call, so the caller only stops ringing when
  // the server learns about the rejection.
  if (pending?.callID) void sendCallDecline(pending.callID)
}

/** Ends the local call; `remote` marks a hangup that came from the other side. */
function endCall(remote: boolean, reason?: string): void {
  stopRinging()
  failed = false
  callError.value = ''
  clearNoAnswerWatch()
  closeCallNotification()
  const active = client
  client = null
  if (active) void active.leave()
  activeCall.value = null
  callParticipants.value = []
  callMedia.value = { ...IDLE_MEDIA }
  resetStreams()
  callMinimized.value = false
  callLive.value = false
  callStatus.value = 'idle'
  if (remote && !callNote.value) showTransientNote(reason === 'declined' ? 'declined' : 'ended')
}

export function hangup(): void {
  endCall(false)
}

export function minimizeCall(): void {
  if (callStatus.value === 'active' || callStatus.value === 'connecting' || callStatus.value === 'joining') {
    callMinimized.value = true
  }
}

export function restoreCall(): void {
  callMinimized.value = false
}

export async function toggleMic(): Promise<void> {
  const next = !callMedia.value.mic
  const active = client
  callMedia.value = { ...callMedia.value, mic: next }
  if (!active) return
  // A missing microphone snaps the state back and raises a toast.
  await active.setMicEnabled(next).catch(() => undefined)
  if (client === active) callMedia.value = active.getMediaState()
}

export async function toggleCamera(): Promise<void> {
  const next = !callMedia.value.camera
  const active = client
  callMedia.value = { ...callMedia.value, camera: next }
  if (!active) return
  // Acquiring the device can fail (permission/no camera); the button then
  // snaps back instead of showing a dead black square.
  await active.setCameraEnabled(next).catch(() => undefined)
  if (client === active) callMedia.value = active.getMediaState()
}

export async function toggleScreenShare(): Promise<void> {
  const active = client
  const next = !callMedia.value.screen
  callMedia.value = { ...callMedia.value, screen: next }
  if (!active) return
  await active.setScreenShare(next).catch(() => undefined)
  // The picker can be cancelled at any moment: trust the real device state.
  if (client === active) callMedia.value = active.getMediaState()
}

export function handleCallStarted(event: IncomingCall): void {
  if (!event.callID && !event.chatID) return
  if (event.startedBy && event.startedBy === selfUserID()) return
  if (isCallBusy.value) return
  if (incomingCall.value?.callID === event.callID) return
  const identity = resolveIdentity(event.chatID)
  if ((event.kind || '').trim() === 'broadcast') {
    // A channel live stream is optional watching: never ring, never a modal,
    // never an "incoming call" desktop notification. It is surfaced as a
    // non-blocking notice instead.
    if (liveNotice.value?.callID === event.callID) return
    liveNotice.value = { callID: event.callID, chatID: event.chatID, identity }
    return
  }
  incomingCall.value = event
  incomingIdentity.value = identity
  startRinging()
  const chatTitle = (identity?.title || titleResolver?.(event.chatID) || '').trim()
  closeCallNotification()
  tryShowDesktopNotification({
    title: 'Combox',
    body: `Incoming call${chatTitle ? ` \u00b7 ${chatTitle}` : ''}`,
    onShown: (notification) => {
      callNotification = notification
    },
  })
}

export function handleCallEnded(event: IncomingCall): void {
  if (incomingCall.value && event.callID && incomingCall.value.callID === event.callID) {
    clearIncomingState()
  }
  if (liveNotice.value && event.callID && liveNotice.value.callID === event.callID) {
    liveNotice.value = null
  }
  if (activeCall.value && event.callID && activeCall.value.callID === event.callID) {
    endCall(true, event.reason)
  }
}

/** Joins the stream the live notice is about, as a viewer. */
export function watchLiveStream(): void {
  const notice = liveNotice.value
  if (!notice) return
  void startCall({ chatID: notice.chatID, kind: 'broadcast', role: 'subscriber', identity: notice.identity })
}

export function dismissLiveNotice(): void {
  liveNotice.value = null
}

export function getActiveCallClient(): CallClient | null {
  return client
}
