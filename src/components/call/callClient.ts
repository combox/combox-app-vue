import {
  buildCallWsURLWithFreshToken,
  getDeviceID,
  type CallKind,
  type CallMediaState,
  type CallParticipant,
  type CallRole,
  type CallTopology,
  type ICEServerConfig,
} from 'combox-api'

export type CallStatus = 'idle' | 'connecting' | 'joining' | 'active' | 'ending' | 'ended' | 'failed'

export type CallTrackSource = 'audio' | 'camera' | 'screen'

export type CallJoinedInfo = {
  callID: string
  chatID: string
  kind: CallKind
  topology: CallTopology
  role: CallRole
  e2ee: boolean
  meshLimit: number
  participants: CallParticipant[]
  iceServers: RTCIceServer[]
}

export type CallClientHandlers = {
  onStatus?: (status: CallStatus) => void
  onJoined?: (info: CallJoinedInfo) => void
  onParticipants?: (participants: CallParticipant[]) => void
  onMedia?: (userID: string, media: CallMediaState) => void
  onRemoteStream?: (userID: string, source: CallTrackSource, stream: MediaStream) => void
  // `stream` is the MediaStream that just died. Handlers drop it when it is no
  // longer the one on screen, so a stale track ending late cannot wipe the
  // replacement share that took over the same (user, source) slot. Callers that
  // mean "clear everything for this user" omit it.
  onRemoteStreamRemoved?: (userID: string, source: CallTrackSource, stream?: MediaStream) => void
  onSelfStream?: (stream: MediaStream | null) => void
  onMediaError?: (source: CallTrackSource) => void
  onEnded?: (reason: string) => void
  onError?: (code: string, message: string) => void
}

export type JoinOptions = {
  chatID: string
  callID?: string
  kind?: CallKind
  role?: CallRole
  e2ee?: boolean
  withAudio?: boolean
  withVideo?: boolean
}

type SignalFrame = {
  type?: string
  id?: string
  call_id?: string
  chat_id?: string
  kind?: CallKind
  role?: CallRole
  topology?: CallTopology
  e2ee?: boolean
  mesh_limit?: number
  reason?: string
  code?: string
  message?: string
  sdp?: string
  candidate?: string
  sdp_mid?: string
  sdp_mline_index?: number
  from_user_id?: string
  target_user_id?: string
  relay_kind?: string
  media?: CallMediaState
  participants?: CallParticipant[]
  ice_servers?: ICEServerConfig[]
  tracks?: Record<string, string>
}

const PING_INTERVAL_MS = 20_000
const SILENCE_TIMEOUT_MS = 45_000
// A pending offer must be answered or superseded within this window; see the
// watchdog in PeerSession.negotiate — a silently dropped offer otherwise
// strands the peer forever and no later track can ever be negotiated.
const OFFER_TIMEOUT_MS = 6_000
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000]
const SPEAKING_INTERVAL_MS = 1_000
const SPEAKING_THRESHOLD = 0.06
const SCREEN_STREAM_ID = 'cb-screen'
const TRACK_SOURCE_RE = /^(.+)#(audio|camera|screen)(#\d+)?$/

// Track ids are compared case insensitively everywhere (the server relays the
// mapping with lowered keys, see normalizeTrackKey on the Go side).
function trackKey(trackID: string): string {
  return trackID.trim().toLowerCase()
}

function asTrackSource(value: string): CallTrackSource | null {
  const source = value.trim().toLowerCase()
  return source === 'audio' || source === 'camera' || source === 'screen' ? source : null
}

function toRTCIceServers(servers: ICEServerConfig[] | undefined): RTCIceServer[] {
  if (!servers?.length) return []
  return servers.map((server) => ({
    urls: server.urls,
    username: server.username,
    credential: server.credential,
  }))
}

type TrackTarget = { userID: string; source: CallTrackSource }

// The SFU rewrites remote track ids to `<userID>#<source>`; mesh keeps the
// sender's raw track id, whose source is only known through the announced
// `call.tracks` map (`lookup`).
function resolveTrackTarget(
  track: MediaStreamTrack,
  stream: MediaStream | undefined,
  fallbackUserID: string,
  lookup?: (trackID: string) => TrackTarget | null,
): TrackTarget | null {
  const parsed = TRACK_SOURCE_RE.exec(track.id)
  if (parsed) {
    return { userID: parsed[1], source: parsed[2] as CallTrackSource }
  }
  const announced = lookup?.(track.id)
  if (announced) {
    return { userID: announced.userID || fallbackUserID, source: announced.source }
  }
  if (stream?.id === SCREEN_STREAM_ID) return { userID: fallbackUserID, source: 'screen' }
  if (track.kind === 'audio') return { userID: fallbackUserID, source: 'audio' }
  return { userID: fallbackUserID, source: 'camera' }
}

// PeerSession wraps one RTCPeerConnection: either a mesh leg towards another
// participant or the single SFU leg. Signaling transport is injected so the
// session stays transport agnostic.
type RemoteTrackEntry = {
  track: MediaStreamTrack
  stream: MediaStream
  owner: string | null
  source: CallTrackSource | null
}

