import { createChatInviteLink, createStandaloneChannel, removeChannelMember, subscribeChannel, unsubscribeChannel, updateChannelMemberRole, updateChat, updateStandaloneChannel } from 'combox-api'
import { CHATS_CACHE_KEY } from './chatWorkspace.constants'
import { writeJSON } from './chatWorkspace.storage'
import type { GroupProfileInput, WorkspaceActionsInput } from './chatWorkspace.actions.shared'

export function createChannelActions(input: WorkspaceActionsInput) {
  async function createStandaloneChannelChat(title: string, publicSlug: string, isPublic = true) {
    const cleanTitle = (title || '').trim()
    const cleanSlug = (publicSlug || '').trim()
    if (!cleanTitle || (isPublic && !cleanSlug)) return
    try {
      const payload = await createStandaloneChannel(isPublic
        ? { title: cleanTitle, public_slug: cleanSlug, is_public: true }
        : { title: cleanTitle, is_public: false })
      await input.loadChats()
      if (payload.chat?.id) {
        await input.selectChat(payload.chat.id)
      }
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.create_channel_error')
      throw error
    }
  }

  async function subscribeSelectedChannel() {
    const active = input.selectedChat.value
    const chatID = (active?.id || '').trim()
    const kind = (active?.kind || '').trim()
  if (!chatID || kind !== 'standalone_channel') return
    try {
      const payload = await subscribeChannel(chatID)
      const currentCount = Number(active?.subscriber_count || 0)
      input.patchChatLocally(chatID, {
        ...payload.chat,
        viewer_role: payload.chat?.viewer_role || 'subscriber',
        subscriber_count: payload.chat?.subscriber_count ?? Math.max(1, currentCount + 1),
      })
      await input.refreshChatMembers(chatID)
      if (input.infoOpen.value) {
        await input.refreshSelectedChatInviteLinks(chatID)
      }
      await input.selectChat(chatID)
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.join_chat_error')
      throw error
    }
  }

  async function unsubscribeSelectedChannel() {
    const active = input.selectedChat.value
    const chatID = (active?.id || '').trim()
    const kind = (active?.kind || '').trim()
  if (!chatID || kind !== 'standalone_channel') return
    try {
      await unsubscribeChannel(chatID)
      const currentCount = Number(active?.subscriber_count || 0)
      input.patchChatLocally(chatID, {
        viewer_role: '',
        subscriber_count: Math.max(0, currentCount - 1),
      })
      input.chatMembers.value = []
      input.removedChatMembers.value = []
      input.selectedChatInviteLinks.value = []
      await input.selectChat(chatID)
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.leave_chat_error')
      throw error
    }
  }

  async function createSelectedChatInviteLink(title = '') {
    const chatID = (input.selectedChat.value?.id || '').trim()
    if (!chatID) return null
    try {
      const item = await createChatInviteLink(chatID, { title })
      await input.refreshSelectedChatInviteLinks(chatID)
      return item
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.invite_link_create_error')
      throw error
    }
  }

  async function updateSelectedGroupProfile(profileInput: GroupProfileInput) {
    const active = input.selectedChat.value
    const chatID = (active?.id || '').trim()
    if (!chatID || !active || active.is_direct) return

    const cleanTitle = (profileInput.title || '').trim()
    if (!cleanTitle) {
      input.errorText.value = input.t('chat.group_title_required')
      throw new Error(input.t('chat.group_title_required'))
    }

    try {
    const updater = (active.kind || '').trim() === 'standalone_channel' ? updateStandaloneChannel : updateChat
      const payload = await updater(chatID, {
        title: cleanTitle,
        avatar_data_url: typeof profileInput.avatarDataUrl === 'string' ? profileInput.avatarDataUrl : undefined,
        comments_enabled: typeof profileInput.commentsEnabled === 'boolean' ? profileInput.commentsEnabled : undefined,
        reactions_enabled: typeof profileInput.reactionsEnabled === 'boolean' ? profileInput.reactionsEnabled : undefined,
        is_public: typeof profileInput.isPublic === 'boolean' ? profileInput.isPublic : undefined,
        public_slug: typeof profileInput.publicSlug === 'string' ? profileInput.publicSlug : profileInput.publicSlug === null ? null : undefined,
      })
      const updatedChat = payload.chat
      input.chats.value = input.chats.value.map((item) => (item.id === updatedChat.id ? { ...item, ...updatedChat } : item))
      writeJSON(CHATS_CACHE_KEY, input.chats.value)
      if (input.selectedChatID.value === updatedChat.id) {
        input.selectedChatID.value = updatedChat.id
      }
      await input.refreshChatMembers(chatID)
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.update_group_error')
      throw error
    }
  }

  async function updateSelectedGroupMemberRole(userID: string, role: 'member' | 'moderator' | 'admin' | 'subscriber' | 'banned') {
    const chatID = (input.selectedChat.value?.id || '').trim()
    const kind = (input.selectedChat.value?.kind || '').trim()
  if (!chatID || kind !== 'standalone_channel') return
    try {
      const items = await updateChannelMemberRole(chatID, userID, role as 'subscriber' | 'admin' | 'banned')
      input.chatMembers.value = await input.enrichChatMembers(items)
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.update_role_error')
      throw error
    }
  }

  async function removeSelectedGroupMember(userID: string) {
    const chatID = (input.selectedChat.value?.id || '').trim()
    const kind = (input.selectedChat.value?.kind || '').trim()
  if (!chatID || kind !== 'standalone_channel') return
    try {
      const items = await removeChannelMember(chatID, userID)
      input.chatMembers.value = await input.enrichChatMembers(items)
      void input.loadChats()
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.remove_participant_error')
      throw error
    }
  }

  return {
    createStandaloneChannelChat,
    subscribeSelectedChannel,
    unsubscribeSelectedChannel,
    createSelectedChatInviteLink,
    updateSelectedGroupProfile,
    updateSelectedGroupMemberRole,
    removeSelectedGroupMember,
  }
}
