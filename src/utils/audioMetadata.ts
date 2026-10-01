export type AudioMeta = { title: string; artist: string }

const metaCache = new Map<string, AudioMeta | null>()

const FILENAME_SPLIT_RE = /^(.+?)\s*[-–—_:|•]\s*(.+)$/

function parseFilename(filename: string): AudioMeta {
  const clean = (filename || '').replace(/\.[a-z0-9]+$/i, '').trim()
  const m = clean.match(FILENAME_SPLIT_RE)
  if (m && m[1] && m[2]) {
    return { artist: m[1].trim(), title: m[2].trim() }
  }
  return { title: clean, artist: '' }
}

const FETCH_TIMEOUT_MS = 8000

type PrefixResult = { ok: true; data: ArrayBuffer | null } | { ok: false }

async function fetchPrefix(src: string): Promise<PrefixResult> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null
  try {
    const response = await fetch(src, {
      headers: { Range: 'bytes=0-262143' },
      signal: controller?.signal,
    })
    if (!response.ok) return { ok: false }
    if (response.status === 206) return { ok: true, data: await response.arrayBuffer() }
    const data = await response.arrayBuffer()
    return { ok: true, data: data.byteLength > 262144 ? data.slice(0, 262144) : data }
  } catch {
    return { ok: false }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}


function syncsafeInt(buf: Uint8Array, offset: number): number | null {
  let value = 0
  for (let i = 0; i < 4; i++) {
    const byte = buf[offset + i]
    if (byte === undefined) return null
    if (byte & 0x80) return null
    value = (value << 7) | byte
  }
  return value
}

const NUL = String.fromCharCode(0)

function frameText(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const enc = bytes[0]
  const body = bytes.subarray(1)
  if (enc === 1 || enc === 2) {
    try {
      return new TextDecoder('utf-16le').decode(body).trim()
    } catch {
      return ''
    }
  }
  if (enc === 3) {
    try {
      return new TextDecoder('utf-8').decode(body).trim()
    } catch {
      return ''
    }
  }
  try {
    return new TextDecoder('iso-8859-1').decode(body).trim()
  } catch {
    return ''
  }
}

function parseID3v2Frames(prefix: ArrayBuffer): { title: string; artist: string } {
  const buf = new Uint8Array(prefix)
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return { title: '', artist: '' }

  const version = buf[3]
  const tagSize = syncsafeInt(buf, 6)
  if (tagSize === null) return { title: '', artist: '' }

  const bodyEnd = Math.min(buf.length, 10 + tagSize)
  const frameSizeLen = version === 2 ? 3 : 4
  const headerLen = version === 2 ? 6 : 10
  let offset = 10

  let title = ''
  let artist = ''

  while (offset + headerLen <= bodyEnd) {
    const idBytes = buf.subarray(offset, offset + frameSizeLen)
    let id: string
    try {
      id = new TextDecoder('latin1').decode(idBytes)
    } catch {
      id = ''
    }
    if (!id) break
    if (id.charCodeAt(0) === 0 && id.charCodeAt(1) === 0) break
    const idTrimmed = id.split(NUL).join('').trim()
    if (idTrimmed.length === 0 && buf[offset] === 0) break

    let frameSize: number | null
    if (frameSizeLen === 3) {
      frameSize = (buf[offset + 3] << 16) | (buf[offset + 4] << 8) | buf[offset + 5]
    } else if (version >= 4) {
      frameSize = syncsafeInt(buf, offset + 4)
    } else {
      frameSize =
        (buf[offset + 4] << 24) | (buf[offset + 5] << 16) | (buf[offset + 6] << 8) | buf[offset + 7]
    }
    if (frameSize === null) break
    if (frameSize <= 0) break

    const dataStart = offset + headerLen
    const dataEnd = Math.min(bodyEnd, dataStart + frameSize)
    const data = buf.subarray(dataStart, dataEnd)

    if (id.startsWith('TIT2') || id === 'TT2') {
      const text = frameText(data)
      if (text && !title) title = text
    } else if (id.startsWith('TPE1') || id === 'TP1') {
      const text = frameText(data)
      if (text && !artist) artist = text
    } else if (id === '' && offset + headerLen >= bodyEnd) {
      break
    }

    offset = dataEnd
  }

  return { title, artist }
}

function parseFLACVorbisComments(prefix: ArrayBuffer): { title: string; artist: string } {
  const buf = new Uint8Array(prefix)
  if (buf.length < 4 || buf[0] !== 0x66 || buf[1] !== 0x4c || buf[2] !== 0x61 || buf[3] !== 0x43) {
    return { title: '', artist: '' }
  }

  let offset = 4
  for (let guard = 0; guard < 64; guard++) {
    if (offset + 4 > buf.length) break
    const header = buf[offset]
    const blockLength = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]
    const blockType = header & 0x7f
    offset += 4
    if (offset + blockLength > buf.length) break

    if (blockType === 4) {
      const blockEnd = offset + blockLength
      let pos = offset
      const readU32LE = (p: number) =>
        (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0

      const vendorLen = readU32LE(pos)
      pos += 4
      if (pos + vendorLen > blockEnd) return { title: '', artist: '' }
      pos += vendorLen
      if (pos + 4 > blockEnd) return { title: '', artist: '' }
      const count = readU32LE(pos)
      pos += 4

      let title = ''
      let artist = ''
      for (let i = 0; i < count && pos + 4 <= blockEnd; i++) {
        const len = readU32LE(pos)
        pos += 4
        if (pos + len > blockEnd) break
        let str = ''
        try {
          str = new TextDecoder('utf-8').decode(buf.subarray(pos, pos + len)).trim()
        } catch {
          str = ''
        }
        pos += len
        const eq = str.indexOf('=')
        if (eq < 1) continue
        const key = str.slice(0, eq).toUpperCase()
        const value = str.slice(eq + 1).trim()
        if (!value) continue
        if (key === 'TITLE' && !title) title = value
        else if ((key === 'ARTIST' || key === 'ALBUMARTIST') && !artist) artist = value
      }
      return { title, artist }
    }

    if (header & 0x80) break
    offset += blockLength
  }

  return { title: '', artist: '' }
}

function parseTags(prefix: ArrayBuffer): { title: string; artist: string } {
  if (!prefix) return { title: '', artist: '' }
  const buf = new Uint8Array(prefix)
  if (buf.length < 10) return { title: '', artist: '' }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    // MPEG sync frame at the very start: no ID3 tag present.
    return { title: '', artist: '' }
  }
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) {
    return parseFLACVorbisComments(prefix)
  }
  return parseID3v2Frames(prefix)
}

export async function resolveAudioMeta(src: string, filename?: string): Promise<AudioMeta | null> {
  const key = src || filename || ''
  if (!key) return null
  if (metaCache.has(key)) return metaCache.get(key) ?? null

  const fallback = parseFilename(filename || '')
  const init: AudioMeta | null = fallback.title ? fallback : null

  if (!src || src.startsWith('blob:') || src.startsWith('data:')) {
    metaCache.set(key, init)
    return init
  }

  try {
    const probe = await fetchPrefix(src)
    if (!probe.ok) {
      // Transient failure (expired URL, offline, stalled request): do NOT
      // poison the cache, the next call gets a real chance to probe again.
      return init
    }
    const prefix = probe.data
    if (prefix) {
      const tags = parseTags(prefix)
      if (tags.title) {
        const result: AudioMeta = { title: tags.title, artist: tags.artist || fallback.artist }
        metaCache.set(key, result)
        return result
      }
    }
  } catch {
    // fall through to filename fallback
  }

  metaCache.set(key, init)
  return init
}