import type { MessageStatus as ApiMessageStatus, PresenceItem as ApiPresenceItem } from 'combox-api'

export type PendingFile = { id: string; file: File; progress: number }

export type GroupChannelItem = {
  id: string
  title: string
  channel_type?: 'text' | 'voice'
  topicNumber?: number
  unread?: number
  isGeneral?: boolean
  lastPreview?: string
  createdAt?: string
}

export type MessageStatus = ApiMessageStatus
export type PresenceItem = ApiPresenceItem
