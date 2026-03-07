<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ComboxClient, type ProfileUpdateInput } from 'combox-api'
import PageShell from '../components/core/PageShell.vue'
import { useI18n } from '../i18n/i18n'
import { normalizeAvatarSrc } from '../utils/avatar'

const USERNAME_RE = /^[a-z0-9_]{4,32}$/
const client = new ComboxClient()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const editMode = ref(false)
const errorText = ref('')
const notice = ref('')
const username = ref('')
const firstName = ref('')
const lastName = ref('')
const birthDate = ref('')
const email = ref('')
const avatarDataUrl = ref('')
const avatarDirty = ref(false)
const showLastSeen = ref(true)
const emailBusy = ref(false)
const oldCode = ref('')
const oldVerified = ref(false)
const newEmail = ref('')
const newCode = ref('')
const emailError = ref('')

const initials = computed(() => {
  const first = firstName.value.trim().slice(0, 1).toUpperCase()
  const last = lastName.value.trim().slice(0, 1).toUpperCase()
  return `${first}${last}`.trim() || (username.value.trim().slice(0, 1).toUpperCase() || '?')
})

const displayName = computed(() => `${firstName.value} ${lastName.value}`.trim() || username.value || t('settings.title'))
const birthdayText = computed(() => {
  const raw = birthDate.value.trim()
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
})

function handleUsernameInput(value: string) {
  username.value = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32)
}

function removeAvatar() {
  avatarDataUrl.value = ''
  avatarDirty.value = true
}

function handleAvatarUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    avatarDataUrl.value = typeof reader.result === 'string' ? reader.result : ''
    avatarDirty.value = true
  }
  reader.readAsDataURL(file)
}

async function loadSettings() {
  loading.value = true
  errorText.value = ''
  try {
    const [profile, settings] = await Promise.all([client.getProfile(), client.getProfileSettings()])
    username.value = profile.username || ''
    firstName.value = profile.first_name || ''
    lastName.value = profile.last_name || ''
    birthDate.value = profile.birth_date || ''
    email.value = profile.email || ''
    showLastSeen.value = settings.show_last_seen ?? true
    avatarDataUrl.value = normalizeAvatarSrc(profile.avatar_data_url || '')
    avatarDirty.value = false
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : t('settings.load_failed')
  } finally {
    loading.value = false
  }
}

async function handleSaveProfile() {
  saving.value = true
  errorText.value = ''
  notice.value = ''
  const normalizedUsername = username.value.trim().toLowerCase()
  if (!USERNAME_RE.test(normalizedUsername)) {
    saving.value = false
    errorText.value = t('auth.error_username_invalid')
    return
  }
  if (!firstName.value.trim()) {
    saving.value = false
    errorText.value = t('auth.error_first_name_required')
    return
  }

  const payload: ProfileUpdateInput = {
    username: normalizedUsername,
    first_name: firstName.value.trim(),
    last_name: lastName.value.trim(),
    birth_date: birthDate.value.trim(),
  }
  if (avatarDirty.value) payload.avatar_data_url = avatarDataUrl.value.trim()

  try {
    const updated = await client.updateProfile(payload)
    username.value = updated.username || ''
    firstName.value = updated.first_name || ''
    lastName.value = updated.last_name || ''
    birthDate.value = updated.birth_date || ''
    email.value = updated.email || ''
    avatarDirty.value = false
    notice.value = t('settings.profile_saved')
    editMode.value = false
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : t('settings.profile_update_failed')
  } finally {
    saving.value = false
  }
}

async function handleShowLastSeenChange(next: boolean | null) {
  if (next === null) return
  const prev = showLastSeen.value
  showLastSeen.value = next
  try {
    await client.updateProfileSettings(next)
  } catch {
    showLastSeen.value = prev
  }
}

async function handleSendOldCode() {
  emailBusy.value = true
  emailError.value = ''
  try {
    await client.startEmailChange()
  } catch (error) {
    emailError.value = error instanceof Error ? error.message : t('settings.send_code_failed')
  } finally {
    emailBusy.value = false
  }
}

async function handleVerifyOldCode() {
  emailBusy.value = true
  emailError.value = ''
  try {
    const ok = await client.verifyOldEmailCode(oldCode.value.trim())
    oldVerified.value = ok
    if (!ok) emailError.value = t('auth.error_code_invalid')
  } catch (error) {
    emailError.value = error instanceof Error ? error.message : t('settings.verify_code_failed')
  } finally {
    emailBusy.value = false
  }
}

