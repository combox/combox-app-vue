<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { usePlaylist } from '../../composables/usePlaylist'
import { useToast } from '../../composables/useToast'
import { attachmentFlagsFromMeta, deleteChannel, deleteChat, encodeAttachmentToken, forwardMessage, getAttachment, getPinnedMessage, getUserByID, leaveChat, listChatCalls, listChannels, parseMessageContent, postStandaloneChannelThreadComment, listStandaloneChannelThreadComments, sendMessage, setChatMuted, setAttachmentMeta, setPinnedMessage, unsubscribeChannel, type AttachmentMeta, type ChatCallItem, type ChatItem, type MessageItem } from 'combox-api'
import ChatComposer from './ChatComposer.vue'
import ChatConversationHeader from './ChatConversationHeader.vue'
import ChatInfoPanel from './ChatInfoPanel.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatMusicPlayer from './ChatMusicPlayer.vue'
import ChatSidebar from './ChatSidebar.vue'
import ChatWorkspaceOverlays from './ChatWorkspaceOverlays.vue'
import { normalizeAvatarSrc, toViewMessage } from './chatUtils'
import { chatKindLabel } from './chatLabels'
import { avatarColorFor } from '../../utils/avatarColor'
import { wallpaperStyle } from '../../utils/chatWallpaper'
import CallMiniBar from '../call/CallMiniBar.vue'
import CallOverlay from '../call/CallOverlay.vue'
import VoiceChannelPanel from './VoiceChannelPanel.vue'
import IncomingCallModal from '../call/IncomingCallModal.vue'
import {
  acceptIncoming,
  callIdentity,
  callMinimized,
  callNote,
  callStatus,
  dismissIncoming,
  dismissLiveNotice,
  hangup,
  incomingCall,
  incomingIdentity,
  liveNotice,
  setCallIdentityResolver,
  startCall,
  watchLiveStream,
  type CallIdentity,
} from '../call/callSession'
import { hydrateAttachmentURLs } from './chatWorkspace.attachments'
import { useChatWorkspace } from './useChatWorkspace.runtime'
import { mediaPipelineClient } from '../../lib/mediaPipeline/client'
import { enqueueOutbox, isOfflineError } from '../../lib/offline/outbox'
import type { ChatAudioTrack } from '../../composables/useChatPlayback'

const ChannelSettingsPanel = defineAsyncComponent(() => import('./ChannelSettingsPanel.vue'))

const { t } = useI18n()

const {
  currentUser,
  localProfile,
  selectedChatID,
  activeMessagesChatID,
  selectedChat,
  hasActiveChat,
  chats,
  filteredChats,
  messages,
  filteredMessages,
  rawMessages,
  sidebarSearch,
  sidebarPanel,
  selectedFilterTab,
  messageSearchOpen,
  messageSearch,
  unreadCounts,
  unreadByChatId,
  mutedChatIDs,
  messageStatusesByMessage,
  contextMenu,
  contextReactionAnchor,
  replyToMessage,
  editingMessage,
  pendingFiles,
  urlsByAttachment,
  directoryQuery,
  directoryResults,
  loadingChats,
  loadingMessages,
  searchingDirectory,
  sending,
  errorText,
  isNearBottom,
  photoViewerSrc,
  videoViewer,
  infoOpen,
  chatMenuAnchor,
  peerProfile,
  focusedInfoUserProfile,
  profileUpdate,
  chatMembers,
  removedChatMembers,
  selectedChatInviteLinks,
  directPeerId,
  infoSubtitle,
  chatSubtitle,
  showGroupChannelsPanel,
  selectedGroupChannelID,
  visibleGroupChannels,
  loadingGroupChannels,
  setChatFilter,
  selectChat,
  selectDirectoryChat,
  openDirectChatByUsername,
  openDirectChatWithUser,
  selectGroupChannel,
  setPendingFiles,
  removePendingFile,
  reactToMessage,
  markMessagesRead,
  openContextMenu,
  closeContextMenu,
  openContextReactionPicker,
  closeContextReactionPicker,
  selectReactionFromPicker,
  copyContextMessage,
  replyFromContextMenu,
  beginReplyToMessage,
  clearReplyToMessage,
  deleteContextMessage,
  editFromContextMenu,
  openPhotoViewer,
  closePhotoViewer,
  openVideoViewer,
  closeVideoViewer,
  openInfo,
  openInfoForUser,
  closeInfo,
  openMessageSearch,
  closeMessageSearch,
  openChatMenu,
  closeChatMenu,
  openSidebarSettings,
  closeSidebarSettings,
  closeGroupChannelsPanel,
  createGroupChat,
  createChannelForSelectedGroup,
  createStandaloneChannelChat,
  createSelectedChatInviteLink,
  updateSelectedGroupProfile,
  leaveSelectedChat,
  canCreateChannel,
  addMembersToSelectedGroup,
  updateSelectedGroupMemberRole,
  removeSelectedGroupMember,
  toggleMuteSelectedChat,
  subscribeSelectedChannel,
  unsubscribeSelectedChannel,
  sendDraft,
  loadChats,
  loadGroupChannels,
  loadMessages,
  selectedGroupChannelByGroupId,
  persistGroupSelection,
  clearHash,
  realtimeExtraChatIDs,
  typingByChat,
  noteTyping,
} = useChatWorkspace()

const isMediaOverlayOpen = computed(() => Boolean(photoViewerSrc.value) || Boolean(videoViewer.value))

const dragDepth = ref(0)
const draggingFiles = ref(false)
const dragSuppressed = ref(false)

function dragHasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

function onDragEnter(event: DragEvent) {
  if (!dragHasFiles(event)) {
    dragSuppressed.value = true
    return
  }
  dragSuppressed.value = false
  dragDepth.value += 1
  draggingFiles.value = true
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent) {
  if (dragSuppressed.value) return
  // Leaving the window (drop outside, Escape, alt-tab) never delivers a
  // balancing dragenter: reset immediately so the veil cannot get stuck.
  const next = event.relatedTarget
  if (!next || !(next instanceof Node) || !document.contains(next)) {
    dragDepth.value = 0
    draggingFiles.value = false
    return
  }
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) draggingFiles.value = false
}

function resetFileDrag() {
  dragDepth.value = 0
  draggingFiles.value = false
  dragSuppressed.value = false
}

function onDropFiles(event: DragEvent) {
  resetFileDrag()
  const files = event.dataTransfer?.files
  if (files && files.length) setPendingFiles(files)
}
const discussionRootMessage = ref<(typeof messages.value)[number] | null>(null)
const discussionThreadChatID = ref('')
const discussionCommentsRaw = ref<MessageItem[]>([])
const discussionLoading = ref(false)
const discussionAttachmentRequests = new Map<string, Promise<void>>()
const discussionRefreshTimer = ref<number | null>(null)
const discussionRefreshing = ref(false)

const forwardPickerOpen = ref(false)
const forwardPickerQuery = ref('')
const forwardMessages = ref<Array<(typeof messages.value)[number]>>([])
const forwardTargetChatIDs = ref<string[]>([])
const forwardPickerSelected = ref<Set<string>>(new Set())
/** Group whose topics are shown as the dialog's second step ('' = step 1). */
const forwardTopicGroupID = ref('')
/** Chosen topic id per group; a group without an entry targets General. */
const forwardTopicByGroupID = ref<Record<string, string>>({})
/** Session cache of `listChannels` results, keyed by group id. */
const forwardTopicsByGroupID = ref<Record<string, ChatItem[]>>({})
const forwardTopicsLoading = ref(false)
let forwardTopicsRequestID = 0
/** Written right before the confirm flow navigates, so the selectedChatID
 *  watcher can tell "our own navigation" from the user switching chats. */
const forwardConfirmedChatID = ref('')

function resetForwardPickerUI() {
  forwardPickerQuery.value = ''
  forwardPickerSelected.value = new Set()
  forwardTopicGroupID.value = ''
}

/** Cancelling drops the pending forward entirely — otherwise the composer
 *  keeps rendering the "Forward / N messages" bar forever (BUG 4). */
function closeForwardPicker() {
  forwardPickerOpen.value = false
  resetForwardPickerUI()
  forwardTopicByGroupID.value = {}
  clearForward()
}

function clearForward() {
  forwardMessages.value = []
  forwardTargetChatIDs.value = []
  forwardConfirmedChatID.value = ''
}

function openForwardPicker() {
  if (!contextMenu.value?.message) return
  forwardMessages.value = [contextMenu.value.message]
  forwardTargetChatIDs.value = []
  contextMenu.value = null
  resetForwardPickerUI()
  forwardTopicByGroupID.value = {}
  forwardPickerOpen.value = true
}

function openForwardPickerForMessages(list: Array<(typeof messages.value)[number]>) {
  forwardMessages.value = list.slice()
  forwardTargetChatIDs.value = []
  resetForwardPickerUI()
  forwardTopicByGroupID.value = {}
  forwardPickerOpen.value = true
}

/** Mirrors the server-side posting rules so the picker never offers a
 *  channel the viewer is not allowed to write into. */
function canPostIntoChat(chat: ChatItem): boolean {
  const kind = String(chat.kind || '').trim()
  const role = String(chat.viewer_role || '').trim().toLowerCase()
  if (kind === 'channel' || kind === 'standalone_channel') {
    if (kind === 'channel' && !String(chat.parent_chat_id || '').trim()) {
      return true
    }
    // Standalone channels and group topics only accept owner/admin/moderator.
    return role === 'owner' || role === 'admin' || role === 'moderator'
  }
  return true
}

/** Forwarding-specific variant of {@link canPostIntoChat}: a group topic only
 *  locks regular members when its own `send_permission` says so (same rule the
 *  composer uses), everything else defers to the shared predicate. */
function canForwardInto(chat: ChatItem): boolean {
  const kind = String(chat.kind || '').trim()
  const isGroupTopic = kind === 'channel' && Boolean(String(chat.parent_chat_id || '').trim())
  if (String(chat.send_permission || '').trim().toLowerCase() === 'admins') {
    const role = String(chat.viewer_role || '').trim().toLowerCase()
    return role === 'owner' || role === 'admin' || role === 'moderator'
  }
  if (isGroupTopic) return true
  return canPostIntoChat(chat)
}

function forwardKindLabel(chat: ChatItem): string {
  return chatKindLabel(t, chat)
}

function forwardMatchesQuery(chat: ChatItem, query: string): boolean {
  if (String(chat.title || '').trim().toLowerCase().includes(query)) return true
  const slug = String(chat.public_slug || '').trim().toLowerCase()
  if (slug && slug.includes(query)) return true
  const parentTitle = String(chat.parent_title || '').trim().toLowerCase()
  if (parentTitle && parentTitle.includes(query)) return true
  return forwardKindLabel(chat).toLowerCase().includes(query)
}

function forwardChatTime(chat: ChatItem): number {
  return Date.parse(String(chat.last_message_at || chat.created_at || '').trim()) || 0
}

function compareForwardChats(a: ChatItem, b: ChatItem): number {
  const unreadA = Number(unreadByChatId.value[String(a.id || '').trim()] || 0) > 0 ? 1 : 0
  const unreadB = Number(unreadByChatId.value[String(b.id || '').trim()] || 0) > 0 ? 1 : 0
  if (unreadA !== unreadB) return unreadB - unreadA
  const timeA = forwardChatTime(a)
  const timeB = forwardChatTime(b)
  if (timeA !== timeB) return timeB - timeA
  return String(a.title || '').localeCompare(String(b.title || ''))
}

/** Every chat the account knows about — deliberately independent of the
 *  sidebar category (All / Direct / Channels / Groups) and inclusive of
 *  group chats, deduplicated, then filtered only by the dialog's own query. */
