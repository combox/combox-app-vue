<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import ChatComposer from './ChatComposer.vue'
import ChatConversationHeader from './ChatConversationHeader.vue'
import ChatInfoPanel from './ChatInfoPanel.vue'
import ChatMessageList from './ChatMessageList.vue'
import ChatSidebar from './ChatSidebar.vue'
import ChatWorkspaceOverlays from './ChatWorkspaceOverlays.vue'
import { normalizeAvatarSrc } from './chatUtils'
import { useChatWorkspace } from './useChatWorkspace.runtime'

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
  directPeerId,
  infoSubtitle,
  chatSubtitle,
  showGroupChannelsPanel,
  selectedGroupChannelID,
  visibleGroupChannels,
  loadingGroupChannels,
  setChatFilter,
  selectChat,
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
  clearReplyToMessage,
  deleteContextMessage,
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
  updateSelectedGroupProfile,
  leaveSelectedChat,
  canCreateChannel,
  addMembersToSelectedGroup,
  updateSelectedGroupMemberRole,
  removeSelectedGroupMember,
  toggleMuteSelectedChat,
  sendDraft,
} = useChatWorkspace()

const isMediaOverlayOpen = computed(() => Boolean(photoViewerSrc.value) || Boolean(videoViewer.value))
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
  const active = selectedChat.value
  if (!active) return 'Chat'
  const kind = (active.kind || '').trim()
  if (kind === 'channel') return `# ${active.title || 'Channel'}`
  if (kind === 'group') return '# General'
  return active.title || 'Chat'
})

async function handleCreateGroup(input: { title: string; memberIDs: string[]; onSuccess: () => void; onError: (message: string) => void }) {
  try {
    await createGroupChat(input.title, input.memberIDs)
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : 'Unable to create group')
  }
}

async function handleCreateChannel(input: {
  title: string
  channel_type?: 'text' | 'voice'
  memberIDs?: string[]
  onSuccess: () => void
  onError: (message: string) => void
}) {
  try {
    await createChannelForSelectedGroup(input.title, input.channel_type)
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : 'Unable to create channel')
  }
}

async function handleAddMembers(memberIDs: string[]) {
  try {
    await addMembersToSelectedGroup(memberIDs)
  } catch {
    // error text is already set in the workspace store
  }
}

async function handleSaveGroupProfile(input: { title: string; avatarDataUrl?: string | null; onSuccess: () => void; onError: (message: string) => void }) {
  try {
    await updateSelectedGroupProfile({ title: input.title, avatarDataUrl: input.avatarDataUrl })
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : 'Unable to save group')
  }
}

async function handleLeaveChat(input: { onSuccess: () => void; onError: (message: string) => void }) {
  try {
    await leaveSelectedChat()
    input.onSuccess()
  } catch (error) {
    input.onError(error instanceof Error ? error.message : 'Unable to leave chat')
  }
}

async function handleUpdateMemberRole(input: { userID: string; role: 'member' | 'moderator' | 'admin' }) {
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
        :subtitle="chatSubtitle"
        :avatar-text="(selectedChat?.title || 'C').slice(0, 1).toUpperCase()"
        :avatar-src="normalizeAvatarSrc(peerProfile?.avatar_data_url || selectedChat?.avatar_data_url || '')"
        :search-open="messageSearchOpen"
        :search-value="messageSearch"
        @open-info="openInfo"
        @open-search="openMessageSearch"
        @close-search="closeMessageSearch"
        @update-search="messageSearch = $event"
        @open-menu="openChatMenu"
      />

      <transition name="convFade" mode="out-in">
        <div :key="selectedChatID" class="convBody">
          <ChatMessageList
            :loading="loadingMessages"
            :messages="filteredMessages"
            :selected-chat-i-d="selectedChatID"
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
            @open-image="openPhotoViewer"
            @open-video="openVideoViewer"
            @open-user-info="openInfoForUser"
            @react="({ messageID, emoji }) => reactToMessage(messageID, emoji)"
            @mark-read="({ chatID, messageIDs }) => markMessagesRead(chatID, messageIDs)"
            @open-context-menu="openContextMenu"
            @close-context-menu="closeContextMenu"
            @open-context-reaction-picker="openContextReactionPicker"
            @close-context-reaction-picker="closeContextReactionPicker"
            @select-reaction-from-picker="selectReactionFromPicker"
            @copy-context-message="copyContextMessage"
            @reply-context-message="replyFromContextMenu"
            @delete-context-message="deleteContextMessage"
            @near-bottom="isNearBottom = $event"
          />
        </div>
      </transition>

      <div v-if="hasActiveChat" class="composerInline">
        <ChatComposer
          :chat-key="selectedChatID"
          :sending="sending"
          :disabled="!selectedChatID"
          :pending-files="pendingFiles"
          :reply-to-message="replyToMessage"
          @pick-files="setPendingFiles"
          @remove-pending-file="removePendingFile"
          @send="sendDraft"
          @clear-reply="clearReplyToMessage"
        />
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
        :messages="messages"
        :direct-peer-id="directPeerId"
        @close="closeInfo"
        @save-group-profile="handleSaveGroupProfile"
        @leave-chat="handleLeaveChat"
        @add-members="handleAddMembers"
        @update-member-role="handleUpdateMemberRole"
        @remove-member="handleRemoveMember"
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
