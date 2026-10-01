<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ComboxClient,
  changePassword,
  updateSessionIdleTTL,
  type PrivacySetting,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import PrivacySettings from './PrivacySettings.vue'
import SessionsSettings from './SessionsSettings.vue'
import BlockedUsersSettings from './BlockedUsersSettings.vue'
import TGRow from './TGRow.vue'
import { DELETE_ACCOUNT_TTL_VALUES, useUserSettings, type DeleteAccountTTL } from './userSettingsMeta'
import './settingsShared.css'

type View = 'main' | 'sessions' | 'blocked'

const { t } = useI18n()
const toast = useToast()
const client = new ComboxClient()
const userSettings = useUserSettings()

const view = ref<View>('main')
const privacySetting = ref<PrivacySetting | null>(null)
const loading = ref(true)
const saving = ref(false)

const email = ref('')
const showLastSeen = ref(true)
const sessionTTLSeconds = ref<number | null>(null)

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordOpen = ref(false)

const emailOpen = ref(false)
const emailBusy = ref(false)
const oldCode = ref('')
const oldVerified = ref(false)
const newEmail = ref('')
const newCode = ref('')
const emailError = ref('')

const SESSION_TTL_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: t('settings.session_1h', undefined, '1 hour'), value: 3600 },
  { label: t('settings.session_24h', undefined, '24 hours'), value: 86400 },
  { label: t('settings.session_7d', undefined, '7 days'), value: 604800 },
  { label: t('settings.session_30d', undefined, '30 days'), value: 2592000 },
  { label: t('settings.session_forever', undefined, 'Forever'), value: null },
]

const currentTTLLabel = computed(() => {
  for (const option of SESSION_TTL_OPTIONS) {
    if (option.value === sessionTTLSeconds.value) return option.label
  }
  return t('settings.session_forever', undefined, 'Forever')
})

// Custom dark dropdowns (button-value + popover-list, like the chat menus):
// the native <select> renders a white OS popup, so both TTL rows use the
// site menu instead. Values/options stay untouched; selection calls the
// same setters as before.
const deleteMenuOpen = ref(false)
const sessionMenuOpen = ref(false)
const deleteWrapRef = ref<HTMLElement | null>(null)
const sessionWrapRef = ref<HTMLElement | null>(null)

function closeAllMenus(): void {
  deleteMenuOpen.value = false
  sessionMenuOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null
  if (deleteMenuOpen.value && deleteWrapRef.value && target && !deleteWrapRef.value.contains(target)) {
    deleteMenuOpen.value = false
  }
  if (sessionMenuOpen.value && sessionWrapRef.value && target && !sessionWrapRef.value.contains(target)) {
    sessionMenuOpen.value = false
  }
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeAllMenus()
}

watch([deleteMenuOpen, sessionMenuOpen], ([deleteOpen, sessionOpen]) => {
  if (deleteOpen || sessionOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onDocumentKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})

function ttlLabel(ttl: DeleteAccountTTL): string {
  if (ttl === '1_month') return t('settings.tg.security.ttl_1m', undefined, '1 month')
  if (ttl === '3_months') return t('settings.tg.security.ttl_3m', undefined, '3 months')
  if (ttl === '12_months') return t('settings.tg.security.ttl_12m', undefined, '12 months')
  return t('settings.tg.security.ttl_6m', undefined, '6 months')
}

function openView(next: View): void {
  privacySetting.value = null
  view.value = next
}

/** Outer back button support: returns true when an inner level was closed. */
function goBack(): boolean {
  if (privacySetting.value) {
    privacySetting.value = null
    return true
  }
  if (view.value !== 'main') {
    view.value = 'main'
    return true
  }
  return false
}

defineExpose({ goBack })

async function load(): Promise<void> {
  loading.value = true
  await userSettings.load()
  const [profile, settings] = await Promise.allSettled([client.getProfile(), client.getProfileSettings()])
  if (profile.status === 'fulfilled') {
    const data = profile.value
    email.value = data.email || ''
    sessionTTLSeconds.value = typeof data.session_idle_ttl_seconds === 'number' ? data.session_idle_ttl_seconds : null
  }
  if (settings.status === 'fulfilled') {
    showLastSeen.value = settings.value.show_last_seen ?? true
  }
  loading.value = false
}

async function handleShowLastSeenChange(next: boolean | null): Promise<void> {
  if (next === null) return
  const prev = showLastSeen.value
  showLastSeen.value = next
  try {
    await client.updateProfileSettings(next)
  } catch {
    showLastSeen.value = prev
  }
}

async function handleSessionTTLChange(next: number | null): Promise<void> {
  sessionTTLSeconds.value = next
  saving.value = true
  try {
    await updateSessionIdleTTL(next)
    toast.success(t('settings.session_saved', undefined, 'Session duration saved'))
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : t('settings.session_failed', undefined, 'Could not update session duration'))
  } finally {
    saving.value = false
  }
}

