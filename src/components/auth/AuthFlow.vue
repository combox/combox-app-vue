<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  checkEmailExists,
  login,
  register,
  saveLocalProfile,
  sendEmailCode,
  verifyEmailCode,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'

type Step = 'email' | 'loginCode' | 'loginPassword' | 'signupCode' | 'signupPassword' | 'username' | 'profile'

const GRADIENTS = ['#4d7cff', '#4db58e', '#8f6fff', '#e97d55', '#2da0d4', '#cc7a3c']
const USERNAME_RE = /^[a-z0-9_]{4,32}$/

function gradientFromIdentity(firstName: string, lastName: string, username: string): string {
  const source = `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}|${username.trim().toLowerCase()}`
  let hash = 0
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(i)
    hash |= 0
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]
}

function getInitials(firstName: string, lastName: string): string {
  const a = firstName.trim()[0] || ''
  const b = lastName.trim()[0] || ''
  const pair = `${a}${b}`.trim()
  if (pair) return pair.toUpperCase()
  return (firstName.trim().slice(0, 2) || 'U').toUpperCase()
}

function makeAvatarDataUrl(initials: string, gradient: string): string {
  const safe = initials || 'U'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${gradient}"/><stop offset="100%" stop-color="#1f2f48"/></linearGradient></defs><rect width="256" height="256" rx="128" fill="url(#g)"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Roboto,Segoe UI,Arial,sans-serif" font-weight="700" font-size="88">${safe}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function parseError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message || fallback
  return fallback
}

const router = useRouter()
const { t } = useI18n()

const step = ref<Step>('email')
const loading = ref(false)
const errorText = ref('')
const email = ref('')
const loginPassword = ref('')
const emailCode = ref('')
const loginKey = ref('')
const password = ref('')
const confirmPassword = ref('')
const username = ref('')
const firstName = ref('')
const lastName = ref('')
const birthDate = ref('')
const avatarDataUrl = ref('')

const avatarGradient = computed(() => gradientFromIdentity(firstName.value, lastName.value, username.value))
const previewInitials = computed(() => getInitials(firstName.value, lastName.value))
const submitLabel = computed(() => (step.value === 'profile' ? t('auth.finish') : t('auth.next')))
const stepMeta = computed(() => {
  switch (step.value) {
    case 'email':
      return { title: t('app.name'), subtitle: t('auth.subtitle_email') }
    case 'loginPassword':
      return { title: t('auth.title_password'), subtitle: t('auth.account_found', { email: email.value }) }
    case 'loginCode':
    case 'signupCode':
      return { title: t('auth.title_code'), subtitle: t('auth.code_sent_to', { email: email.value }) }
    case 'signupPassword':
      return { title: t('auth.title_set_password'), subtitle: t('auth.subtitle_set_password') }
    case 'username':
      return { title: t('auth.title_username'), subtitle: t('auth.subtitle_username') }
    default:
      return { title: t('auth.title_profile'), subtitle: t('auth.profile_hint') }
  }
})

async function continueFromEmail() {
  const normalized = email.value.trim().toLowerCase()
  if (!normalized) {
    errorText.value = t('auth.error_email_required')
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const exists = await checkEmailExists(normalized)
    await sendEmailCode(normalized)
    emailCode.value = ''
    loginKey.value = ''
    step.value = exists ? 'loginCode' : 'signupCode'
  } catch (error) {
    errorText.value = parseError(error, t('auth.error_email_check'))
  } finally {
    loading.value = false
  }
}

async function continueLogin() {
  if (!loginPassword.value.trim()) {
    errorText.value = t('auth.error_password_required')
    return
  }
  if (!emailCode.value.trim()) {
    errorText.value = t('auth.error_code_required')
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    await login(email.value.trim().toLowerCase(), loginPassword.value, loginKey.value)
    await router.push('/')
  } catch (error) {
    errorText.value = parseError(error, t('auth.error_password_invalid'))
  } finally {
    loading.value = false
  }
}

async function continueCode() {
  if (!emailCode.value.trim()) {
    errorText.value = t('auth.error_code_required')
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const result = await verifyEmailCode(email.value.trim().toLowerCase(), emailCode.value.trim(), 'signup')
    if (!result.verified) {
      errorText.value = t('auth.error_code_invalid')
      return
    }
    step.value = 'signupPassword'
  } catch (error) {
    errorText.value = parseError(error, t('auth.error_code_invalid'))
  } finally {
    loading.value = false
  }
}

async function continueLoginCode() {
  if (!emailCode.value.trim()) {
    errorText.value = t('auth.error_code_required')
    return
  }
  if (emailCode.value.trim().length < 4) {
    errorText.value = t('auth.error_code_invalid')
    return
  }
  loading.value = true
  errorText.value = ''
  try {
    const result = await verifyEmailCode(email.value.trim().toLowerCase(), emailCode.value.trim(), 'login')
    if (!result.verified || !result.login_key) {
      errorText.value = t('auth.error_code_invalid')
      return
    }
    loginKey.value = result.login_key
    step.value = 'loginPassword'
  } catch (error) {
    errorText.value = parseError(error, t('auth.error_code_invalid'))
  } finally {
    loading.value = false
  }
}

