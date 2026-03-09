import type { ComputedRef, Ref } from 'vue'
import type { ChatInviteLink, ChatItem, ChatMemberProfile, MessageItem } from 'combox-api'
import type { ViewMessage } from './chatTypes'
import type { AttachmentView, MessageStatus, PendingFile } from './chatWorkspace.types'

export type RefreshMembers = (chatID: string) => Promise<void>
export type RefreshInviteLinks = (chatID: string) => Promise<void>
export type LoadChats = () => Promise<void>
export type LoadGroupChannels = (groupChatID: string) => Promise<void>
export type LoadMessages = (chatID: string) => Promise<void>
export type SelectChat = (chatID: string) => Promise<void>
export type EnrichMembers = (items: any[]) => Promise<ChatMemberProfile[]>

export type GroupProfileInput = {
  title: string
  avatarDataUrl?: string | null
  commentsEnabled?: boolean
  reactionsEnabled?: boolean
  isPublic?: boolean
  publicSlug?: string | null
}

export type WorkspaceActionsInput = {
  t: (key: string) => string
  currentUser: { id?: string } | null
  selectedChat: ComputedRef<ChatItem | null>
  activeMessagesChatID: ComputedRef<string>
  pendingFiles: Ref<PendingFile[]>
  editingMessage: Ref<ViewMessage | null>
  replyToMessage: Ref<ViewMessage | null>
  rawMessages: Ref<MessageItem[]>
  urlsByAttachment: Ref<Record<string, AttachmentView>>
  attachmentRequests: Map<string, Promise<void>>
  messageStatusesByMessage: Ref<Record<string, MessageStatus>>
  unreadByChatId: Ref<Record<string, number>>
  mutedChatIDs: Ref<Record<string, boolean>>
  sending: Ref<boolean>
  errorText: Ref<string>
  chats: Ref<ChatItem[]>
  invitePreviewChat: Ref<ChatItem | null>
  selectedChatID: Ref<string>
  selectedGroupChannelByGroupId: Ref<Record<string, string>>
  groupChannelsOpen: Ref<boolean>
  infoOpen: Ref<boolean>
  chatMembers: Ref<ChatMemberProfile[]>
  removedChatMembers: Ref<ChatMemberProfile[]>
  selectedChatInviteLinks: Ref<ChatInviteLink[]>
  loadChats: LoadChats
  loadGroupChannels: LoadGroupChannels
  loadMessages: LoadMessages
  selectChat: SelectChat
  refreshChatMembers: RefreshMembers
  refreshSelectedChatInviteLinks: RefreshInviteLinks
  enrichChatMembers: EnrichMembers
  updateGroupChannelPreview: (channelChatIDRaw: string, previewRaw: string, createdAtRaw?: string) => void
  findGroupIDByChannelID: (chatIDRaw: string) => string
  persistGroupSelection: () => void
  clearHash: () => void
  patchChatLocally: (chatID: string, patch: Partial<ChatItem>) => void
}
