<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import ChatComposer from './ChatComposer.vue'
import ChatConversationHeader from './ChatConversationHeader.vue'
import ChatInfoPanel from './ChatInfoPanel.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatSidebar from './ChatSidebar.vue'
import ChatWorkspaceOverlays from './ChatWorkspaceOverlays.vue'
import { normalizeAvatarSrc } from './chatUtils'
import { useChatWorkspace } from './useChatWorkspace.runtime'

const { t } = useI18n()

const {
  currentUser,
  localProfile,
  selectedChatID,
  selectedChat,
  hasActiveChat,
  chats,
  filteredChats,
  messages,
  filteredMessages,
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
  createPublicChannelChat,
  createSelectedChatInviteLink,
  updateSelectedGroupProfile,
  leaveSelectedChat,
  canCreateChannel,
  addMembersToSelectedGroup,
  updateSelectedGroupMemberRole,
  removeSelectedGroupMember,
  toggleMuteSelectedChat,
  subscribeSelectedPublicChannel,
  unsubscribeSelectedPublicChannel,
  sendDraft,
} = useChatWorkspace()

const isMediaOverlayOpen = computed(() => Boolean(photoViewerSrc.value) || Boolean(videoViewer.value))
const discussionRootMessage = ref<(typeof messages.value)[number] | null>(null)
const inDiscussionMode = computed(() => Boolean(discussionRootMessage.value && selectedChat.value?.kind === 'public_channel'))
const composerReplyTarget = computed(() => (inDiscussionMode.value ? discussionRootMessage.value : replyToMessage.value))
const renderedMessages = computed(() => {
  if (!inDiscussionMode.value || !discussionRootMessage.value) return filteredMessages.value
  const root = discussionRootMessage.value
  const rootID = (root.raw.id || '').trim()
  if (!rootID) return filteredMessages.value
  const comments = messages.value.filter((message) => (message.raw.reply_to_message_id || '').trim() === rootID)
  return [root, ...comments]
})
const currentUserAvatarSrc = computed(() => normalizeAvatarSrc(currentUser?.avatar_data_url || localProfile?.avatarDataUrl || ''))
const currentUserDisplayName = computed(
  () => `${(currentUser?.first_name || localProfile?.firstName || '').trim()} ${(currentUser?.last_name || localProfile?.lastName || '').trim()}`.trim() || currentUser?.username || '',
)
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
  if (!selectedChat.value) return 'Group'
  if ((selectedChat.value.kind || '').trim() === 'group') return selectedChat.value.title
  const parentID = (selectedChat.value.parent_chat_id || '').trim()
  return parentID ? (chats.value.find((chat) => chat.id === parentID)?.title || selectedChat.value.title) : selectedChat.value.title
})

const conversationTitle = computed(() => {
  if (inDiscussionMode.value) return 'Discussion'
  const active = selectedChat.value
  if (!active) return 'Chat'
  const kind = (active.kind || '').trim()
  if (kind === 'channel') return `# ${active.title || 'Channel'}`
  if (kind === 'group') return '# General'
  return active.title || 'Chat'
})

const conversationSubtitle = computed(() => {
  if (!inDiscussionMode.value || !discussionRootMessage.value) return chatSubtitle.value
  const count = Math.max(0, renderedMessages.value.length - 1)
  return `${count} ${count === 1 ? 'comments' : 'comments'}`
})

watch(selectedChatID, () => {
  discussionRootMessage.value = null
})

function openDiscussion(message: (typeof messages.value)[number]) {
  discussionRootMessage.value = message
  beginReplyToMessage(message)
}

function closeDiscussion() {
  discussionRootMessage.value = null
  clearReplyToMessage()
}

const canModerateSelectedPublicChannel = computed(() => {
  const active = selectedChat.value
  if (!active || (active.kind || '').trim() !== 'public_channel') return false
  const role = (active.viewer_role || '').trim().toLowerCase()
  return role === 'owner' || role === 'admin'
})

const canSendInSelectedChat = computed(() => {
  const active = selectedChat.value
  if (!active) return false
  if ((active.kind || '').trim() !== 'public_channel') return true
  return canModerateSelectedPublicChannel.value
})

const canReactInSelectedChat = computed(() => {
  const active = selectedChat.value
  if (!active) return false
  if ((active.kind || '').trim() !== 'public_channel') return true
  const role = (active.viewer_role || '').trim().toLowerCase()
  return role === 'owner' || role === 'admin' || role === 'subscriber'
})

const showPublicChannelViewerBar = computed(() => {
  const active = selectedChat.value
  if (!active || !hasActiveChat.value || inDiscussionMode.value) return false
  return (active.kind || '').trim() === 'public_channel' && !canSendInSelectedChat.value
})

const canEditContextMessage = computed(() => {
  const target = contextMenu.value?.message
  if (!target) return false
  if ((target.raw.user_id || '').trim() === (currentUser?.id || '').trim()) return true
  return canModerateSelectedPublicChannel.value
})

