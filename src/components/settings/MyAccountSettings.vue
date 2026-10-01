<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ComboxClient, getCurrentUser, normalizeBirthDate, type AuthUser, type ProfileUpdateInput } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { normalizeAvatarSrc } from '../../utils/avatar'
import { openAvatarPreview } from '../../utils/avatarViewer'
import TGRow from './TGRow.vue'
import './settingsShared.css'

const USERNAME_RE = /^[a-z0-9_]{4,32}$/
const MAX_BIO = 70
const MAX_NAME = 64
const MAX_PHONE = 32

type DialogKind = 'name' | 'username' | 'phone' | 'birthday' | 'bio' | null

const { t } = useI18n()
const toast = useToast()
const client = new ComboxClient()

const loading = ref(true)
const loadError = ref('')
const profile = ref<AuthUser | null>(null)
const dialog = ref<DialogKind>(null)
const dialogError = ref('')
const saving = ref(false)
const avatarSaving = ref(false)

const draftFirst = ref('')
const draftLast = ref('')
const draftUsername = ref('')
const draftPhone = ref('')
const draftBirthday = ref('')
const draftBio = ref('')

const displayName = computed(() => {
  const p = profile.value
  const full = `${p?.first_name || ''} ${p?.last_name || ''}`.trim()
  return full || `@${p?.username || ''}` || t('settings.title', undefined, 'Settings')
})

const initials = computed(() => {
  const p = profile.value
  const first = (p?.first_name || '').trim().slice(0, 1).toUpperCase()
  const last = (p?.last_name || '').trim().slice(0, 1).toUpperCase()
  return `${first}${last}`.trim() || (p?.username || '?').slice(0, 1).toUpperCase()
})

const avatarSrc = computed(() => normalizeAvatarSrc(profile.value?.avatar_data_url || ''))

const avatarInput = ref<HTMLInputElement | null>(null)

function ownUserId(): string {
  return (profile.value?.id || '').trim() || (getCurrentUser()?.id || '').trim()
}

function openOwnAvatar(): void {
  const ownerId = ownUserId()
  if (!ownerId) return
  openAvatarPreview(avatarSrc.value, displayName.value, { ownerId, ownerKind: 'user' })
}

function triggerAvatarPick(): void {
  avatarInput.value?.click()
}

function formatBirthday(value: string): string {
  return value || t('settings.tg.account.birthday_empty', undefined, 'Not set')
}

function openDialog(kind: Exclude<DialogKind, null>): void {
  const p = profile.value
  dialogError.value = ''
  draftFirst.value = p?.first_name || ''
  draftLast.value = p?.last_name || ''
  draftUsername.value = p?.username || ''
  draftPhone.value = p?.phone_number || ''
  draftBirthday.value = p?.birth_date || ''
  draftBio.value = p?.bio || ''
  dialog.value = kind
}

function closeDialog(): void {
  dialog.value = null
  dialogError.value = ''
}

function handleUsernameInput(value: string): void {
  draftUsername.value = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32)
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    profile.value = await client.getProfile()
  } catch (caught) {
    loadError.value = caught instanceof Error ? caught.message : t('settings.load_failed', undefined, 'Failed to load settings')
  } finally {
    loading.value = false
  }
}

async function savePatch(patch: ProfileUpdateInput): Promise<boolean> {
  saving.value = true
  dialogError.value = ''
  try {
    profile.value = await client.updateProfile(patch)
    toast.success(t('settings.profile_saved', undefined, 'Profile saved'))
    closeDialog()
    return true
  } catch (caught) {
    dialogError.value = caught instanceof Error ? caught.message : t('settings.profile_update_failed', undefined, 'Profile update failed')
    return false
  } finally {
    saving.value = false
  }
}

