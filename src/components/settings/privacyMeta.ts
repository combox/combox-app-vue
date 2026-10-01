import type { PrivacyResponse, PrivacyRule, PrivacySetting } from 'combox-api'

/** Same shape as `useI18n().t`, so every helper takes the caller's `t`. */
export type TFn = (key: string, params?: Record<string, string | number>, fallback?: string) => string

const KNOWN_RULES: readonly PrivacyRule[] = ['everybody', 'contacts', 'nobody']

/** The three rows every privacy editor shows, in Telegram's order. */
export const PRIVACY_RULE_ROWS: ReadonlyArray<{ value: PrivacyRule; icon: string }> = [
  { value: 'everybody', icon: 'mdi-earth' },
  { value: 'contacts', icon: 'mdi-account-multiple-outline' },
  { value: 'nobody', icon: 'mdi-account-off-outline' },
]

const PARAM_ICONS: Record<string, string> = {
  phone_number: 'mdi-cellphone',
  last_seen: 'mdi-clock-outline',
  profile_photos: 'mdi-image-multiple-outline',
  forwarded_messages: 'mdi-forward-outline',
  calls: 'mdi-phone-outline',
  voice_messages: 'mdi-microphone-outline',
  messages: 'mdi-message-outline',
  birthday: 'mdi-cake-outline',
  gifts: 'mdi-gift-outline',
  bio: 'mdi-card-account-details-outline',
  saved_music: 'mdi-music-note-outline',
  invites: 'mdi-account-multiple-plus-outline',
}

/** Last response, so re-entering the screen renders instantly. */
let cache: PrivacyResponse | null = null

export function readPrivacyCache(): PrivacyResponse | null {
  return cache
}

export function writePrivacyCache(response: PrivacyResponse): void {
  cache = { settings: response.settings, defaults: response.defaults }
}

/** Applies one saved row on top of the cached list. */
export function updatePrivacyCache(setting: PrivacySetting): void {
  if (!cache) {
    cache = { settings: [setting], defaults: {} }
    return
  }
  const index = cache.settings.findIndex((item) => item.param === setting.param)
  const next = [...cache.settings]
  if (index >= 0) next[index] = setting
  else next.push(setting)
  cache = { ...cache, settings: next }
}

function humanize(param: string): string {
  const raw = String(param || '').replace(/_/g, ' ').trim()
  if (!raw) return ''
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

export function isPrivacyRule(value: unknown): value is PrivacyRule {
  return typeof value === 'string' && (KNOWN_RULES as readonly string[]).includes(value)
}

export function privacyParamIcon(param: string): string {
  return PARAM_ICONS[param] || 'mdi-shield-lock-outline'
}

export function privacyParamTitle(param: string, t: TFn): string {
  return t(`settings.privacy.param.${param}`, undefined, humanize(param))
}

export function privacyHeading(param: string, t: TFn): string {
  return t(
    `settings.privacy.heading.${param}`,
    undefined,
    t('settings.privacy.heading_generic', undefined, 'Who can see this?'),
  )
}

export function privacyRuleLabel(rule: PrivacyRule, t: TFn): string {
  if (rule === 'contacts') return t('settings.privacy.rule.contacts', undefined, 'My contacts')
  if (rule === 'nobody') return t('settings.privacy.rule.nobody', undefined, 'Nobody')
  return t('settings.privacy.rule.everybody', undefined, 'Everybody')
}

export function privacyRuleSummary(rule: PrivacyRule, t: TFn): string {
  if (rule === 'contacts') return t('settings.privacy.rule.contacts_short', undefined, 'Contacts only')
  if (rule === 'nobody') return t('settings.privacy.rule.nobody_short', undefined, 'Nobody')
  return t('settings.privacy.rule.everybody_short', undefined, 'Everybody')
}

/** `(-3)` / `(+3)` exception badge shown on the list, like Telegram. */
export function privacyExceptionSuffix(setting: PrivacySetting): string {
  if (setting.rule === 'everybody' && setting.deny_count > 0) return `(-${setting.deny_count})`
  if (setting.rule === 'nobody' && setting.allow_count > 0) return `(+${setting.allow_count})`
  return ''
}

export function privacyCaption(rule: PrivacyRule, t: TFn): string {
  if (rule === 'nobody') {
    return t(
      'settings.privacy.caption_nobody',
      undefined,
      'Nobody can see this, except the people you allow below.',
    )
  }
  if (rule === 'contacts') {
    return t(
      'settings.privacy.caption_contacts',
      undefined,
      'Only your contacts can see this. The people you never share with are excluded, the ones you always share with are included.',
    )
  }
  return t(
    'settings.privacy.caption_everybody',
    undefined,
    'Everyone can see this, except the people you never share with.',
  )
}

export function privacyListTitle(t: TFn): string {
  return t('settings.privacy.list_title', undefined, 'Privacy')
}

export function privacyEditorTitle(param: string, t: TFn): string {
  return t(
    'settings.privacy.editor_title',
    { what: privacyParamTitle(param, t) },
    `Who can see: ${privacyParamTitle(param, t)}`,
  )
}
