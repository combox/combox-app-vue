<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../../i18n/i18n'

const props = defineProps<{
  currentUserAvatarSrc: string
  currentUserDisplayName: string
  currentUsername: string
  currentBirthDate: string
  settingsLoading: boolean
  settingsSaving: boolean
  settingsError: string
  settingsSuccess: string
  profileDraft: { first_name: string; last_name: string; username: string; birth_date: string }
  sessionIdleDays: number
  passwordDraft: { current: string; next: string }
  passwordSaving: boolean
  emailDraft: { email: string; oldCode: string; newCode: string }
  emailStep: 'old' | 'new' | 'confirm'
  emailBusy: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:session-days', value: number): void
  (e: 'save-profile'): void
  (e: 'save-password'): void
  (e: 'start-email-flow'): void
  (e: 'verify-old-code'): void
  (e: 'send-new-email-code'): void
  (e: 'confirm-new-email'): void
}>()

const editMode = ref(false)
const { t } = useI18n()

const initials = computed(() => {
  const first = props.profileDraft.first_name.trim().slice(0, 1).toUpperCase()
  const last = props.profileDraft.last_name.trim().slice(0, 1).toUpperCase()
  return `${first}${last}`.trim() || (props.currentUsername || props.currentUserDisplayName || t('settings.user_fallback')).slice(0, 1).toUpperCase()
})

const displayName = computed(() => {
  const draft = `${props.profileDraft.first_name} ${props.profileDraft.last_name}`.trim()
  return draft || props.currentUserDisplayName || props.currentUsername || t('settings.user_fallback')
})

const birthdayText = computed(() => {
  const raw = (props.profileDraft.birth_date || props.currentBirthDate || '').trim()
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
})

function handleBack() {
  if (editMode.value) {
    editMode.value = false
    return
  }
  emit('close')
}
</script>

<template>
  <div class="spRoot">
    <header class="spHeader">
      <button type="button" class="spIconBtn" :aria-label="t('chat.back')" @click="handleBack">
        <v-icon icon="mdi-arrow-left" size="18" />
      </button>
      <div class="spTitle">{{ editMode ? t('settings.edit_profile') : t('settings.title') }}</div>
      <div class="spHeaderActions">
        <button v-if="!editMode" type="button" class="spIconBtn" :aria-label="t('settings.edit_profile')" @click="editMode = true">
          <v-icon icon="mdi-pencil-outline" size="18" />
        </button>
      </div>
    </header>

    <div class="spScroll">
      <div v-if="settingsError" class="spAlert spAlert--error">{{ settingsError }}</div>
      <div v-if="settingsSuccess" class="spAlert spAlert--success">{{ settingsSuccess }}</div>

      <template v-if="!editMode">
        <section class="spHeroView">
          <div v-if="currentUserAvatarSrc" class="spHeroAvatar">
            <img :src="currentUserAvatarSrc" alt="" class="spAvatarImg" />
          </div>
          <div v-else class="spHeroAvatar spHeroAvatar--fallback">{{ initials }}</div>
          <div class="spHeroName">{{ displayName }}</div>
          <div class="spHeroStatus">{{ t('settings.online') }}</div>
        </section>

        <section class="spInfoList">
          <article class="spInfoRow">
            <div class="spInfoIcon"><v-icon icon="mdi-at" size="20" /></div>
            <div class="spInfoBody">
              <div class="spInfoValue">@{{ props.profileDraft.username || props.currentUsername || t('settings.username').toLowerCase() }}</div>
              <div class="spInfoLabel">{{ t('settings.username') }}</div>
            </div>
          </article>

          <article class="spInfoRow">
            <div class="spInfoIcon"><v-icon icon="mdi-cake-variant-outline" size="20" /></div>
            <div class="spInfoBody">
              <div class="spInfoValue">{{ birthdayText }}</div>
              <div class="spInfoLabel">{{ t('settings.birth_date') }}</div>
            </div>
          </article>

          <article class="spInfoRow">
            <div class="spInfoIcon"><v-icon icon="mdi-timer-outline" size="20" /></div>
            <div class="spInfoBody">
              <div class="spInfoValue">{{ t('settings.session_duration_days', { count: props.sessionIdleDays }, `${props.sessionIdleDays} days`) }}</div>
              <div class="spInfoLabel">{{ t('settings.session_duration') }}</div>
            </div>
          </article>
        </section>
      </template>

      <template v-else>
        <section class="spEditHero">
          <div v-if="currentUserAvatarSrc" class="spEditAvatar">
            <img :src="currentUserAvatarSrc" alt="" class="spAvatarImg" />
            <div class="spEditAvatarOverlay"><v-icon icon="mdi-camera-plus-outline" size="34" /></div>
          </div>
          <div v-else class="spEditAvatar spHeroAvatar--fallback">
            {{ initials }}
            <div class="spEditAvatarOverlay"><v-icon icon="mdi-camera-plus-outline" size="34" /></div>
          </div>
        </section>

        <section class="spSection">
          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.first_name') }}</span>
            <input v-model="profileDraft.first_name" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.last_name') }}</span>
            <input v-model="profileDraft.last_name" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.username') }}</span>
            <input v-model="profileDraft.username" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.birth_date') }}</span>
            <input v-model="profileDraft.birth_date" type="date" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.session_duration') }}</span>
            <input
              :value="sessionIdleDays"
              type="number"
              min="1"
              max="365"
              class="spInput"
              :disabled="settingsLoading || settingsSaving"
              @input="$emit('update:session-days', Number(($event.target as HTMLInputElement).value || 1))"
            />
          </label>

          <button type="button" class="spBtn spBtn--primary" :disabled="settingsLoading || settingsSaving" @click="emit('save-profile')">
            {{ settingsSaving ? t('settings.save_profile_busy') : t('settings.save_profile') }}
          </button>
        </section>

        <section class="spSection">
          <div class="spSectionTitle">{{ t('settings.password') }}</div>
          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.current_password') }}</span>
            <input v-model="passwordDraft.current" type="password" class="spInput" :disabled="passwordSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.new_password') }}</span>
            <input v-model="passwordDraft.next" type="password" class="spInput" :disabled="passwordSaving" />
          </label>

          <button type="button" class="spBtn spBtn--primary" :disabled="passwordSaving" @click="emit('save-password')">
            {{ passwordSaving ? t('settings.changing_password') : t('settings.change_password') }}
          </button>
        </section>

        <section class="spSection">
          <div class="spSectionTitle">{{ t('settings.email_change') }}</div>
          <div class="spHint">{{ t('settings.email_change_intro') }}</div>

          <template v-if="emailStep === 'old'">
            <button
              v-if="!emailDraft.oldCode"
              type="button"
              class="spBtn spBtn--soft"
              :disabled="emailBusy"
              @click="emit('start-email-flow')"
            >
              {{ emailBusy ? t('settings.sending') : t('settings.send_code_current') }}
            </button>
            <label class="spField">
              <span class="spFieldLabel">{{ t('settings.code_current') }}</span>
              <input v-model="emailDraft.oldCode" class="spInput" :disabled="emailBusy" />
            </label>
            <button type="button" class="spBtn spBtn--primary" :disabled="emailBusy" @click="emit('verify-old-code')">
              {{ emailBusy ? t('settings.checking') : t('settings.verify_old_email_code') }}
            </button>
          </template>

          <template v-else-if="emailStep === 'new'">
            <label class="spField">
              <span class="spFieldLabel">{{ t('settings.new_email') }}</span>
              <input v-model="emailDraft.email" class="spInput" :disabled="emailBusy" />
            </label>
            <button type="button" class="spBtn spBtn--primary" :disabled="emailBusy" @click="emit('send-new-email-code')">
              {{ emailBusy ? t('settings.sending') : t('settings.send_code_new') }}
            </button>
          </template>

          <template v-else>
            <label class="spField">
              <span class="spFieldLabel">{{ t('settings.code_new') }}</span>
              <input v-model="emailDraft.newCode" class="spInput" :disabled="emailBusy" />
            </label>
            <button type="button" class="spBtn spBtn--primary" :disabled="emailBusy" @click="emit('confirm-new-email')">
              {{ emailBusy ? t('settings.confirming') : t('settings.confirm_email_change') }}
            </button>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.spRoot {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--surface-strong);
}

