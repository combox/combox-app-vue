import { ComboxClient } from 'combox-api'
import { setNotificationsEnabled } from '../chat/chatWorkspace.notifications'
import {
  effectiveBadge,
  effectiveNotifications,
  effectivePreviewName,
  effectivePreviewText,
  effectiveSound,
  perChatEnabled,
  type PerChatKind,
  type UserSettingsValues,
} from './userSettingsMeta'

// This module is the honest wiring between the settings UI and the rest of
// the app. Everything here either touches a mechanism the chat/call runtime
// actually reads, or computes a live preview from server data. Anything that
// needs an edit in a forbidden file is documented at the call site instead
// of being faked.

// ---- desktop notifications bridge ----------------------------------------
// chatWorkspace.notifications.ts gates every notification/sound path on its
// `notificationsEnabled` ref (localStorage `combox.notifications.enabled`).
// The backend `notifications_enabled` master must stay in sync with it,
// otherwise the toggle would persist server-side but change nothing on
// screen. Per-chat kind flags additionally need the notify path to know the
// chat kind — that check lives in forbidden files, so kinds are enforced
// server-side / documented, while the master is enforced here AND there.

const NOTIF_KEY = 'combox.notifications.enabled'

/** Pushes the backend master into the live runtime gate (no reload needed). */
export function syncNotificationBridge(values: UserSettingsValues): void {
  const enabled = effectiveNotifications(values)
  try {
    setNotificationsEnabled(enabled)
  } catch {
    try {
      window.localStorage.setItem(NOTIF_KEY, enabled ? '1' : '0')
    } catch {
      // Storage may be unavailable; the in-memory ref (when set) still works.
    }
  }
}

// ---- live unread snapshot --------------------------------------------------

export type UnreadSnapshot = { unreadByChat: Record<string, number>; mutedIds: string[] }

export async function loadUnreadSnapshot(): Promise<UnreadSnapshot> {
  try {
    const payload = await new ComboxClient().getChatNotifications()
    const unreadByChat: Record<string, number> = {}
    for (const [chatID, count] of Object.entries(payload.unread_by_chat || {})) {
      const n = Math.max(0, Number(count) || 0)
      if (n > 0) unreadByChat[chatID] = n
    }
    return { unreadByChat, mutedIds: [...(payload.muted_chat_ids || [])] }
  } catch {
    return { unreadByChat: {}, mutedIds: [] }
  }
}

// ---- badge formula ----------------------------------------------------------
// badge_enabled is the master (AND). When on: muted chats count only with
// badge_include_muted; the unit is messages with badge_count_messages,
// chats otherwise; badge_folders_count switches the presentation to
// per-folder counters. Computed here from live server data so the preview
// under the toggles is never a mock.

export type BadgePreview = {
  visible: boolean
  count: number
  unit: 'off' | 'chats' | 'messages'
  perFolder: boolean
  includesMuted: boolean
}

export function computeBadgePreview(values: UserSettingsValues, snap: UnreadSnapshot): BadgePreview {
  if (!effectiveBadge(values)) {
    return { visible: false, count: 0, unit: 'off', perFolder: false, includesMuted: values.badge_include_muted }
  }
  const muted = new Set(snap.mutedIds)
  const entries = Object.entries(snap.unreadByChat).filter(
    ([chatID, count]) => count > 0 && (values.badge_include_muted || !muted.has(chatID)),
  )
  const byMessages = values.badge_count_messages
  const count = byMessages ? entries.reduce((sum, [, n]) => sum + n, 0) : entries.length
  return {
    visible: true,
    count,
    unit: byMessages ? 'messages' : 'chats',
    perFolder: values.badge_folders_count,
    includesMuted: values.badge_include_muted,
  }
}

// ---- notification AND preview -----------------------------------------------
// Shows exactly what the AND chain produces for an incoming private message,
// so the master/refinement relationship is visible, not just documented.

export type NotificationSample = {
  allowed: boolean
  kindAllowed: boolean
  title: string
  body: string
  sound: boolean
}

export function notificationSample(values: UserSettingsValues, kind: PerChatKind = 'private'): NotificationSample {
  const allowed = effectiveNotifications(values)
  const kindAllowed = perChatEnabled(values, kind)
  const shown = allowed && kindAllowed
  return {
    allowed: shown,
    kindAllowed,
    title: effectivePreviewName(values) ? 'Alice' : 'ComBox',
    body: !values.notification_previews
      ? '…'
      : effectivePreviewText(values)
        ? 'Hey, are you coming tonight?'
        : 'You have a new message',
    sound: shown && effectiveSound(values),
  }
}

// ---- power saving ---------------------------------------------------------------
// Disables animations for real via a <style> injected on <html>: the master
// kills every CSS animation/transition app-wide; the scoped toggles only
// touch media elements (stickers/emoji/GIFs) and overlay UI. GIF frame
// animation itself cannot be frozen from CSS — the rule pauses CSS-driven
// motion, which is what the messenger renders. Applied on first paint via
// applyPowerSaving(loadPowerSaving()) in main.ts.

export type PowerSaving = { all: boolean; media: boolean; ui: boolean }

const PS_KEY = 'combox.power-saving.v1'
const PS_STYLE_ID = 'combox-power-saving-style'

const PS_CSS = `
html.cb-psm-all *, html.cb-psm-all *::before, html.cb-psm-all *::after {
  animation: none !important;
  transition: none !important;
}
html.cb-psm-media img, html.cb-psm-media video, html.cb-psm-media canvas, html.cb-psm-media svg,
html.cb-psm-media [class*="sticker" i], html.cb-psm-media [class*="emoji" i], html.cb-psm-media [class*="gif" i] {
  animation: none !important;
  animation-play-state: paused !important;
}
html.cb-psm-ui .v-overlay__content, html.cb-psm-ui .v-dialog, html.cb-psm-ui .v-menu__content,
html.cb-psm-ui [role="dialog"], html.cb-psm-ui .v-overlay__scrim {
  animation: none !important;
  transition: none !important;
}
`.trim()

export function loadPowerSaving(): PowerSaving {
  try {
    const raw = window.localStorage.getItem(PS_KEY)
    if (!raw) return { all: false, media: false, ui: false }
    const parsed = JSON.parse(raw) as Partial<PowerSaving>
    return { all: Boolean(parsed.all), media: Boolean(parsed.media), ui: Boolean(parsed.ui) }
  } catch {
    return { all: false, media: false, ui: false }
  }
}

export function applyPowerSaving(state: PowerSaving): void {
  try {
    const root = document.documentElement
    root.classList.toggle('cb-psm-all', state.all)
    root.classList.toggle('cb-psm-media', state.all || state.media)
    root.classList.toggle('cb-psm-ui', state.all || state.ui)
    let style = document.getElementById(PS_STYLE_ID)
    if (!style) {
      style = document.createElement('style')
      style.id = PS_STYLE_ID
      style.textContent = PS_CSS
      document.head.appendChild(style)
    }
  } catch {
    // DOM may be unavailable in tests.
  }
}

export function savePowerSaving(state: PowerSaving): void {
  try {
    window.localStorage.setItem(PS_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage failures (private mode, quota, etc).
  }
  applyPowerSaving(state)
}
