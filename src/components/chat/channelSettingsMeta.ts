import { getUserByID, type ChatInviteLink } from 'combox-api'

export type I18nPair = { key: string; fallback: string }

export type SlowModeOption = { seconds: number; label: I18nPair }

/** Telegram's slow-mode presets; the column stores plain seconds. */
export const SLOW_MODE_OPTIONS: readonly SlowModeOption[] = [
  { seconds: 0, label: { key: 'chat.chanset_slow_off', fallback: 'Off' } },
  { seconds: 10, label: { key: 'chat.chanset_slow_10s', fallback: '10s' } },
  { seconds: 30, label: { key: 'chat.chanset_slow_30s', fallback: '30s' } },
  { seconds: 60, label: { key: 'chat.chanset_slow_1m', fallback: '1m' } },
  { seconds: 300, label: { key: 'chat.chanset_slow_5m', fallback: '5m' } },
  { seconds: 900, label: { key: 'chat.chanset_slow_15m', fallback: '15m' } },
  { seconds: 3600, label: { key: 'chat.chanset_slow_1h', fallback: '1h' } },
]

export function slowModeLabel(seconds: number): I18nPair {
  const found = SLOW_MODE_OPTIONS.find((option) => option.seconds === seconds)
  if (found) return found.label
  return { key: 'chat.chanset_slow_raw', fallback: `${seconds}s` }
}

const EVENT_LABELS: Record<string, I18nPair> = {
  member_joined: { key: 'chat.chanset_ev_joined', fallback: '{actor} joined' },
  member_left: { key: 'chat.chanset_ev_left', fallback: '{actor} left' },
  member_removed: { key: 'chat.chanset_ev_removed', fallback: '{actor} removed a member' },
  role_changed: { key: 'chat.chanset_ev_role', fallback: '{actor} changed a member role' },
  title_changed: { key: 'chat.chanset_ev_title', fallback: '{actor} changed the title' },
  avatar_changed: { key: 'chat.chanset_ev_avatar', fallback: '{actor} changed the photo' },
  description_changed: { key: 'chat.chanset_ev_description', fallback: '{actor} changed the description' },
  icon_changed: { key: 'chat.chanset_ev_icon', fallback: '{actor} changed the icon' },
  settings_changed: { key: 'chat.chanset_ev_settings', fallback: '{actor} updated the settings' },
  banned: { key: 'chat.chanset_ev_banned', fallback: '{actor} blocked a user' },
  unbanned: { key: 'chat.chanset_ev_unbanned', fallback: '{actor} unblocked a user' },
}

export function eventLabel(eventType: string): I18nPair {
  return EVENT_LABELS[eventType] || { key: 'chat.chanset_ev_generic', fallback: 'Updated the channel' }
}

const EVENT_ICONS: Record<string, string> = {
  member_joined: 'mdi-account-plus-outline',
  member_left: 'mdi-account-minus-outline',
  member_removed: 'mdi-account-remove-outline',
  role_changed: 'mdi-shield-account-outline',
  title_changed: 'mdi-rename-outline',
  avatar_changed: 'mdi-image-outline',
  description_changed: 'mdi-text',
  icon_changed: 'mdi-emoticon-outline',
  settings_changed: 'mdi-cog-outline',
  banned: 'mdi-account-cancel-outline',
  unbanned: 'mdi-account-check-outline',
}

export function eventIcon(eventType: string): string {
  return EVENT_ICONS[eventType] || 'mdi-information-outline'
}

const ROLE_LABELS: Record<string, I18nPair> = {
  owner: { key: 'chat.chanset_role_owner', fallback: 'Owner' },
  admin: { key: 'chat.chanset_role_admin', fallback: 'Admin' },
  moderator: { key: 'chat.chanset_role_moderator', fallback: 'Moderator' },
  member: { key: 'chat.chanset_role_member', fallback: 'Member' },
  subscriber: { key: 'chat.chanset_role_subscriber', fallback: 'Subscriber' },
  banned: { key: 'chat.chanset_role_banned', fallback: 'Blocked' },
}

export function roleLabel(role: string): I18nPair {
  const key = (role || '').trim().toLowerCase()
  return ROLE_LABELS[key] || { key: 'chat.chanset_role_member', fallback: 'Member' }
}

/** Strips the `role=admin` payload form down to the bare role name. */
export function roleFromPayload(payload: string): string {
  const raw = (payload || '').trim()
  return raw.startsWith('role=') ? raw.slice('role='.length).trim() : raw
}

export type UserBrief = { name: string; avatar: string }

export function userFullName(user: { first_name?: string; last_name?: string; username?: string } | null | undefined): string {
  if (!user) return ''
  const name = `${(user.first_name || '').trim()} ${(user.last_name || '').trim()}`.trim()
  return name || (user.username || '').trim()
}

/** Resolves display names/avatars for a batch of user ids; unknown ids are omitted. */
export async function loadUsers(userIDs: string[]): Promise<Record<string, UserBrief>> {
  const unique = [...new Set(userIDs.map((id) => (id || '').trim()).filter(Boolean))]
  const out: Record<string, UserBrief> = {}
  await Promise.all(
    unique.map(async (id) => {
      try {
        const user = await getUserByID(id)
        out[id] = { name: userFullName(user), avatar: (user.avatar_data_url || '').trim() }
      } catch {
        out[id] = { name: '', avatar: '' }
      }
    }),
  )
  return out
}

export function inviteLinkUrl(link: ChatInviteLink | null | undefined): string {
  const token = (link?.token || '').trim()
  if (!token || typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}#link:${encodeURIComponent(token)}`
}

export async function copyText(value: string): Promise<boolean> {
  if (!value) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through to the legacy path below
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  } catch {
    return false
  }
}

export function formatEventTime(iso: string, locale: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  try {
    return parsed.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return parsed.toISOString()
  }
}