async function handleDeleteTTLChange(next: DeleteAccountTTL): Promise<void> {
  deleteMenuOpen.value = false
  await userSettings.set('delete_account_ttl', next)
}

async function selectSessionTTL(next: number | null): Promise<void> {
  sessionMenuOpen.value = false
  await handleSessionTTLChange(next)
}

async function handleSavePassword(): Promise<void> {
  if (newPassword.value.length < 6) {
    toast.error(t('auth.error_password_short', undefined, 'Password must be at least 6 characters'))
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    toast.error(t('auth.error_passwords_mismatch', undefined, 'Passwords do not match'))
    return
  }
  saving.value = true
  try {
    await changePassword(currentPassword.value, newPassword.value)
    toast.success(t('settings.password_changed', undefined, 'Password changed'))
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordOpen.value = false
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : t('settings.password_failed', undefined, 'Could not change the password'))
  } finally {
    saving.value = false
  }
}

async function handleSendOldCode(): Promise<void> {
  emailBusy.value = true
  emailError.value = ''
  try {
    await client.startEmailChange()
  } catch (caught) {
    emailError.value = caught instanceof Error ? caught.message : t('settings.send_code_failed', undefined, 'Failed to send code')
  } finally {
    emailBusy.value = false
  }
}

async function handleVerifyOldCode(): Promise<void> {
  emailBusy.value = true
  emailError.value = ''
  try {
    const ok = await client.verifyOldEmailCode(oldCode.value.trim())
    oldVerified.value = ok
    if (!ok) emailError.value = t('auth.error_code_invalid', undefined, 'Invalid or expired code')
  } catch (caught) {
    emailError.value = caught instanceof Error ? caught.message : t('settings.verify_code_failed', undefined, 'Failed to verify code')
  } finally {
    emailBusy.value = false
  }
}

async function handleSendNewCode(): Promise<void> {
  emailBusy.value = true
  emailError.value = ''
  try {
    await client.sendNewEmailCode(newEmail.value.trim().toLowerCase())
  } catch (caught) {
    emailError.value = caught instanceof Error ? caught.message : t('settings.send_code_failed', undefined, 'Failed to send code')
  } finally {
    emailBusy.value = false
  }
}