.spHeader {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-strong);
}

.spHeaderActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spTitle {
  font-size: 1.15rem;
  line-height: 1;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text);
}

.spIconBtn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.spScroll {
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 18px;
  display: grid;
  align-content: start;
  gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.18) transparent;
}

.spScroll::-webkit-scrollbar { width: 8px; }
.spScroll::-webkit-scrollbar-track { background: transparent; }
.spScroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.16);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.spAlert {
  border-radius: 14px;
  padding: 10px 12px;
  font-size: .84rem;
  font-weight: 600;
}

.spAlert--error { background: #fee2e2; color: #b91c1c; }
.spAlert--success { background: #dcfce7; color: #166534; }

.spHeroView {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 4px 0 0;
}

.spHeroAvatar,
.spEditAvatar {
  width: 82px;
  height: 82px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.spHeroAvatar--fallback {
  display: grid;
  place-items: center;
  background: var(--avatar-fallback);
  color: #fff;
  font-size: 1.55rem;
  font-weight: 800;
}

.spAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.spHeroName {
  font-size: 1.05rem;
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: -.05em;
  text-align: center;
  color: var(--text);
}

.spHeroStatus {
  color: var(--text-muted);
  font-size: .8rem;
}

.spInfoList {
  display: grid;
  gap: 8px;
}

.spInfoRow {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border-radius: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-soft);
}

.spInfoIcon {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.spInfoValue {
  font-size: .95rem;
  font-weight: 800;
  color: var(--text);
}

.spInfoLabel {
  margin-top: 2px;
  font-size: .8rem;
  color: var(--text-muted);
}

.spEditHero {
  display: grid;
  justify-items: center;
  padding: 2px 0 0;
}

.spEditAvatarOverlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.22);
  color: #fff;
}

.spSection {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-soft);
}

.spSectionTitle {
  font-size: .92rem;
  font-weight: 800;
  color: var(--text);
}

.spHint {
  color: var(--text-muted);
  font-size: .82rem;
  line-height: 1.45;
}

.spField {
  display: grid;
  gap: 5px;
}

.spFieldLabel {
  font-size: .78rem;
  font-weight: 700;
  color: var(--text-soft);
}

.spInput {
  width: 100%;
  height: 38px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-soft);
  padding: 0 12px;
  font-size: .9rem;
  color: var(--text);
  outline: none;
}

.spInput:focus {
  border-color: rgba(74, 144, 217, 0.38);
  box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.12);
}

.spBtn {
  min-height: 38px;
  border: 0;
  border-radius: 14px;
  padding: 0 14px;
  font-size: .88rem;
  font-weight: 800;
  cursor: pointer;
}

.spBtn--primary {
  background: linear-gradient(135deg, #4a90d9 0%, #2563eb 100%);
  color: #fff;
}

.spBtn--soft {
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.spBtn:disabled {
  opacity: .64;
  cursor: default;
}
</style>