function continuePassword() {
  if (!password.value.trim() || !confirmPassword.value.trim()) {
    errorText.value = t('auth.error_password_confirm_required')
    return
  }
  if (password.value !== confirmPassword.value) {
    errorText.value = t('auth.error_password_mismatch')
    return
  }
  errorText.value = ''
  step.value = 'username'
}

function continueUsername() {
  if (!username.value.trim()) {
    errorText.value = t('auth.error_username_required')
    return
  }
  if (!USERNAME_RE.test(username.value.trim())) {
    errorText.value = t('auth.error_username_invalid')
    return
  }
  errorText.value = ''
  step.value = 'profile'
}

function handleEmailCodeInput(value: string) {
  emailCode.value = value.replace(/[^0-9]/g, '').slice(0, 6)
}

function handleUsernameInput(value: string) {
  username.value = value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32)
}

async function finishSignup() {
  if (!firstName.value.trim()) {
    errorText.value = t('auth.error_first_name_required')
    return
  }
  const finalAvatarDataUrl = avatarDataUrl.value.trim() || makeAvatarDataUrl(previewInitials.value, avatarGradient.value)
  loading.value = true
  errorText.value = ''
  try {
    await register(email.value.trim().toLowerCase(), username.value.trim(), password.value, {
      first_name: firstName.value.trim(),
      last_name: lastName.value.trim() || undefined,
      birth_date: birthDate.value.trim() || undefined,
      avatar_data_url: finalAvatarDataUrl,
      avatar_gradient: avatarGradient.value,
    })
    saveLocalProfile({
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim(),
      birthDate: birthDate.value.trim() || undefined,
      avatarDataUrl: finalAvatarDataUrl,
      gradient: avatarGradient.value,
    })
    await router.push('/')
  } catch (error) {
    errorText.value = parseError(error, t('auth.error_register'))
  } finally {
    loading.value = false
  }
}

async function resendCode() {
  loading.value = true
  errorText.value = ''
  try {
    await sendEmailCode(email.value.trim().toLowerCase())
    loginKey.value = ''
  } catch (error) {
    errorText.value = parseError(error, t('auth.error_code_send'))
  } finally {
    loading.value = false
  }
}

function back() {
  errorText.value = ''
  if (step.value === 'loginCode' || step.value === 'signupCode' || step.value === 'signupPassword') step.value = 'email'
  else if (step.value === 'loginPassword') step.value = 'loginCode'
  else if (step.value === 'username') step.value = 'signupPassword'
  else if (step.value === 'profile') step.value = 'username'
}

function onAvatarSelect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    avatarDataUrl.value = typeof reader.result === 'string' ? reader.result : ''
  }
  reader.readAsDataURL(file)
}
</script>

