import type { MessageItem } from 'combox-api'

export type ResolvedAttachment = {
  id: string
  kind: string
  filename: string
  mimeType: string
  url: string
  previewUrl: string
  width: number
  height: number
  durationMs: number
}

export type ViewMessage = {
  raw: MessageItem
  text: string
  attachments: ResolvedAttachment[]
}

