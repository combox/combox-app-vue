import { addChatMembers, createChannel, createChat, leaveChat, removeChatMember, setChatMuted, updateChatMemberRole } from 'combox-api'
import type { WorkspaceActionsInput } from './chatWorkspace.actions.shared'

export function createGroupActions(input: WorkspaceActionsInput) {
  async function createGroupChat(title: string, memberIDs: string[] = []) {
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return
    const cleanMemberIDs = Array.from(new Set(memberIDs.map((id) => (id || '').trim()).filter(Boolean)))
    try {
      const payload = await createChat({ title: cleanTitle, member_ids: cleanMemberIDs, type: 'standard' })
      await input.loadChats()
      if (payload.chat?.id) {
        await input.selectChat(payload.chat.id)
        await input.loadGroupChannels(payload.chat.id)
        input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [payload.chat.id]: payload.chat.id }
        input.persistGroupSelection()
      }
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.create_group_error')
      throw error
    }
  }

  async function createChannelForSelectedGroup(title: string, channelType?: 'text' | 'voice') {
    const active = input.selectedChat.value
    const groupID =
      (active?.parent_chat_id || '').trim() ||
      ((active && (active.kind || '').trim() === 'group' ? active.id : '') || '').trim()
    if (!groupID) return
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return
    try {
      const payload = await createChannel(groupID, { title: cleanTitle, channel_type: channelType || 'text' })
      await input.loadChats()
      await input.loadGroupChannels(groupID)
      if (payload.chat?.id) {
        input.selectedChatID.value = groupID
        input.groupChannelsOpen.value = true
        input.selectedGroupChannelByGroupId.value = { ...input.selectedGroupChannelByGroupId.value, [groupID]: payload.chat.id }
        input.persistGroupSelection()
      }
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.create_channel_error')
    }
  }

  async function toggleMuteSelectedChat() {
    const chatID = (input.activeMessagesChatID.value || input.selectedChatID.value).trim()
    if (!chatID) return
    const nextMuted = !input.mutedChatIDs.value[chatID]
    input.mutedChatIDs.value = { ...input.mutedChatIDs.value, [chatID]: nextMuted }
    try {
      const payload = await setChatMuted(chatID, nextMuted)
      input.unreadByChatId.value = payload.unread_by_chat || {}
      input.mutedChatIDs.value = Object.fromEntries((payload.muted_chat_ids || []).map((id) => [id, true]))
    } catch (error) {
      input.mutedChatIDs.value = { ...input.mutedChatIDs.value, [chatID]: !nextMuted }
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.mute_failed')
    }
  }

  async function leaveSelectedChat() {
    const active = input.selectedChat.value
    const chatID = (active?.id || '').trim()
    if (!chatID || !active || active.is_direct) return
    try {
      await leaveChat(chatID)
      if (input.selectedChatID.value === chatID) {
        input.selectedChatID.value = ''
        input.rawMessages.value = []
        input.chatMembers.value = []
        input.infoOpen.value = false
      }
      await input.loadChats()
      input.clearHash()
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.leave_chat_error')
      throw error
    }
  }

  async function addMembersToSelectedGroup(memberIDs: string[]) {
    const chatID = (input.selectedChat.value?.id || '').trim()
    if (!chatID) return
    try {
      const items = await addChatMembers(chatID, memberIDs)
      input.chatMembers.value = await input.enrichChatMembers(items)
      void input.loadChats()
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.add_participants_error')
      throw error
    }
  }

  async function updateSelectedGroupMemberRole(userID: string, role: 'member' | 'moderator' | 'admin' | 'subscriber' | 'banned') {
    const chatID = (input.selectedChat.value?.id || '').trim()
    if (!chatID) return
    try {
      const items = await updateChatMemberRole(chatID, userID, role as 'member' | 'moderator' | 'admin')
      input.chatMembers.value = await input.enrichChatMembers(items)
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.update_role_error')
      throw error
    }
  }

  async function removeSelectedGroupMember(userID: string) {
    const chatID = (input.selectedChat.value?.id || '').trim()
    if (!chatID) return
    try {
      const items = await removeChatMember(chatID, userID)
      input.chatMembers.value = await input.enrichChatMembers(items)
      void input.loadChats()
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.remove_participant_error')
      throw error
    }
  }

  return {
    createGroupChat,
    createChannelForSelectedGroup,
    toggleMuteSelectedChat,
    leaveSelectedChat,
    addMembersToSelectedGroup,
    updateSelectedGroupMemberRole,
    removeSelectedGroupMember,
  }
}