const canDeleteContextMessage = computed(() => canEditContextMessage.value)

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
      await createPublicChannelChat(input.title, input.publicSlug || '', input.isPublic)
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
    return
  }
  if (contextMenu.value) {
    closeContextMenu()
    return
  }
  if (chatMenuAnchor.value) {
    closeChatMenu()
    return
  }
  if (photoViewerSrc.value) {
    closePhotoViewer()
    return
  }
  if (videoViewer.value) {
    closeVideoViewer()
    return
  }
  if (infoOpen.value) {
    closeInfo()
    return
  }
  if (messageSearchOpen.value) {
    closeMessageSearch()
    return
  }
  if (hasActiveChat.value) {
    selectChat('')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalEscape)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalEscape)
})
</script>

<template>
  <div class="workspace">
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
      @close-group-channels="closeGroupChannelsPanel"
      @select-group-channel="selectGroupChannel"
      @create-group-channel="
        (input: { title: string; channel_type: 'text' | 'voice' }) =>
          handleCreateChannel({ title: input.title, channel_type: input.channel_type, onSuccess: () => undefined, onError: () => undefined })
      "
    />

    <section class="conversation">
      <ChatConversationHeader
        v-if="hasActiveChat"
        :title="conversationTitle"
        :subtitle="conversationSubtitle"
        :avatar-text="(selectedChat?.title || 'C').slice(0, 1).toUpperCase()"
        :avatar-src="normalizeAvatarSrc(peerProfile?.avatar_data_url || selectedChat?.avatar_data_url || '')"
        :search-open="messageSearchOpen"
        :search-value="messageSearch"
        :show-back="inDiscussionMode"
        @open-info="openInfo"
        @open-search="openMessageSearch"
        @close-search="closeMessageSearch"
        @update-search="messageSearch = $event"
        @open-menu="openChatMenu"
        @back="closeDiscussion"
      />

      <transition name="convFade">
        <div :key="selectedChatID" class="convBody">
          <ChatMessageList
            :loading="loadingMessages"
            :messages="renderedMessages"
            :selected-chat-i-d="selectedChatID"
            :discussion-mode="inDiscussionMode"
            :is-public-channel="Boolean(selectedChat && selectedChat.kind === 'public_channel' && !inDiscussionMode)"
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
            :show-sender-meta="Boolean(selectedChat && !selectedChat.is_direct)"
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
            @edit-context-message="editFromContextMenu"
            @delete-context-message="deleteContextMessage"
            @near-bottom="isNearBottom = $event"
          />
        </div>
      </transition>

      <div v-if="hasActiveChat && !showPublicChannelViewerBar" class="composerInline">
        <ChatComposer
          :chat-key="selectedChatID"
          :sending="sending"
          :disabled="!selectedChatID || !canSendInSelectedChat"
          :pending-files="pendingFiles"
          :reply-to-message="composerReplyTarget"
          :editing-message="editingMessage"
          :suppress-reply-preview="inDiscussionMode"
          @pick-files="setPendingFiles"
          @remove-pending-file="removePendingFile"
          @send="sendDraft"
          @clear-reply="clearReplyToMessage"
          @clear-edit="editFromContextMenu(null)"
        />
      </div>

      <div v-else-if="showPublicChannelViewerBar" class="viewerActionBar">
        <button type="button" class="viewerIconBtn" :aria-label="t(Boolean(selectedChatID && mutedChatIDs[selectedChatID]) ? 'chat.unmute' : 'chat.mute')" @click="toggleMuteSelectedChat">
          <v-icon :icon="Boolean(selectedChatID && mutedChatIDs[selectedChatID]) ? 'mdi-bell-ring-outline' : 'mdi-bell-off-outline'" size="20" />
        </button>
        <button
          type="button"
          class="viewerPrimaryBtn"
          @click="((selectedChat?.viewer_role || '').trim().toLowerCase() === 'subscriber' ? unsubscribeSelectedPublicChannel() : subscribeSelectedPublicChannel())"
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
        :is-selected-chat-muted="Boolean(selectedChatID && mutedChatIDs[selectedChatID])"
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
        @subscribe-public-channel="subscribeSelectedPublicChannel"
        @unsubscribe-public-channel="unsubscribeSelectedPublicChannel"
        @create-invite-link="createSelectedChatInviteLink"
        @open-direct-chat="openDirectChatWithUser"
        @toggle-mute-chat="toggleMuteSelectedChat"
        @open-image="openPhotoViewer"
        @open-video="openVideoViewer"
      />
    </aside>
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: 420px minmax(0, 1fr) auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
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
  background: linear-gradient(180deg, rgba(247, 249, 252, 0.7), rgba(238, 242, 247, 0.82));
  overflow: hidden;
  position: relative;
}

.convBody {
  min-height: 0;
  height: 100%;
}

.convFade-enter-active,
.convFade-leave-active {
  transition: opacity 140ms ease;
}

.convFade-enter-from,
.convFade-leave-to {
  opacity: 0;
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
  background: rgba(255, 255, 255, 0.96);
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
  background: rgba(255, 255, 255, 0.96);
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
  width: 0;
  overflow: hidden;
  background: var(--surface);
  border-left: 1px solid var(--border);
  transition: width 220ms ease;
}

.infoDock.open {
  width: 370px;
}

@media (max-width: 960px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
