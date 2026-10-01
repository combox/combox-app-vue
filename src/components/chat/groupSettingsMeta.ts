import type { ChatTranslate } from './chatLabels'

/** One row of the slow mode picker; `seconds` is the stored `slow_mode_seconds`. */
export type SlowModeOption = {
  seconds: number
  key: string
  fallback: string
}

export const SLOW_MODE_OPTIONS: SlowModeOption[] = [
  { seconds: 0, key: 'chat.groupset_slow_off', fallback: 'Off' },
  { seconds: 10, key: 'chat.groupset_slow_10s', fallback: '10 seconds' },
  { seconds: 30, key: 'chat.groupset_slow_30s', fallback: '30 seconds' },
  { seconds: 60, key: 'chat.groupset_slow_1m', fallback: '1 minute' },
  { seconds: 300, key: 'chat.groupset_slow_5m', fallback: '5 minutes' },
  { seconds: 900, key: 'chat.groupset_slow_15m', fallback: '15 minutes' },
  { seconds: 3600, key: 'chat.groupset_slow_1h', fallback: '1 hour' },
]

/** Localized label for a `slow_mode_seconds` value; unknown values degrade to a plain "Ns". */
export function slowModeLabel(t: ChatTranslate, seconds: number): string {
  const clean = Number(seconds) || 0
  const option = SLOW_MODE_OPTIONS.find((item) => item.seconds === clean)
  if (option) return t(option.key, undefined, option.fallback)
  if (clean > 0) return t('chat.groupset_slow_custom', { seconds: String(clean) }, '{seconds}s')
  return t('chat.groupset_slow_off', undefined, 'Off')
}

/** Localized action line for one `ChatEvent.event_type`. */
export function eventActionLabel(t: ChatTranslate, eventType: string): string {
  const action = CHAT_EVENT_ACTIONS[String(eventType || '').trim()]
  if (!action) return t('chat.groupset_evt_updated', undefined, 'Updated the chat')
  return t(action.key, undefined, action.fallback)
}

const CHAT_EVENT_ACTIONS: Record<string, { key: string; fallback: string }> = {
  member_joined: { key: 'chat.groupset_evt_joined', fallback: 'Joined the chat' },
  member_left: { key: 'chat.groupset_evt_left', fallback: 'Left the chat' },
  member_removed: { key: 'chat.groupset_evt_removed', fallback: 'Removed a member' },
  role_changed: { key: 'chat.groupset_evt_role', fallback: 'Changed a role' },
  title_changed: { key: 'chat.groupset_evt_title', fallback: 'Renamed the chat' },
  avatar_changed: { key: 'chat.groupset_evt_avatar', fallback: 'Changed the avatar' },
  description_changed: { key: 'chat.groupset_evt_description', fallback: 'Changed the description' },
  icon_changed: { key: 'chat.groupset_evt_icon', fallback: 'Changed the icon' },
  settings_changed: { key: 'chat.groupset_evt_settings', fallback: 'Changed the settings' },
  banned: { key: 'chat.groupset_evt_banned', fallback: 'Blocked a member' },
  unbanned: { key: 'chat.groupset_evt_unbanned', fallback: 'Unblocked a member' },
}

/** `send_permission` as accepted by PATCH /chats/{id}. */
export type SendPermissionValue = 'all' | 'admins'

export function normalizeSendPermission(value: string | null | undefined): SendPermissionValue {
  return String(value || '').trim().toLowerCase() === 'admins' ? 'admins' : 'all'
}

/** Length in Unicode code points (Go counts `[]rune`, not UTF-16 units). */
export function runeCount(value: string): number {
  return Array.from(value || '').length
}

/** Cuts a string to `max` code points without splitting a surrogate pair. */
export function truncateRunes(value: string, max: number): string {
  const source = value || ''
  const runes = Array.from(source)
  if (runes.length <= max) return source
  return runes.slice(0, max).join('')
}
