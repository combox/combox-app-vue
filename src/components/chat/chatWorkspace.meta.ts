import { getStandaloneChannel, listChatInviteLinks, listChatMembers, listChannelMembers, type ChatInviteLink, type ChatItem, type ChatMemberProfile } from 'combox-api'
import type { Ref } from 'vue'
import { CHATS_CACHE_KEY } from './chatWorkspace.constants'
import { enrichChatMembers } from './chatWorkspace.members'
import { writeJSON } from './chatWorkspace.storage'

type SetupWorkspaceMetaInput = {
  chats: Ref<ChatItem[]>
  invitePreviewChat: Ref<ChatItem | null>
  chatMembers: Ref<ChatMemberProfile[]>
  removedChatMembers: Ref<ChatMemberProfile[]>
  selectedChatInviteLinks: Ref<ChatInviteLink[]>
}

export function setupWorkspaceMeta(input: SetupWorkspaceMetaInput) {
  function patchChatLocally(chatID: string, patch: Partial<ChatItem>) {
    input.chats.value = input.chats.value.map((item) => (item.id === chatID ? { ...item, ...patch } : item))
    if (input.invitePreviewChat.value?.id === chatID) {
      input.invitePreviewChat.value = { ...input.invitePreviewChat.value, ...patch }
    }
    writeJSON(CHATS_CACHE_KEY, input.chats.value)
  }

  async function refreshChatMembers(chatID: string) {
    const cleanChatID = (chatID || '').trim()
    if (!cleanChatID) {
      input.chatMembers.value = []
      return
    }
    try {
      const target = input.chats.value.find((item) => item.id === cleanChatID) || input.invitePreviewChat.value
      const items = (target?.kind || '').trim() === 'standalone_channel'
        ? await listChannelMembers(cleanChatID)
        : await listChatMembers(cleanChatID)
      input.chatMembers.value = await enrichChatMembers(items)
    } catch {
      input.chatMembers.value = []
    }
  }

  async function refreshRemovedChatMembers(chatID: string) {
    const cleanChatID = (chatID || '').trim()
    if (!cleanChatID) {
      input.removedChatMembers.value = []
      return
    }
    try {
      const target = input.chats.value.find((item) => item.id === cleanChatID) || input.invitePreviewChat.value
      const items = (target?.kind || '').trim() === 'standalone_channel'
        ? await listChannelMembers(cleanChatID, { include_banned: true })
        : await listChatMembers(cleanChatID, { include_banned: true })
      const banned = items.filter((item) => ((item.role || '').trim().toLowerCase()) === 'banned')
      input.removedChatMembers.value = await enrichChatMembers(banned)
    } catch {
      input.removedChatMembers.value = []
    }
  }

  async function refreshSelectedChatInviteLinks(chatIDRaw: string) {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) {
      input.selectedChatInviteLinks.value = []
      return
    }
    try {
      input.selectedChatInviteLinks.value = await listChatInviteLinks(chatID)
    } catch {
      input.selectedChatInviteLinks.value = []
    }
  }

  async function refreshSelectedChannel(chatIDRaw: string) {
    const chatID = (chatIDRaw || '').trim()
    if (!chatID) return
    try {
      const chat = await getStandaloneChannel(chatID)
      patchChatLocally(chatID, chat)
      if (input.invitePreviewChat.value?.id === chatID) input.invitePreviewChat.value = chat
    } catch {
      // keep current preview state
    }
  }

  return {
    patchChatLocally,
    refreshChatMembers,
    refreshRemovedChatMembers,
    refreshSelectedChatInviteLinks,
    refreshSelectedChannel,
  }
}