<template>
  <v-container class="pa-0 fill-width">
    <v-row class="ma-0">
      <v-col cols="12" class="pa-0">
        <div class="d-flex flex-column ga-4">
          <div class="d-flex flex-column align-center ga-1 mb-1">
            <h1 class="auth-title">{{ stepMeta.title }}</h1>
            <p class="auth-subtitle">{{ stepMeta.subtitle }}</p>
          </div>

          <v-btn v-if="step !== 'email'" variant="text" class="align-self-start auth-back-btn" @click="back">{{ t('auth.back') }}</v-btn>

          <v-alert v-if="errorText" type="error" density="compact" variant="tonal">{{ errorText }}</v-alert>

          <template v-if="step === 'email'">
            <v-text-field
              v-model="email"
              :label="t('auth.enter_email')"
              :placeholder="t('auth.email_placeholder')"
              type="email"
              density="comfortable"
              variant="outlined"
              hide-details
              autofocus
              autocomplete="email"
              name="email"
              class="auth-field"
              @keydown.enter="continueFromEmail"
            />
            <v-btn block color="primary" size="large" class="auth-primary-btn" :disabled="loading" @click="continueFromEmail">
              <v-progress-circular v-if="loading" indeterminate size="18" width="2" color="currentColor" />
              <template v-else>{{ submitLabel }}</template>
            </v-btn>
          </template>

          <template v-if="step === 'loginPassword'">
            <v-text-field
              v-model="loginPassword"
              :label="t('auth.password')"
              type="password"
              variant="outlined"
              hide-details
              autofocus
              class="auth-field"
              @keydown.enter="continueLogin"
            />
            <v-btn block color="primary" size="large" class="auth-primary-btn" :disabled="loading" @click="continueLogin">
              <v-progress-circular v-if="loading" indeterminate size="18" width="2" color="currentColor" />
              <template v-else>{{ submitLabel }}</template>
            </v-btn>
          </template>

          <template v-if="step === 'loginCode'">
            <v-text-field
              :model-value="emailCode"
              :label="t('auth.email_code')"
              :placeholder="t('auth.email_code_placeholder')"
              variant="outlined"
              hide-details
              autofocus
              type="text"
              autocomplete="one-time-code"
              name="one-time-code"
              class="auth-field"
              @update:model-value="handleEmailCodeInput"
              @keydown.enter="continueLoginCode"
            />
            <v-btn block color="primary" size="large" class="auth-primary-btn" :disabled="loading" @click="continueLoginCode">
              <v-progress-circular v-if="loading" indeterminate size="18" width="2" color="currentColor" />
              <template v-else>{{ submitLabel }}</template>
            </v-btn>
            <v-btn block variant="text" class="auth-secondary-btn" :disabled="loading" @click="resendCode">{{ t('auth.resend_code') }}</v-btn>
          </template>

          <template v-if="step === 'signupCode'">
            <v-text-field
              :model-value="emailCode"
              :label="t('auth.email_code')"
              :placeholder="t('auth.email_code_placeholder')"
              variant="outlined"
              hide-details
              autofocus
              type="text"
              autocomplete="one-time-code"
              name="one-time-code"
              class="auth-field"
              @update:model-value="handleEmailCodeInput"
              @keydown.enter="continueCode"
            />
            <v-btn block color="primary" size="large" class="auth-primary-btn" :disabled="loading" @click="continueCode">{{ submitLabel }}</v-btn>
            <v-btn block variant="text" class="auth-secondary-btn" :disabled="loading" @click="resendCode">{{ t('auth.resend_code') }}</v-btn>
          </template>

          <template v-if="step === 'signupPassword'">
            <v-text-field v-model="password" :label="t('auth.password')" type="password" variant="outlined" hide-details autofocus class="auth-field" />
            <v-text-field v-model="confirmPassword" :label="t('auth.confirm_password')" type="password" variant="outlined" hide-details class="auth-field" @keydown.enter="continuePassword" />
            <v-btn block color="primary" size="large" class="auth-primary-btn" @click="continuePassword">{{ submitLabel }}</v-btn>
          </template>

          <template v-if="step === 'username'">
            <v-text-field
              :model-value="username"
              :label="t('auth.username')"
              variant="outlined"
              :hint="t('auth.username_hint')"
              persistent-hint
              autofocus
              class="auth-field"
              @update:model-value="handleUsernameInput"
              @keydown.enter="continueUsername"
            />
            <v-btn block color="primary" size="large" class="auth-primary-btn" @click="continueUsername">{{ submitLabel }}</v-btn>
          </template>

          <template v-if="step === 'profile'">
            <div class="d-flex ga-3 align-center">
              <v-avatar size="64" rounded="0" color="grey-lighten-2" class="auth-avatar">
                <img v-if="avatarDataUrl" :src="avatarDataUrl" alt="avatar" />
                <span v-else>{{ previewInitials }}</span>
              </v-avatar>
              <v-btn variant="outlined" prepend-icon="mdi-cloud-upload-outline" class="auth-upload-btn">
                {{ t('auth.upload_avatar') }}
                <input hidden type="file" accept="image/*" @change="onAvatarSelect" />
              </v-btn>
            </div>
            <v-text-field v-model="firstName" :label="t('auth.first_name')" variant="outlined" hide-details autofocus class="auth-field" />
            <v-text-field v-model="lastName" :label="t('auth.last_name_optional')" variant="outlined" hide-details class="auth-field" />
            <v-text-field v-model="birthDate" :label="t('auth.birth_date_optional')" placeholder="YYYY-MM-DD" variant="outlined" hide-details class="auth-field" />
            <v-btn block color="primary" size="large" class="auth-primary-btn" :disabled="loading" @click="finishSignup">
              <v-progress-circular v-if="loading" indeterminate size="18" width="2" color="currentColor" />
              <template v-else>{{ submitLabel }}</template>
            </v-btn>
          </template>
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.fill-width {
  width: 100%;
}

.auth-title {
  margin: 0;
  font-size: clamp(28px, 5vw, 34px);
  line-height: 1.1;
  font-weight: 900;
  text-align: center;
}

.auth-subtitle {
  margin: 0;
  color: rgba(0, 0, 0, 0.62);
  text-align: center;
  font-size: 14px;
  max-width: 360px;
}

:deep(.auth-field .v-field) {
  border-radius: 0;
}

:deep(.auth-field .v-field__input) {
  min-height: 56px;
}

.auth-back-btn {
  margin-top: -4px;
  padding-inline: 4px;
  text-transform: none;
}

.auth-primary-btn {
  min-height: 48px;
  border-radius: 0;
  text-transform: none;
  font-weight: 700;
}

.auth-secondary-btn {
  text-transform: none;
  opacity: 0.9;
}

.auth-upload-btn {
  border-radius: 0;
  text-transform: none;
}

.auth-avatar {
  color: rgba(0, 0, 0, 0.72);
  font-weight: 700;
}
</style>
