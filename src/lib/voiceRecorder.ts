export type VoiceRecording = {
  blob: Blob
  mimeType: string
  durationMs: number
  peaks: number[]
}

export type VoiceLevelsListener = (levels: number[]) => void

export type VoiceRecorderStartOptions = {
  video?: boolean
}

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/aac',
]

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
]

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 720 },
  height: { ideal: 720 },
  frameRate: { ideal: 24, max: 30 },
}

const PEAK_COUNT = 64
const LEVEL_BARS = 24
const MAX_DURATION_MS = 15 * 60 * 1000
const NOISE_FLOOR = 0.01
const MIN_DECODED_SAMPLES = 1024
const MIN_DECODED_MS = 120

function isTypeSupported(mime: string): boolean {
  if (typeof MediaRecorder === 'undefined') return false
  try {
    return MediaRecorder.isTypeSupported(mime)
  } catch {
    return false
  }
}

function pickMimeType(withVideo: boolean): string {
  const candidates = withVideo ? VIDEO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES
  for (const mime of candidates) {
    if (isTypeSupported(mime)) return mime
  }
  return ''
}

function extensionFor(mimeType: string): string {
  const mime = (mimeType || '').toLowerCase()
  if (mime.startsWith('video/')) return mime.includes('mp4') || mime.includes('m4v') ? 'mp4' : 'webm'
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

export function voiceFileExtension(mimeType: string): string {
  return extensionFor(mimeType)
}

async function analyseBlob(blob: Blob): Promise<{ peaks: number[]; durationMs: number } | null> {
  const ContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!ContextCtor) return null
  let context: AudioContext | null = null
  try {
    context = new ContextCtor()
    const buffer = await blob.arrayBuffer()
    const decoded = await context.decodeAudioData(buffer)
    const data = decoded.getChannelData(0)
    const durationMs = Number.isFinite(decoded.duration) && decoded.duration > 0 ? Math.round(decoded.duration * 1000) : 0
    if (data.length < MIN_DECODED_SAMPLES || durationMs < MIN_DECODED_MS) return { peaks: [], durationMs }
    const block = Math.max(1, Math.floor(data.length / PEAK_COUNT))
    const peaks: number[] = []
    let max = 0
    for (let index = 0; index < PEAK_COUNT; index += 1) {
      const start = index * block
      const end = Math.min(data.length, start + block)
      let peak = 0
      for (let sample = start; sample < end; sample += 4) {
        const value = Math.abs(data[sample] || 0)
        if (value > peak) peak = value
      }
      peaks.push(peak)
      if (peak > max) max = peak
    }
    if (max < NOISE_FLOOR) return { peaks: [], durationMs }
    const scale = 1 / max
    const normalized = peaks.map((value) => Math.max(4, Math.min(100, Math.round(value * scale * 100))))
    return { peaks: normalized, durationMs }
  } catch {
    return null
  } finally {
    if (context) void context.close().catch(() => undefined)
  }
}