async function saveDialog(): Promise<void> {
  if (!dialog.value || saving.value) return
  if (dialog.value === 'name') {
    const first = draftFirst.value.trim().slice(0, MAX_NAME)
    if (!first) {
      dialogError.value = t('auth.error_first_name_required', undefined, 'Enter first name')
      return
    }
    await savePatch({ first_name: first, last_name: draftLast.value.trim().slice(0, MAX_NAME) })
    return
  }
  if (dialog.value === 'username') {
    const normalized = draftUsername.value.trim().toLowerCase()
    if (!USERNAME_RE.test(normalized)) {
      dialogError.value = t('auth.error_username_invalid', undefined, 'Username must be 4-32 chars: a-z, 0-9 and _')
      return
    }
    await savePatch({ username: normalized })
    return
  }
  if (dialog.value === 'phone') {
    await savePatch({ phone_number: draftPhone.value.trim().slice(0, MAX_PHONE) })
    return
  }
  if (dialog.value === 'birthday') {
    // normalizeBirthDate: '' clears, valid shapes pass through, anything else is null.
    const normalized = normalizeBirthDate(draftBirthday.value.trim())
    if (normalized === null) {
      dialogError.value = t('settings.tg.account.birthday_invalid', undefined, 'Use YYYY-MM-DD or DD.MM.YYYY, or clear the field')
      return
    }
    await savePatch({ birth_date: normalized })
    return
  }
  await savePatch({ bio: draftBio.value.trim().slice(0, MAX_BIO) })
}

async function pickAvatar(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || avatarSaving.value) return
  if (!file.type.startsWith('image/')) return
  avatarSaving.value = true
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(new Error('read_failed'))
      reader.readAsDataURL(file)
    })
    if (!dataUrl) throw new Error('read_failed')
    profile.value = await client.updateProfile({ avatar_data_url: dataUrl })
    toast.success(t('settings.profile_saved', undefined, 'Profile saved'))
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : t('settings.avatar_read_failed', undefined, 'Failed to read the image.'))
  } finally {
    avatarSaving.value = false
  }
}

