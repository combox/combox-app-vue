export type AttachmentThumb = { url: string; preview_url?: string }

export type GroupChannelItem = {
  id: string
  title: string
  channel_type?: 'text' | 'voice'
  unread?: number
  isGeneral?: boolean
  lastPreview?: string
  createdAt?: string
}