const forwardTargets = computed(() => {
  const q = forwardPickerQuery.value.trim().toLowerCase()
  const seen = new Set<string>()
  const rows: ChatItem[] = []
  for (const chat of chats.value) {
    const id = String(chat.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (q && !forwardMatchesQuery(chat, q)) continue
    rows.push(chat)
  }
  rows.sort(compareForwardChats)
  return rows
})

function findForwardChatByID(idRaw: string): ChatItem | null {
  const id = String(idRaw || '').trim()
  if (!id) return null
  const direct = chats.value.find((chat) => String(chat.id || '').trim() === id)
  if (direct) return direct
  for (const topics of Object.values(forwardTopicsByGroupID.value)) {
    const match = topics.find((topic) => String(topic.id || '').trim() === id)
    if (match) return match
  }
  return null
}

function isForwardGroup(chat: ChatItem): boolean {
  return String(chat.kind || '').trim() === 'group'
}

function forwardGroupTargetID(groupIDRaw: string): string {
  const groupID = String(groupIDRaw || '').trim()
  if (!groupID) return ''
  return String(forwardTopicByGroupID.value[groupID] || '').trim() || groupID
}

function isForwardGroupSelected(groupIDRaw: string): boolean {
  const target = forwardGroupTargetID(groupIDRaw)
  return Boolean(target) && forwardPickerSelected.value.has(target)
}

function isForwardChatSelected(chat: ChatItem): boolean {
  const id = String(chat.id || '').trim()
  if (!id) return false
  if (isForwardGroup(chat)) return isForwardGroupSelected(id)
  return forwardPickerSelected.value.has(id)
}

function isForwardTopicSelected(topic: ChatItem): boolean {
  const groupID = String(forwardTopicGroupID.value || '').trim()
  const topicID = String(topic.id || '').trim()
  if (!groupID || !topicID) return false
  return forwardGroupTargetID(groupID) === topicID && forwardPickerSelected.value.has(topicID)
}

function forwardTopicTitle(topic: ChatItem): string {
  const title = String(topic.title || '').trim()
  if (title) return title
  const topicNumber = Number(topic.topic_number || 0)
  if (Number.isInteger(topicNumber) && topicNumber > 0) return `#${topicNumber}`
  return t('chat.forward_general', undefined, 'General')
}

/** "# General" is the group itself plus every topic of that group. */
const forwardTopicRows = computed<ChatItem[]>(() => {
  const groupID = String(forwardTopicGroupID.value || '').trim()
  if (!groupID) return []
  const rows: ChatItem[] = []
  const group = chats.value.find((chat) => String(chat.id || '').trim() === groupID)
  if (group) {
    rows.push({ ...group, title: t('chat.forward_general', undefined, 'General'), is_general: true, topic_number: 1 })
  }
  for (const topic of forwardTopicsByGroupID.value[groupID] || []) {
    if (String(topic.id || '').trim() === groupID) continue
    rows.push(topic)
  }
  return rows
})

async function ensureForwardTopics(groupIDRaw: string) {
  const groupID = String(groupIDRaw || '').trim()
  if (!groupID) return
  if ((forwardTopicsByGroupID.value[groupID] || []).length > 0) return
  const requestID = ++forwardTopicsRequestID
  forwardTopicsLoading.value = true
  try {
    const items = await listChannels(groupID)
    forwardTopicsByGroupID.value = {
      ...forwardTopicsByGroupID.value,
      [groupID]: Array.isArray(items) ? items : [],
    }
  } catch {
    // Leave the list empty — the dialog shows its own empty state.
  } finally {
    if (requestID === forwardTopicsRequestID) forwardTopicsLoading.value = false
  }
}

async function openForwardTopics(chat: ChatItem) {
  const groupID = String(chat.id || '').trim()
  if (!groupID) return
  forwardTopicGroupID.value = groupID
  await ensureForwardTopics(groupID)
}

function closeForwardTopics() {
  forwardTopicGroupID.value = ''
}

function forwardChatMeta(chat: ChatItem): string {
  const label = forwardKindLabel(chat)
  if (!isForwardGroup(chat)) return label
  const groupID = String(chat.id || '').trim()
  if (!isForwardGroupSelected(groupID)) return label
  const target = forwardGroupTargetID(groupID)
  if (!target || target === groupID) return label
  const topic = findForwardChatByID(target)
  if (!topic) return label
  return `${label} · # ${forwardTopicTitle(topic)}`
}

function toggleForwardTarget(chat: ChatItem) {
  const id = String(chat.id || '').trim()
  if (!id) return
  if (isForwardGroup(chat)) {
    toggleForwardGroup(id)
    return
  }
  if (!canForwardInto(chat)) return
  const next = new Set(forwardPickerSelected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  forwardPickerSelected.value = next
}

function toggleForwardGroup(groupIDRaw: string) {
  const groupID = String(groupIDRaw || '').trim()
  if (!groupID) return
  const group = findForwardChatByID(groupID)
  if (group && !canForwardInto(group)) return
  const target = forwardGroupTargetID(groupID)
  if (target !== groupID) {
    const topic = findForwardChatByID(target)
    if (topic && !canForwardInto(topic)) return
  }
  const next = new Set(forwardPickerSelected.value)
  if (next.has(target)) {
    next.delete(target)
    const topics = { ...forwardTopicByGroupID.value }
    delete topics[groupID]
    forwardTopicByGroupID.value = topics
    return
  }
  next.add(target)
  forwardPickerSelected.value = next
}

/** A group resolves to exactly one target id: General (the group) or a topic. */
function selectForwardTopic(topic: ChatItem) {
  const groupID = String(forwardTopicGroupID.value || '').trim()
  const topicID = String(topic.id || '').trim()
  if (!groupID || !topicID) return
  if (!canForwardInto(topic)) return
  const currentTarget = forwardGroupTargetID(groupID)
  const next = new Set(forwardPickerSelected.value)
  const topics = { ...forwardTopicByGroupID.value }
  if (next.has(currentTarget) && currentTarget === topicID) {
    next.delete(currentTarget)
    delete topics[groupID]
  } else {
    if (next.has(currentTarget)) next.delete(currentTarget)
    if (topicID === groupID) delete topics[groupID]
    else topics[groupID] = topicID
    next.add(topicID)
  }
  forwardTopicByGroupID.value = topics
  forwardPickerSelected.value = next
}

async function confirmForwardTargets() {
  const targets: string[] = []
  const seen = new Set<string>()
  for (const raw of forwardPickerSelected.value) {
    const id = String(raw || '').trim()
    if (!id || seen.has(id)) continue
    const target = findForwardChatByID(id)
    if (!target || !canForwardInto(target)) continue
    seen.add(id)
    targets.push(id)
  }
  if (targets.length === 0) return

  forwardTargetChatIDs.value = targets
  // Close the dialog but keep `forwardMessages`: the composer now owns the
  // pending forward and only clears it once the user actually sends it.
  forwardPickerOpen.value = false
  resetForwardPickerUI()
  forwardTopicByGroupID.value = {}

  const first = targets[0]
  const chat = findForwardChatByID(first)
  const kind = String(chat?.kind || '').trim()
  const parentID = String(chat?.parent_chat_id || '').trim()
  const destination = kind === 'channel' && parentID ? parentID : first

  // Mark the chat we are about to open so the selectedChatID watcher keeps
  // this forward alive; every other chat switch still drops it.
  forwardConfirmedChatID.value = destination
  if (kind === 'group') {
    // General: the group id doubles as its own topic id.
    await selectChat(first)
    selectGroupChannel(first)
    return
  }
  if (kind === 'channel' && parentID) {
    await selectChat(parentID)
    selectGroupChannel(first)
    return
  }
  await selectChat(first)
}

async function apiForwardMessage(targetChatIDRaw: string, sourceMessageIDRaw: string): Promise<MessageItem> {
  return await forwardMessage(targetChatIDRaw, sourceMessageIDRaw)
}
const conversationChat = computed(() => {
  const activeID = (activeMessagesChatID.value || '').trim()
  if (activeID) return chats.value.find((chat) => (chat.id || '').trim() === activeID) || selectedChat.value
  return selectedChat.value
})
const inDiscussionMode = computed(() => {
  const kind = (conversationChat.value?.kind || '').trim()
  return Boolean(discussionRootMessage.value && kind === 'standalone_channel')
})
/** Hide the call/broadcast button in channels the viewer may not publish in. */
const canBroadcastInSelectedChat = computed(() => {
  const chat = conversationChat.value
  if (!chat) return false
  const kind = (chat.kind || '').trim()
  if (kind === 'standalone_channel' || Boolean(chat.is_public)) {
    const role = (chat.viewer_role || '').trim().toLowerCase()
    return role === 'owner' || role === 'admin'
  }
  return true
})
const composerReplyTarget = computed(() => (inDiscussionMode.value ? discussionRootMessage.value : replyToMessage.value))
const renderedMessages = computed(() => {
  if (!inDiscussionMode.value || !discussionRootMessage.value) return filteredMessages.value
  const root = discussionRootMessage.value

  const comments = discussionCommentsRaw.value
    .slice()
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
    .map((item) => toViewMessage(item, urlsByAttachment.value))

  return [root, ...comments]
})

const chatCallRows = ref<ChatCallItem[]>([])
let callRowsRequestID = 0

async function loadChatCallRows(chatID: string) {
  const requestID = ++callRowsRequestID
  const target = (chatID || '').trim()
  chatCallRows.value = []
  if (!target) return
  try {
    const items = await listChatCalls(target)
    if (requestID !== callRowsRequestID) return
    chatCallRows.value = items
  } catch {
    if (requestID === callRowsRequestID) chatCallRows.value = []
  }
}

watch(activeMessagesChatID, (chatID) => {
  void loadChatCallRows(chatID)
}, { immediate: true })

const pinnedMessageRaw = ref<MessageItem | null>(null)

watch(activeMessagesChatID, (chatID) => {
  const target = (chatID || '').trim()
  pinnedMessageRaw.value = null
  if (!target) return
  void (async () => {
    try {
      const item = await getPinnedMessage(target)
      if (activeMessagesChatID.value === target) pinnedMessageRaw.value = item
    } catch {
      if (activeMessagesChatID.value === target) pinnedMessageRaw.value = null
    }
  })()
}, { immediate: true })

const pinnedMessageView = computed(() => {
  const raw = pinnedMessageRaw.value
  if (!raw) return null
  return toViewMessage(raw, urlsByAttachment.value)
})

const pinnedContextMessage = computed(() => {
  const pinned = pinnedMessageRaw.value
  const target = contextMenu.value?.message
  if (!pinned || !target) return false
  return String(pinned.id || '').trim() === String(target.raw.id || '').trim()
})

const chatAudioTracks = computed<ChatAudioTrack[]>(() => {
  const list: ChatAudioTrack[] = []
  const seen = new Set<string>()
  for (const message of renderedMessages.value) {
    for (const attachment of message.attachments) {
      if (attachment.kind !== 'audio' || !attachment.url) continue
      const id = attachment.id || `file:${(attachment.filename || attachment.url).trim()}`
      if (seen.has(id)) continue
      seen.add(id)
      list.push({
        id,
        url: attachment.url,
        title: attachment.filename || '',
        artist: '',
        durationMs: attachment.durationMs || 0,
        poster: attachment.previewUrl || '',
      })
    }
  }
  return list
})
const currentUserAvatarSrc = ref(normalizeAvatarSrc(currentUser?.avatar_data_url || localProfile?.avatarDataUrl || ''))
const currentUserDisplayName = ref(
  `${(currentUser?.first_name || localProfile?.firstName || '').trim()} ${(currentUser?.last_name || localProfile?.lastName || '').trim()}`.trim() || currentUser?.username || '',
)
const extraAvatarByUserId = ref<Record<string, string>>({})
const extraSenderNameByUserId = ref<Record<string, string>>({})

watch(profileUpdate, (update) => {
  if (!update) return
  const userID = (update.userID || '').trim()
  const user = update.user
  if (!userID || !user) return
  const avatar = normalizeAvatarSrc(user.avatar_data_url || '')
  const name = `${(user.first_name || '').trim()} ${(user.last_name || '').trim()}`.trim() || (user.username || '').trim()
  if (avatar) extraAvatarByUserId.value = { ...extraAvatarByUserId.value, [userID]: avatar }
  if (name) extraSenderNameByUserId.value = { ...extraSenderNameByUserId.value, [userID]: name }
  if (userID !== (currentUser?.id || '').trim()) return
  if (avatar) currentUserAvatarSrc.value = avatar
  if (name) currentUserDisplayName.value = name
})

const avatarByUserId = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  const peerId = (peerProfile.value?.id || '').trim() || (selectedChat.value?.peer_user_id || '').trim()
  const peerAvatar = normalizeAvatarSrc(selectedChat.value?.avatar_data_url || peerProfile.value?.avatar_data_url || '')
  if (peerId && peerAvatar) out[peerId] = peerAvatar
  if (currentUser?.id && currentUserAvatarSrc.value) out[currentUser.id] = currentUserAvatarSrc.value
  for (const member of chatMembers.value) {
    const id = (member.user_id || '').trim()
    const avatar = normalizeAvatarSrc(member.profile?.avatar_data_url || '')
    if (id && avatar) out[id] = avatar
  }
  for (const [id, avatar] of Object.entries(extraAvatarByUserId.value || {})) {
    const clean = (id || '').trim()
    const src = normalizeAvatarSrc(avatar || '')
    if (clean && src) out[clean] = src
  }
  return out
})
const senderNameByUserId = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  if (currentUser?.id) {
    const meName = `${(currentUser.first_name || '').trim()} ${(currentUser.last_name || '').trim()}`.trim() || currentUser.username || ''
    if (meName) out[currentUser.id] = meName
  }
  for (const member of chatMembers.value) {
    const id = (member.user_id || '').trim()
    if (!id) continue
    const profile = member.profile
    const name = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() || (profile?.username || '').trim()
    if (name) out[id] = name
  }
  const peerId = (peerProfile.value?.id || '').trim()
  if (peerId) {
    const name = `${(peerProfile.value?.first_name || '').trim()} ${(peerProfile.value?.last_name || '').trim()}`.trim() || (peerProfile.value?.username || '').trim()
    if (name) out[peerId] = name
  }
  for (const [id, name] of Object.entries(extraSenderNameByUserId.value || {})) {
    const clean = (id || '').trim()
    const value = (name || '').trim()
    if (clean && value) out[clean] = value
  }
  return out
})
const senderRoleByUserId = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (const member of chatMembers.value) {
    const id = (member.user_id || '').trim()
    const role = (member.role || '').trim()
    if (id && role) out[id] = role
  }
  return out
})
const channelPanelTitle = computed(() => {
  if (!conversationChat.value) return 'Group'
  if ((conversationChat.value.kind || '').trim() === 'group') return conversationChat.value.title
  const parentID = (conversationChat.value.parent_chat_id || '').trim()
  return parentID ? (chats.value.find((chat) => chat.id === parentID)?.title || conversationChat.value.title) : conversationChat.value.title
})

