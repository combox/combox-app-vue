import type { ChatItem } from 'combox-api'

/** Shape of the `t()` returned by `useI18n()`. */
export type ChatTranslate = (key: string, params?: Record<string, string | number>, fallback?: string) => string

/**
 * Localized, human readable label for a chat's `kind`.
 *
 * Never returns a raw enum value: everything unknown degrades to a localized
 * "Chat" instead of leaking `standalone_channel` / `comment_thread` into the UI.
 */
export function chatKindLabel(t: ChatTranslate, chat: ChatItem | null | undefined): string {
  if (!chat) return t('chat.kind_chat', undefined, 'Chat')
  const kind = String(chat.kind || '').trim()
  switch (kind) {
    case 'direct':
      return t('chat.direct', undefined, 'Direct messages')
    case 'group':
      return t('chat.group', undefined, 'Group chat')
    case 'standalone_channel':
      return t('chat.standalone_channel', undefined, 'Channel')
    case 'channel':
      return t('chat.channel', undefined, 'Channel')
    case 'bot':
      return t('chat.kind_bot', undefined, 'Bot')
    case 'comment_thread':
      return t('chat.kind_comments', undefined, 'Comments')
    default:
      break
  }
  if (chat.is_direct) return t('chat.direct', undefined, 'Direct messages')
  if (String(chat.parent_chat_id || '').trim()) return t('chat.channel', undefined, 'Channel')
  return t('chat.kind_chat', undefined, 'Chat')
}
