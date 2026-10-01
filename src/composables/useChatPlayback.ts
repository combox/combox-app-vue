import { reactive } from 'vue'
import { resolveAudioMeta } from '../utils/audioMetadata'

export type ChatAudioTrack = {
  id: string
  url: string
  title: string
  artist: string
  durationMs: number
  poster: string
}

export type RepeatMode = 'off' | 'all' | 'one'

export type ChatPlaybackState = {
  queue: ChatAudioTrack[]
  currentId: string
  playing: boolean
  time: number
  duration: number
  volume: number
  muted: boolean
  repeat: RepeatMode
  shuffle: boolean
  rate: number
  visible: boolean
  listOpen: boolean
  error: boolean
}

const state = reactive<ChatPlaybackState>({
  queue: [],
  currentId: '',
  playing: false,
  time: 0,
  duration: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  rate: 1,
  visible: false,
  listOpen: false,
  error: false,
})

let audio: HTMLAudioElement | null = null

const PREFS_KEY = 'combox_player_prefs'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function loadPrefs() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<ChatPlaybackState>
    if (typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)) state.volume = clamp(parsed.volume, 0, 1)
    if (typeof parsed.rate === 'number' && Number.isFinite(parsed.rate)) state.rate = clamp(parsed.rate, 0.5, 4)
    if (parsed.repeat === 'off' || parsed.repeat === 'all' || parsed.repeat === 'one') state.repeat = parsed.repeat
    if (typeof parsed.shuffle === 'boolean') state.shuffle = parsed.shuffle
    if (typeof parsed.muted === 'boolean') state.muted = parsed.muted
  } catch {
    // ignore corrupted prefs
  }
}

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        volume: state.volume,
        rate: state.rate,
        repeat: state.repeat,
        shuffle: state.shuffle,
        muted: state.muted,
      }),
    )
  } catch {
    // ignore storage failures
  }
}

function currentIndex(): number {
  return state.queue.findIndex((item) => item.id === state.currentId)
}

function currentTrack(): ChatAudioTrack | null {
  const index = currentIndex()
  return index >= 0 ? state.queue[index] : null
}

function isValidTrack(track: ChatAudioTrack): boolean {
  return Boolean(track && typeof track.id === 'string' && track.id && typeof track.url === 'string' && track.url)
}

// Local (already known) metadata wins over anything a message reload or
// another sender brings in; foreign values only fill empty fields.
function mergeTrack(local: ChatAudioTrack | undefined, incoming: ChatAudioTrack): ChatAudioTrack {
  if (!local) return { ...incoming }
  return {
    ...incoming,
    title: local.title || incoming.title,
    artist: local.artist || incoming.artist,
    poster: local.poster || incoming.poster,
    durationMs: local.durationMs || incoming.durationMs,
  }
}

function syncDuration() {
  if (!audio) return
  const value = audio.duration
  if (Number.isFinite(value) && value > 0) {
    state.duration = value
    return
  }
  const fallback = currentTrack()?.durationMs || 0
  state.duration = fallback > 0 ? fallback / 1000 : 0
}

function stopAudio() {
  if (audio) {
    audio.pause()
    try {
      audio.currentTime = 0
    } catch {
      // ignore
    }
    audio.removeAttribute('src')
    audio.load()
  }
  state.playing = false
  state.time = 0
  state.duration = 0
  state.error = false
  // Without clearing this the track could never be replayed: `toggle()` bailed
  // out on the empty src while `isActive` still pointed at the dead track.
  state.currentId = ''
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.playbackRate = state.rate
  audio.volume = state.volume
  audio.muted = state.muted
  audio.addEventListener('timeupdate', () => {
    if (!audio) return
    state.time = audio.currentTime || 0
  })
  audio.addEventListener('durationchange', syncDuration)
  audio.addEventListener('loadedmetadata', syncDuration)
  audio.addEventListener('play', () => {
    state.playing = true
  })
  audio.addEventListener('pause', () => {
    state.playing = false
  })
  audio.addEventListener('ended', handleEnded)
  audio.addEventListener('error', () => {
    if (audio && audio.src) state.error = true
  })
  audio.addEventListener('emptied', () => {
    state.time = 0
    state.duration = 0
  })
  return audio
}