const conversationTitle = computed(() => {
  if (inDiscussionMode.value) return 'Discussion'
  const active = conversationChat.value
  if (!active) return 'Chat'
  const kind = (active.kind || '').trim()
  if (kind === 'channel') return `# ${active.title || 'Channel'}`
  if (kind === 'group') {
    const selectedChannelID = (selectedGroupChannelID.value || '').trim()
    if (selectedChannelID) {
      const channel = visibleGroupChannels.value.find((item) => (item.id || '').trim() === selectedChannelID)
      const title = channel?.title || (selectedChannelID === active.id ? 'General' : active.title)
      return `# ${title || 'General'}`
    }
    return active.title || 'Group'
  }
  return active.title || 'Chat'
})

const conversationSubtitle = computed(() => {
  if (!inDiscussionMode.value || !discussionRootMessage.value) return chatSubtitle.value
  const count = Math.max(0, renderedMessages.value.length - 1)
  return `${count} ${count === 1 ? 'comments' : 'comments'}`
})

const conversationAvatarOwner = computed<{ ownerId?: string; ownerKind: 'user' | 'chat' }>(() => {
  const active = conversationChat.value
  if (!active) return { ownerKind: 'chat' }
  const peerId = (peerProfile.value?.id || '').trim() || (active.peer_user_id || '').trim()
  if ((active.is_direct || active.kind === 'direct') && peerId) {
    return { ownerId: peerId, ownerKind: 'user' }
  }
  return active.id ? { ownerId: String(active.id), ownerKind: 'chat' } : { ownerKind: 'chat' }
})

/**
 * Wallpaper overrides the picker just wrote, keyed by chat id, so the pane
 * repaints immediately without waiting for the chat list to be refetched.
 */
const wallpaperOverride = ref<Record<string, { kind: string; value: string }>>({})

const conversationWallpaper = computed<Record<string, string> | undefined>(() => {
  const active = conversationChat.value
  if (!active) return undefined
  const override = wallpaperOverride.value[active.id]
  return wallpaperStyle(override?.kind ?? active.wallpaper_kind, override?.value ?? active.wallpaper_value)
})

function handleWallpaperChanged(chat: ChatItem) {
  if (!chat?.id) return
  wallpaperOverride.value = {
    ...wallpaperOverride.value,
    [chat.id]: { kind: String(chat.wallpaper_kind || 'none'), value: String(chat.wallpaper_value || '') },
  }
}

/**
 * Telegram style typing line: "typing…" in a private chat, "Alice is typing…"
 * (or several names) in a group. Only peers are shown, never ourselves.
 */
const typingLabel = computed(() => {
  const chatID = (activeMessagesChatID.value || '').trim()
  if (!chatID) return ''
  const ids = Object.keys(typingByChat.value[chatID] || {})
  if (ids.length === 0) return ''
  const chat = conversationChat.value
  const kind = (chat?.kind || '').trim()
  const isDirect = Boolean(chat?.is_direct) || kind === 'direct'
  if (ids.length === 1 && isDirect) return t('chat.typing', undefined, 'typing')
  const names = ids.map((id) => senderNameByUserId.value[id] || '').filter(Boolean)
  if (ids.length === 1) {
    const name = names[0] || ''
    if (!name) return t('chat.typing', undefined, 'typing')
    return `${name} ${t('chat.is_typing', undefined, 'is typing…')}`
  }
  if (ids.length > 3) return t('chat.typing_count', { count: ids.length }, `${ids.length} users typing…`)
  const shown = names.slice(0, 3).join(', ')
  if (!shown) return t('chat.typing_count', { count: ids.length }, `${ids.length} users typing…`)
  return `${shown} ${t('chat.are_typing', undefined, 'are typing…')}`
})

watch(selectedChatID, (chatID) => {
  discussionRootMessage.value = null
  discussionThreadChatID.value = ''
  discussionCommentsRaw.value = []
  realtimeExtraChatIDs.value = []

  // BUG 4: a pending forward must never survive a chat switch. The confirm
  // flow navigates on purpose, so it marks the chat it is heading to first —
  // that single change is allowed to keep the forward payload alive.
  const token = String(forwardConfirmedChatID.value || '').trim()
  forwardConfirmedChatID.value = ''
  if (token && token === String(chatID || '').trim()) return
  if (forwardPickerOpen.value) {
    forwardPickerOpen.value = false
    forwardPickerQuery.value = ''
    forwardTopicGroupID.value = ''
  }
  forwardPickerSelected.value = new Set()
  forwardTopicByGroupID.value = {}
  clearForward()
})

async function refreshDiscussionComments() {
  if (!discussionRootMessage.value) return
  const channelID = (conversationChat.value?.id || '').trim()
  const rootMessageID = (discussionRootMessage.value.raw.id || '').trim()
  if (!channelID || !rootMessageID) return
  if (discussionRefreshing.value) return
  discussionRefreshing.value = true
  try {
    const page = await listStandaloneChannelThreadComments(channelID, rootMessageID, { limit: 80 })
    discussionThreadChatID.value = (page.thread_chat_id || '').trim()
    discussionCommentsRaw.value = Array.isArray(page.items) ? page.items : []
    void hydrateDiscussionAuthors(discussionCommentsRaw.value)
    await hydrateAttachmentURLs(discussionCommentsRaw.value, urlsByAttachment, discussionAttachmentRequests, parseMessageContent, getAttachment)
  } catch {
    // ignore
  } finally {
    discussionRefreshing.value = false
  }
}

async function hydrateDiscussionAuthors(items: MessageItem[]) {
  const missing = new Set<string>()
  for (const msg of items || []) {
    const id = String(msg?.user_id || '').trim()
    if (!id) continue
    if (id.startsWith('bot:')) continue
    if (senderNameByUserId.value?.[id]) continue
    if (extraSenderNameByUserId.value?.[id]) continue
    missing.add(id)
  }
  if (missing.size === 0) return
  const toFetch = Array.from(missing).slice(0, 40)
  for (const userID of toFetch) {
    try {
      const profile = await getUserByID(userID)
      const rawProfile = (profile && typeof profile === 'object' ? profile : {}) as Record<string, unknown>
      const display = `${String(rawProfile.first_name || '').trim()} ${String(rawProfile.last_name || '').trim()}`.trim()
        || String(rawProfile.username || '').trim()
      const avatar = normalizeAvatarSrc(String(rawProfile.avatar_data_url || '').trim())
      if (display) extraSenderNameByUserId.value = { ...extraSenderNameByUserId.value, [userID]: display }
      if (avatar) extraAvatarByUserId.value = { ...extraAvatarByUserId.value, [userID]: avatar }
    } catch {
      // ignore
    }
  }
}

async function hydrateReactorProfiles(reactions?: MessageItem['reactions']) {
  const list = Array.isArray(reactions) ? reactions : []
  const ids = new Set<string>()
  for (const reaction of list) {
    for (const rawID of reaction?.user_ids || []) {
      const id = String(rawID || '').trim()
      if (id) ids.add(id)
    }
  }
  if (ids.size === 0) return
  const missing = [...ids].filter((id) => !senderNameByUserId.value?.[id] && !extraSenderNameByUserId.value?.[id])
  if (missing.length === 0) return
  for (const userID of missing.slice(0, 40)) {
    try {
      const profile = await getUserByID(userID)
      const rawProfile = (profile && typeof profile === 'object' ? profile : {}) as Record<string, unknown>
      const display = `${String(rawProfile.first_name || '').trim()} ${String(rawProfile.last_name || '').trim()}`.trim()
        || String(rawProfile.username || '').trim()
      const avatar = normalizeAvatarSrc(String(rawProfile.avatar_data_url || '').trim())
      if (display) extraSenderNameByUserId.value = { ...extraSenderNameByUserId.value, [userID]: display }
      if (avatar) extraAvatarByUserId.value = { ...extraAvatarByUserId.value, [userID]: avatar }
    } catch {
      // ignore
    }
  }
}

watch(
  () => contextMenu.value?.message?.raw.id || '',
  () => {
    const message = contextMenu.value?.message
    if (!message) return
    void hydrateReactorProfiles(message.raw.reactions)
  },
)

function stopDiscussionPolling() {
  if (discussionRefreshTimer.value) {
    window.clearInterval(discussionRefreshTimer.value)
    discussionRefreshTimer.value = null
  }
}

function startDiscussionPolling() {
  stopDiscussionPolling()
  if (!inDiscussionMode.value || !discussionRootMessage.value) return
  discussionRefreshTimer.value = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    void refreshDiscussionComments()
  }, 1500)
}

watch(
  () => [inDiscussionMode.value, discussionThreadChatID.value, discussionRootMessage.value?.raw.id || ''] as const,
  () => {
    if (!inDiscussionMode.value) {
      stopDiscussionPolling()
      realtimeExtraChatIDs.value = []
      return
    }
    const threadID = (discussionThreadChatID.value || '').trim()
    realtimeExtraChatIDs.value = threadID ? [threadID] : []
    startDiscussionPolling()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopDiscussionPolling()
})

function openDiscussion(message: (typeof messages.value)[number]) {
  discussionRootMessage.value = message
  clearReplyToMessage()

  const channelID = (conversationChat.value?.id || '').trim()
  const rootMessageID = (message.raw.id || '').trim()
  if (!channelID || !rootMessageID) return

  discussionLoading.value = true
  void refreshDiscussionComments().finally(() => {
    discussionLoading.value = false
  })
}