async function handleSendNewCode() {
  emailBusy.value = true
  emailError.value = ''
  try {
    await client.sendNewEmailCode(newEmail.value.trim().toLowerCase())
  } catch (error) {
    emailError.value = error instanceof Error ? error.message : t('settings.send_code_failed')
  } finally {
    emailBusy.value = false
  }
}

async function handleConfirmNewEmail() {
  emailBusy.value = true
  emailError.value = ''
  try {
    const updated = await client.confirmEmailChange(newCode.value.trim())
    email.value = updated.email || ''
    oldVerified.value = false
    oldCode.value = ''
    newEmail.value = ''
    newCode.value = ''
    notice.value = t('settings.email_changed')
  } catch (error) {
    emailError.value = error instanceof Error ? error.message : t('settings.email_change_failed')
  } finally {
    emailBusy.value = false
  }
}

onMounted(() => {
  void loadSettings()
})
</script>

<template>
  <PageShell>
    <v-container class="settingsPage py-6" style="max-width: 960px">
      <v-progress-linear v-if="loading" indeterminate />

      <template v-else>
        <section class="settingsShell">
          <header class="settingsTopbar">
            <div class="settingsTopbar__title">{{ editMode ? t('settings.edit_profile', undefined, 'Edit profile') : t('settings.title') }}</div>
            <div class="settingsTopbar__actions">
              <button v-if="editMode" type="button" class="settingsIconBtn" @click="editMode = false">
                <v-icon icon="mdi-arrow-left" size="18" />
              </button>
              <button v-else type="button" class="settingsIconBtn" @click="editMode = true">
                <v-icon icon="mdi-pencil-outline" size="18" />
              </button>
            </div>
          </header>

          <v-alert v-if="errorText" type="error" class="mb-4">{{ errorText }}</v-alert>
          <v-alert v-if="notice" type="success" class="mb-4">{{ notice }}</v-alert>

          <template v-if="!editMode">
            <section class="profileHero">
              <div class="profileHero__ornament profileHero__ornament--left" />
              <div class="profileHero__ornament profileHero__ornament--right" />
              <div v-if="avatarDataUrl" class="profileAvatar">
                <img :src="avatarDataUrl" alt="" class="profileAvatar__img" />
              </div>
              <div v-else class="profileAvatar profileAvatar--fallback">{{ initials }}</div>
              <div class="profileHero__name">{{ displayName }}</div>
              <div class="profileHero__status">{{ showLastSeen ? t('presence.online') : t('presence.offline') }}</div>
            </section>

            <section class="settingsGrid">
              <article class="settingsCard settingsCard--info">
                <div class="settingsCard__title">{{ t('settings.profile') }}</div>
                <div class="infoList">
                  <div class="infoRow">
                    <div class="infoRow__icon"><v-icon icon="mdi-at" size="18" /></div>
                    <div class="infoRow__body">
                      <div class="infoRow__value">@{{ username || 'username' }}</div>
                      <div class="infoRow__label">{{ t('settings.username') }}</div>
                    </div>
                  </div>
                  <div class="infoRow">
                    <div class="infoRow__icon"><v-icon icon="mdi-email-outline" size="18" /></div>
                    <div class="infoRow__body">
                      <div class="infoRow__value">{{ email || '—' }}</div>
                      <div class="infoRow__label">{{ t('settings.email') }}</div>
                    </div>
                  </div>
                  <div class="infoRow">
                    <div class="infoRow__icon"><v-icon icon="mdi-cake-variant-outline" size="18" /></div>
                    <div class="infoRow__body">
                      <div class="infoRow__value">{{ birthdayText }}</div>
                      <div class="infoRow__label">{{ t('settings.birth_date') }}</div>
                    </div>
                  </div>
                </div>
              </article>

              <article class="settingsCard">
                <div class="settingsCard__title">{{ t('settings.privacy') }}</div>
                <div class="settingsSectionText">{{ t('settings.privacy_hint', undefined, 'Control what other people can see about your profile.') }}</div>
                <div class="toggleRow">
                  <div>
                    <div class="toggleRow__title">{{ t('settings.show_last_seen') }}</div>
                    <div class="toggleRow__sub">{{ t('settings.show_last_seen_hint', undefined, 'Display your online status and last seen time.') }}</div>
                  </div>
                  <v-switch :model-value="showLastSeen" hide-details inset color="primary" @update:model-value="handleShowLastSeenChange" />
                </div>
              </article>

              <article class="settingsCard settingsCard--full">
                <div class="settingsCard__title">{{ t('settings.email_change') }}</div>
                <div class="settingsSectionText">{{ t('settings.email_change_hint', undefined, 'Verify your current email first, then confirm the new address.') }}</div>
                <v-alert v-if="emailError" type="error" class="mb-4">{{ emailError }}</v-alert>

                <div class="emailFlow">
                  <div class="emailStep">
                    <div class="emailStep__head">
                      <div class="emailStep__badge">1</div>
                      <div class="emailStep__title">{{ t('settings.email_change_send_old') }}</div>
                    </div>
                    <div class="emailStep__body">
                      <v-btn class="settingsBtn settingsBtn--soft" variant="outlined" rounded="xl" :loading="emailBusy" @click="handleSendOldCode">
                        {{ t('settings.email_change_send_old') }}
                      </v-btn>
                      <v-text-field v-model="oldCode" class="settingsField" :label="t('settings.email_change_old_code')" variant="outlined" rounded="xl" />
                      <v-btn class="settingsBtn settingsBtn--primary" color="primary" rounded="xl" :loading="emailBusy" @click="handleVerifyOldCode">
                        {{ t('settings.email_change_verify_old') }}
                      </v-btn>
                    </div>
                  </div>

                  <div class="emailStep">
                    <div class="emailStep__head">
                      <div class="emailStep__badge">2</div>
                      <div class="emailStep__title">{{ t('settings.email_change_new_email') }}</div>
                    </div>
                    <div class="emailStep__body">
                      <v-text-field v-model="newEmail" class="settingsField" :label="t('settings.email_change_new_email')" variant="outlined" rounded="xl" :disabled="!oldVerified" />
                      <v-btn class="settingsBtn settingsBtn--soft" variant="outlined" rounded="xl" :disabled="!oldVerified" :loading="emailBusy" @click="handleSendNewCode">
                        {{ t('settings.email_change_send_new') }}
                      </v-btn>
                      <v-text-field v-model="newCode" class="settingsField" :label="t('settings.email_change_new_code')" variant="outlined" rounded="xl" :disabled="!oldVerified" />
                      <v-btn class="settingsBtn settingsBtn--primary" color="primary" rounded="xl" :disabled="!oldVerified" :loading="emailBusy" @click="handleConfirmNewEmail">
                        {{ t('settings.email_change_confirm') }}
                      </v-btn>
                    </div>
                  </div>
                </div>
              </article>
            </section>
          </template>

          <template v-else>
            <section class="editHero">
              <label class="editAvatarPicker">
                <div v-if="avatarDataUrl" class="profileAvatar profileAvatar--edit">
                  <img :src="avatarDataUrl" alt="" class="profileAvatar__img" />
                </div>
                <div v-else class="profileAvatar profileAvatar--fallback profileAvatar--edit">{{ initials }}</div>
                <div class="editAvatarPicker__overlay">
                  <v-icon icon="mdi-camera-plus-outline" size="28" />
                </div>
                <input hidden type="file" accept="image/*" @change="handleAvatarUpload" />
              </label>
            </section>

            <section class="settingsGrid settingsGrid--edit">
              <article class="settingsCard settingsCard--full">
                <div class="settingsCard__title">{{ t('settings.profile') }}</div>
                <div class="editFields">
                  <v-text-field v-model="firstName" class="settingsField" :label="t('settings.first_name')" variant="outlined" rounded="xl" />
                  <v-text-field v-model="lastName" class="settingsField" :label="t('settings.last_name')" variant="outlined" rounded="xl" />
                  <v-text-field :model-value="username" class="settingsField" :label="t('settings.username')" variant="outlined" rounded="xl" @update:model-value="handleUsernameInput" />
                  <v-text-field v-model="birthDate" class="settingsField" :label="t('settings.birth_date')" type="date" variant="outlined" rounded="xl" />
                </div>
                <div class="editActions">
                  <v-btn variant="text" class="settingsBtn" color="error" @click="removeAvatar">{{ t('settings.avatar_remove') }}</v-btn>
                  <v-btn color="primary" class="settingsBtn settingsBtn--primary" rounded="xl" :loading="saving" @click="handleSaveProfile">{{ t('settings.save_profile') }}</v-btn>
                </div>
              </article>

              <article class="settingsCard">
                <div class="settingsCard__title">{{ t('settings.email') }}</div>
                <v-text-field v-model="email" class="settingsField" :label="t('settings.email')" variant="outlined" rounded="xl" disabled />
              </article>

              <article class="settingsCard">
                <div class="settingsCard__title">{{ t('settings.privacy') }}</div>
                <div class="toggleRow">
                  <div>
                    <div class="toggleRow__title">{{ t('settings.show_last_seen') }}</div>
                    <div class="toggleRow__sub">{{ t('settings.show_last_seen_hint', undefined, 'Display your online status and last seen time.') }}</div>
                  </div>
                  <v-switch :model-value="showLastSeen" hide-details inset color="primary" @update:model-value="handleShowLastSeenChange" />
                </div>
              </article>
            </section>
          </template>
        </section>
      </template>
    </v-container>
  </PageShell>
