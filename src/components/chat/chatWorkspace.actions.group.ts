import { addChatMembers, createChannel, createChat, leaveChat, removeChatMember, setChatMuted, updateChat, updateChatMemberRole } from 'combox-api'
import { writeJSON } from './chatWorkspace.storage'

export function createGroupActions(deps: any) {
  async function createGroupChat(title: string, memberIDs: string[] = []) {
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return
    const cleanMemberIDs = Array.from(new Set(memberIDs.map((id) => (id || '').trim()).filter(Boolean)))
    try {
      const payload = await createChat({ title: cleanTitle, member_ids: cleanMemberIDs, type: 'standard' })
      await deps.loadChats()
      if (payload.chat?.id) {
        await deps.selectChat(payload.chat.id)
        deps.selectedChatID.value = payload.chat.id
      }
      deps.sidebarPanel.value = 'chats'
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Unable to create group'
      throw error
    }
  }

  async function createChannelForSelectedGroup(title: string) {
    const active = deps.selectedChat.value
    const groupID = (active?.parent_chat_id || '').trim() || (active && !active.is_direct ? active.id : '')
    if (!groupID) {
      deps.errorText.value = 'Open a group first to create a channel'
      return
    }
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return
    try {
      const payload = await createChannel(groupID, { title: cleanTitle, channel_type: 'text' })
      await deps.loadChats()
      if (payload.chat?.id) {
        await deps.selectChat(payload.chat.id)
        deps.selectedChatID.value = payload.chat.id
      }
      deps.sidebarPanel.value = 'chats'
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Unable to create channel'
      throw error
    }
  }

  async function toggleMuteSelectedChat() {
    const chatID = deps.selectedChatID.value
    if (!chatID) return
    const nextMuted = !Boolean(deps.mutedChatIDs.value[chatID])
    deps.mutedChatIDs.value = { ...deps.mutedChatIDs.value, [chatID]: nextMuted }
    try {
      const payload = await setChatMuted(chatID, nextMuted)
      deps.unreadByChatId.value = payload.unread_by_chat || {}
      deps.mutedChatIDs.value = Object.fromEntries((payload.muted_chat_ids || []).map((id: string) => [id, true]))
    } catch (error) {
      deps.mutedChatIDs.value = { ...deps.mutedChatIDs.value, [chatID]: !nextMuted }
      deps.errorText.value = error instanceof Error ? error.message : 'Mute failed'
    }
  }

  async function updateSelectedGroupProfile(input: { title: string; avatarDataUrl?: string | null }) {
    const active = deps.selectedChat.value
    const chatID = (active?.id || '').trim()
    if (!chatID || !active || active.is_direct) return

    const cleanTitle = (input.title || '').trim()
    if (!cleanTitle) {
      deps.errorText.value = 'Group title is required'
      throw new Error('Group title is required')
    }

    try {
      const payload = await updateChat(chatID, {
        title: cleanTitle,
        avatar_data_url: typeof input.avatarDataUrl === 'string' ? input.avatarDataUrl : undefined,
      })
      const updatedChat = payload.chat
      deps.chats.value = deps.chats.value.map((item: any) => (item.id === updatedChat.id ? { ...item, ...updatedChat } : item))
      writeJSON(deps.CHATS_CACHE_KEY, deps.chats.value)
      if (deps.selectedChatID.value === updatedChat.id) deps.selectedChatID.value = updatedChat.id
      await deps.refreshChatMembers(chatID)
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Unable to update group'
      throw error
    }
  }

  async function leaveSelectedChat() {
    const active = deps.selectedChat.value
    const chatID = (active?.id || '').trim()
    if (!chatID) return
    try {
      await leaveChat(chatID)
      deps.infoOpen.value = false
      deps.chatMenuAnchor.value = null
      await deps.loadChats()
      if (deps.selectedChatID.value === chatID) deps.selectedChatID.value = ''
      deps.rawMessages.value = []
      deps.chatMembers.value = []
      deps.focusedInfoUserProfile.value = null
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Unable to leave chat'
      throw error
    }
  }

  async function addMembersToSelectedGroup(memberIDs: string[]) {
    const active = deps.selectedChat.value
    const chatID = (active?.id || '').trim()
    if (!chatID || active?.is_direct) return
    const cleanMemberIDs = Array.from(new Set(memberIDs.map((id) => (id || '').trim()).filter(Boolean)))
    if (!cleanMemberIDs.length) return
    try {
      await addChatMembers(chatID, cleanMemberIDs)
      await deps.refreshChatMembers(chatID)
      await deps.loadChats()
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Unable to add members'
      throw error
    }
  }

  async function updateSelectedGroupMemberRole(userID: string, role: 'member' | 'moderator' | 'admin') {
    const active = deps.selectedChat.value
    const chatID = (active?.id || '').trim()
    const cleanUserID = (userID || '').trim()
    if (!chatID || !cleanUserID || active?.is_direct) return
    try {
      await updateChatMemberRole(chatID, cleanUserID, role)
      await deps.refreshChatMembers(chatID)
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Unable to update role'
      throw error
    }
  }

  async function removeSelectedGroupMember(userID: string) {
    const active = deps.selectedChat.value
    const chatID = (active?.id || '').trim()
    const cleanUserID = (userID || '').trim()
    if (!chatID || !cleanUserID || active?.is_direct) return
    try {
      await removeChatMember(chatID, cleanUserID)
      await deps.refreshChatMembers(chatID)
      await deps.loadChats()
    } catch (error) {
      deps.errorText.value = error instanceof Error ? error.message : 'Unable to remove member'
      throw error
    }
  }

  return {
    createGroupChat,
    createChannelForSelectedGroup,
    toggleMuteSelectedChat,
    updateSelectedGroupProfile,
    leaveSelectedChat,
    addMembersToSelectedGroup,
    updateSelectedGroupMemberRole,
    removeSelectedGroupMember,
  }
}