function closeDiscussion() {
  discussionRootMessage.value = null
  discussionThreadChatID.value = ''
  discussionCommentsRaw.value = []
  realtimeExtraChatIDs.value = []
  stopDiscussionPolling()
  clearReplyToMessage()
}

async function sendVoiceMessage(file: File, meta: AttachmentMeta) {
  pendingFiles.value = [
    ...pendingFiles.value,
    { id: `voice:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`, file, progress: 0, meta },
  ].slice(0, 8)
  await sendDraftSmart('')
}

async function sendDraftSmart(draft: string) {
  if ((forwardMessages.value || []).length > 0 && !inDiscussionMode.value) {
    const targets = (forwardTargetChatIDs.value || []).map((id) => id.trim()).filter(Boolean)
    const targetChatID = targets.length > 0 ? targets[0] : (activeMessagesChatID.value || '').trim()
    if (!targetChatID) return false

    const comment = (draft || '').trim()
    sending.value = true
    errorText.value = ''
    try {
      if (comment) {
        if (targets.length <= 1) {
          const ok = await sendDraft(comment)
          if (!ok) return false
        } else {
          for (const chatID of targets) {
            try {
              await sendMessage(chatID, comment, [], '')
            } catch (error) {
              if (isOfflineError(error)) {
                enqueueOutbox({ type: 'sendMessage', chatID, content: comment, attachmentIDs: [], replyToMessageID: '' })
                continue
              }
              throw error
            }
          }
        }
      }

      const items = forwardMessages.value.slice()
      const forwardTo = targets.length > 0 ? targets : [targetChatID]
      let results: PromiseSettledResult<MessageItem>[]
      try {
        const tasks: Promise<MessageItem>[] = []
        for (const chatID of forwardTo) {
          for (const m of items) {
            tasks.push(apiForwardMessage(chatID, (m.raw.id || '').trim()))
          }
        }
        results = await Promise.allSettled(tasks)
      } catch (error) {
        if (isOfflineError(error)) {
          for (const chatID of forwardTo) {
            for (const m of items) {
              const sourceMessageID = (m.raw.id || '').trim()
              if (!sourceMessageID) continue
              enqueueOutbox({ type: 'forwardMessage', targetChatID: chatID, sourceMessageID })
            }
          }
          clearForward()
          return true
        }
        throw error
      }
      const ok = results.some((r) => r.status === 'fulfilled')
      if (!ok) {
        const firstRejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
        if (firstRejected?.reason && isOfflineError(firstRejected.reason)) {
          for (const chatID of forwardTo) {
            for (const m of items) {
              const sourceMessageID = (m.raw.id || '').trim()
              if (!sourceMessageID) continue
              enqueueOutbox({ type: 'forwardMessage', targetChatID: chatID, sourceMessageID })
            }
          }
          clearForward()
          return true
        }
        throw new Error('Forward failed')
      }
      clearForward()
      window.setTimeout(() => {
        void loadMessages(targetChatID)
      }, 180)
      return true
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : t('chat.send_failed_runtime')
      return false
    } finally {
      sending.value = false
    }
  }

  if (!inDiscussionMode.value || !discussionRootMessage.value) return await sendDraft(draft)

  const channelID = (conversationChat.value?.id || '').trim()
  const rootMessageID = (discussionRootMessage.value.raw.id || '').trim()
  if (!channelID || !rootMessageID) return false

  const text = draft.trim()
  if (!text && pendingFiles.value.length === 0) return false

  sending.value = true
  errorText.value = ''
  try {
    const uploaded = await Promise.all(
      pendingFiles.value.map(async (pending) => {
        const up = await mediaPipelineClient.uploadFile({
          file: pending.file,
          onProgress: (percent) => {
            pendingFiles.value = pendingFiles.value.map((item) => (item.id === pending.id ? { ...item, progress: percent } : item))
          },
        })
        if (pending.meta) {
          try {
            await setAttachmentMeta(up.attachment.id, pending.meta)
          } catch {
            // metadata is optional: playback still works without waveform/duration
          }
        }
        return {
          id: up.attachment.id,
          token: encodeAttachmentToken({ id: up.attachment.id, filename: up.attachment.filename, mimeType: up.attachment.mime_type, kind: up.attachment.kind, flags: attachmentFlagsFromMeta(pending.meta) }),
        }
      }),
    )

    const content = [text, uploaded.map((item) => item.token).join(' ')].filter(Boolean).join('\n')
    const attachmentIDs = uploaded.map((item) => item.id)

    const res = await postStandaloneChannelThreadComment(channelID, rootMessageID, { content, attachment_ids: attachmentIDs })
    discussionCommentsRaw.value = [...discussionCommentsRaw.value, res.item]
    await hydrateAttachmentURLs([res.item], urlsByAttachment, discussionAttachmentRequests, parseMessageContent, getAttachment)
    void hydrateDiscussionAuthors([res.item])

    pendingFiles.value = []
    clearReplyToMessage()
    window.setTimeout(() => {
      void listStandaloneChannelThreadComments(channelID, rootMessageID, { limit: 80 })
        .then((page) => {
          discussionThreadChatID.value = (page.thread_chat_id || '').trim()
          discussionCommentsRaw.value = Array.isArray(page.items) ? page.items : []
          return hydrateAttachmentURLs(discussionCommentsRaw.value, urlsByAttachment, discussionAttachmentRequests, parseMessageContent, getAttachment)
        })
        .catch(() => {})
    }, 200)

    return true
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : t('chat.send_failed_runtime')
    return false
  } finally {
    sending.value = false
  }
}

const isPhoneLayout = ref(false)
const isTabletLayout = ref(false)

function syncViewportLayout() {
  const width = typeof window === 'undefined' ? 1024 : window.innerWidth
  isPhoneLayout.value = width <= 720
  isTabletLayout.value = width > 720 && width <= 1024
}

// On phones, selecting a group opens the topics list first; the conversation opens only after a topic is chosen.
const mobileConversationOpen = computed(() => Boolean(isPhoneLayout.value && hasActiveChat.value && !showGroupChannelsPanel.value))

function handleConversationBack() {
  if (inDiscussionMode.value) {
    closeDiscussion()
    return
  }
  if (!isPhoneLayout.value) return

  // Topics list visible: back always exits the group to the chat list
  // (All/Direct/Channels/Groups) instead of re-opening a channel.
  if (showGroupChannelsPanel.value) {
    selectChat('')
    return
  }

  const active = conversationChat.value
  const kind = String(active?.kind || '').trim()
  const chatID = String(active?.id || '').trim()

  if (kind === 'channel' && String(active?.parent_chat_id || '').trim()) {
    // Mobile: back from a sub-channel topic goes to the parent group topic list
    selectChat(active!.parent_chat_id!)
    return
  }

  if (kind === 'group' && chatID) {
    // If we are ALREADY in the group view (showing topics), go back to main chat list
    if (showGroupChannelsPanel.value) {
      selectChat('')
      return
    }
    // Otherwise go to topics list
    selectChat(chatID)
    return
  }

  selectChat('')
}

function handleSelectGroupChannel(channelChatID: string) {
  selectGroupChannel(channelChatID)
  if (isPhoneLayout.value) closeGroupChannelsPanel()
}

function handleCloseGroupChannels() {
  if (isPhoneLayout.value) {
    selectChat('')
    return
  }
  closeGroupChannelsPanel()
}

const canModerateSelectedChannel = computed(() => {
  const active = conversationChat.value
  const kind = (active?.kind || '').trim()
if (!active || kind !== 'standalone_channel') return false
  const role = (active.viewer_role || '').trim().toLowerCase()
  return role === 'owner' || role === 'admin'
})

const canPinContextMessage = computed(() => {
  const active = conversationChat.value
  if (!active) return false
  if ((active.kind || '').trim() !== 'standalone_channel') return true
  return canModerateSelectedChannel.value
})

/** The group channel (topic) currently open, if any — group channels are not part of `chats`. */
const activeGroupChannelChat = computed(() => {
  const activeID = (activeMessagesChatID.value || '').trim()
  if (!activeID) return null
  return visibleGroupChannels.value.find((item) => (item.id || '').trim() === activeID) || null
})

/** A group "voice" channel is a live voice room, not a text chat. */
const isVoiceChannel = computed(() => {
  if ((activeGroupChannelChat.value?.channel_type || '').trim() === 'voice') return true
  return (conversationChat.value?.channel_type || '').trim() === 'voice' && Boolean(activeGroupChannelChat.value)
})

const canSendInSelectedChat = computed(() => {
  const active = conversationChat.value
  if (!active) return false
  const kind = (active.kind || '').trim()
  if (kind !== 'standalone_channel') {
    const channel = activeGroupChannelChat.value
    if (channel && (channel.send_permission || '').trim() === 'admins') {
      const role = (channel.viewer_role || '').trim().toLowerCase()
      if (role !== 'owner' && role !== 'admin' && role !== 'moderator') return false
    }
    return true
  }
  if (inDiscussionMode.value) return Boolean(active.comments_enabled ?? true)
  return canModerateSelectedChannel.value
})

/** Explains why the composer is locked for the current channel. */
const composerLockHint = computed(() => {
  if (canSendInSelectedChat.value) return ''
  const channel = activeGroupChannelChat.value
  if (channel && (channel.send_permission || '').trim() === 'admins') {
    return t('chat.only_admins_can_send', undefined, 'Only admins can send messages in this channel')
  }
  return ''
})

const canReactInSelectedChat = computed(() => {
  const active = conversationChat.value
  if (!active) return false
  const kind = (active.kind || '').trim()
if (kind !== 'standalone_channel') return true
  return Boolean(active.reactions_enabled ?? true)
})

const showChannelViewerBar = computed(() => {
  const active = conversationChat.value
  if (!active || !hasActiveChat.value || inDiscussionMode.value) return false
  const kind = (active.kind || '').trim()
return kind === 'standalone_channel' && !canSendInSelectedChat.value
})

const canEditContextMessage = computed(() => {
  const target = contextMenu.value?.message
  if (!target) return false
  if ((target.raw.user_id || '').trim() === (currentUser?.id || '').trim()) return true
  return canModerateSelectedChannel.value
})

const canDeleteContextMessage = computed(() => {
  if (canEditContextMessage.value) return true
  const active = conversationChat.value
  return Boolean(active?.is_direct)
})

const canSaveContextMessage = computed(() => {
  const target = contextMenu.value?.message
  if (!target) return false
  return target.attachments.some((attachment) => (attachment.kind || '').trim() === 'audio')
})

const playlistStore = usePlaylist()
const toast = useToast()

async function saveContextMessage() {
  const target = contextMenu.value?.message
  closeContextMenu()
  if (!target) return
  const audios = target.attachments.filter((attachment) => (attachment.kind || '').trim() === 'audio')
  if (audios.length === 0) return
  let added = 0
  let skipped = 0
  let failed = 0
  for (const audio of audios) {
    const title = (audio.filename || '').trim().replace(/\.[a-z0-9]+$/i, '') || 'Unknown track'
    const track = await playlistStore.addTrack({
      title,
      fileUrl: audio.url,
      duration: Math.round(audio.durationMs / 1000) || 0,
    })
    if (track) added += 1
    else if (playlistStore.isSaved({ title, fileUrl: audio.url })) skipped += 1
    else failed += 1
  }
  if (added === 0 && skipped > 0) {
    toast.info(t('player.already_saved', undefined, 'Track is already in your playlist'))
    return
  }
  if (added === 0 && failed > 0) {
    toast.error(t('player.save_failed', undefined, 'Could not save the track'))
    return
  }
  const count = added > 0 ? added : audios.length
  toast.success(t('player.saved_to_playlist', { count }, `${count} track(s) saved to your playlist`))
}