function handleEnded() {
  const list = state.queue
  if (!list.length) {
    stopAudio()
    return
  }
  if (state.repeat === 'one') {
    if (audio) audio.currentTime = 0
    void audio?.play()
    return
  }
  if (state.shuffle && list.length > 1) {
    const from = currentIndex()
    let pick = from
    while (pick === from) pick = Math.floor(Math.random() * list.length)
    activate(list[pick])
    return
  }
  const index = currentIndex()
  const nextIndex = index + 1
  if (nextIndex < list.length) {
    activate(list[nextIndex])
    return
  }
  if (state.repeat === 'all' && list.length) {
    activate(list[0])
    return
  }
  stopAudio()
}

function playMedia(url: string, seekTo?: number) {
  const node = ensureAudio()
  const sameSource = (node.getAttribute('src') || '') === url
  if (!sameSource) {
    node.src = url
    node.load()
  }
  if (seekTo !== undefined) {
    try {
      node.currentTime = seekTo
    } catch {
      // seeking before metadata is ready is not fatal
    }
  }
  void node.play().catch(() => {
    state.error = true
    state.playing = false
  })
}

export async function activate(track: ChatAudioTrack): Promise<boolean> {
  const id = (track.id || '').trim()
  const url = (track.url || '').trim()
  if (!id || !url) return false

  const index = state.queue.findIndex((item) => item.id === id)
  const merged = mergeTrack(index >= 0 ? state.queue[index] : undefined, { ...track, id, url })
  if (index >= 0) state.queue.splice(index, 1, merged)
  else state.queue.push(merged)

  state.currentId = id
  state.time = 0
  state.error = false
  state.visible = true
  state.playing = true
  // BUG7b: expose the known duration instantly (API durationMs) so time never
  // shows 0:00 until play; the <audio> loadedmetadata/durationchange refines it.
  state.duration = merged.durationMs > 0 ? merged.durationMs / 1000 : 0

  // Start playback first: a stalled/expired metadata probe must never be able
  // to wedge the player in a "playing but silent" state.
  playMedia(url, 0)

  void resolveAudioMeta(url, merged.title).then((meta) => {
    const target = state.queue.find((item) => item.id === id)
    if (target && meta) {
      if (!target.title && meta.title) target.title = meta.title
      if (!target.artist && meta.artist) target.artist = meta.artist
    }
  })

  return true
}

export function enqueueTrack(track: ChatAudioTrack): boolean {
  const id = (track.id || '').trim()
  const url = (track.url || '').trim()
  if (!id || !url) return false
  if (id === state.currentId) return true

  const index = state.queue.findIndex((item) => item.id === id)
  const entry = mergeTrack(index >= 0 ? state.queue[index] : undefined, { ...track, id, url })
  if (index >= 0) state.queue.splice(index, 1)

  const current = currentIndex()
  const insertAt = current >= 0 ? current + 1 : state.queue.length
  state.queue.splice(insertAt, 0, entry)
  state.visible = true
  return true
}

/** Replace the stored playback URL for a queued entry in place. Playlist
 *  entries keep a stable attachment id while their presigned URLs expire, so a
 *  fresh resolve patches the queue without stopping what is playing.
 */
export function patchQueueTrackUrl(id: string, url: string): void {
  const key = (id || '').trim()
  const fresh = (url || '').trim()
  if (!key || !fresh) return
  const entry = state.queue.find((item) => item.id === key)
  if (entry && entry.url !== fresh) entry.url = fresh
}

export function toggle(): void {
  const node = ensureAudio()
  if (!state.currentId) return
  state.error = false
  if (!node.src) {
    // The element was reset (track ended, player closed): restart from queue.
    const track = currentTrack()
    if (track?.url) playMedia(track.url, 0)
    return
  }
  if (node.paused) {
    void node.play().catch(() => {
      state.error = true
      state.playing = false
    })
  } else {
    node.pause()
  }
}

export function seek(seconds: number): void {
  const node = ensureAudio()
  if (!state.currentId) return
  if (!node.src) {
    const track = currentTrack()
    if (track?.url) playMedia(track.url, clamp(seconds, 0, state.duration || 0))
    return
  }
  node.currentTime = clamp(seconds, 0, state.duration || node.duration || 0)
}

