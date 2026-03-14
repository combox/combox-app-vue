import type { Ref } from 'vue'
import { editMessage, encodeAttachmentToken, getAttachment, markMessageRead, parseMessageContent, sendMessage, toggleMessageReaction } from 'combox-api'
import { mediaPipelineClient } from '../../lib/mediaPipeline/client'
import { hydrateAttachmentURLs } from './chatWorkspace.attachments'
import { MSG_CACHE_PREFIX, STATUS_CACHE_PREFIX, STATUS_GLOBAL_CACHE_KEY } from './chatWorkspace.constants'
import { readJSON, writeJSON } from './chatWorkspace.storage'
import { enqueueOutbox, isOfflineError } from '../../lib/offline/outbox'
import type { MessageStatus } from './chatWorkspace.types'
import type { WorkspaceActionsInput } from './chatWorkspace.actions.shared'

export function createMessageActions(input: WorkspaceActionsInput) {
  async function sendDraft(draft: string) {
    const chatID = input.activeMessagesChatID.value
    const text = draft.trim()
    if (!chatID) return false

    input.sending.value = true
    input.errorText.value = ''
    try {
      const existingAttachmentIDs = input.editingMessage.value
        ? parseMessageContent(input.editingMessage.value.raw.content || '').attachments.map((item) => item.id).filter(Boolean)
        : []
      if (!text && input.pendingFiles.value.length === 0 && existingAttachmentIDs.length === 0) return false

      const replyToMessageID = (input.replyToMessage.value?.raw.id || '').trim()

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (text && input.pendingFiles.value.length === 0 && existingAttachmentIDs.length === 0 && !input.editingMessage.value) {
          enqueueOutbox({ type: 'sendMessage', chatID, content: text, attachmentIDs: [], replyToMessageID })
          input.pendingFiles.value = []
          input.replyToMessage.value = null
          input.unreadByChatId.value = { ...input.unreadByChatId.value, [chatID]: 0 }
          return true
        }
      }

      const uploaded = await Promise.all(
        input.pendingFiles.value.map(async (pending) => {
          const up = await mediaPipelineClient.uploadFile({
            file: pending.file,
            onProgress: (percent) => {
              input.pendingFiles.value = input.pendingFiles.value.map((item) => (item.id === pending.id ? { ...item, progress: percent } : item))
            },
          })
          return {
            id: up.attachment.id,
            token: encodeAttachmentToken({
              id: up.attachment.id,
              filename: up.attachment.filename,
              mimeType: up.attachment.mime_type,
              kind: up.attachment.kind,
            }),
          }
        }),
      )

      const attachmentTokens = uploaded.length > 0
        ? uploaded.map((item) => item.token)
        : input.editingMessage.value
          ? parseMessageContent(input.editingMessage.value.raw.content || '').attachments.map((item) =>
              encodeAttachmentToken({
                id: item.id,
                filename: item.filename,
                mimeType: item.mimeType,
                kind: item.kind,
              }),
            )
          : []
      const attachmentIDs = uploaded.length > 0 ? uploaded.map((item) => item.id) : existingAttachmentIDs
      const content = [text, attachmentTokens.join(' ')].filter(Boolean).join('\n')
      if (input.editingMessage.value) {
        let updated
        try {
          updated = await editMessage(chatID, input.editingMessage.value.raw.id, content, attachmentIDs)
        } catch (error) {
          if (isOfflineError(error) && content) {
            enqueueOutbox({ type: 'editMessage', chatID, messageID: input.editingMessage.value.raw.id, content, attachmentIDs })
            input.pendingFiles.value = []
            input.replyToMessage.value = null
            input.editingMessage.value = null
            return true
          }
          throw error
        }
        input.rawMessages.value = input.rawMessages.value.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
        await hydrateAttachmentURLs([updated], input.urlsByAttachment, input.attachmentRequests, parseMessageContent, getAttachment)
        writeJSON(`${MSG_CACHE_PREFIX}${chatID}`, input.rawMessages.value)
        input.updateGroupChannelPreview(chatID, updated.content || content, updated.created_at)
        input.pendingFiles.value = []
        input.replyToMessage.value = null
        input.editingMessage.value = null
        void input.loadChats()
        const groupID = input.findGroupIDByChannelID(chatID)
        if (groupID) void input.loadGroupChannels(groupID)
        return true
      }

      let created
      try {
        created = await sendMessage(chatID, content, attachmentIDs, replyToMessageID)
      } catch (error) {
        if (isOfflineError(error) && content && attachmentIDs.length === 0) {
          enqueueOutbox({ type: 'sendMessage', chatID, content, attachmentIDs: [], replyToMessageID })
          input.pendingFiles.value = []
          input.replyToMessage.value = null
          input.unreadByChatId.value = { ...input.unreadByChatId.value, [chatID]: 0 }
          return true
        }
        throw error
      }
      input.rawMessages.value = [...input.rawMessages.value, created]
      await hydrateAttachmentURLs([created], input.urlsByAttachment, input.attachmentRequests, parseMessageContent, getAttachment)
      writeJSON(`${MSG_CACHE_PREFIX}${chatID}`, input.rawMessages.value)
      input.updateGroupChannelPreview(chatID, created.content || content, created.created_at)

      input.pendingFiles.value = []
      input.replyToMessage.value = null
      input.unreadByChatId.value = { ...input.unreadByChatId.value, [chatID]: 0 }
      const groupID = input.findGroupIDByChannelID(chatID)
      if (groupID) void input.loadGroupChannels(groupID)

      window.setTimeout(() => {
        void input.loadMessages(chatID)
      }, 160)

      return true
    } catch (error) {
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.send_failed_runtime')
      return false
    } finally {
      input.sending.value = false
    }
  }

  async function reactToMessage(messageID: string, emoji: string) {
    try {
      const result = await toggleMessageReaction(messageID, emoji)
      input.rawMessages.value = input.rawMessages.value.map((item) => (item.id === messageID ? { ...item, reactions: result.reactions || [] } : item))
      if (input.activeMessagesChatID.value) writeJSON(`${MSG_CACHE_PREFIX}${input.activeMessagesChatID.value}`, input.rawMessages.value)
    } catch (error) {
      if (isOfflineError(error)) {
        enqueueOutbox({ type: 'toggleReaction', messageID, emoji })
        return
      }
      input.errorText.value = error instanceof Error ? error.message : input.t('chat.reaction_failed')
    }
  }

  async function markMessagesRead(chatID: string, messageIDs: string[], readReportedMessageIDs: Ref<Set<string>>) {
    const cleanChatID = chatID.trim()
    const pending = messageIDs.filter((id) => id && !readReportedMessageIDs.value.has(id))
    if (!cleanChatID || pending.length === 0) return

    for (const messageID of pending) readReportedMessageIDs.value.add(messageID)
    let results: PromiseSettledResult<unknown>[]
    try {
      results = await Promise.allSettled(pending.map((messageID) => markMessageRead(cleanChatID, messageID)))
    } catch (error) {
      if (isOfflineError(error)) {
        for (const messageID of pending) enqueueOutbox({ type: 'markRead', chatID: cleanChatID, messageID })
        const next = { ...input.messageStatusesByMessage.value }
        for (const messageID of pending) {
          next[messageID] = {
            message_id: messageID,
            chat_id: cleanChatID,
            user_id: input.currentUser?.id || '',
            status: 'read',
            updated_at: new Date().toISOString(),
          }
        }
        input.messageStatusesByMessage.value = next
        writeJSON(`${STATUS_CACHE_PREFIX}${cleanChatID}`, next)
        writeJSON(STATUS_GLOBAL_CACHE_KEY, { ...readJSON<Record<string, MessageStatus>>(STATUS_GLOBAL_CACHE_KEY, {}), ...next })
        input.unreadByChatId.value = { ...input.unreadByChatId.value, [cleanChatID]: 0 }
        return
      }
      throw error
    }
    const successful = results
      .map((result, index) => ({ result, messageID: pending[index] }))
      .filter((item) => item.result.status === 'fulfilled')

    if (successful.length > 0) {
      const next = { ...input.messageStatusesByMessage.value }
      for (const item of successful) {
        const resultRaw = (item.result as PromiseFulfilledResult<unknown>).value
        const result = (resultRaw && typeof resultRaw === 'object' ? resultRaw : {}) as Partial<MessageStatus>
        const mID = result?.message_id || item.messageID
        next[mID] = {
          message_id: mID,
          chat_id: result?.chat_id || cleanChatID,
          user_id: result?.user_id || input.currentUser?.id || '',
          status: result?.status || 'read',
          updated_at: result?.updated_at || new Date().toISOString(),
        }
      }
      input.messageStatusesByMessage.value = next
      writeJSON(`${STATUS_CACHE_PREFIX}${cleanChatID}`, next)
      writeJSON(STATUS_GLOBAL_CACHE_KEY, { ...readJSON<Record<string, MessageStatus>>(STATUS_GLOBAL_CACHE_KEY, {}), ...next })
      input.unreadByChatId.value = { ...input.unreadByChatId.value, [cleanChatID]: 0 }
    }

    for (let i = 0; i < results.length; i += 1) {
      if (results[i].status === 'rejected') {
        readReportedMessageIDs.value.delete(pending[i])
      }
    }
  }

  return {
    sendDraft,
    reactToMessage,
    markMessagesRead,
  }
}
