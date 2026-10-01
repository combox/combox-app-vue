export type AudioMeta = { title: string; artist: string }

const metaCache = new Map<string, AudioMeta | null>()

// BUG7a: artist/title come ONLY from real tags (ID3v2 / Vorbis / MP4 ilst).
// The file name is NEVER split on '-' (so "08 - sofslinesz" keeps the whole
// string as the title and yields no fake artist); it is only stripped of its
// extension and used as-is when tags are absent.
function filenameAsTitle(filename: string): string {
  const base = (filename || '').trim()
  if (!base) return ''
  const withoutExt = base.replace(/\.[a-z0-9]+$/i, '').trim()
  return withoutExt || base
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
      // enc 0x01 = UTF-16 with BOM (BE or LE), enc 0x02 = UTF-16BE without BOM.
      if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(body.subarray(2)).trim()
      }
      if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(body.subarray(2)).trim()
      }
      return new TextDecoder(enc === 2 ? 'utf-16be' : 'utf-16le').decode(body).trim()
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

function parseOggVorbisComments(prefix: ArrayBuffer): { title: string; artist: string } {
  // Ogg container (Vorbis/Opus): comments live in the second packet —
  // '\x03vorbis' or 'OpusTags' — inside the 256KB prefix. Best effort scan.
  const buf = new Uint8Array(prefix)
  let start = -1
  for (let i = 0; i + 8 < buf.length; i++) {
    if (
      buf[i] === 0x03 &&
      buf[i + 1] === 0x76 &&
      buf[i + 2] === 0x6f &&
      buf[i + 3] === 0x72 &&
      buf[i + 4] === 0x62 &&
      buf[i + 5] === 0x69 &&
      buf[i + 6] === 0x73
    ) {
      start = i + 7
      break
    }
    if (
      buf[i] === 0x4f &&
      buf[i + 1] === 0x70 &&
      buf[i + 2] === 0x75 &&
      buf[i + 3] === 0x73 &&
      buf[i + 4] === 0x54 &&
      buf[i + 5] === 0x61 &&
      buf[i + 6] === 0x67 &&
      buf[i + 7] === 0x73
    ) {
      start = i + 8
      break
    }
  }
  if (start < 0) return { title: '', artist: '' }
  let pos = start
  const readU32LE = (p: number) =>
    (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0
  if (pos + 4 > buf.length) return { title: '', artist: '' }
  const vendorLen = readU32LE(pos)
  if (vendorLen > 1 << 20 || pos + 4 + vendorLen + 4 > buf.length) return { title: '', artist: '' }
  pos += 4 + vendorLen
  const count = readU32LE(pos)
  pos += 4
  if (count > 256) return { title: '', artist: '' }
  let title = ''
  let artist = ''
  for (let i = 0; i < count && pos + 4 <= buf.length; i++) {
    const len = readU32LE(pos)
    pos += 4
    if (len > 1 << 20 || pos + len > buf.length) break
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

function parseMP4Ilst(prefix: ArrayBuffer): { title: string; artist: string } {
  // MP4/M4A (ftyp … moov/udta/meta/ilst): '\xa9nam' = title, '\xa9ART' = artist.
  // Best effort scan of the prefix (works when moov is at the file start).
  const buf = new Uint8Array(prefix)
  const findBox = (fourcc: number[]): number => {
    for (let i = 0; i + 4 <= buf.length; i++) {
      if (buf[i] === fourcc[0] && buf[i + 1] === fourcc[1] && buf[i + 2] === fourcc[2] && buf[i + 3] === fourcc[3]) return i
    }
    return -1
  }
  // 0x69='i',0x6c='l',0x73='s',0x74='t'
  const ilstAt = findBox([0x69, 0x6c, 0x73, 0x74])
  if (ilstAt < 0) return { title: '', artist: '' }
  // ilst payload starts right after the fourcc; bound the scan to 64KB.
  const end = Math.min(buf.length, ilstAt + 4 + 65536)
  let title = ''
  let artist = ''
  const readU32BE = (p: number) =>
    (buf[p] * 0x1000000 + (buf[p + 1] << 16) + (buf[p + 2] << 8) + buf[p + 3]) >>> 0
  const decodeDataBox = (at: number, boxEnd: number): string => {
    // data box: size(4) 'data'(4) type(4) locale(4) payload...
    if (at + 16 > boxEnd) return ''
    let payload = at + 16
    // Some muxers pad with an extra 4 zero bytes; skip them.
    while (payload + 4 <= boxEnd && buf[payload] === 0 && buf[payload + 1] === 0 && buf[payload + 2] === 0 && buf[payload + 3] === 0) payload += 4
    if (payload >= boxEnd) return ''
    try {
      return new TextDecoder('utf-8').decode(buf.subarray(payload, boxEnd)).replace(/\0+$/g, '').trim()
    } catch {
      return ''
    }
  }
  let pos = ilstAt + 4
  for (let guard = 0; guard < 64 && pos + 8 <= end; guard++) {
    const size = readU32BE(pos)
    if (!Number.isFinite(size) || size < 8 || pos + size > end) break
    const key = [buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]]
    const isTitle = key[0] === 0xa9 && key[1] === 0x6e && key[2] === 0x61 && key[3] === 0x6d
    const isArtist = key[0] === 0xa9 && (key[1] === 0x41 || key[1] === 0x61) && (key[2] === 0x52 || key[2] === 0x72) && (key[3] === 0x54 || key[3] === 0x74)
    if (isTitle || isArtist) {
      // Inside the item: one or more 'data' boxes; take the first payload.
      const itemEnd = pos + size
      let inner = pos + 8
      let text = ''
      for (let innerGuard = 0; innerGuard < 8 && inner + 8 <= itemEnd; innerGuard++) {
        const innerSize = readU32BE(inner)
        if (!Number.isFinite(innerSize) || innerSize < 8 || inner + innerSize > itemEnd) break
        if (buf[inner + 4] === 0x64 && buf[inner + 5] === 0x61 && buf[inner + 6] === 0x74 && buf[inner + 7] === 0x61) {
          text = decodeDataBox(inner, inner + innerSize)
          break
        }
        inner += innerSize
      }
      if (text) {
        if (isTitle && !title) title = text
        if (isArtist && !artist) artist = text
      }
    }
    pos += size
  }
  return { title, artist }
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
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return parseOggVorbisComments(prefix)
  }
  if (buf.length > 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return parseMP4Ilst(prefix)
  }
  return parseID3v2Frames(prefix)
}

export async function resolveAudioMeta(src: string, filename?: string): Promise<AudioMeta | null> {
  const key = src || filename || ''
  if (!key) return null
  if (metaCache.has(key)) return metaCache.get(key) ?? null

  // Tags only: the file name is used as-is (extension stripped, no hyphen
  // split), the artist stays empty unless a real tag provided one. Callers
  // render "Unknown artist" for the empty case.
  const fallbackTitle = filenameAsTitle(filename || '')
  const init: AudioMeta | null = fallbackTitle ? { title: fallbackTitle, artist: '' } : null

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
        const result: AudioMeta = { title: tags.title, artist: tags.artist || '' }
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