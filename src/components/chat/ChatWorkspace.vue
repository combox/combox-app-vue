<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { deleteChannel, deleteChat, encodeAttachmentToken, forwardMessage, getAttachment, getUserByID, leaveChat, parseMessageContent, postStandaloneChannelThreadComment, listStandaloneChannelThreadComments, sendMessage, setChatMuted, unsubscribeChannel, type ChatItem, type MessageItem } from 'combox-api'
import ChatComposer from './ChatComposer.vue'
import ChatConversationHeader from './ChatConversationHeader.vue'
import ChatInfoPanel from './ChatInfoPanel.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatSidebar from './ChatSidebar.vue'
import ChatWorkspaceOverlays from './ChatWorkspaceOverlays.vue'
import { normalizeAvatarSrc, toViewMessage } from './chatUtils'
import { hydrateAttachmentURLs } from './chatWorkspace.attachments'
import { useChatWorkspace } from './useChatWorkspace.runtime'
import { mediaPipelineClient } from '../../lib/mediaPipeline/client'
import { enqueueOutbox, isOfflineError } from '../../lib/offline/outbox'

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
} = useChatWorkspace()

const isMediaOverlayOpen = computed(() => Boolean(photoViewerSrc.value) || Boolean(videoViewer.value))
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

function closeForwardPicker() {
  forwardPickerOpen.value = false
  forwardPickerQuery.value = ''
  forwardPickerSelected.value = new Set()
}

function clearForward() {
  forwardMessages.value = []
  forwardTargetChatIDs.value = []
}

function openForwardPicker() {
  if (!contextMenu.value?.message) return
  forwardMessages.value = [contextMenu.value.message]
  contextMenu.value = null
  forwardPickerOpen.value = true
  forwardPickerQuery.value = ''
  forwardPickerSelected.value = new Set()
}

function openForwardPickerForMessages(list: Array<(typeof messages.value)[number]>) {
  forwardMessages.value = list.slice()
  forwardPickerOpen.value = true
  forwardPickerQuery.value = ''
  forwardPickerSelected.value = new Set()
}

const forwardTargets = computed(() => {
  const q = forwardPickerQuery.value.trim().toLowerCase()
  const base = filteredChats.value
    .filter((chat) => {
      const kind = String(chat.kind || '').trim()
      if (kind === 'group') return false
      return Boolean((chat.id || '').trim())
    })
    .slice()
  if (!q) return base
  return base.filter((chat) => {
    const title = String(chat.title || '').toLowerCase()
    const slug = String((chat as unknown as Record<string, unknown>).public_slug || '').toLowerCase()
    return title.includes(q) || (slug && slug.includes(q))
  })
})