async function removeAvatar(): Promise<void> {
  if (avatarSaving.value || !profile.value?.avatar_data_url) return
  avatarSaving.value = true
  try {
    profile.value = await client.updateProfile({ avatar_data_url: '' })
    toast.success(t('settings.profile_saved', undefined, 'Profile saved'))
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : t('settings.profile_update_failed', undefined, 'Profile update failed'))
  } finally {
    avatarSaving.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="tgPage">
    <v-alert v-if="loadError" type="error">{{ loadError }}</v-alert>

    <section class="tgHero">
      <div class="tgAvatarPick">
        <input ref="avatarInput" type="file" accept="image/*" class="avatarFileInput" @change="pickAvatar" />
        <button
          type="button"
          class="tgAvatarBtn"
          :aria-label="t('settings.avatar_upload', undefined, 'Upload avatar')"
          :title="displayName"
          @click="openOwnAvatar"
        >
          <span class="tgHeroAvatar">
            <img v-if="avatarSrc" :src="avatarSrc" alt="" class="tgHeroAvatarImg" />
            <span v-else>{{ initials }}</span>
          </span>
        </button>
        <button
          type="button"
          class="tgAvatarCam"
          :aria-label="t('settings.avatar_upload', undefined, 'Upload avatar')"
          :title="t('settings.avatar_upload', undefined, 'Upload avatar')"
          @click="triggerAvatarPick"
        >
          <v-icon icon="mdi-camera-plus-outline" size="18" />
        </button>
      </div>
      <div class="tgHeroMain">
        <div class="tgHeroName">{{ loading ? '…' : displayName }}</div>
        <div class="tgHeroSub">@{{ profile?.username || 'username' }}</div>
        <div class="tgHeroStatus">{{ t('settings.status_online', undefined, 'Active & running') }}</div>
      </div>
      <button
        v-if="avatarSrc"
        type="button"
        class="tgBtnGhost tgBtn tgBtnSm"
        :disabled="avatarSaving"
        @click="removeAvatar"
      >
        {{ t('settings.avatar_remove', undefined, 'Remove avatar') }}
      </button>
    </section>

    <section class="tgCard">
      <div class="tgSectionLabel">{{ t('settings.tg.account.info', undefined, 'Info') }}</div>
      <TGRow
        icon="mdi-account-outline"
        :title="t('settings.tg.account.name', undefined, 'Name')"
        :value="displayName"
        @click="openDialog('name')"
      />
      <TGRow
        icon="mdi-card-account-details-outline"
        :title="t('settings.bio', undefined, 'Bio')"
        :sub="t('settings.tg.account.bio_hint', undefined, 'A short line about yourself')"
        :value="`${(profile?.bio || '').length}/${MAX_BIO}`"
        @click="openDialog('bio')"
      />
      <div class="tgDivider" />
      <TGRow
        icon="mdi-phone-outline"
        :title="t('settings.phone', undefined, 'Phone number')"
        :value="profile?.phone_number || t('settings.phone_empty', undefined, 'Not set')"
        @click="openDialog('phone')"
      />
      <TGRow
        icon="mdi-at"
        :title="t('settings.username', undefined, 'Username')"
        :value="`@${profile?.username || 'username'}`"
        @click="openDialog('username')"
      />
      <TGRow
        icon="mdi-cake-outline"
        :title="t('settings.birth_date', undefined, 'Birth date')"
        :value="formatBirthday(profile?.birth_date || '')"
        @click="openDialog('birthday')"
      />
    </section>

    <Teleport to="body">
      <div v-if="dialog" class="tgModalOverlay" @click.self="closeDialog">
        <div class="tgModal" role="dialog" aria-modal="true">
          <div class="tgModalTitle">
            <template v-if="dialog === 'name'">{{ t('settings.tg.account.edit_name', undefined, 'Edit name') }}</template>
            <template v-else-if="dialog === 'username'">{{ t('settings.tg.account.edit_username', undefined, 'Edit username') }}</template>
            <template v-else-if="dialog === 'phone'">{{ t('settings.tg.account.edit_phone', undefined, 'Edit phone') }}</template>
            <template v-else-if="dialog === 'birthday'">{{ t('settings.tg.account.edit_birthday', undefined, 'Edit birthday') }}</template>
            <template v-else>{{ t('settings.tg.account.edit_bio', undefined, 'Edit bio') }}</template>
          </div>

          <v-alert v-if="dialogError" type="error">{{ dialogError }}</v-alert>

          <template v-if="dialog === 'name'">
            <v-text-field v-model="draftFirst" :label="t('settings.first_name', undefined, 'First name')" variant="outlined" rounded="xl" maxlength="64" counter="64" autocomplete="given-name" />
            <v-text-field v-model="draftLast" :label="t('settings.last_name', undefined, 'Last name')" variant="outlined" rounded="xl" maxlength="64" counter="64" :hint="t('settings.tg.account.last_clear', undefined, 'Empty clears the last name')" persistent-hint autocomplete="family-name" />
          </template>
          <template v-else-if="dialog === 'username'">
            <v-text-field :model-value="draftUsername" :label="t('settings.username', undefined, 'Username')" variant="outlined" rounded="xl" prefix="@" autocomplete="username" :hint="t('settings.tg.account.username_hint', undefined, '4-32 chars: a-z, 0-9 and _')" persistent-hint @update:model-value="handleUsernameInput" />
          </template>
          <template v-else-if="dialog === 'phone'">
            <v-text-field v-model="draftPhone" :label="t('settings.phone', undefined, 'Phone number')" variant="outlined" rounded="xl" maxlength="32" counter="32" autocomplete="tel" />
          </template>
          <template v-else-if="dialog === 'birthday'">
            <v-text-field v-model="draftBirthday" type="date" :label="t('settings.birth_date', undefined, 'Birth date')" variant="outlined" rounded="xl" class="tgDateField" :hint="t('settings.tg.account.birthday_hint', undefined, 'Pick a date from the calendar. Empty clears it.')" persistent-hint autocomplete="bday" />
          </template>
          <template v-else>
            <v-textarea v-model="draftBio" :label="t('settings.bio', undefined, 'Bio')" variant="outlined" rounded="xl" rows="2" maxlength="70" counter="70" :hint="t('settings.bio_hint', undefined, 'A short line about yourself')" persistent-hint />
          </template>

          <div class="tgModalActions">
            <button type="button" class="tgBtn tgBtnGhost" :disabled="saving" @click="closeDialog">
              {{ t('common.cancel', undefined, 'Cancel') }}
            </button>
            <button type="button" class="tgBtn tgBtnPrimary" :disabled="saving" @click="saveDialog">
              <v-progress-circular v-if="saving" indeterminate :size="14" :width="2" />
              {{ t('common.save', undefined, 'Save') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.tgAvatarPick {
  position: relative;
  flex: 0 0 auto;
}

.avatarFileInput {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.tgAvatarBtn {
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: block;
}

.tgAvatarCam {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  border: 2px solid var(--surface);
  cursor: pointer;
}

.tgBtnSm {
  min-height: 32px;
  padding: 0 12px;
  font-size: 12.5px;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
}

/* Native date picker must follow the app theme (dark calendar in dark mode). */
.tgDateField :is(input) {
  color-scheme: light dark;
}
</style>