</template>

<style scoped>
.settingsPage {
  color: var(--text);
}

.settingsShell {
  display: grid;
  gap: 18px;
}

.settingsTopbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settingsTopbar__title {
  font-size: 2rem;
  line-height: 1.02;
  font-weight: 900;
  letter-spacing: -.04em;
}

.settingsTopbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settingsIconBtn {
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.settingsIconBtn:hover {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.profileHero {
  position: relative;
  overflow: hidden;
  padding: 34px 24px 26px;
  border-radius: 32px;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.22), transparent 28%),
    radial-gradient(circle at bottom right, rgba(255, 255, 255, 0.2), transparent 26%),
    linear-gradient(135deg, #9d77d8 0%, #8c6ed4 38%, #b386e0 100%);
  box-shadow: 0 20px 44px rgba(140, 110, 212, 0.24);
  display: grid;
  justify-items: center;
  gap: 10px;
  color: #fff;
}

.profileHero__ornament {
  position: absolute;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  filter: blur(8px);
  opacity: 0.18;
  background: rgba(255, 255, 255, 0.9);
}

.profileHero__ornament--left {
  left: -14px;
  top: -18px;
}

.profileHero__ornament--right {
  right: -10px;
  bottom: -14px;
}

.profileAvatar {
  width: 108px;
  height: 108px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  z-index: 1;
  box-shadow: 0 16px 28px rgba(15, 23, 42, 0.18);
}

.profileAvatar--edit {
  width: 116px;
  height: 116px;
}

.profileAvatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.profileAvatar--fallback {
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: 2.2rem;
  font-weight: 800;
  letter-spacing: -.04em;
}

.profileHero__name {
  position: relative;
  z-index: 1;
  font-size: 2rem;
  line-height: 1.02;
  font-weight: 900;
  letter-spacing: -.05em;
  text-align: center;
}

.profileHero__status {
  position: relative;
  z-index: 1;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: .95rem;
  font-weight: 600;
}

.settingsGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.settingsGrid--edit {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.settingsCard {
  border: 1px solid var(--border);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: var(--shadow-soft);
  padding: 20px;
}

.settingsCard--full,
.settingsCard--info {
  grid-column: 1 / -1;
}

.settingsCard__title {
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: -.02em;
  margin-bottom: 14px;
}

.settingsSectionText {
  color: var(--text-muted);
  font-size: .95rem;
  line-height: 1.45;
  margin-bottom: 14px;
  max-width: 58ch;
}

.infoList {
  display: grid;
  gap: 12px;
}

.infoRow {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 14px 16px;
  border-radius: 22px;
  background: var(--surface-soft);
}

.infoRow__icon {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: rgba(148, 163, 184, 0.14);
  color: var(--accent-strong);
}

.infoRow__value {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
}

.infoRow__label {
  margin-top: 2px;
  font-size: .86rem;
  color: var(--text-muted);
}

.toggleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-radius: 22px;
  background: var(--surface-soft);
}

.toggleRow__title {
  font-size: 1rem;
  font-weight: 700;
}

.toggleRow__sub {
  margin-top: 2px;
  color: var(--text-muted);
  font-size: .88rem;
  line-height: 1.4;
}

.emailFlow {
  display: grid;
  gap: 16px;
}

.emailStep {
  padding: 16px;
  border-radius: 24px;
  background: var(--surface-soft);
}

.emailStep__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.emailStep__badge {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  font-size: .85rem;
  font-weight: 800;
}

.emailStep__title {
  font-weight: 700;
}

.emailStep__body {
  display: grid;
  gap: 12px;
}

.editHero {
  display: grid;
  justify-items: center;
  padding: 10px 0 4px;
}

.editAvatarPicker {
  position: relative;
  cursor: pointer;
}

.editAvatarPicker__overlay {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.26);
  color: #fff;
}

.editFields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.editActions {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.settingsBtn {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 700;
}

.settingsBtn--primary {
  box-shadow: none;
}

.settingsBtn--soft {
  background: rgba(148, 163, 184, 0.08);
}

@media (max-width: 900px) {
  .settingsGrid,
  .settingsGrid--edit,
  .editFields {
    grid-template-columns: 1fr;
  }

  .profileHero {
    padding-inline: 18px;
  }

  .profileHero__name {
    font-size: 1.7rem;
  }

  .editActions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
