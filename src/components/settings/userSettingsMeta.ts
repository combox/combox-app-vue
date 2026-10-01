import {
  DELETE_ACCOUNT_TTL_VALUES,
  USER_SETTING_DEFAULTS as SERVER_DEFAULTS,
  USER_SETTING_KEYS as SERVER_KEYS,
  getUserSettings,
  updateUserSettings,
  type DeleteAccountTTL,
  type UserSettingKey,
  type UserSettingsPatch,
} from 'combox-api'
import { reactive, ref } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'

export type { DeleteAccountTTL, UserSettingKey }
export { DELETE_ACCOUNT_TTL_VALUES }

/** Full backend whitelist, in the documented order — never hardcode, always re-export. */
export const USER_SETTING_KEYS = SERVER_KEYS

/** Server defaults (`'true'`/`'false'` strings, TTL string) — the single source of truth. */
export const USER_SETTING_DEFAULTS = SERVER_DEFAULTS

export type BoolSettingKey = Exclude<UserSettingKey, 'delete_account_ttl'>

export const BOOL_SETTING_KEYS = SERVER_KEYS.filter((key): key is BoolSettingKey => key !== 'delete_account_ttl')

export type UserSettingsValues = Record<BoolSettingKey, boolean> & { delete_account_ttl: DeleteAccountTTL }

export type PerChatKind = 'private' | 'groups' | 'channels' | 'reactions'

const PER_CHAT_KEY: Record<PerChatKind, UserSettingKey> = {
  private: 'notifications_private',
  groups: 'notifications_groups',
  channels: 'notifications_channels',
  reactions: 'notifications_reactions',
}

function isDeleteAccountTTL(value: unknown): value is DeleteAccountTTL {
  return typeof value === 'string' && (DELETE_ACCOUNT_TTL_VALUES as readonly string[]).includes(value)
}

function boolDefault(key: BoolSettingKey): boolean {
  return SERVER_DEFAULTS[key] === 'true'
}

function ttlDefault(): DeleteAccountTTL {
  const raw = SERVER_DEFAULTS.delete_account_ttl
  return isDeleteAccountTTL(raw) ? raw : '6_months'
}

export function defaultValues(): UserSettingsValues {
  const next = {} as UserSettingsValues
  for (const key of BOOL_SETTING_KEYS) next[key] = boolDefault(key)
  next.delete_account_ttl = ttlDefault()
  return next
}

function fromRaw(raw: Record<string, string>): UserSettingsValues {
  const next = defaultValues()
  for (const key of BOOL_SETTING_KEYS) {
    const value = raw[key]
    if (value === 'true') next[key] = true
    else if (value === 'false') next[key] = false
  }
  const ttl = raw.delete_account_ttl
  if (isDeleteAccountTTL(ttl)) next.delete_account_ttl = ttl
  return next
}

function applyValues(target: UserSettingsValues, source: UserSettingsValues): void {
  for (const key of BOOL_SETTING_KEYS) target[key] = source[key]
  target.delete_account_ttl = source.delete_account_ttl
}

// ---- AND semantics -------------------------------------------------------
// The four legacy flags are masters; the newer keys only refine them. Every
// consumer must read the effective (ANDed) value, never the refining key
// alone. These helpers are the single place that rule lives.

/** Master kill-switch for every desktop notification. */
export function effectiveNotifications(values: UserSettingsValues): boolean {
  return values.notifications_enabled
}

/** Master AND per-chat type: no notification when either side is off. */
export function perChatEnabled(values: UserSettingsValues, kind: PerChatKind): boolean {
  if (!values.notifications_enabled) return false
  return values[PER_CHAT_KEY[kind] as BoolSettingKey]
}

/** Sender name is shown only when previews AND the name chip are on. */
export function effectivePreviewName(values: UserSettingsValues): boolean {
  return values.notification_previews && values.notification_preview_name
}

/** Message text is shown only when previews AND the text chip are on. */
export function effectivePreviewText(values: UserSettingsValues): boolean {
  return values.notification_previews && values.notification_preview_text
}

/** Master kill-switch for message sounds. */
export function effectiveSound(values: UserSettingsValues): boolean {
  return values.sounds_enabled
}

/** Master kill-switch for the unread badge. */
export function effectiveBadge(values: UserSettingsValues): boolean {
  return values.badge_enabled
}

/** Last server answer, so re-entering a category does not refetch. */
let cache: UserSettingsValues | null = null

/**
 * Backend backed settings with an optimistic update: the control flips right
 * away, a failed request rolls it back and reports the API message.
 */
export function useUserSettings() {
  const { t } = useI18n()
  const toast = useToast()

  const values: UserSettingsValues = reactive({ ...defaultValues(), ...(cache || {}) })
  const pending = reactive<Partial<Record<UserSettingKey, boolean>>>({})
  const loading = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    if (cache) {
      applyValues(values, cache)
      return
    }
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
      const raw = await getUserSettings()
      cache = fromRaw(raw)
      applyValues(values, cache)
    } catch (caught) {
      error.value =
        caught instanceof Error ? caught.message : t('settings.toggle_load_failed', undefined, 'Could not load the settings')
    } finally {
      loading.value = false
    }
  }

  async function set(key: UserSettingKey, next: boolean | DeleteAccountTTL | null): Promise<void> {
    if (next === null || next === undefined || pending[key]) return
    if (key === 'delete_account_ttl' && typeof next !== 'string') return
    if (key !== 'delete_account_ttl' && typeof next !== 'boolean') return
    const previous = values[key]
    if (previous === next) return
    ;(values[key] as boolean | DeleteAccountTTL) = next
    pending[key] = true
    error.value = ''
    try {
      const raw = await updateUserSettings({ [key]: next } as UserSettingsPatch)
      cache = fromRaw(raw)
      applyValues(values, cache)
    } catch (caught) {
      ;(values[key] as boolean | DeleteAccountTTL) = previous
      toast.error(
        caught instanceof Error ? caught.message : t('settings.toggle_save_failed', undefined, 'Could not save the setting'),
      )
    } finally {
      pending[key] = false
    }
  }

  return { values, pending, loading, error, load, set }
}
