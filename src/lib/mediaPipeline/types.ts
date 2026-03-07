import type { MediaAttachment } from 'combox-api'

export type MediaUploadProtocol = 'multipart-legacy' | 'hls-session'

export type MediaUploadInput = {
  file: File
  onProgress?: (percent: number) => void
}

export type MediaUploadResult = {
  attachment: MediaAttachment
  url: string
  previewUrl?: string
  protocol: MediaUploadProtocol
}
