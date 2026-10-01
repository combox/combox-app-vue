import type { AttachmentMeta, ChatItem, MessageStatus as ApiMessageStatus, PresenceItem as ApiPresenceItem } from 'combox-api'

export type PendingFile = { id: string; file: File; progress: number; meta?: AttachmentMeta }

// A group channel is a full ChatItem (viewer_role, parent_chat_id, public_slug,
// pinned, …) plus the sidebar presentation fields the group list needs.
export type GroupChannelItem = ChatItem & {
  topicNumber?: number
  unread?: number
  isGeneral?: boolean
  lastPreview?: string
  createdAt?: string
}

export type MessageStatus = ApiMessageStatus
export type PresenceItem = ApiPresenceItem