/** Records microphone audio (optionally with camera video) and derives playback waveform peaks. */
export class VoiceRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private mimeType = ''
  private startedAt = 0
  private accumulated = 0
  private paused = false
  private active = false
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private frameHandle = 0
  private levelHistory: number[] = []
  private listeners = new Set<VoiceLevelsListener>()

  get elapsedMs(): number {
    if (!this.active) return 0
    const running = this.paused ? 0 : performance.now() - this.startedAt
    return Math.max(0, this.accumulated + running)
  }

  get isRecording(): boolean {
    return this.active && this.recorder?.state === 'recording'
  }

  get isPaused(): boolean {
    return this.active && this.paused
  }

  get hasVideo(): boolean {
    return (this.stream?.getVideoTracks().length ?? 0) > 0
  }

  get previewStream(): MediaStream | null {
    return this.stream
  }

  subscribe(listener: VoiceLevelsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async acquireStream(withVideo: boolean): Promise<MediaStream> {
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) throw new Error('media_unsupported')
    if (withVideo) {
      try {
        return await media.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: VIDEO_CONSTRAINTS })
      } catch {
        // camera missing or denied: fall back to an audio-only round
      }
    }
    return await media.getUserMedia({ audio: AUDIO_CONSTRAINTS })
  }

  private createRecorder(stream: MediaStream): MediaRecorder {
    if (!this.mimeType) return new MediaRecorder(stream)
    try {
      return new MediaRecorder(stream, { mimeType: this.mimeType })
    } catch {
      return new MediaRecorder(stream)
    }
  }

  async start(options: VoiceRecorderStartOptions = {}): Promise<void> {
    if (this.active) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('media_unsupported')
    }
    if (typeof MediaRecorder === 'undefined') throw new Error('media_unsupported')

    const stream = await this.acquireStream(options.video === true)
    this.stream = stream
    try {
      this.chunks = []
      this.accumulated = 0
      this.paused = false
      this.mimeType = pickMimeType(stream.getVideoTracks().length > 0)
      const recorder = this.createRecorder(stream)
      this.mimeType = recorder.mimeType || this.mimeType || (stream.getVideoTracks().length > 0 ? 'video/webm' : 'audio/webm')
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data)
      }
      recorder.start(250)
      this.recorder = recorder
      this.startedAt = performance.now()
      this.active = true
      this.attachMeter(stream)
    } catch (error) {
      this.teardown()
      throw error
    }
  }

  pause(): void {
    if (!this.active || this.paused || !this.recorder) return
    if (this.recorder.state === 'recording') this.recorder.pause()
    this.accumulated += performance.now() - this.startedAt
    this.paused = true
  }

  resume(): void {
    if (!this.active || !this.paused || !this.recorder) return
    if (this.recorder.state === 'paused') this.recorder.resume()
    this.startedAt = performance.now()
    this.paused = false
  }

  async stop(): Promise<VoiceRecording | null> {
    if (!this.active || !this.recorder) return null
    const recorder = this.recorder
    const wasPaused = this.paused
    const elapsed = this.elapsedMs
    if (!wasPaused && recorder.state === 'recording') {
      this.accumulated += performance.now() - this.startedAt
    }
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      try {
        recorder.requestData()
      } catch {
        // requestData is best effort
      }
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve()
    })
    const blob = new Blob(this.chunks, { type: this.mimeType })
    const analysed = blob.size > 0 ? await analyseBlob(blob) : null
    const durationMs = analysed?.durationMs && analysed.durationMs > 0 ? analysed.durationMs : Math.round(elapsed)
    const recording: VoiceRecording = {
      blob,
      mimeType: this.mimeType,
      durationMs: Math.max(0, durationMs),
      peaks: analysed?.peaks ?? [],
    }
    this.teardown()
    if (recording.durationMs < 400 || recording.blob.size === 0) return null
    if (recording.durationMs > MAX_DURATION_MS) recording.durationMs = MAX_DURATION_MS
    return recording
  }

  cancel(): void {
    if (!this.active) return
    const recorder = this.recorder
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    } catch {
      // already stopped
    }
    this.teardown()
  }

  private attachMeter(stream: MediaStream): void {
    try {
      const ContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!ContextCtor) return
      const context = new ContextCtor()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.75
      source.connect(analyser)
      this.context = context
      this.source = source
      this.analyser = analyser
      this.levelHistory = new Array(LEVEL_BARS).fill(0)
      this.loopMeter()
    } catch {
      this.context = null
      this.source = null
      this.analyser = null
    }
  }

  private loopMeter(): void {
    if (!this.analyser) return
    const buffer = new Uint8Array(this.analyser.fftSize)
    const tick = () => {
      if (!this.active || !this.analyser) return
      this.analyser.getByteTimeDomainData(buffer)
      let sum = 0
      for (let index = 0; index < buffer.length; index += 1) {
        const value = (buffer[index] - 128) / 128
        sum += value * value
      }
      const rms = Math.sqrt(sum / buffer.length)
      const level = Math.min(1, rms * 3.2)
      this.levelHistory = [...this.levelHistory.slice(1), level]
      const snapshot = this.levelHistory.slice()
      for (const listener of this.listeners) listener(snapshot)
      this.frameHandle = window.setTimeout(tick, 66)
    }
    tick()
  }

  private teardown(): void {
    this.active = false
    this.paused = false
    this.recorder = null
    if (this.frameHandle) {
      window.clearTimeout(this.frameHandle)
      this.frameHandle = 0
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {
        // node already gone
      }
    }
    this.source = null
    this.analyser = null
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
    this.chunks = []
    this.levelHistory = []
    for (const listener of this.listeners) listener([])
  }
}