function toggleForwardTarget(chat: ChatItem) {
  const id = String(chat.id || '').trim()
  if (!id) return
  const next = new Set(forwardPickerSelected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  forwardPickerSelected.value = next
}

async function confirmForwardTargets() {
  const selected = Array.from(forwardPickerSelected.value)
    .map((id) => id.trim())
    .filter(Boolean)
  if (selected.length === 0) return

  forwardTargetChatIDs.value = selected
  closeForwardPicker()

  const first = selected[0]
  const chat = chats.value.find((c) => (c.id || '').trim() === first)
  const kind = String(chat?.kind || '').trim()
  if (kind === 'channel' && String(chat?.parent_chat_id || '').trim()) {
    const groupID = String(chat?.parent_chat_id || '').trim()
    await selectChat(groupID)
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
const currentUserAvatarSrc = computed(() => normalizeAvatarSrc(currentUser?.avatar_data_url || localProfile?.avatarDataUrl || ''))
const currentUserDisplayName = computed(
  () => `${(currentUser?.first_name || localProfile?.firstName || '').trim()} ${(currentUser?.last_name || localProfile?.lastName || '').trim()}`.trim() || currentUser?.username || '',
)
const extraAvatarByUserId = ref<Record<string, string>>({})
const extraSenderNameByUserId = ref<Record<string, string>>({})

const avatarByUserId = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  const peerId = (peerProfile.value?.id || '').trim() || (selectedChat.value?.peer_user_id || '').trim()
  const peerAvatar = normalizeAvatarSrc(peerProfile.value?.avatar_data_url || selectedChat.value?.avatar_data_url || '')
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

watch(selectedChatID, () => {
  discussionRootMessage.value = null
  discussionThreadChatID.value = ''
  discussionCommentsRaw.value = []
  realtimeExtraChatIDs.value = []
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
        return {
          id: up.attachment.id,
          token: encodeAttachmentToken({ id: up.attachment.id, filename: up.attachment.filename, mimeType: up.attachment.mime_type, kind: up.attachment.kind }),
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

const canSendInSelectedChat = computed(() => {
  const active = conversationChat.value
  if (!active) return false
  const kind = (active.kind || '').trim()
if (kind !== 'standalone_channel') return true
  if (inDiscussionMode.value) return Boolean(active.comments_enabled ?? true)
  return canModerateSelectedChannel.value
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

const canDeleteContextMessage = computed(() => canEditContextMessage.value)

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
const deleteCancelBtn = ref<HTMLButtonElement | null>(null)

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
      await deleteChat(chatID)
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

onMounted(() => {
  syncViewportLayout()
  window.addEventListener('resize', syncViewportLayout)
  window.addEventListener('keydown', onGlobalEscape, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewportLayout)
  window.removeEventListener('keydown', onGlobalEscape, { capture: true })
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
        :unread-group="unreadCounts.group"
        :unread-by-chat-id="unreadByChatId"
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
            setChatFilter(value === 0 ? 'all' : value === 1 ? 'direct' : 'group')
          }
        "
        @select="selectChat"
        @select-directory-chat="selectDirectoryChat"
        @select-directory-user="(user) => openDirectChatWithUser(user.id)"
        @open-settings="openSidebarSettings"
        @close-settings="closeSidebarSettings"
        @create-group="handleCreateGroup"
        @create-channel="handleCreateChannel"
        @chat-context-mute="handleChatContextMute"
        @chat-context-leave="handleChatContextLeave"
        @chat-context-delete="handleChatContextDelete"
        @close-group-channels="handleCloseGroupChannels"
        @select-group-channel="handleSelectGroupChannel"
        @create-group-channel="
          (input: { title: string; channel_type: 'text' | 'voice' }) =>
            handleCreateChannel({ title: input.title, channel_type: input.channel_type, onSuccess: () => undefined, onError: () => undefined })
        "
      />
    </aside>

    <section class="conversation">
      <ChatConversationHeader
        v-if="hasActiveChat"
        :title="conversationTitle"
        :subtitle="conversationSubtitle"
        :avatar-text="(selectedChat?.title || 'C').slice(0, 1).toUpperCase()"
        :avatar-src="normalizeAvatarSrc(peerProfile?.avatar_data_url || selectedChat?.avatar_data_url || '')"
        :search-open="messageSearchOpen"
        :search-value="messageSearch"
        :show-back="inDiscussionMode || mobileConversationOpen"
        @open-info="openInfo"
        @open-search="openMessageSearch"
        @close-search="closeMessageSearch"
        @update-search="messageSearch = $event"
        @open-menu="openChatMenu"
        @back="handleConversationBack"
      />

      <transition :name="conversationTransitionName" mode="out-in">
        <div :key="activeMessagesChatID" class="convBody">
          <ChatMessageList
            :loading="loadingMessages || discussionLoading"
            :messages="renderedMessages"
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
            @open-context-reaction-picker="openContextReactionPicker"
            @close-context-reaction-picker="closeContextReactionPicker"
            @select-reaction-from-picker="selectReactionFromPicker"
            @copy-context-message="copyContextMessage"
            @reply-context-message="replyFromContextMenu"
            @forward-context-message="openForwardPicker"
            @forward-selected-messages="openForwardPickerForMessages($event as any)"
            @edit-context-message="editFromContextMenu"
            @delete-context-message="deleteContextMessage"
            @near-bottom="isNearBottom = $event"
          />
        </div>
      </transition>

      <div v-if="hasActiveChat && !showChannelViewerBar" class="composerInline">
        <ChatComposer
          :chat-key="selectedChatID"
          :sending="sending"
          :disabled="!selectedChatID || !canSendInSelectedChat"
          :pending-files="pendingFiles"
          :reply-to-message="composerReplyTarget"
          :editing-message="editingMessage"
          :forward-messages="forwardMessages"
          :suppress-reply-preview="inDiscussionMode"
          @pick-files="setPendingFiles"
          @remove-pending-file="removePendingFile"
          @send="sendDraftSmart"
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
      />
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
        @leave-chat="handleLeaveChat"
        @add-members="handleAddMembers"
        @update-member-role="handleUpdateMemberRole"
        @remove-member="handleRemoveMember"
        @subscribe-channel="subscribeSelectedChannel"
        @unsubscribe-channel="unsubscribeSelectedChannel"
        @create-invite-link="createSelectedChatInviteLink"
        @open-direct-chat="openDirectChatWithUser"
        @toggle-mute-chat="toggleMuteSelectedChat"
        @open-image="openPhotoViewer"
        @open-video="openVideoViewer"
      />
    </aside>

    <div v-if="deleteConfirm.open" class="wsDangerOverlay" @click.self="closeDeleteConfirm">
      <div class="wsDangerDialog" role="dialog" aria-modal="true" :aria-label="deleteDialogTitle(deleteConfirm.chat)">
        <div class="wsDangerTitle">{{ deleteDialogTitle(deleteConfirm.chat) }}</div>
        <div class="wsDangerText">
          {{ t('chat.delete_confirm', undefined, 'This action cannot be undone. Click Delete again to confirm.') }}
        </div>
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
          <div class="fwTitle">{{ t('chat.forward', undefined, 'Forward') }}</div>
          <button type="button" class="fwClose" :aria-label="t('common.close', undefined, 'Close')" @click="closeForwardPicker">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
        <div class="fwSearch">
          <v-icon icon="mdi-magnify" size="18" class="fwSearchIcon" />
          <input v-model="forwardPickerQuery" class="fwSearchInput" :placeholder="t('chat.search', undefined, 'Search')" />
        </div>
        <div class="fwList">
          <button v-for="chat in forwardTargets" :key="chat.id" type="button" class="fwItem" @click="toggleForwardTarget(chat)">
            <img v-if="normalizeAvatarSrc(chat.avatar_data_url || '')" class="fwAvatar" :src="normalizeAvatarSrc(chat.avatar_data_url || '')" alt="" />
            <div v-else class="fwAvatar fwAvatarFallback">{{ (chat.title || '?').slice(0, 1).toUpperCase() }}</div>
            <div class="fwMain">
              <div class="fwName">{{ chat.title }}</div>
              <div class="fwMeta">{{ (chat.kind || '').trim() || 'chat' }}</div>
            </div>
            <div class="fwPick">
              <v-icon :icon="forwardPickerSelected.has(String(chat.id || '').trim()) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" size="18" />
            </div>
          </button>
          <div v-if="forwardTargets.length === 0" class="fwEmpty">{{ t('chat.no_results', undefined, 'No results') }}</div>
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
</template>

<style scoped>
.fwOverlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.28);
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
  display: grid;
  place-items: center;
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
  background: var(--avatar-fallback);
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
</style>

<style scoped>
.workspace {
  display: grid;
  --info-dock-width: 0px;
  grid-template-columns: 420px minmax(0, 1fr) var(--info-dock-width);
  transition: grid-template-columns 220ms ease;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.workspace.info-open {
  --info-dock-width: 370px;
}

.wsSidebar {
  min-height: 0;
}

.workspace > * {
  min-width: 0;
}

.conversation {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--chat-wallpaper, linear-gradient(180deg, rgba(247, 249, 252, 0.7), rgba(238, 242, 247, 0.82)));
  overflow: hidden;
  position: relative;
}

.convBody {
  min-height: 0;
  height: 100%;
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
  background: rgba(0, 0, 0, 0.45);
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

.composerInline {
  display: flex;
  justify-content: center;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  pointer-events: none;
}

.composerInline > * {
  pointer-events: auto;
}

.viewerActionBar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  padding: 0 16px 12px;
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

.infoDock.open {
  border-left: 1px solid var(--border);
}

@media (max-width: 1024px) {
  .workspace {
    grid-template-columns: 360px minmax(0, 1fr);
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
</style>