class PeerSession {
  pc: RTCPeerConnection
  polite: boolean
  remoteUserID: string | null
  makingOffer = false
  remoteDescriptionSet = false
  pendingRemoteCandidates: RTCIceCandidateInit[] = []
  private closed = false
  private trackEntries = new Map<string, RemoteTrackEntry>()
  private offerTimer: number | null = null

  private sendOffer: (sdp: string) => void
  private sendAnswer: (sdp: string) => void
  private sendCandidate: (candidate: RTCIceCandidateInit) => void
  private onStream: (userID: string, source: CallTrackSource, stream: MediaStream) => void
  private onStreamEnded: (userID: string, source: CallTrackSource, stream: MediaStream) => void
  private resolveTarget: (track: MediaStreamTrack, stream: MediaStream) => TrackTarget | null

  constructor(options: {
    iceServers: RTCIceServer[]
    polite: boolean
    remoteUserID: string | null
    sendOffer: (sdp: string) => void
    sendAnswer: (sdp: string) => void
    sendCandidate: (candidate: RTCIceCandidateInit) => void
    onStream: (userID: string, source: CallTrackSource, stream: MediaStream) => void
    onStreamEnded: (userID: string, source: CallTrackSource, stream: MediaStream) => void
    resolveTarget: (track: MediaStreamTrack, stream: MediaStream) => TrackTarget | null
  }) {
    this.polite = options.polite
    this.remoteUserID = options.remoteUserID
    this.sendOffer = options.sendOffer
    this.sendAnswer = options.sendAnswer
    this.sendCandidate = options.sendCandidate
    this.onStream = options.onStream
    this.onStreamEnded = options.onStreamEnded
    this.resolveTarget = options.resolveTarget
    this.pc = new RTCPeerConnection({ iceServers: options.iceServers })

    this.pc.onnegotiationneeded = () => {
      void this.negotiate()
    }
    this.pc.onicecandidate = (event) => {
      if (!event.candidate) return
      this.sendCandidate(event.candidate.toJSON())
    }
    this.pc.ontrack = (event) => {
      // One MediaStream per track. The sender reuses a single stream id across
      // stop -> start cycles, so event.streams[0] for a re-enabled screen share
      // is the very same object — still holding the previous, dead track. A
      // <video> fed that object renders the dead track: a black rectangle
      // even though the fresh track is already live.
      const stream = new MediaStream([event.track])
      const entry: RemoteTrackEntry = { track: event.track, stream, owner: null, source: null }
      this.trackEntries.set(event.track.id, entry)
      event.track.onended = () => {
        if (this.closed) return
        this.unpublish(entry)
        this.trackEntries.delete(entry.track.id)
      }
      // A remote track that stops delivering frames (camera/screen switched
      // off, sender removed it) reports itself as muted instead of ended;
      // without this the frozen last frame stays on screen forever.
      event.track.onmute = () => {
        if (this.closed) return
        this.unpublish(entry)
      }
      event.track.onunmute = () => {
        if (this.closed) return
        this.publish(entry, true)
      }
      this.publish(entry)
    }
  }

  // `reannounce` re-emits a stream whose source did not change: a remote track
  // arrives muted until the first frames flow, so the UI may have rejected it
  // (`liveVideo` treats a muted track as dead). Without the re-emit nothing
  // reactively changes and the tile stays empty until an unrelated update.
  private publish(entry: RemoteTrackEntry, reannounce = false): void {
    if (this.closed || entry.track.readyState === 'ended') return
    const target = this.resolveTarget(entry.track, entry.stream)
    if (!target) return
    if (entry.source === target.source && entry.owner === target.userID) {
      if (reannounce) this.onStream(target.userID, target.source, entry.stream)
      return
    }
    this.unpublish(entry)
    entry.source = target.source
    entry.owner = target.userID
    this.onStream(target.userID, target.source, entry.stream)
  }

  private unpublish(entry: RemoteTrackEntry): void {
    if (!entry.source || !entry.owner) return
    const source = entry.source
    const owner = entry.owner
    const stream = entry.stream
    entry.source = null
    entry.owner = null
    this.onStreamEnded(owner, source, stream)
  }

  // A `call.tracks` map can arrive after the media it describes (mesh keeps
  // opaque track ids), so every known track is reclassified when it changes.
  refreshTrackSources(): void {
    for (const entry of this.trackEntries.values()) {
      this.publish(entry, true)
    }
  }

  async addTrack(track: MediaStreamTrack, stream: MediaStream): Promise<void> {
    if (this.closed) return
    const already = this.pc.getSenders().some((sender) => sender.track?.id === track.id)
    if (already) return
    this.pc.addTrack(track, stream)
  }

  async removeTrack(track: MediaStreamTrack): Promise<void> {
    if (this.closed) return
    const sender = this.pc.getSenders().find((item) => item.track?.id === track.id)
    if (!sender) return
    await this.pc.removeTrack(sender)
  }

  // Stops whose sender was left behind: a finished screen share used to keep
  // its (already dead) sender forever, so the remote side only ever saw a
  // muted zombie track and the next share had to fight it for the same slot.
  async removeMissingTracks(active: ReadonlySet<MediaStreamTrack>): Promise<void> {
    if (this.closed) return
    for (const sender of this.pc.getSenders()) {
      const track = sender.track
      if (track && !active.has(track)) await this.pc.removeTrack(sender)
    }
  }

