export type ChatFilter = 'all' | 'direct' | 'group'

export type PendingFile = { id: string; file: File; progress: number }

export type AttachmentView = {
  url: string
  previewUrl: string
  width: number
  height: number
  durationMs: number
}

export type ChatMenuAnchor = { top: number; left: number; width: number; height: number }

export type MessageStatus = {
  message_id: string
  chat_id: string
  user_id: string
  status: string
  updated_at: string
}

export type WsResponseEnvelope<T> = { payload?: T; error?: string; code?: string }

export type PresenceItem = { user_id: string; online: boolean; last_seen?: string; last_seen_visible: boolean }

export type PeerProfile = {
  id: string
  username: string
  first_name?: string
  last_name?: string
  email?: string
  birth_date?: string
  avatar_data_url?: string
}

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
