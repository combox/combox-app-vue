import type { GroupChannelItem, MessageStatus, PendingFile, PresenceItem } from '../../models/chat'

export type ChatFilter = 'all' | 'direct' | 'channel' | 'group'

export type AttachmentView = {
  url: string
  previewUrl: string
  width: number
  height: number
  durationMs: number
  sizeBytes?: number
  /** Stored server side too; kept here so a freshly sent message is complete. */
  mimeType?: string
  filename?: string
  userMeta?: Record<string, unknown>
  /** When the (possibly presigned) URL was last refreshed. */
  fetchedAt?: number
  /** Set on a failed lookup so the entry is retried instead of staying dead. */
  failedAt?: number
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