  async negotiate(): Promise<void> {
    if (this.closed || this.makingOffer) return
    if (this.pc.signalingState !== 'stable') return
    this.makingOffer = true
    try {
      const offer = await this.pc.createOffer()
      if (this.pc.signalingState !== 'stable') return
      await this.pc.setLocalDescription(offer)
      const sdp = this.pc.localDescription?.sdp
      if (sdp) {
        this.sendOffer(sdp)
        this.armOfferWatchdog()
      }
    } catch {
      // Negotiation races are retried by the next negotiationneeded event.
    } finally {
      this.makingOffer = false
    }
  }

  // Perfect negotiation lets the far side ignore a colliding offer — and it
  // then has no reason to ever answer it, because it expects us to roll back
  // on *its* next offer. If that offer never comes (it had nothing of its own
  // to send), we would sit in have-local-offer forever: every later change,
  // such as starting a screen share, would be refused by the stable-state
  // check above without ever reaching the remote. Roll back and try again
  // instead of waiting for an answer that will not arrive.
  private armOfferWatchdog(): void {
    this.clearOfferWatchdog()
    this.offerTimer = window.setTimeout(() => {
      this.offerTimer = null
      if (this.closed || this.pc.signalingState !== 'have-local-offer') return
      void (async () => {
        try {
          await this.pc.setLocalDescription({ type: 'rollback' })
        } catch {
          return
        }
        await this.negotiate()
      })()
    }, OFFER_TIMEOUT_MS)
  }

  private clearOfferWatchdog(): void {
    if (this.offerTimer !== null) window.clearTimeout(this.offerTimer)
    this.offerTimer = null
  }

  async handleRemoteOffer(sdp: string): Promise<void> {
    if (this.closed) return
    const collision = this.makingOffer || this.pc.signalingState !== 'stable'
    if (collision && !this.polite) return
    // The far side answered (or superseded) our offer: stop watching it.
    this.clearOfferWatchdog()
    if (collision) {
      try {
        await this.pc.setLocalDescription({ type: 'rollback' })
      } catch {
        return
      }
    }
    await this.pc.setRemoteDescription({ type: 'offer', sdp })
    this.remoteDescriptionSet = true
    await this.flushPendingCandidates()
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    const out = this.pc.localDescription?.sdp
    if (out) this.sendAnswer(out)
  }

  async handleRemoteAnswer(sdp: string): Promise<void> {
    if (this.closed) return
    if (this.pc.signalingState !== 'have-local-offer') return
    await this.pc.setRemoteDescription({ type: 'answer', sdp })
    this.remoteDescriptionSet = true
    this.clearOfferWatchdog()
    await this.flushPendingCandidates()
  }

