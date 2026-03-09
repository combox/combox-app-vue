import type { GroupChannelItem, MessageStatus, PendingFile, PresenceItem } from '../../models/chat'

export type ChatFilter = 'all' | 'direct' | 'group'

export type AttachmentView = {
  url: string
  previewUrl: string
  width: number
  height: number
  durationMs: number
}

export type ChatMenuAnchor = { top: number; left: number; width: number; height: number }

export type WsResponseEnvelope<T> = { payload?: T; error?: string; code?: string }

export type PeerProfile = {
  id: string
  username: string
  first_name?: string
  last_name?: string
  email?: string
  birth_date?: string
  avatar_data_url?: string
}

export type { GroupChannelItem, MessageStatus, PendingFile, PresenceItem }