function playIndex(index: number) {
  const track = state.queue[index]
  if (track) void activate(track)
}

function move(direction: 1 | -1) {
  const list = state.queue
  if (!list.length) return
  if (state.shuffle && list.length > 1) {
    const from = currentIndex()
    let pick = from
    while (pick === from) pick = Math.floor(Math.random() * list.length)
    playIndex(pick)
    return
  }
  const index = currentIndex()
  const raw = index + direction
  if (raw < 0) {
    if (state.repeat === 'all') {
      playIndex(list.length - 1)
    }
    return
  }
  if (raw >= list.length) {
    if (state.repeat === 'all') {
      playIndex(0)
    }
    return
  }
  playIndex(raw)
}

export function next(): void {
  move(1)
}

export function prev(): void {
  if (state.time > 3) {
    seek(0)
    return
  }
  move(-1)
}

export function setVolume(value: number): void {
  state.volume = clamp(value, 0, 1)
  if (state.volume > 0 && state.muted) {
    state.muted = false
    if (audio) audio.muted = false
  }
  if (audio) audio.volume = state.volume
  savePrefs()
}

export function toggleMute(): void {
  state.muted = !state.muted
  if (audio) audio.muted = state.muted
  savePrefs()
}

export function toggleShuffle(): void {
  state.shuffle = !state.shuffle
  savePrefs()
}

export function cycleRepeat(): void {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'
  savePrefs()
}

export function cycleRate(): void {
  const rates = [1, 1.25, 1.5, 2]
  const nextRate = rates[(rates.indexOf(state.rate) + 1) % rates.length] ?? 1
  state.rate = nextRate
  if (audio) audio.playbackRate = nextRate
  savePrefs()
}

export function closePlayer(): void {
  state.visible = false
  state.listOpen = false
  stopAudio()
}

// Queue refresh coming from a chat message list reload (chat switch, reaction,
// foreign message). It must never stop or rewind what the user is hearing, and
// it must not lose the identity of the track that is currently playing: the
// message player keys on the file URL while the chat list keys on the
// attachment id, so the two are matched by URL here.
export function syncQueue(list: ChatAudioTrack[]): void {
  const previous = state.queue
  const byID = new Map(previous.map((track) => [track.id, track]))
  const byURL = new Map<string, ChatAudioTrack>()
  for (const track of previous) if (track.url && !byURL.has(track.url)) byURL.set(track.url, track)

  const filtered = list
    .filter(isValidTrack)
    .map((incoming) => mergeTrack(byID.get(incoming.id) || byURL.get(incoming.url), incoming))

  let queue = filtered
  const current = state.currentId ? byID.get(state.currentId) : undefined
  if (current && !queue.some((track) => track.id === current.id)) {
    const twin = current.url ? queue.find((track) => track.url === current.url) : undefined
    if (twin) state.currentId = twin.id
    else queue = [current, ...queue]
  }

  const same =
    queue.length === previous.length &&
    queue.every((track, index) => track.id === previous[index]?.id && track.url === previous[index]?.url)

  if (same) {
    for (let index = 0; index < queue.length; index++) {
      const target = previous[index]
      const patch = queue[index]
      if (!target || target === patch) continue
      if (!target.title && patch.title) target.title = patch.title
      if (!target.artist && patch.artist) target.artist = patch.artist
      if (!target.poster && patch.poster) target.poster = patch.poster
      if (!target.durationMs && patch.durationMs) target.durationMs = patch.durationMs
    }
    return
  }

  state.queue = queue
}

export function openQueueList(): void {
  state.visible = true
  state.listOpen = true
}

export function closeQueueList(): void {
  state.listOpen = false
}

export function formatPlayerTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const total = Math.floor(sec)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function useChatPlayback() {
  loadPrefs()
  return {
    state,
    activate,
    enqueueTrack,
    patchQueueTrackUrl,
    toggle,
    seek,
    next,
    prev,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    cycleRate,
    closePlayer,
    syncQueue,
    openQueueList,
    closeQueueList,
  }
}