  async handleRemoteCandidate(init: RTCIceCandidateInit): Promise<void> {
    if (this.closed) return
    if (!this.remoteDescriptionSet) {
      this.pendingRemoteCandidates.push(init)
      return
    }
    try {
      await this.pc.addIceCandidate(init)
    } catch {
      // Late candidates from a superseded negotiation are harmless.
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const pending = this.pendingRemoteCandidates
    this.pendingRemoteCandidates = []
    for (const candidate of pending) {
      try {
        await this.pc.addIceCandidate(candidate)
      } catch {
        // ignore
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.clearOfferWatchdog()
    this.pc.onnegotiationneeded = null
    this.pc.onicecandidate = null
    this.pc.ontrack = null
    try {
      this.pc.close()
    } catch {
      // ignore
    }
  }
}

export class CallClient {
  private handlers: CallClientHandlers
  private selfUserID: string
  private ws: WebSocket | null = null
  private status: CallStatus = 'idle'
  private info: CallJoinedInfo | null = null
  private participants = new Map<string, CallParticipant>()
  private peers = new Map<string, PeerSession>()
  private sfuPeer: PeerSession | null = null
  private localAudio: MediaStreamTrack | null = null
  private localCamera: MediaStreamTrack | null = null
  private localScreen: MediaStreamTrack | null = null
  private localStreams = { main: new MediaStream(), screen: new MediaStream() }
  private media: CallMediaState = { mic: true, camera: false, screen: false, speaking: false }
  private joinOptions: JoinOptions | null = null
  private joinRequestID: string | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private lastInboundAt = 0
  private stopped = false
  private speakingTimer: ReturnType<typeof setInterval> | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private analyserSource: MediaStreamAudioSourceNode | null = null
  private speaking = false
  private lastSpeakingSentAt = 0
  /** Announced `call.tracks` of remote publishers: track id -> owner/source. */
  private remoteTrackSources = new Map<string, TrackTarget>()

  constructor(handlers: CallClientHandlers, selfUserID: string) {
    this.handlers = handlers
    this.selfUserID = selfUserID
  }

  getStatus(): CallStatus {
    return this.status
  }

  getInfo(): CallJoinedInfo | null {
    return this.info
  }

  getParticipants(): CallParticipant[] {
    return [...this.participants.values()]
  }

  getMediaState(): CallMediaState {
    return { ...this.media }
  }

  async start(options: JoinOptions): Promise<void> {
    this.joinOptions = options
    this.stopped = false
    this.reconnectAttempt = 0
    this.setStatus('connecting')
    await this.openSignal()
    await this.sendJoin()
  }

  async leave(): Promise<void> {
    if (this.status === 'idle' || this.status === 'ended') return
    this.stopped = true
    this.setStatus('ending')
    const callID = this.info?.callID
    if (callID) this.send({ type: 'call.leave', call_id: callID, id: this.nextID('leave') })
    await this.teardown('left')
  }

  hangup(): void {
    void this.leave()
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.media.mic = enabled
    if (!enabled || this.localAudio) {
      if (this.localAudio) this.localAudio.enabled = enabled
      this.pushMedia()
      return
    }
    // The microphone may be missing (join without audio, denied permission):
    // re-enabling acquires the device and announces the new track.
    const track = await this.acquireAudio()
    if (!track) {
      this.media.mic = false
      this.pushMedia()
      this.handlers.onMediaError?.('audio')
      return
    }
    this.localAudio = track
    track.enabled = true
    this.localStreams.main.addTrack(track)
    this.attachSpeakingProbe(track)
    await this.propagateLocalTracks()
    this.announceTracks()
    this.pushMedia()
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (enabled && !this.localCamera) {
      // The camera is acquired lazily: a join only asks for the microphone, so
      // the first toggle grabs the device and announces the new track.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        const [track] = stream.getVideoTracks()
        if (!track) {
          this.media.camera = false
          this.pushMedia()
          this.handlers.onMediaError?.('camera')
          return
        }
        this.localCamera = track
        this.localCamera.enabled = true
        this.localStreams.main.addTrack(track)
        await this.propagateLocalTracks()
        this.announceTracks()
        this.media.camera = true
        this.pushMedia()
        this.handlers.onSelfStream?.(this.selfViewStream())
      } catch {
        // Permission denied / no device: stay in audio-only mode.
        this.media.camera = false
        this.pushMedia()
        this.handlers.onMediaError?.('camera')
      }
      return
    }
    this.media.camera = enabled
    if (this.localCamera) this.localCamera.enabled = enabled
    this.pushMedia()
    // A fresh MediaStream identity forces the self view to re-attach: reusing
    // the previous object left the preview bound to the old, just-disabled
    // track after an off -> on toggle, i.e. a black square.
    this.handlers.onSelfStream?.(this.selfViewStream())
  }

  async setScreenShare(enabled: boolean): Promise<void> {
    if (enabled) {
      if (this.localScreen) return
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        const [track] = stream.getVideoTracks()
        if (!track) {
          this.media.screen = false
          this.pushMedia()
          this.handlers.onMediaError?.('screen')
          return
        }
        this.localScreen = track
        track.onended = () => {
          void this.setScreenShare(false)
        }
        this.media.screen = true
        this.localStreams.screen.addTrack(track)
        // Announce the source map *before* the media reaches the SFU: the room
        // labels a subscriber's track when it subscribes, so a map that lands
        // late leaves the screen share permanently named "camera" — rendered
        // as a cropped tile in the participant grid instead of the stage.
        this.announceTracks()
        await this.propagateLocalTracks()
        this.announceTracks()
        this.handlers.onSelfStream?.(this.selfViewStream())
      } catch {
        this.media.screen = false
        this.pushMedia()
        this.handlers.onMediaError?.('screen')
      }
      this.pushMedia()
      return
    }
    const track = this.localScreen
    this.localScreen = null
    this.media.screen = false
    if (track) {
      track.onended = null
      track.stop()
      this.localStreams.screen.removeTrack(track)
      await this.propagateLocalTracks()
      this.announceTracks()
    }
    this.pushMedia()
    this.handlers.onSelfStream?.(this.selfViewStream())
  }

  getSelfViewStream(): MediaStream {
    return this.selfViewStream()
  }

  // -- local media ---------------------------------------------------------

  private selfViewStream(): MediaStream {
    const stream = new MediaStream()
    if (this.localCamera) stream.addTrack(this.localCamera)
    return stream
  }

  // Opens the microphone. A missing or denied device resolves to null instead
  // of throwing so the join never dies over it — but the caller must treat
  // null as "no microphone", never as a working one.
  private async acquireAudio(): Promise<MediaStreamTrack | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const [track] = stream.getAudioTracks()
      return track ?? null
    } catch {
      return null
    }
  }

  private async ensureLocalMedia(options: JoinOptions): Promise<void> {
    const wantAudio = options.withAudio !== false
    const wantVideo = options.withVideo === true
    if (wantAudio && !this.localAudio) {
      const track = await this.acquireAudio()
      if (track) {
        this.localAudio = track
        this.localAudio.enabled = this.media.mic
        this.localStreams.main.addTrack(track)
        this.attachSpeakingProbe(track)
      } else {
        // No usable microphone: the mic must not be reported as on, and the
        // user has to learn why (permission / default device / unplugged).
        this.media.mic = false
        this.handlers.onMediaError?.('audio')
      }
    }
    if (wantVideo && !this.localCamera) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
        const [track] = stream.getVideoTracks()
        if (!track) throw new Error('no_video_track')
        this.localCamera = track
        this.media.camera = true
        this.localCamera.enabled = true
        this.localStreams.main.addTrack(track)
      } catch {
        this.media.camera = false
        this.handlers.onMediaError?.('camera')
      }
    }
    this.handlers.onSelfStream?.(this.selfViewStream())
    // Peers must see the real device state, not the optimistic default.
    this.pushMedia()
  }

  private async propagateLocalTracks(): Promise<void> {
    const active = new Set<MediaStreamTrack>([
      ...this.localStreams.main.getTracks(),
      ...this.localStreams.screen.getTracks(),
    ])
    const peers = [...this.peers.values()]
    if (this.sfuPeer) peers.push(this.sfuPeer)
    for (const peer of peers) {
      // Drop first: a re-share adds a new track while the old sender may still
      // hold the stopped one, and the remote side needs the old track gone
      // (ended, not just muted) before the replacement can be shown.
      await peer.removeMissingTracks(active)
      for (const track of this.localStreams.main.getTracks()) {
        await peer.addTrack(track, this.localStreams.main)
      }
      for (const track of this.localStreams.screen.getTracks()) {
        await peer.addTrack(track, this.localStreams.screen)
      }
    }
  }

  private announceTracks(): void {
    const mapping: Record<string, string> = {}
    for (const track of this.localStreams.main.getTracks()) {
      mapping[track.id] = track.kind === 'audio' ? 'audio' : 'camera'
    }
    for (const track of this.localStreams.screen.getTracks()) {
      mapping[track.id] = 'screen'
    }
    if (!Object.keys(mapping).length) return
    const callID = this.info?.callID
    if (callID) this.send({ type: 'call.tracks', call_id: callID, tracks: mapping })
  }

  // Mesh keeps the sender's raw track id, whose media source is only known
  // from the announced `call.tracks` map; every peer reclassifies its tracks
  // whenever a new announcement lands.
  private readonly lookupRemoteTrack = (trackID: string): TrackTarget | null =>
    this.remoteTrackSources.get(trackKey(trackID)) ?? null

  private attachSpeakingProbe(track: MediaStreamTrack): void {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      this.audioContext ??= new Ctor()
      const context = this.audioContext
      const stream = new MediaStream([track])
      this.analyserSource = context.createMediaStreamSource(stream)
      this.analyser = context.createAnalyser()
      this.analyser.fftSize = 512
      this.analyserSource.connect(this.analyser)
      const buffer = new Float32Array(this.analyser.fftSize)
      this.speakingTimer = setInterval(() => {
        if (!this.analyser) return
        this.analyser.getFloatTimeDomainData(buffer)
        let sum = 0
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i]
        const rms = Math.sqrt(sum / buffer.length)
        const now = Date.now()
        const active = rms > SPEAKING_THRESHOLD
        if (active !== this.speaking || (active && now - this.lastSpeakingSentAt > SPEAKING_INTERVAL_MS * 5)) {
          this.speaking = active
          this.lastSpeakingSentAt = now
          const next = { ...this.media, speaking: active }
          this.media = next
          this.pushMedia()
        }
      }, SPEAKING_INTERVAL_MS)
    } catch {
      // Audio analysis is an enhancement; never break the call over it.
    }
  }

  // -- signaling -----------------------------------------------------------

  private async openSignal(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    const url = await buildCallWsURLWithFreshToken()
    if (!url) throw new Error('unauthorized')
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url)
      this.ws = socket
      socket.onopen = () => {
        this.lastInboundAt = Date.now()
        this.startPing()
        resolve()
      }
      socket.onmessage = (event) => {
        this.lastInboundAt = Date.now()
        if (typeof event.data === 'string') this.handleFrame(event.data)
      }
      socket.onerror = () => {
        reject(new Error('signaling_connection_failed'))
      }
      socket.onclose = () => {
        this.stopPing()
        if (this.ws === socket) this.ws = null
        if (!this.stopped && this.status !== 'idle' && this.status !== 'ended') {
          this.scheduleReconnect()
        }
      }
    })
  }

  private async sendJoin(): Promise<void> {
    const options = this.joinOptions
    if (!options) return
    this.setStatus('joining')
    const id = this.nextID('join')
    this.joinRequestID = id
    this.send({
      type: 'call.join',
      id,
      chat_id: options.chatID,
      call_id: options.callID ?? '',
      kind: options.kind ?? 'group',
      role: options.role ?? '',
      e2ee: options.e2ee ?? false,
      device_id: getDeviceID(),
    })
  }

  private nextID(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  private send(frame: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(frame))
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastInboundAt > SILENCE_TIMEOUT_MS) {
        try {
          this.ws.close()
        } catch {
          // ignore
        }
        return
      }
      const callID = this.info?.callID ?? ''
      this.send({ type: 'call.ping', id: this.nextID('ping'), call_id: callID })
    }, PING_INTERVAL_MS)
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped || !this.joinOptions) return
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)]
    this.reconnectAttempt += 1
    this.setStatus('connecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.reconnect()
    }, delay)
  }

  private async reconnect(): Promise<void> {
    if (this.stopped || !this.joinOptions) return
    try {
      await this.openSignal()
      await this.sendJoin()
    } catch {
      this.scheduleReconnect()
    }
  }

  // -- frame handling ------------------------------------------------------

  private handleFrame(raw: string): void {
    let frame: SignalFrame
    try {
      frame = JSON.parse(raw) as SignalFrame
    } catch {
      return
    }
    switch (frame.type) {
      case 'call.joined':
        this.handleJoined(frame)
        break
      case 'call.peer_joined':
        this.handlePeerJoined(frame)
        break
      case 'call.peer_left':
        this.handlePeerLeft(frame)
        break
      case 'call.escalate':
        void this.handleEscalate()
        break
      case 'call.offer':
        void this.handleRemoteOfferFrame(frame)
        break
      case 'call.answer':
        void this.handleRemoteAnswerFrame(frame)
        break
      case 'call.candidate':
        void this.handleRemoteCandidateFrame(frame)
        break
      case 'call.relay':
        void this.handleRelayFrame(frame)
        break
      case 'call.media':
        this.handleMediaFrame(frame)
        break
      case 'call.tracks':
        this.handleTracksFrame(frame)
        break
      case 'call.ended':
        this.handleEnded(frame)
        break
      case 'call.error':
        this.handleErrorFrame(frame)
        break
      default:
        break
    }
  }

  private handleJoined(frame: SignalFrame): void {
    if (frame.id && this.joinRequestID && frame.id !== this.joinRequestID) return
    this.joinRequestID = null
    // A rejoin rebuilds every peer connection from scratch while keeping the
    // local media devices alive.
    for (const peer of this.peers.values()) peer.close()
    this.peers.clear()
    if (this.sfuPeer) {
      this.sfuPeer.close()
      this.sfuPeer = null
    }
    for (const source of ['audio', 'camera', 'screen'] as CallTrackSource[]) {
      for (const userID of this.participants.keys()) {
        this.handlers.onRemoteStreamRemoved?.(userID, source)
      }
    }
    const participants = frame.participants ?? []
    this.participants = new Map(participants.map((item) => [item.user_id, item]))
    const info: CallJoinedInfo = {
      callID: frame.call_id ?? '',
      chatID: frame.chat_id ?? this.joinOptions?.chatID ?? '',
      kind: frame.kind ?? 'group',
      topology: frame.topology ?? 'mesh',
      role: frame.role ?? 'publisher',
      e2ee: frame.e2ee ?? false,
      meshLimit: frame.mesh_limit ?? 2,
      participants,
      iceServers: toRTCIceServers(frame.ice_servers),
    }
    this.info = info
    this.reconnectAttempt = 0
    this.setStatus('active')
    this.handlers.onJoined?.(info)
    this.handlers.onParticipants?.(participants)
    void this.buildPeersForTopology(info)
  }

  private async buildPeersForTopology(info: CallJoinedInfo): Promise<void> {
    if (this.joinOptions) {
      await this.ensureLocalMedia(this.joinOptions).catch(() => undefined)
    }
    if (info.topology === 'mesh') {
      for (const participant of this.participants.values()) {
        if (participant.user_id === this.selfUserID) continue
        this.ensureMeshPeer(participant.user_id, info)
      }
    } else {
      this.ensureSFUPeer(info)
    }
    await this.propagateLocalTracks()
    this.announceTracks()
  }

  private handlePeerJoined(frame: SignalFrame): void {
    const participant = frame.participants?.[0]
    if (!participant) return
    this.participants.set(participant.user_id, participant)
    this.handlers.onParticipants?.(this.getParticipants())
    if (this.info?.topology === 'mesh' && participant.user_id !== this.selfUserID) {
      this.ensureMeshPeer(participant.user_id, this.info)
      void this.propagateLocalTracks().then(() => this.announceTracks())
    }
  }

  private handlePeerLeft(frame: SignalFrame): void {
    const participant = frame.participants?.[0]
    if (!participant) return
    this.participants.delete(participant.user_id)
    this.handlers.onParticipants?.(this.getParticipants())
    const peer = this.peers.get(participant.user_id)
    if (peer) {
      peer.close()
      this.peers.delete(participant.user_id)
    }
    for (const [key, target] of this.remoteTrackSources) {
      if (target.userID === participant.user_id) this.remoteTrackSources.delete(key)
    }
    for (const source of ['audio', 'camera', 'screen'] as CallTrackSource[]) {
      this.handlers.onRemoteStreamRemoved?.(participant.user_id, source)
    }
  }

  private async handleEscalate(): Promise<void> {
    if (!this.info) return
    this.info = { ...this.info, topology: 'sfu' }
    for (const peer of this.peers.values()) peer.close()
    this.peers.clear()
    this.ensureSFUPeer(this.info)
    await this.propagateLocalTracks()
    this.announceTracks()
  }

  private handleRemoteOfferFrame(frame: SignalFrame): void {
    const peer = this.peerForFrame(frame)
    if (!peer || !frame.sdp) return
    void peer.handleRemoteOffer(frame.sdp).catch(() => undefined)
  }

  private handleRemoteAnswerFrame(frame: SignalFrame): void {
    const peer = this.peerForFrame(frame)
    if (!peer || !frame.sdp) return
    void peer.handleRemoteAnswer(frame.sdp).catch(() => undefined)
  }

  private handleRemoteCandidateFrame(frame: SignalFrame): void {
    const peer = this.peerForFrame(frame)
    if (!peer || !frame.candidate) return
    void peer
      .handleRemoteCandidate({
        candidate: frame.candidate,
        sdpMid: frame.sdp_mid ?? undefined,
        sdpMLineIndex: frame.sdp_mline_index ?? undefined,
      })
      .catch(() => undefined)
  }

  private async handleRelayFrame(frame: SignalFrame): Promise<void> {
    const from = frame.from_user_id
    if (!from) return
    const peer = this.peers.get(from)
    if (!peer) return
    try {
      if (frame.relay_kind === 'offer' && frame.sdp) await peer.handleRemoteOffer(frame.sdp)
      else if (frame.relay_kind === 'answer' && frame.sdp) await peer.handleRemoteAnswer(frame.sdp)
      else if (frame.relay_kind === 'candidate' && frame.candidate) {
        await peer.handleRemoteCandidate({
          candidate: frame.candidate,
          sdpMid: frame.sdp_mid ?? undefined,
          sdpMLineIndex: frame.sdp_mline_index ?? undefined,
        })
      }
    } catch {
      // A rejected renegotiation is recovered by the next offer.
    }
  }

  private handleMediaFrame(frame: SignalFrame): void {
    const target = frame.participants?.[0]?.user_id
    const media = frame.media
    if (!target || !media) return
    const existing = this.participants.get(target)
    const merged: CallParticipant = { ...(existing ?? { user_id: target, role: 'publisher', joined_at: '' }), media }
    this.participants.set(target, merged)
    this.handlers.onMedia?.(target, media)
    this.handlers.onParticipants?.(this.getParticipants())
  }

  // A publisher announces its track -> source map so receivers can tell a
  // screen share from a camera (raw mesh track ids carry no source). The map
  // replaces the publisher's previous one and triggers a reclassification of
  // every track already received.
  private handleTracksFrame(frame: SignalFrame): void {
    const owner = (frame.from_user_id ?? '').trim()
    if (!owner) return
    for (const [key, target] of this.remoteTrackSources) {
      if (target.userID === owner) this.remoteTrackSources.delete(key)
    }
    for (const [trackID, source] of Object.entries(frame.tracks ?? {})) {
      const normalized = asTrackSource(source)
      if (!normalized) continue
      this.remoteTrackSources.set(trackKey(trackID), { userID: owner, source: normalized })
    }
    for (const peer of this.peers.values()) peer.refreshTrackSources()
    this.sfuPeer?.refreshTrackSources()
  }

  private handleEnded(frame: SignalFrame): void {
    const reason = frame.reason ?? 'ended'
    void this.teardown(reason)
  }

  private handleErrorFrame(frame: SignalFrame): void {
    const code = frame.code ?? 'error'
    const message = frame.message ?? ''
    if (frame.id && this.joinRequestID && frame.id === this.joinRequestID) {
      this.joinRequestID = null
      this.setStatus('failed')
      this.handlers.onError?.(code, message || code)
      void this.teardown(code)
      return
    }
    if (code === 'ice_failed') {
      // The server side peer died; drop ours so a fresh offer rebuilds it.
      if (this.sfuPeer) {
        this.sfuPeer.close()
        this.sfuPeer = null
        if (this.info) this.ensureSFUPeer(this.info)
        void this.propagateLocalTracks().then(() => this.announceTracks())
      }
      return
    }
    this.handlers.onError?.(code, message || code)
  }

  private peerForFrame(frame: SignalFrame): PeerSession | null {
    if (frame.from_user_id) return this.peers.get(frame.from_user_id) ?? null
    if (this.sfuPeer) return this.sfuPeer
    return null
  }

  // -- peer factories ------------------------------------------------------

  private ensureMeshPeer(remoteUserID: string, info: CallJoinedInfo): PeerSession {
    const existing = this.peers.get(remoteUserID)
    if (existing) return existing
    // Deterministic perfect negotiation: the lexicographically smaller user
    // id is the impolite peer and drives offers; the other yields.
    const polite = this.selfUserID > remoteUserID
    const peer = new PeerSession({
      iceServers: info.iceServers,
      polite,
      remoteUserID,
      sendOffer: (sdp) => this.relay(remoteUserID, 'offer', { sdp }),
      sendAnswer: (sdp) => this.relay(remoteUserID, 'answer', { sdp }),
      sendCandidate: (candidate) =>
        this.relay(remoteUserID, 'candidate', {
          candidate: candidate.candidate,
          sdp_mid: candidate.sdpMid ?? '',
          sdp_mline_index: candidate.sdpMLineIndex ?? 0,
        }),
      onStream: (_userID, source, stream) => this.handlers.onRemoteStream?.(remoteUserID, source, stream),
      onStreamEnded: (_userID, source, stream) => this.handlers.onRemoteStreamRemoved?.(remoteUserID, source, stream),
      resolveTarget: (track, stream) => resolveTrackTarget(track, stream, remoteUserID, this.lookupRemoteTrack),
    })
    this.peers.set(remoteUserID, peer)
    return peer
  }

  private ensureSFUPeer(info: CallJoinedInfo): PeerSession {
    if (this.sfuPeer) return this.sfuPeer
    const callID = info.callID
    const peer = new PeerSession({
      iceServers: info.iceServers,
      polite: true,
      remoteUserID: null,
      sendOffer: (sdp) => this.send({ type: 'call.offer', id: this.nextID('offer'), call_id: callID, sdp }),
      sendAnswer: (sdp) => this.send({ type: 'call.answer', call_id: callID, sdp }),
      sendCandidate: (candidate) =>
        this.send({
          type: 'call.candidate',
          call_id: callID,
          candidate: candidate.candidate,
          sdp_mid: candidate.sdpMid ?? '',
          sdp_mline_index: candidate.sdpMLineIndex ?? 0,
        }),
      onStream: (owner, source, stream) => {
        if (owner) this.handlers.onRemoteStream?.(owner, source, stream)
      },
      onStreamEnded: (owner, source, stream) => {
        if (owner) {
          this.handlers.onRemoteStreamRemoved?.(owner, source, stream)
          return
        }
        for (const participant of this.participants.values()) {
          this.handlers.onRemoteStreamRemoved?.(participant.user_id, source, stream)
        }
      },
      // The SFU rewrites track ids to `<userID>#<source>`; the announced map
      // is the fallback whenever a forwarded id carries no source yet.
      resolveTarget: (track, stream) => resolveTrackTarget(track, stream, '', this.lookupRemoteTrack),
    })
    this.sfuPeer = peer
    return peer
  }

  private relay(targetUserID: string, relayKind: 'offer' | 'answer' | 'candidate', payload: Record<string, unknown>): void {
    const callID = this.info?.callID ?? ''
    this.send({ type: 'call.relay', call_id: callID, target_user_id: targetUserID, relay_kind: relayKind, ...payload })
  }

  private pushMedia(): void {
    const callID = this.info?.callID
    if (!callID) return
    this.send({ type: 'call.media', call_id: callID, media: { ...this.media } })
  }

  // -- lifecycle -----------------------------------------------------------

  private setStatus(status: CallStatus): void {
    if (this.status === status) return
    this.status = status
    this.handlers.onStatus?.(status)
  }

  private async teardown(reason: string): Promise<void> {
    this.stopped = true
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.speakingTimer) {
      clearInterval(this.speakingTimer)
      this.speakingTimer = null
    }
    for (const peer of this.peers.values()) peer.close()
    this.peers.clear()
    if (this.sfuPeer) {
      this.sfuPeer.close()
      this.sfuPeer = null
    }
    this.participants.clear()
    this.remoteTrackSources.clear()
    this.info = null
    this.joinRequestID = null
    const socket = this.ws
    this.ws = null
    if (socket) {
      socket.onclose = null
      socket.onmessage = null
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
    this.releaseLocalMedia()
    this.setStatus('ended')
    this.handlers.onEnded?.(reason)
    this.handlers.onSelfStream?.(null)
  }

  private releaseLocalMedia(): void {
    for (const track of [this.localAudio, this.localCamera, this.localScreen]) {
      if (!track) continue
      track.onended = null
      track.stop()
    }
    this.localAudio = null
    this.localCamera = null
    this.localScreen = null
    this.localStreams.main = new MediaStream()
    this.localStreams.screen = new MediaStream()
    try {
      void this.analyserSource?.disconnect()
      void this.analyser?.disconnect()
      void this.audioContext?.close()
    } catch {
      // ignore
    }
    this.analyserSource = null
    this.analyser = null
    this.audioContext = null
  }
}

