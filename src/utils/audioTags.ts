export type AudioTags = {
  title?: string
  artist?: string
}

function syncsafe(bytes: Uint8Array, offset: number, len: number): number {
  let value = 0
  for (let i = 0; i < len; i++) {
    value = (value << 7) | (bytes[offset + i] & 0x7f)
  }
  return value
}

function stripTrailingNulls(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 0) end--
  return end === value.length ? value : value.slice(0, end)
}

function readText(bytes: Uint8Array, start: number, end: number): string {
  if (start >= end) return ''
  const encoding = bytes[start]
  const slice = bytes.subarray(start + 1, end)
  try {
    if (encoding === 1 || encoding === 2) return stripTrailingNulls(new TextDecoder('utf-16').decode(slice))
    if (encoding === 3) return stripTrailingNulls(new TextDecoder('utf-8').decode(slice))
    return stripTrailingNulls(new TextDecoder('latin1').decode(slice))
  } catch {
    return ''
  }
}

export function parseId3(bytes: Uint8Array): AudioTags {
  const tags: AudioTags = {}
  if (bytes.length < 10) return tags
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return tags

  const major = bytes[3]
  const size = syncsafe(bytes, 6, 4)
  const end = Math.min(10 + size, bytes.length)
  let offset = 10

  while (offset + 10 <= end) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    let frameSize: number
    if (major >= 4) {
      frameSize = syncsafe(bytes, offset + 4, 4)
    } else {
      frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7]
    }
    if (frameSize <= 0) break

    const dataStart = offset + 10
    const dataEnd = Math.min(dataStart + frameSize, end)
    if (id === 'TIT2') tags.title = readText(bytes, dataStart, dataEnd)
    else if (id === 'TPE1') tags.artist = readText(bytes, dataStart, dataEnd)

    if (tags.title && tags.artist) break
    offset = dataEnd
  }
  return tags
}

export async function parseAudioTags(url: string, signal?: AbortSignal): Promise<AudioTags> {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-262143' }, signal: controller.signal })
    if (!res.ok && res.status !== 206) return {}
    const buffer = await res.arrayBuffer()
    return parseId3(new Uint8Array(buffer))
  } catch {
    return {}
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}