async function pinContextMessage() {
  const target = contextMenu.value?.message
  closeContextMenu()
  if (!target) return
  const chatID = (activeMessagesChatID.value || '').trim()
  const messageID = String(target.raw.id || '').trim()
  if (!chatID || !messageID) return
  const alreadyPinned = Boolean(pinnedMessageRaw.value && String(pinnedMessageRaw.value.id || '').trim() === messageID)
  try {
    pinnedMessageRaw.value = await setPinnedMessage(chatID, messageID, !alreadyPinned)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('chat.pin_failed', undefined, 'Could not update the pinned message'))
  }
}

async function unpinPinnedMessage() {
  const chatID = (activeMessagesChatID.value || '').trim()
  const messageID = String(pinnedMessageRaw.value?.id || '').trim()
  if (!chatID || !messageID) return
  try {
    pinnedMessageRaw.value = await setPinnedMessage(chatID, messageID, false)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('chat.pin_failed', undefined, 'Could not update the pinned message'))
  }
}

function reportContextMessage() {
  closeContextMenu()
  toast.info(t('chat.report_soon', undefined, 'Reporting will be available soon'))
}

async function copyLinkContextMessage() {
  const target = contextMenu.value?.message
  const slug = (selectedChat.value?.public_slug || '').trim()
  closeContextMenu()
  if (!target) return
  if (!slug) {
    toast.info(t('chat.link_unavailable', undefined, 'This message does not have a public link yet'))
    return
  }
  const link = `${window.location.origin}/@${encodeURIComponent(slug)}/${encodeURIComponent(target.raw.id || '')}`
  try {
    await navigator.clipboard.writeText(link)
    toast.success(t('chat.link_copied', undefined, 'Message link copied'))
  } catch {
    toast.error(t('chat.copy_failed', undefined, 'Could not copy the link'))
  }
}

const conversationTransitionBackwards = ref(false)
const conversationTransitionName = computed(() => (conversationTransitionBackwards.value ? 'convSlideBack' : 'convSlide'))

watch(
  () => activeMessagesChatID.value,
  (nextID, prevID) => {
    const cleanNext = (nextID || '').trim()
    const cleanPrev = (prevID || '').trim()
    if (!cleanNext || !cleanPrev || cleanNext === cleanPrev) return

    const list = filteredChats.value
    const prevIdx = list.findIndex((chat) => (chat.id || '').trim() === cleanPrev)
    const nextIdx = list.findIndex((chat) => (chat.id || '').trim() === cleanNext)
    if (prevIdx === -1 || nextIdx === -1) return
    conversationTransitionBackwards.value = nextIdx < prevIdx
  },
)

async function handleCreateGroup(input: { title: string; memberIDs: string[]; onSuccess: () => void; onError: (message: string) => void }) {
  try {
    await createGroupChat(input.title, input.memberIDs)
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : errorText.value || 'Unable to create group')
  }
}

async function handleCreateChannel(input: {
  title: string
  channel_type?: 'text' | 'voice'
  memberIDs?: string[]
  publicSlug?: string
  isPublic?: boolean
  avatarDataUrl?: string | null
  onSuccess: () => void
  onError: (message: string) => void
}) {
  try {
    if (typeof input.isPublic === 'boolean') {
      await createStandaloneChannelChat(input.title, input.publicSlug || '', input.isPublic)
      if (input.avatarDataUrl) {
        await updateSelectedGroupProfile({ title: input.title, avatarDataUrl: input.avatarDataUrl })
      }
    } else {
      await createChannelForSelectedGroup(input.title, input.channel_type)
    }
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : errorText.value || 'Unable to create channel')
  }
}

const deleteConfirm = ref<{ open: boolean; chat: ChatItem | null; busy: boolean; error: string }>({ open: false, chat: null, busy: false, error: '' })

// ── Channel settings: the full panel lives in ChannelSettingsPanel.vue ────
const channelSettingsChat = ref<ChatItem | null>(null)

function openChannelSettings(channel: ChatItem | null) {
  if (!channel) return
  channelSettingsChat.value = channel
}

function closeChannelSettings() {
  channelSettingsChat.value = null
}

function handleChatSettingsUpdated(updated: ChatItem | null) {
  if (!updated?.id) return
  const previous = chats.value.find((item) => item.id === updated.id) || null
  chats.value = chats.value.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
  if (channelSettingsChat.value?.id === updated.id) channelSettingsChat.value = updated
  const structuralChange =
    !previous || previous.title !== updated.title || (previous.channel_type || '') !== (updated.channel_type || '')
  if (!structuralChange) return
  const groupID = (updated.parent_chat_id || '').trim() || (selectedChatID.value || '').trim()
  if (groupID) void loadGroupChannels(groupID)
}
const deleteForEveryone = ref(false)
const deleteCancelBtn = ref<HTMLButtonElement | null>(null)

function directoryUserTitle(user: { first_name?: string; last_name?: string; username?: string }) {
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || (user.username || '').trim()
}

watch(
  () => deleteConfirm.value.open,
  (open) => {
    if (!open) return
    void nextTick(() => deleteCancelBtn.value?.focus())
  },
)

async function handleChatContextMute(chat: ChatItem) {
  const chatID = (chat?.id || '').trim()
  if (!chatID) return
  const nextMuted = !mutedChatIDs.value[chatID]
  mutedChatIDs.value = { ...mutedChatIDs.value, [chatID]: nextMuted }
  try {
    const payloadRaw = await setChatMuted(chatID, nextMuted)
    const payload = (payloadRaw && typeof payloadRaw === 'object' ? payloadRaw : {}) as Record<string, unknown>
    const unread = (payload.unread_by_chat && typeof payload.unread_by_chat === 'object'
      ? payload.unread_by_chat
      : {}) as Record<string, number>
    const mutedIDs = Array.isArray(payload.muted_chat_ids)
      ? payload.muted_chat_ids.map((id) => String(id || '').trim()).filter(Boolean)
      : []
    unreadByChatId.value = unread
    mutedChatIDs.value = Object.fromEntries(mutedIDs.map((id) => [id, true]))
  } catch (error) {
    mutedChatIDs.value = { ...mutedChatIDs.value, [chatID]: !nextMuted }
    errorText.value = error instanceof Error ? error.message : t('chat.mute_failed_runtime', undefined, 'Mute failed')
  }
}

async function handleChatContextLeave(chat: ChatItem) {
  const chatID = (chat?.id || '').trim()
  if (!chatID || chat.is_direct) return
  try {
    const kind = (chat.kind || '').trim()
    if (kind === 'channel' && (chat.parent_chat_id || '').trim()) {
      await leaveChat((chat.parent_chat_id || '').trim())
    } else if (kind === 'standalone_channel') {
      const role = (chat.viewer_role || '').trim().toLowerCase()
      if (role === 'subscriber') {
        await unsubscribeChannel(chatID)
      } else if (role === 'owner') {
        handleChatContextDelete(chat)
        return
      } else {
        await leaveChat(chatID)
      }
    } else {
      await leaveChat(chatID)
    }

    if (selectedChatID.value === chatID) {
      selectedChatID.value = ''
      rawMessages.value = []
      chatMembers.value = []
      infoOpen.value = false
    }
    await loadChats()
    clearHash()
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : t('chat.leave_chat_error')
  }
}

function handleChatContextDelete(chat: ChatItem) {
  deleteForEveryone.value = false
  deleteConfirm.value = { open: true, chat, busy: false, error: '' }
}

function deleteDialogTitle(chat: ChatItem | null) {
  const kind = (chat?.kind || '').trim()
  if (kind === 'group') return t('chat.delete_group', undefined, 'Delete group')
  if (kind === 'standalone_channel') return t('chat.delete_channel', undefined, 'Delete channel')
  if (kind === 'channel') return t('chat.delete_topic', undefined, 'Delete topic')
  return t('chat.delete_chat', undefined, 'Delete chat')
}

function closeDeleteConfirm() {
  deleteForEveryone.value = false
  deleteConfirm.value = { open: false, chat: null, busy: false, error: '' }
}

async function confirmDeleteChat() {
  const chat = deleteConfirm.value.chat
  const chatID = (chat?.id || '').trim()
  const parentID = (chat?.parent_chat_id || '').trim()
  if (!chat || !chatID) {
    closeDeleteConfirm()
    return
  }

  deleteConfirm.value = { ...deleteConfirm.value, busy: true, error: '' }
  try {
    const kind = (chat.kind || '').trim()
    if (kind === 'channel' && parentID) {
      await deleteChannel(parentID, chatID)
      await loadGroupChannels(parentID)
      if (selectedGroupChannelByGroupId.value?.[parentID] === chatID) {
        selectedGroupChannelByGroupId.value = { ...selectedGroupChannelByGroupId.value, [parentID]: parentID }
        persistGroupSelection()
      }
    } else {
      // Deleting a direct chat only leaves my membership unless I explicitly
      // ask to remove it for the peer too.
      await deleteChat(chatID, Boolean(chat.is_direct) && deleteForEveryone.value ? { forEveryone: true } : undefined)
      if (kind === 'group') {
        selectedGroupChannelByGroupId.value = Object.fromEntries(Object.entries(selectedGroupChannelByGroupId.value || {}).filter(([k]) => k !== chatID))
        persistGroupSelection()
      }
    }

    if (selectedChatID.value === chatID) {
      selectedChatID.value = ''
      rawMessages.value = []
      chatMembers.value = []
      infoOpen.value = false
    }
    await loadChats()
    closeDeleteConfirm()
  } catch (error) {
    deleteConfirm.value = { ...deleteConfirm.value, busy: false, error: error instanceof Error ? error.message : t('chat.request_failed') }
  }
}

async function handleAddMembers(memberIDs: string[]) {
  try {
    await addMembersToSelectedGroup(memberIDs)
  } catch {
    // error text is already set in the workspace store
  }
}

async function handleSaveGroupProfile(input: {
  title: string
  avatarDataUrl?: string | null
  commentsEnabled?: boolean
  reactionsEnabled?: boolean
  isPublic?: boolean
  publicSlug?: string | null
  onSuccess: () => void
  onError: (message: string) => void
}) {
  try {
    await updateSelectedGroupProfile({
      title: input.title,
      avatarDataUrl: input.avatarDataUrl,
      commentsEnabled: input.commentsEnabled,
      reactionsEnabled: input.reactionsEnabled,
      isPublic: input.isPublic,
      publicSlug: input.publicSlug,
    })
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : errorText.value || 'Unable to save group')
  }
}

async function handleLeaveChat(input: { onSuccess: () => void; onError: (message: string) => void }) {
  try {
    await leaveSelectedChat()
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : errorText.value || 'Unable to leave chat')
  }
}

async function handleUpdateMemberRole(input: { userID: string; role: 'member' | 'moderator' | 'admin' | 'subscriber' | 'banned' }) {
  try {
    await updateSelectedGroupMemberRole(input.userID, input.role)
  } catch {
    // error text is already set in the workspace store
  }
}

async function handleRemoveMember(userID: string) {
  try {
    await removeSelectedGroupMember(userID)
  } catch {
    // error text is already set in the workspace store
  }
}

function onGlobalEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (contextReactionAnchor.value) {
    closeContextReactionPicker()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (contextMenu.value) {
    closeContextMenu()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (chatMenuAnchor.value) {
    closeChatMenu()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (photoViewerSrc.value) {
    closePhotoViewer()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (videoViewer.value) {
    closeVideoViewer()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (infoOpen.value) {
    closeInfo()
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (messageSearchOpen.value) {
    closeMessageSearch()
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (inDiscussionMode.value) {
    closeDiscussion()
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (!hasActiveChat.value) return
  const active = selectedChat.value
  const kind = String(active?.kind || '').trim()
  const groupID = String(active?.id || '').trim()
  const activeChatID = String(activeMessagesChatID.value || '').trim()

  // In group chats, ESC should exit the active topic/channel first (back to the group root),
  // not close the whole chat view.
  if (kind === 'group' && groupID && activeChatID && activeChatID !== groupID) {
    selectGroupChannel(groupID)
    event.preventDefault()
    event.stopPropagation()
    return
  }

  selectChat('')
  event.preventDefault()
  event.stopPropagation()
}

// The call identity is frozen when a call starts / starts ringing: switching
// chats while a call is up must not rename it or swap its avatar.
function resolveCallIdentity(chatID: string): CallIdentity | null {
  const id = (chatID || '').trim()
  if (!id) return null
  const isCurrent = (selectedChat.value?.id || '').trim() === id
  const chat = chats.value.find((item) => (item.id || '').trim() === id) ?? (isCurrent ? selectedChat.value : null)
  const title = (isCurrent ? conversationTitle.value : chat?.title || '').trim()
  const avatar = normalizeAvatarSrc((isCurrent ? selectedChat.value?.avatar_data_url || '' : '') || chat?.avatar_data_url || '')
  if (!title && !avatar) return null
  return {
    title: title || t('call.title', undefined, 'Call'),
    avatarSrc: avatar,
    avatarText: (title || 'C').slice(0, 1).toUpperCase(),
  }
}

setCallIdentityResolver(resolveCallIdentity)

/**
 * Which three-dot menu opened the shared overlay menu: the compact variant
 * (topics-panel header, next to the group name) hides wallpaper/poll/
 * navigation/export/clear/mute rows; the full variant (dialog header, far
 * right edge) keeps everything.
 */
const chatMenuVariant = ref<'full' | 'compact'>('full')

function openGroupChatMenu(anchor: { top: number; left: number; width: number; height: number }) {
  chatMenuVariant.value = 'compact'
  openChatMenu(anchor)
}

function openHeaderChatMenu(anchor: { top: number; left: number; width: number; height: number }) {
  chatMenuVariant.value = 'full'
  openChatMenu(anchor)
}

const callTitle = computed(
  () => callIdentity.value?.title || t('call.title', undefined, 'Call'),
)
const callAvatarText = computed(() => callIdentity.value?.avatarText || (callIdentity.value?.title || 'C').slice(0, 1).toUpperCase())
const callAvatarSrc = computed(() => callIdentity.value?.avatarSrc || '')
const incomingTitle = computed(() => incomingIdentity.value?.title || callTitle.value)
const incomingAvatarText = computed(() => incomingIdentity.value?.avatarText || callAvatarText.value)
const incomingAvatarSrc = computed(() => incomingIdentity.value?.avatarSrc || callAvatarSrc.value)
const liveNoticeTitle = computed(() => {
  const notice = liveNotice.value
  if (!notice) return ''
  return (
    notice.identity?.title ||
    chats.value.find((item) => (item.id || '').trim() === notice.chatID)?.title ||
    t('call.live_stream', undefined, 'Live stream')
  )
})

const isChannelChat = computed(() => {
  const chat = selectedChat.value
  if (!chat) return false
  const kind = (chat.kind || '').trim()
  return kind === 'standalone_channel' || kind === 'channel' || Boolean(chat.is_public)
})

const callOverlayVisible = computed(() => {
  if (callMinimized.value) return false
  if (callStatus.value !== 'idle' && callStatus.value !== 'ended') return true
  return Boolean(callNote.value)
})

const callDirectory = computed(() => {
  const rows: Array<{ user_id: string; display_name: string; avatar_src?: string }> = []
  const seen = new Set<string>()
  // A blank name stays blank on purpose: the call UI falls back to the chat
  // title instead of leaking a raw user id / uuid.
  const push = (userID: string, name: string, avatar: string) => {
    const id = (userID || '').trim()
    if (!id || seen.has(id)) return
    seen.add(id)
    rows.push({ user_id: id, display_name: (name || '').trim(), avatar_src: avatar })
  }
  const selfID = currentUser?.id || ''
  if (selfID) {
    push(selfID, t('call.you', undefined, 'You'), normalizeAvatarSrc(currentUser?.avatar_data_url || ''))
  }
  for (const member of chatMembers.value) {
    const profile = member.profile
    const name = [profile?.first_name || '', profile?.last_name || ''].map((part) => part.trim()).filter(Boolean).join(' ')
    push(member.user_id, name || profile?.username || '', normalizeAvatarSrc(profile?.avatar_data_url || ''))
  }
  const peer = peerProfile.value
  if (peer?.id) {
    const name = [peer.first_name || '', peer.last_name || ''].map((part) => part.trim()).filter(Boolean).join(' ')
    push(peer.id, name || peer.username || '', normalizeAvatarSrc(peer.avatar_data_url || ''))
  }
  // Message senders (channel owners, group members) carry the remaining names.
  const knownIDs = new Set([...Object.keys(senderNameByUserId.value), ...Object.keys(avatarByUserId.value)])
  for (const id of knownIDs) {
    push(id, senderNameByUserId.value[id] || '', normalizeAvatarSrc(avatarByUserId.value[id] || ''))
  }
  return rows
})

function beginCall() {
  const chatID = (activeMessagesChatID.value || '').trim()
  if (!chatID) return
  // Voice channels are live rooms (Discord-style): join immediately as live,
  // never as a ringing "calling" call.
  if (isVoiceChannel.value) {
    void startCall({ chatID, kind: 'group', live: true })
    return
  }
  // Channels are watched as a broadcast stream: one publisher, everyone else
  // joins as a viewer.
  if (isChannelChat.value) {
    void startCall({ chatID, kind: 'broadcast', role: 'publisher' })
    return
  }
  const chat = selectedChat.value
  const kind = chat?.is_direct ? 'p2p' : 'group'
  void startCall({ chatID, kind })
}

function onIncomingAccept() {
  void acceptIncoming()
}

function onCallHangup() {
  hangup()
}

onMounted(() => {
  syncViewportLayout()
  window.addEventListener('resize', syncViewportLayout)
  window.addEventListener('keydown', onGlobalEscape, { capture: true })
  window.addEventListener('dragend', resetFileDrag)
  window.addEventListener('drop', resetFileDrag)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewportLayout)
  window.removeEventListener('keydown', onGlobalEscape, { capture: true })
  window.removeEventListener('dragend', resetFileDrag)
  window.removeEventListener('drop', resetFileDrag)
})
</script>

<template>
  <div class="workspace" :class="{ phone: isPhoneLayout, tablet: isTabletLayout, 'conv-open': mobileConversationOpen, 'info-open': infoOpen }">
    <aside class="wsSidebar" :aria-hidden="isPhoneLayout && mobileConversationOpen">
      <ChatSidebar
        :chats="filteredChats"
        :selected-chat-i-d="selectedChatID"
        :current-user-id="currentUser?.id || ''"
        :current-username="currentUser?.username || ''"
        :current-user-display-name="currentUserDisplayName"
        :current-user-avatar-src="currentUserAvatarSrc"
        :search="sidebarSearch"
        :selected-filter-tab="selectedFilterTab"
        :unread-all="unreadCounts.all"
        :unread-direct="unreadCounts.direct"
        :unread-channel="unreadCounts.channel"
        :unread-group="unreadCounts.group"
        :unread-by-chat-id="unreadByChatId"
        :typing-by-chat-id="typingByChat"
        :muted-chat-i-ds="mutedChatIDs"
        :loading="loadingChats"
        :searching-directory="searchingDirectory"
        :directory-query="directoryQuery"
        :directory-results="directoryResults"
        :sidebar-panel="sidebarPanel"
        :can-create-channel="canCreateChannel"
        :show-group-channels-panel="showGroupChannelsPanel"
        :group-title="channelPanelTitle"
        :group-member-count="chatMembers.length"
        :group-channels="visibleGroupChannels"
        :selected-group-channel-i-d="selectedGroupChannelID"
        :loading-group-channels="loadingGroupChannels"
        @update:search="sidebarSearch = $event"
        @update:selected-filter-tab="
          (value) => {
            setChatFilter(value === 0 ? 'all' : value === 1 ? 'direct' : value === 2 ? 'channel' : 'group')
          }
        "
        @select="selectChat"
        @select-directory-chat="selectDirectoryChat"
        @select-directory-user="(user) => openDirectChatWithUser(user.id, directoryUserTitle(user))"
        @open-settings="openSidebarSettings"
        @close-settings="closeSidebarSettings"
        @update-current-user-avatar="currentUserAvatarSrc = normalizeAvatarSrc($event || '')"
        @create-group="handleCreateGroup"
        @create-channel="handleCreateChannel"
        @chat-context-mute="handleChatContextMute"
        @chat-context-leave="handleChatContextLeave"
        @chat-context-delete="handleChatContextDelete"
        @open-channel-settings="openChannelSettings"
        @open-group-menu="openGroupChatMenu"
        @close-group-channels="handleCloseGroupChannels"
        @select-group-channel="handleSelectGroupChannel"
        @create-group-channel="
          (input: { title: string; channel_type: 'text' | 'voice' }) =>
            handleCreateChannel({ title: input.title, channel_type: input.channel_type, onSuccess: () => undefined, onError: () => undefined })
        "
      />
    </aside>

    <section
      class="conversation"
      :style="conversationWallpaper"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDropFiles"
    >
      <ChatConversationHeader
        v-if="hasActiveChat"
        :title="conversationTitle"
        :subtitle="conversationSubtitle"
        :avatar-text="(selectedChat?.title || 'C').slice(0, 1).toUpperCase()"
        :avatar-src="normalizeAvatarSrc(selectedChat?.avatar_data_url || peerProfile?.avatar_data_url || '')"
        :owner-id="conversationAvatarOwner.ownerId"
        :owner-kind="conversationAvatarOwner.ownerKind"
        :typing-label="typingLabel"
        :search-open="messageSearchOpen"
        :search-value="messageSearch"
        :show-back="inDiscussionMode || mobileConversationOpen"
        :stream-mode="isChannelChat"
        :loading="loadingMessages"
        :can-broadcast="canBroadcastInSelectedChat"
        @open-info="openInfo"
        @open-search="openMessageSearch"
        @close-search="closeMessageSearch"
        @update-search="messageSearch = $event"
        @open-menu="openHeaderChatMenu"
        @back="handleConversationBack"
        @start-call="beginCall"
      />

      <ChatMusicPlayer :tracks="chatAudioTracks" />

      <transition :name="conversationTransitionName" mode="out-in">
        <div v-if="isVoiceChannel" :key="`voice:${activeMessagesChatID}`" class="convBody convBodyVoice">
          <VoiceChannelPanel
            :chat-i-d="activeMessagesChatID"
            :title="conversationTitle"
            @open-user="openInfoForUser"
          />
        </div>
        <div v-else :key="activeMessagesChatID" class="convBody">
          <ChatMessageList
            :loading="loadingMessages || discussionLoading"
            :messages="renderedMessages"
            :call-rows="chatCallRows"
            :selected-chat-i-d="activeMessagesChatID"
            :discussion-mode="inDiscussionMode"
            :is-public-channel="Boolean(selectedChat && selectedChat.kind === 'standalone_channel' && !inDiscussionMode)"
            :comments-enabled="Boolean(selectedChat?.comments_enabled ?? true)"
            :message-search="messageSearch"
            :error-text="errorText"
            :current-user-id="currentUser?.id || ''"
            :current-user-avatar-src="currentUserAvatarSrc"
            :avatar-by-user-id="avatarByUserId"
            :context-menu="contextMenu"
            :context-reaction-anchor="contextReactionAnchor"
            :media-overlay-open="isMediaOverlayOpen"
            :delivery-status-by-message="messageStatusesByMessage"
            :sender-name-by-user-id="senderNameByUserId"
            :sender-role-by-user-id="senderRoleByUserId"
            :show-sender-meta="inDiscussionMode || Boolean(selectedChat && !selectedChat.is_direct && (selectedChat.kind === 'group' || selectedChat.kind === 'channel'))"
            :can-edit-context-message="canEditContextMessage"
            :can-delete-context-message="canDeleteContextMessage"
            :can-save-context-message="canSaveContextMessage"
            :can-pin-context-message="canPinContextMessage"
            :pinned-context-message="pinnedContextMessage"
            :pinned-message="pinnedMessageView"
            :channel-title="conversationTitle"
            :can-comment="canSendInSelectedChat"
            :can-react="canReactInSelectedChat"
            @open-image="openPhotoViewer"
            @open-video="openVideoViewer"
            @open-user-info="openInfoForUser"
            @open-username="openDirectChatByUsername"
            @reply-to-message="beginReplyToMessage"
            @open-discussion="openDiscussion"
            @react="({ messageID, emoji }) => reactToMessage(messageID, emoji)"
            @mark-read="({ chatID, messageIDs }) => markMessagesRead(chatID, messageIDs)"
            @open-context-menu="openContextMenu"
            @close-context-menu="closeContextMenu"
            @open-reaction-picker="openContextReactionPicker"
            @open-context-reaction-picker="openContextReactionPicker"
            @close-context-reaction-picker="closeContextReactionPicker"
            @select-reaction-from-picker="selectReactionFromPicker"
            @copy-context-message="copyContextMessage"
            @reply-context-message="replyFromContextMenu"
            @forward-context-message="openForwardPicker"
            @forward-selected-messages="openForwardPickerForMessages($event as any)"
            @edit-context-message="editFromContextMenu"
            @delete-context-message="deleteContextMessage"
            @save-context-message="saveContextMessage"
            @pin-context-message="pinContextMessage"
            @unpin-pinned-message="unpinPinnedMessage"
            @copy-link-context-message="copyLinkContextMessage"
            @report-context-message="reportContextMessage"
            @near-bottom="isNearBottom = $event"
          />
        </div>
      </transition>

      <div v-if="hasActiveChat && !showChannelViewerBar && !isVoiceChannel" class="composerInline">
        <div v-if="!canSendInSelectedChat && composerLockHint" class="composerLockHint">
          <v-icon icon="mdi-lock-outline" size="13" />
          <span>{{ composerLockHint }}</span>
        </div>
        <ChatComposer
          :chat-key="selectedChatID"
          :sending="sending"
          :disabled="!selectedChatID || !canSendInSelectedChat"
          :pending-files="pendingFiles"
          :reply-to-message="composerReplyTarget"
          :editing-message="editingMessage"
          :forward-messages="forwardMessages"
          :suppress-reply-preview="inDiscussionMode"
          @typing="noteTyping(activeMessagesChatID)"
          @pick-files="setPendingFiles"
          @remove-pending-file="removePendingFile"
          @send="sendDraftSmart"
          @send-voice="sendVoiceMessage"
          @clear-reply="clearReplyToMessage"
          @clear-edit="editFromContextMenu(null)"
          @clear-forward="clearForward"
        />
      </div>

      <div v-else-if="showChannelViewerBar" class="viewerActionBar">
        <button type="button" class="viewerIconBtn" :aria-label="t(Boolean(activeMessagesChatID && mutedChatIDs[activeMessagesChatID]) ? 'chat.unmute' : 'chat.mute')" @click="toggleMuteSelectedChat">
          <v-icon :icon="Boolean(activeMessagesChatID && mutedChatIDs[activeMessagesChatID]) ? 'mdi-bell-ring-outline' : 'mdi-bell-off-outline'" size="20" />
        </button>
        <button
          type="button"
          class="viewerPrimaryBtn"
          @click="((selectedChat?.viewer_role || '').trim().toLowerCase() === 'subscriber' ? unsubscribeSelectedChannel() : subscribeSelectedChannel())"
        >
          {{
            (selectedChat?.viewer_role || '').trim().toLowerCase() === 'subscriber'
              ? t('chat.unsubscribe', undefined, 'Unsubscribe')
              : t('chat.subscribe', undefined, 'Subscribe')
          }}
        </button>
        <button type="button" class="viewerIconBtn" :aria-label="t('chat.open_info', undefined, 'Open info')" @click="openInfo">
          <v-icon icon="mdi-information-outline" size="20" />
        </button>
      </div>

      <ChatWorkspaceOverlays
        :viewer-src="photoViewerSrc"
        :video-viewer="videoViewer"
        :selected-chat="selectedChat"
        :chat-menu-anchor="chatMenuAnchor"
        :menu-variant="chatMenuVariant"
        :messages-chat-i-d="activeMessagesChatID"
        :is-selected-chat-muted="Boolean(activeMessagesChatID && mutedChatIDs[activeMessagesChatID])"
        @close-photo-viewer="closePhotoViewer"
        @close-video-viewer="closeVideoViewer"
        @close-chat-menu="closeChatMenu"
        @open-info="openInfo"
        @open-message-search="openMessageSearch"
        @toggle-mute-selected-chat="toggleMuteSelectedChat"
        @leave-chat="handleLeaveChat"
        @open-image="openPhotoViewer"
        @open-video="openVideoViewer"
        @wallpaper-changed="handleWallpaperChanged"
      />

      <transition name="dropzoneFade">
        <div v-if="draggingFiles" class="wsDropzone">
          <div class="wsDropzoneInner">
            <v-icon icon="mdi-tray-arrow-down" size="40" class="wsDropzoneIcon" />
            <div class="wsDropzoneTitle">{{ t('chat.drop_files', undefined, 'Drop files to send') }}</div>
            <div class="wsDropzoneHint">{{ t('chat.drop_files_hint', undefined, 'Images, videos and any other files') }}</div>
          </div>
        </div>
      </transition>
    </section>

    <aside class="infoDock" :class="{ open: infoOpen }" :aria-hidden="!infoOpen">
      <ChatInfoPanel
        :open="infoOpen"
        :selected-chat="selectedChat"
        :subtitle="infoSubtitle"
        :current-user="currentUser"
        :local-profile="localProfile"
        :peer-profile="peerProfile"
        :focused-user-profile="focusedInfoUserProfile"
        :chat-members="chatMembers"
        :removed-chat-members="removedChatMembers"
        :selected-chat-invite-links="selectedChatInviteLinks"
        :messages="messages"
        :direct-peer-id="directPeerId"
        :muted-chat-i-ds="mutedChatIDs"
        @close="closeInfo"
        @save-group-profile="handleSaveGroupProfile"
        @chat-updated="handleChatSettingsUpdated"
        @leave-chat="handleLeaveChat"
        @add-members="handleAddMembers"
        @update-member-role="handleUpdateMemberRole"
        @remove-member="handleRemoveMember"
        @subscribe-channel="subscribeSelectedChannel"
        @unsubscribe-channel="unsubscribeSelectedChannel"
        @create-invite-link="createSelectedChatInviteLink"
        @open-direct-chat="openDirectChatWithUser"
        @delete-chat="handleChatContextDelete"
        @toggle-mute-chat="toggleMuteSelectedChat"
        @open-image="openPhotoViewer"
        @open-video="openVideoViewer"
      />
    </aside>

    <ChannelSettingsPanel
      :open="Boolean(channelSettingsChat)"
      :chat="channelSettingsChat"
      :current-user="currentUser"
      @close="closeChannelSettings"
      @chat-updated="handleChatSettingsUpdated"
      @delete-chat="handleChatContextDelete"
    />

    <div v-if="deleteConfirm.open" class="wsDangerOverlay" @click.self="closeDeleteConfirm">
      <div class="wsDangerDialog" role="dialog" aria-modal="true" :aria-label="deleteDialogTitle(deleteConfirm.chat)">
        <div class="wsDangerTitle">{{ deleteDialogTitle(deleteConfirm.chat) }}</div>
        <div class="wsDangerText">
          {{ t('chat.delete_confirm', undefined, 'This action cannot be undone. Click Delete again to confirm.') }}
        </div>
        <div v-if="deleteConfirm.chat?.is_direct" class="wsDangerText wsDangerHint">
          {{ t('chat.delete_direct_hint', undefined, 'Only you will lose this chat.') }}
        </div>
        <label v-if="deleteConfirm.chat?.is_direct" class="wsDangerCheck">
          <input v-model="deleteForEveryone" type="checkbox" :disabled="deleteConfirm.busy" />
          <span>{{ t('chat.delete_for_everyone', undefined, 'Also delete for the other person') }}</span>
        </label>
        <div v-if="deleteConfirm.error" class="wsDangerError">{{ deleteConfirm.error }}</div>
        <div class="wsDangerActions">
          <button ref="deleteCancelBtn" type="button" class="wsDangerBtn primary" autofocus :disabled="deleteConfirm.busy" @click="closeDeleteConfirm">
            {{ t('chat.cancel', undefined, 'Cancel') }}
          </button>
          <button type="button" class="wsDangerBtn danger" :disabled="deleteConfirm.busy" @click="confirmDeleteChat">
            {{ deleteConfirm.busy ? t('chat.deleting', undefined, 'Deleting…') : t('chat.delete_action', undefined, 'Delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="forwardPickerOpen" class="fwOverlay" @click.self="closeForwardPicker">
      <div class="fwDialog" @click.stop>
        <div class="fwHeader">
          <button
            v-if="forwardTopicGroupID"
            type="button"
            class="fwClose fwBack"
            :aria-label="t('common.back', undefined, 'Back')"
            @click="closeForwardTopics"
          >
            <v-icon icon="mdi-arrow-left" size="18" />
          </button>
          <div class="fwTitle">
            {{ forwardTopicGroupID ? t('chat.forward_choose_topic', undefined, 'Choose a topic') : t('chat.forward', undefined, 'Forward') }}
          </div>
          <button type="button" class="fwClose" :aria-label="t('common.close', undefined, 'Close')" @click="closeForwardPicker">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div v-if="!forwardTopicGroupID" class="fwSearch">
          <v-icon icon="mdi-magnify" size="18" class="fwSearchIcon" />
          <input v-model="forwardPickerQuery" class="fwSearchInput" :placeholder="t('chat.search', undefined, 'Search')" />
        </div>
        <div class="fwList">
          <template v-if="forwardTopicGroupID">
            <p v-if="forwardTopicsLoading" class="fwEmpty">{{ t('chat.loading_topics', undefined, 'Loading topics...') }}</p>
            <div
              v-for="topic in forwardTopicRows"
              :key="topic.id"
              class="fwItem fwTopicItem"
              :class="{ locked: !canForwardInto(topic) }"
              role="button"
              tabindex="0"
              :aria-disabled="!canForwardInto(topic)"
              :title="canForwardInto(topic) ? undefined : t('chat.forward_admins_only', undefined, 'Only admins can post here')"
              @click="selectForwardTopic(topic)"
              @keydown.enter.prevent="selectForwardTopic(topic)"
              @keydown.space.prevent="selectForwardTopic(topic)"
            >
              <span class="fwHashBadge" :style="{ background: avatarColorFor(String(topic.id || '').trim()) }">#</span>
              <div class="fwMain">
                <div class="fwName">{{ forwardTopicTitle(topic) }}</div>
              </div>
              <div class="fwPick">
                <v-icon v-if="!canForwardInto(topic)" icon="mdi-lock-outline" size="18" />
                <v-icon v-else :icon="isForwardTopicSelected(topic) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" size="18" />
              </div>
            </div>
            <div v-if="!forwardTopicsLoading && forwardTopicRows.length === 0" class="fwEmpty">
              {{ t('chat.forward_no_topics', undefined, 'This group has no topics yet') }}
            </div>
          </template>
          <template v-else>
            <div
              v-for="chat in forwardTargets"
              :key="chat.id"
              class="fwItem"
              :class="{ locked: !canForwardInto(chat) }"
              role="button"
              tabindex="0"
              :aria-disabled="!canForwardInto(chat)"
              :title="canForwardInto(chat) ? undefined : t('chat.forward_admins_only', undefined, 'Only admins can post here')"
              @click="toggleForwardTarget(chat)"
              @keydown.enter.prevent="toggleForwardTarget(chat)"
              @keydown.space.prevent="toggleForwardTarget(chat)"
            >
              <img v-if="normalizeAvatarSrc(chat.avatar_data_url || '')" class="fwAvatar" :src="normalizeAvatarSrc(chat.avatar_data_url || '')" alt="" />
              <div v-else class="fwAvatar fwAvatarFallback" :style="{ background: avatarColorFor(String(chat.id || '').trim()) }">
                {{ (chat.title || '?').slice(0, 1).toUpperCase() }}
              </div>
              <div class="fwMain">
                <div class="fwName">{{ chat.title }}</div>
                <div class="fwMeta">{{ forwardChatMeta(chat) }}</div>
              </div>
              <div class="fwPick">
                <button
                  v-if="isForwardGroup(chat)"
                  type="button"
                  class="fwDrill"
                  :title="t('chat.forward_choose_topic', undefined, 'Choose a topic')"
                  :aria-label="t('chat.forward_choose_topic', undefined, 'Choose a topic')"
                  @click.stop="openForwardTopics(chat)"
                >
                  <v-icon icon="mdi-chevron-right" size="18" />
                </button>
                <v-icon v-if="!canForwardInto(chat)" icon="mdi-lock-outline" size="18" />
                <v-icon v-else :icon="isForwardChatSelected(chat) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" size="18" />
              </div>
            </div>
            <div v-if="forwardTargets.length === 0" class="fwEmpty">{{ t('chat.no_results', undefined, 'No results') }}</div>
          </template>
        </div>
        <div class="fwActions">
          <button type="button" class="fwActionBtn muted" @click="closeForwardPicker">{{ t('common.cancel', undefined, 'Cancel') }}</button>
          <button type="button" class="fwActionBtn" :disabled="forwardPickerSelected.size === 0" @click="confirmForwardTargets">
            {{ t('chat.forward', undefined, 'Forward') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <IncomingCallModal
    v-if="incomingCall"
    :title="incomingTitle"
    :avatar-text="incomingAvatarText"
    :avatar-src="incomingAvatarSrc"
    :kind="incomingCall.kind"
    @accept="onIncomingAccept"
    @decline="dismissIncoming"
  />

  <CallOverlay
    v-if="callOverlayVisible"
    :title="callTitle"
    :avatar-text="callAvatarText"
    :avatar-src="callAvatarSrc"
    :members="callDirectory"
    @hangup="onCallHangup"
  />

  <CallMiniBar
    v-if="callMinimized && callStatus !== 'idle' && callStatus !== 'ended'"
    :title="callTitle"
    :avatar-text="callAvatarText"
    :avatar-src="callAvatarSrc"
  />

  <!-- A channel live stream is optional watching: a non-blocking notice, never
       a ringing prompt. -->
  <div v-if="liveNotice" class="liveNotice" role="status">
    <span class="liveNoticeDot" />
    <div class="liveNoticeMeta">
      <span class="liveNoticeBadge">{{ t('call.live_stream', undefined, 'Live stream') }}</span>
      <span class="liveNoticeTitle">{{ liveNoticeTitle }}</span>
    </div>
    <button type="button" class="liveNoticeBtn primary" @click="watchLiveStream()">
      {{ t('call.watch', undefined, 'Watch') }}
    </button>
    <button type="button" class="liveNoticeBtn" @click="dismissLiveNotice()">
      {{ t('call.dismiss', undefined, 'Dismiss') }}
    </button>
  </div>
</template>

<style scoped>
.fwOverlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--scrim-soft);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 12px;
}

.fwDialog {
  width: min(520px, 100%);
  max-height: min(72vh, 720px);
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid var(--border);
  background: var(--surface);
  box-shadow: 0 20px 80px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
}

.fwHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border);
}

.fwTitle {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.fwClose {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.fwClose:hover {
  background: var(--surface-soft);
}

.fwSearch {
  margin: 10px 12px;
  height: 38px;
  border-radius: 999px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.fwSearchIcon {
  color: var(--text-muted);
}

.fwSearchInput {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 14px;
}

.fwList {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

.fwPick {
  margin-left: auto;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.fwActions {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.fwActionBtn {
  height: 36px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text);
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
}

.fwActionBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fwActionBtn.muted {
  background: transparent;
  color: var(--text-muted);
}

.fwItem {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 10px 10px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  text-align: left;
}

.fwItem:hover {
  background: var(--surface-soft);
}

.fwAvatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 auto;
}

.fwAvatarFallback {
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
}

.fwMain {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fwName {
  color: var(--text);
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fwMeta {
  color: var(--text-muted);
  font-size: 12px;
}

.fwEmpty {
  padding: 14px 10px;
  color: var(--text-muted);
  font-size: 14px;
}

.fwBack {
  flex: 0 0 auto;
}

.fwTopicItem .fwName {
  font-weight: 700;
}

.fwHashBadge {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  color: #fff;
  font-weight: 800;
  font-size: 16px;
}

.fwDrill {
  width: 30px;
  height: 30px;
  margin-right: 6px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.fwDrill:hover {
  background: var(--surface-soft);
  color: var(--text);
}
</style>

<style scoped>
.workspace {
  display: grid;
  --info-dock-width: 0px;
  grid-template-columns: 320px minmax(0, 1fr) var(--info-dock-width);
  transition: grid-template-columns 220ms ease;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.workspace.info-open {
  --info-dock-width: min(370px, 40vw);
}

.wsSidebar {
  min-height: 0;
}

.workspace > * {
  min-width: 0;
}

.conversation {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--chat-wallpaper, linear-gradient(180deg, rgba(247, 249, 252, 0.7), rgba(238, 242, 247, 0.82)));
  overflow: hidden;
  position: relative;
}

.conversation > .chatPlayer {
  grid-row: 2;
}

.convBody {
  grid-row: 3;
  min-height: 0;
  height: 100%;
}

.convBodyVoice {
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.convSlide-enter-active,
.convSlide-leave-active,
.convSlideBack-enter-active,
.convSlideBack-leave-active {
  transition: opacity 140ms ease, transform 220ms ease;
  will-change: transform, opacity;
}

.convSlide-enter-from,
.convSlideBack-enter-from {
  opacity: 0;
}

.convSlide-enter-from {
  transform: translate3d(10px, 0, 0);
}

.convSlide-leave-to {
  opacity: 0;
  transform: translate3d(-10px, 0, 0);
}

.convSlideBack-enter-from {
  transform: translate3d(-10px, 0, 0);
}

.convSlideBack-leave-to {
  opacity: 0;
  transform: translate3d(10px, 0, 0);
}

/* ── Delete confirmation ── */
.wsDangerOverlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: 16px;
}
.wsDangerDialog {
  width: min(520px, 96vw);
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow-soft);
  padding: 16px;
}
.wsDangerTitle { font-weight: 800; font-size: 18px; color: var(--text); }
.wsDangerText { margin-top: 8px; color: var(--text-soft); font-size: 14px; line-height: 1.35; }
.wsDangerHint { color: var(--text-muted); font-size: 13px; }
.wsDangerCheck {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}
.wsDangerCheck input { accent-color: var(--accent); width: 16px; height: 16px; }
.wsDangerError { margin-top: 10px; color: #ff6b6b; font-size: 13px; }
.wsDangerActions { margin-top: 14px; display: flex; gap: 10px; justify-content: flex-end; }
.wsDangerBtn {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 14px;
  font-weight: 700;
  cursor: pointer;
}
.wsDangerBtn.primary { background: var(--accent-soft); color: var(--accent-strong); }
.wsDangerBtn.danger { background: rgba(255, 107, 107, 0.16); border-color: rgba(255, 107, 107, 0.35); color: #ff6b6b; }
.wsDangerBtn:disabled { opacity: 0.6; cursor: not-allowed; }


@media (prefers-reduced-motion: reduce) {
  .convSlide-enter-active,
  .convSlide-leave-active,
  .convSlideBack-enter-active,
  .convSlideBack-leave-active {
    transition: none;
  }
}

.composerInline,
.viewerActionBar {
  grid-row: 4;
}

.composerLockHint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px 0;
  color: var(--text-muted);
  font-size: 12.5px;
  text-align: center;
}

.composerInline {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: stretch;
  z-index: 10;
  min-height: 0;
  pointer-events: none;
  background: var(--msg-bar-glass);
  border-top: 1px solid var(--border);
}

.composerInline > * {
  pointer-events: auto;
}

.viewerActionBar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  z-index: 10;
  padding: 6px 16px 12px;
  min-height: 0;
  background: var(--msg-bar-glass);
  border-top: 1px solid var(--border);
}

.viewerPrimaryBtn {
  min-width: min(560px, calc(100vw - 180px));
  height: 52px;
  padding: 0 24px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
}

.viewerIconBtn {
  width: 52px;
  height: 52px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.viewerPrimaryBtn:hover,
.viewerIconBtn:hover {
  background: var(--surface);
}

.infoDock {
  width: 100%;
  overflow: hidden;
  background: var(--surface);
  border-left: 0;
}

/* ── Drag & drop dropzone ── */
.wsDropzone {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  /* No dimming layer over the wallpaper: only the dashed card signals the drop. */
  background: transparent;
  pointer-events: none;
}

.wsDropzoneInner {
  display: grid;
  place-items: center;
  gap: 6px;
  padding: 28px 44px;
  border: 2px dashed var(--accent);
  border-radius: 20px;
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.wsDropzoneIcon {
  color: var(--accent);
}

.wsDropzoneTitle {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}

.wsDropzoneHint {
  font-size: 13px;
  color: var(--text-soft);
}

.dropzoneFade-enter-active,
.dropzoneFade-leave-active {
  transition: opacity 100ms linear;
}

.dropzoneFade-enter-from,
.dropzoneFade-leave-to {
  opacity: 0;
}

.infoDock.open {
  border-left: 1px solid var(--border);
}

/* ── Non-blocking live stream notice ── */
.liveNotice {
  position: fixed;
  /* Below the sticky conversation header, clear of the minimized call bar. */
  top: 74px;
  right: 16px;
  z-index: 86;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(360px, calc(100vw - 32px));
  padding: 8px 10px;
  border-radius: 999px;
  background: rgba(12, 15, 22, 0.94);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}

.liveNoticeDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e0465a;
  flex: 0 0 auto;
}

.liveNoticeMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.liveNoticeBadge {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted, #8b93a7);
}

.liveNoticeTitle {
  font-size: 13px;
  font-weight: 800;
  color: var(--text, #e8ecf5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.liveNoticeBtn {
  border: 0;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  background: var(--surface-soft, rgba(255, 255, 255, 0.08));
  color: var(--text, #e8ecf5);
}

.liveNoticeBtn.primary {
  background: #3a86ff;
  color: #fff;
}

@media (max-width: 1024px) {
  .workspace {
    grid-template-columns: 320px minmax(0, 1fr);
  }
  .infoDock {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100%);
    transform: translateX(100%);
    opacity: 0;
    pointer-events: none;
    transition: transform 220ms ease, opacity 140ms ease;
    z-index: 6;
    border-left: 1px solid var(--border);
  }
  .workspace.info-open .infoDock {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }
}

@media (max-width: 720px) {
  .workspace {
    grid-template-columns: 1fr;
    position: relative;
  }

  .wsSidebar,
  .conversation {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transition: transform 220ms ease, opacity 140ms ease;
    will-change: transform, opacity;
  }

  .wsSidebar {
    transform: translateX(0);
    opacity: 1;
    z-index: 2;
  }

  .workspace.conv-open .wsSidebar {
    transform: translateX(-8%);
    opacity: 0;
    pointer-events: none;
  }

  .conversation {
    transform: translateX(100%);
    opacity: 0;
    z-index: 3;
    pointer-events: none;
  }

  .workspace.conv-open .conversation {
    transform: translateX(0);
    opacity: 1;
    pointer-events: auto;
  }

  .infoDock {
    inset: 0;
    width: 100%;
    border-left: 0;
    transform: translateX(100%);
  }

  .workspace.info-open .infoDock {
    transform: translateX(0);
  }
}

.fwItem.locked { opacity: 0.55; cursor: not-allowed; }
.fwItem.locked:hover { background: transparent; }
.fwItem.locked .fwName { color: var(--text-muted); }
.fwPick { display: flex; align-items: center; gap: 2px; color: var(--text-muted); }
</style>
