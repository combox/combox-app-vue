// Ringtone for incoming calls: a two-tone pattern repeated while the call is
// unanswered. Uses WebAudio so no audio asset is bundled.
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

let context: AudioContext | null = null
let ringTimer: number | null = null

function playPulse(frequency: number, durationMs: number): void {
  if (!context) return
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.value = 0.0001
  oscillator.connect(gain)
  gain.connect(context.destination)
  const now = context.currentTime
  gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000)
  oscillator.start(now)
  oscillator.stop(now + durationMs / 1000 + 0.05)
}

function playCycle(): void {
  playPulse(440, 400)
  window.setTimeout(() => playPulse(554, 400), 450)
  window.setTimeout(() => playPulse(440, 400), 900)
  window.setTimeout(() => playPulse(554, 600), 1350)
}

export function startRinging(): void {
  if (ringTimer !== null) return
  try {
    const AudioCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
    if (!AudioCtor) return
    context ??= new AudioCtor()
    if (context.state === 'suspended') void context.resume().catch(() => {})
    playCycle()
    ringTimer = window.setInterval(playCycle, 3200)
  } catch {
    // Autoplay restrictions simply mute the ringtone.
  }
}

export function stopRinging(): void {
  if (ringTimer !== null) {
    window.clearInterval(ringTimer)
    ringTimer = null
  }
  try {
    void context?.close()
  } catch {
    // ignore
  }
  context = null
}