async function handleConfirmNewEmail(): Promise<void> {
  emailBusy.value = true
  emailError.value = ''
  try {
    const updated = await client.confirmEmailChange(newCode.value.trim())
    email.value = updated.email || ''
    oldVerified.value = false
    oldCode.value = ''
    newEmail.value = ''
    newCode.value = ''
    emailOpen.value = false
    toast.success(t('settings.email_changed', undefined, 'Email changed'))
  } catch (caught) {
    emailError.value = caught instanceof Error ? caught.message : t('settings.email_change_failed', undefined, 'Email change failed')
  } finally {
    emailBusy.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="tgPage">
    <template v-if="view === 'sessions'">
      <button type="button" class="tgRow tgBackRow" @click="openView('main')">
        <v-icon icon="mdi-arrow-left" size="20" class="tgRowChevron" />
        <span class="tgRowMain"><span class="tgRowTitle">{{ t('settings.active_sessions', undefined, 'Active sessions') }}</span></span>
      </button>
      <SessionsSettings />
    </template>

    <template v-else-if="view === 'blocked'">
      <button type="button" class="tgRow tgBackRow" @click="openView('main')">
        <v-icon icon="mdi-arrow-left" size="20" class="tgRowChevron" />
        <span class="tgRowMain"><span class="tgRowTitle">{{ t('settings.tg.security.blocked', undefined, 'Blocked users') }}</span></span>
      </button>
      <BlockedUsersSettings />
    </template>

    <template v-else>
      <section class="tgCard">
        <div class="tgSectionLabel">{{ t('settings.tg.security.title', undefined, 'Security') }}</div>
        <TGRow
          icon="mdi-cellphone-link"
          :title="t('settings.active_sessions', undefined, 'Active sessions')"
          :sub="t('settings.active_sessions_hint', undefined, 'Devices that are signed in to your account')"
          @click="openView('sessions')"
        />
        <TGRow
          icon="mdi-account-cancel-outline"
          :title="t('settings.tg.security.blocked', undefined, 'Blocked users')"
          :sub="t('settings.tg.security.blocked_hint', undefined, 'People who cannot reach you')"
          @click="openView('blocked')"
        />
        <div class="tgDivider" />

        <div class="toggleRow tgInsetRow">
          <div>
            <div class="toggleRow__title">{{ t('settings.tg.security.delete_ttl', undefined, 'Delete account if away for') }}</div>
            <div class="toggleRow__sub">{{ ttlLabel(userSettings.values.delete_account_ttl) }}</div>
          </div>
          <div ref="deleteWrapRef" class="tgMenuWrap">
            <button
              type="button"
              class="tgMenuBtn"
              :disabled="Boolean(userSettings.pending.delete_account_ttl)"
              :aria-haspopup="'listbox'"
              :aria-expanded="deleteMenuOpen"
              :aria-label="t('settings.tg.security.delete_ttl', undefined, 'Delete account if away for')"
              @click="deleteMenuOpen = !deleteMenuOpen"
            >
              <span class="tgMenuBtnLabel">{{ ttlLabel(userSettings.values.delete_account_ttl) }}</span>
              <v-icon icon="mdi-chevron-down" size="16" />
            </button>
            <div v-if="deleteMenuOpen" class="tgMenuPop" role="listbox">
              <button
                v-for="ttl in DELETE_ACCOUNT_TTL_VALUES"
                :key="ttl"
                type="button"
                class="tgMenuItem"
                :class="{ active: userSettings.values.delete_account_ttl === ttl }"
                role="option"
                :aria-selected="userSettings.values.delete_account_ttl === ttl"
                @click="handleDeleteTTLChange(ttl)"
              >
                <span>{{ ttlLabel(ttl) }}</span>
                <v-icon v-if="userSettings.values.delete_account_ttl === ttl" icon="mdi-check" size="16" />
              </button>
            </div>
          </div>
        </div>

        <div class="toggleRow tgInsetRow">
          <div>
            <div class="toggleRow__title">{{ t('settings.session_ttl', undefined, 'Session duration') }}</div>
            <div class="toggleRow__sub">{{ currentTTLLabel }}</div>
          </div>
          <div ref="sessionWrapRef" class="tgMenuWrap">
            <button
              type="button"
              class="tgMenuBtn"
              :disabled="saving"
              :aria-haspopup="'listbox'"
              :aria-expanded="sessionMenuOpen"
              :aria-label="t('settings.session_ttl', undefined, 'Session duration')"
              @click="sessionMenuOpen = !sessionMenuOpen"
            >
              <span class="tgMenuBtnLabel">{{ currentTTLLabel }}</span>
              <v-icon icon="mdi-chevron-down" size="16" />
            </button>
            <div v-if="sessionMenuOpen" class="tgMenuPop" role="listbox">
              <button
                v-for="option in SESSION_TTL_OPTIONS"
                :key="String(option.value)"
                type="button"
                class="tgMenuItem"
                :class="{ active: option.value === sessionTTLSeconds }"
                role="option"
                :aria-selected="option.value === sessionTTLSeconds"
                @click="selectSessionTTL(option.value)"
              >
                <span>{{ option.label }}</span>
                <v-icon v-if="option.value === sessionTTLSeconds" icon="mdi-check" size="16" />
              </button>
            </div>
          </div>
        </div>

        <div class="tgDivider" />

        <TGRow
          icon="mdi-email-lock-outline"
          :title="t('settings.email_change', undefined, 'Change email')"
          :value="email || '—'"
          @click="emailOpen = !emailOpen; passwordOpen = false"
        />
        <div v-if="emailOpen" class="tgExpand">
          <v-alert v-if="emailError" type="error" class="mb-4">{{ emailError }}</v-alert>
          <v-btn class="settingsBtn settingsBtn--soft" variant="outlined" rounded="xl" :loading="emailBusy" @click="handleSendOldCode">
            {{ t('settings.email_change_send_old', undefined, 'Send code to current email') }}
          </v-btn>
          <v-text-field v-model="oldCode" :label="t('settings.email_change_old_code', undefined, 'Code from current email')" variant="outlined" rounded="xl" autocomplete="one-time-code" />
          <v-btn class="settingsBtn settingsBtn--primary" color="primary" rounded="xl" :loading="emailBusy" @click="handleVerifyOldCode">
            {{ t('settings.email_change_verify_old', undefined, 'Verify code') }}
          </v-btn>
          <v-text-field v-model="newEmail" :label="t('settings.email_change_new_email', undefined, 'New email')" variant="outlined" rounded="xl" autocomplete="email" :disabled="!oldVerified" />
          <v-btn class="settingsBtn settingsBtn--soft" variant="outlined" rounded="xl" :disabled="!oldVerified" :loading="emailBusy" @click="handleSendNewCode">
            {{ t('settings.email_change_send_new', undefined, 'Send code to new email') }}
          </v-btn>
          <v-text-field v-model="newCode" :label="t('settings.email_change_new_code', undefined, 'Code from new email')" variant="outlined" rounded="xl" autocomplete="one-time-code" :disabled="!oldVerified" />
          <v-btn class="settingsBtn settingsBtn--primary" color="primary" rounded="xl" :disabled="!oldVerified" :loading="emailBusy" @click="handleConfirmNewEmail">
            {{ t('settings.email_change_confirm', undefined, 'Confirm new email') }}
          </v-btn>
        </div>

        <TGRow
          icon="mdi-key-change"
          :title="t('settings.change_password', undefined, 'Change password')"
          :sub="t('settings.change_password_hint', undefined, 'Requires your current password')"
          @click="passwordOpen = !passwordOpen; emailOpen = false"
        />
        <div v-if="passwordOpen" class="tgExpand">
          <v-text-field v-model="currentPassword" :label="t('settings.current_password', undefined, 'Current password')" type="password" variant="outlined" rounded="xl" autocomplete="current-password" />
          <v-text-field v-model="newPassword" :label="t('settings.new_password', undefined, 'New password')" type="password" variant="outlined" rounded="xl" autocomplete="new-password" />
          <v-text-field v-model="confirmPassword" :label="t('settings.confirm_password', undefined, 'Confirm password')" type="password" variant="outlined" rounded="xl" autocomplete="new-password" />
          <v-btn color="primary" rounded="xl" :loading="saving" @click="handleSavePassword">
            {{ t('settings.save_password', undefined, 'Save password') }}
          </v-btn>
        </div>
      </section>

      <section class="tgCard">
        <div class="tgSectionLabel">{{ t('settings.privacy', undefined, 'Privacy') }}</div>
        <div class="toggleRow tgInsetRow">
          <div>
            <div class="toggleRow__title">{{ t('settings.show_last_seen', undefined, 'Show last seen') }}</div>
            <div class="toggleRow__sub">{{ t('settings.show_last_seen_hint', undefined, 'Display your online status and last seen time.') }}</div>
          </div>
          <v-switch :model-value="showLastSeen" hide-details inset color="primary" @update:model-value="handleShowLastSeenChange" />
        </div>
        <div class="tgDivider" />
        <PrivacySettings
          :setting="privacySetting"
          @select="privacySetting = $event"
          @saved="privacySetting = null"
          @cancel="privacySetting = null"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.tgInsetRow {
  margin: 0 8px;
}

.toggleRow.tgInsetRow + .toggleRow.tgInsetRow {
  margin-top: 10px;
}

.tgBackRow {
  border: 1px solid var(--border);
  background: var(--surface);
}

.tgExpand {
  display: grid;
  gap: 10px;
  padding: 4px 12px 12px;
  justify-items: stretch;
}
</style>