/**
 * Reports a declined incoming call to the server. The callee never joined the
 * call, so it opens a short-lived signaling socket just to deliver the frame;
 * the server then closes the call for the caller with reason `declined`.
 */
export async function sendCallDecline(callID: string): Promise<void> {
  const target = (callID || '').trim()
  if (!target) return
  let url = ''
  try {
    url = await buildCallWsURLWithFreshToken()
  } catch {
    return
  }
  if (!url) return
  await new Promise<void>((resolve) => {
    let settled = false
    let socket: WebSocket | null = null
    let timer = 0
    const finish = (): void => {
      if (settled) return
      settled = true
      if (timer) window.clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        // ignore
      }
      resolve()
    }
    timer = window.setTimeout(finish, 4000)
    try {
      socket = new WebSocket(url)
    } catch {
      finish()
      return
    }
    socket.onopen = () => {
      try {
        socket?.send(JSON.stringify({ type: 'call.decline', id: `decline-${Date.now().toString(36)}`, call_id: target }))
      } catch {
        finish()
      }
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      try {
        const frame = JSON.parse(event.data) as { type?: string }
        if (frame.type === 'call.decline' || frame.type === 'call.error') finish()
      } catch {
        // ignore
      }
    }
    socket.onerror = () => finish()
    socket.onclose = () => finish()
  })
}
