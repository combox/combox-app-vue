<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ApiError,
  isEmailBindingRequired,
  requestLegacyBindEmail,
  verifyLegacyBindEmail,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { logoutNow } from '../settings/sessionMeta'
import {
  resolveLegacyMigration,
  useLegacyMigrationState,
} from '../../stores/legacyMigration'

/**
 * Forced email binding for legacy (password-only) accounts.
 *
 * Rendered via Teleport to <body> outside the <main> landmark, so the
 * single-main-landmark audit stays green. The dialog is intentionally NOT
 * dismissible by overlay click or Escape: with a migr-limited token every
 * other API call answers 403, so closing without binding would strand the
 * user. The only exit besides binding is the X button, which logs out and
 * sends the user back to /auth (no dead buttons).
 */
type Step = 'email' | 'code' | 'done'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE_LENGTH = 6

const router = useRouter()
const { t } = useI18n()
const { migrationRequired, migrationEmail } = useLegacyMigrationState()

const step = ref<Step>('email')
const email = ref('')
const errorText = ref('')
const sending = ref(false)
const verifying = ref(false)
const closing = ref(false)
const digits = ref<string[]>(Array.from({ length: CODE_LENGTH }, () => ''))
const resendIn = ref(0)
const boxRefs = ref<Array<HTMLInputElement | null>>(Array.from({ length: CODE_LENGTH }, () => null))

let timer: ReturnType<typeof setInterval> | null = null

const code = computed(() => digits.value.join(''))
const busy = computed(() => sending.value || verifying.value || closing.value)

function clearTimer(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

function startCountdown(seconds: number): void {
  clearTimer()
  const initial = Math.max(0, Math.ceil(seconds))
  resendIn.value = initial
  if (initial <= 0) return
  timer = setInterval(() => {
    resendIn.value -= 1
    if (resendIn.value <= 0) {
      resendIn.value = 0
      clearTimer()
    }
  }, 1000)
}

function setBoxRef(index: number, el: unknown): void {
  boxRefs.value[index] = el instanceof HTMLInputElement ? el : null
}

function focusBox(index: number): void {
  const clamped = Math.max(0, Math.min(CODE_LENGTH - 1, index))
  boxRefs.value[clamped]?.focus()
  boxRefs.value[clamped]?.select()
}

function reset(): void {
  clearTimer()
  step.value = 'email'
  email.value = migrationEmail.value
  errorText.value = ''
  sending.value = false
  verifying.value = false
  closing.value = false
  digits.value = Array.from({ length: CODE_LENGTH }, () => '')
  resendIn.value = 0
}

watch(migrationRequired, (open) => {
  if (open) reset()
})

onBeforeUnmount(() => {
  clearTimer()
})

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}

function apiCodeOf(caught: unknown): string {
  if (caught instanceof ApiError) return caught.code.toLowerCase()
  if (caught && typeof caught === 'object' && 'code' in caught) {
    return String((caught as { code?: unknown }).code || '').toLowerCase()
  }
  return ''
}

async function sendCode(): Promise<void> {
  const normalized = email.value.trim().toLowerCase()
  if (!normalized) {
    errorText.value = t('legacy.error_email_required', undefined, 'Enter an email address')
    return
  }
  if (!EMAIL_RE.test(normalized)) {
    errorText.value = t('legacy.error_email_invalid', undefined, 'That does not look like a valid email')
    return
  }
  if (sending.value) return
  sending.value = true
  errorText.value = ''
  try {
    const result = await requestLegacyBindEmail(normalized)
    email.value = normalized
    startCountdown(result.resend_after)
    step.value = 'code'
    await nextTick()
    focusBox(0)
  } catch (caught) {
    if (isEmailBindingRequired(caught)) {
      // Already inside the migration flow; surface it as text, stay open.
      errorText.value = messageOf(caught, t('legacy.error_request_failed', undefined, 'Could not send the code'))
      return
    }
    const apiCode = apiCodeOf(caught)
    if (apiCode === 'conflict' || apiCode === 'already_exists' || apiCode === 'email_taken') {
      errorText.value = t('legacy.error_email_taken', undefined, 'This email is already in use by another account')
    } else if (apiCode === 'invalid_argument' || apiCode === 'invalid_email') {
      errorText.value = t('legacy.error_email_invalid', undefined, 'That does not look like a valid email')
    } else {
      errorText.value = messageOf(caught, t('legacy.error_request_failed', undefined, 'Could not send the code'))
    }
  } finally {
    sending.value = false
  }
}

async function submitCode(): Promise<void> {
  const value = code.value
  if (value.length < CODE_LENGTH) {
    errorText.value = t('legacy.error_code_required', undefined, 'Enter the 6-digit code from the email')
    return
  }
  if (verifying.value) return
  verifying.value = true
  errorText.value = ''
  try {
    // The SDK persists the upgraded full-session tokens itself and returns
    // the user; nothing else to store here.
    await verifyLegacyBindEmail(email.value.trim().toLowerCase(), value)
    clearTimer()
    step.value = 'done'
  } catch (caught) {
    const apiCode = apiCodeOf(caught)
    if (apiCode === 'invalid_code' || apiCode === 'code_mismatch' || apiCode === 'expired' || apiCode === 'not_found') {
      errorText.value = t('legacy.error_code_invalid', undefined, 'Wrong or expired code — check it and try again')
    } else {
      errorText.value = messageOf(caught, t('legacy.error_verify_failed', undefined, 'Could not verify the code'))
    }
    digits.value = Array.from({ length: CODE_LENGTH }, () => '')
    await nextTick()
    focusBox(0)
  } finally {
    verifying.value = false
  }
}

function onDigitInput(index: number, event: Event): void {
  const input = event.target as HTMLInputElement | null
  if (!input) return
  const next = input.value.replace(/\D/g, '').slice(-1)
  digits.value[index] = next
  input.value = next
  if (next && index < CODE_LENGTH - 1) {
    focusBox(index + 1)
  }
  if (digits.value.join('').length === CODE_LENGTH) {
    void submitCode()
  }
}

function onDigitKeydown(index: number, event: KeyboardEvent): void {
  if (event.key === 'Backspace' && !digits.value[index] && index > 0) {
    event.preventDefault()
    digits.value[index - 1] = ''
    focusBox(index - 1)
  } else if (event.key === 'ArrowLeft' && index > 0) {
    event.preventDefault()
    focusBox(index - 1)
  } else if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
    event.preventDefault()
    focusBox(index + 1)
  }
}

function onDigitPaste(event: ClipboardEvent): void {
  event.preventDefault()
  const clean = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, CODE_LENGTH)
  if (!clean) return
  const next = Array.from({ length: CODE_LENGTH }, () => '')
  for (let i = 0; i < clean.length; i += 1) next[i] = clean[i]
  digits.value = next
  if (clean.length === CODE_LENGTH) {
    focusBox(CODE_LENGTH - 1)
    void submitCode()
  } else {
    focusBox(clean.length)
  }
}

/** Success step: full token is stored, the server lifted the restriction. */
async function continueToApp(): Promise<void> {
  resolveLegacyMigration()
  await router.push('/')
}

/**
 * The only non-binding exit: drop the migr-limited session and go to /auth,
 * otherwise every subsequent request would keep failing with 403.
 */
async function closeAndLogout(): Promise<void> {
  if (closing.value) return
  closing.value = true
  try {
    await logoutNow()
  } finally {
    resolveLegacyMigration()
    closing.value = false
    await router.push('/auth')
  }
}

function backToEmail(): void {
  if (busy.value) return
  errorText.value = ''
  step.value = 'email'
}
</script>

<template>
  <Teleport to="body">
    <div v-if="migrationRequired" class="lmOverlay">
      <div class="lmDialog" role="dialog" aria-modal="true" :aria-label="t('legacy.title', undefined, 'Link an email to keep your account')">
        <div class="lmHead">
          <div class="lmTitle">{{ t('legacy.title', undefined, 'Link an email to keep your account') }}</div>
          <button type="button" class="lmClose" :disabled="busy" :title="t('legacy.close_logout', undefined, 'Log out without linking')" :aria-label="t('legacy.close_logout', undefined, 'Log out without linking')" @click="closeAndLogout">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <div v-if="errorText" class="lmError" role="alert">{{ errorText }}</div>

        <template v-if="step === 'email'">
          <div class="lmPolicy">
            <v-icon icon="mdi-shield-check-outline" size="20" class="lmPolicyIcon" />
            <span>{{ t('legacy.subtitle', undefined, 'For your security every account must now have a verified email. Link one below — it takes less than a minute.') }}</span>
          </div>
          <label class="lmLabel" for="lm-email">{{ t('legacy.email_label', undefined, 'New email address') }}</label>
          <input
            id="lm-email"
            v-model="email"
            type="email"
            class="lmInput"
            :placeholder="t('legacy.email_placeholder', undefined, 'you@example.com')"
            autocomplete="email"
            :disabled="sending"
            @keydown.enter.prevent="sendCode"
          />
          <button type="button" class="lmBtn" :disabled="sending || !email.trim()" @click="sendCode">
            {{ sending ? t('common.loading', undefined, 'Loading…') : t('legacy.send_code', undefined, 'Send code') }}
          </button>
        </template>

        <template v-else-if="step === 'code'">
          <div class="lmHint">{{ t('legacy.code_hint', { email: email }, 'We sent a 6-digit code to {email}') }}</div>
          <div class="lmBoxes" @paste="onDigitPaste">
            <input
              v-for="(digit, index) in digits"
              :key="`lm-box-${index}`"
              :ref="(el) => setBoxRef(index, el)"
              :value="digit"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="1"
              class="lmBox"
              :disabled="verifying"
              :aria-label="t('legacy.code_digit_label', { index: index + 1 }, 'Digit {index} of the code')"
              @input="onDigitInput(index, $event)"
              @keydown="onDigitKeydown(index, $event)"
              @paste="onDigitPaste"
            />
          </div>
          <button type="button" class="lmBtn" :disabled="verifying || code.length < 6" @click="submitCode">
            {{ verifying ? t('common.loading', undefined, 'Loading…') : t('legacy.verify', undefined, 'Verify') }}
          </button>
          <div class="lmRow">
            <button type="button" class="lmLink" :disabled="busy" @click="backToEmail">
              {{ t('auth.back', undefined, 'Back') }}
            </button>
            <button type="button" class="lmLink" :disabled="sending || verifying || resendIn > 0" @click="sendCode">
              {{
                resendIn > 0
                  ? t('legacy.resend_in', { seconds: resendIn }, 'Resend in {seconds}s')
                  : t('legacy.resend', undefined, 'Resend code')
              }}
            </button>
          </div>
        </template>

        <template v-else>
          <div class="lmDone">
            <span class="lmDoneIcon"><v-icon icon="mdi-check-circle-outline" size="40" /></span>
            <div class="lmDoneTitle">{{ t('legacy.success_title', undefined, 'Email linked') }}</div>
            <div class="lmDoneText">{{ t('legacy.success_text', undefined, 'Your account is fully unlocked — welcome back.') }}</div>
          </div>
          <button type="button" class="lmBtn" @click="continueToApp">
            {{ t('legacy.continue', undefined, 'Continue') }}
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lmOverlay {
  position: fixed;
  inset: 0;
  z-index: 9700;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  padding: 16px;
}

.lmDialog {
  width: min(100%, 420px);
  max-height: min(92vh, 640px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
  padding: 18px;
  display: grid;
  gap: 12px;
}

.lmHead {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.lmTitle {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.lmClose {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.lmClose:hover:not(:disabled) {
  background: var(--surface-soft);
  color: var(--text);
}

.lmClose:disabled {
  opacity: 0.5;
  cursor: default;
}

.lmError {
  font-size: 13px;
  color: #ef4444;
}

.lmPolicy {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--text-soft);
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
}

.lmPolicyIcon {
  flex: 0 0 auto;
  color: var(--accent-strong);
  margin-top: 1px;
}

.lmLabel {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.lmInput {
  height: 44px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  padding: 0 12px;
  outline: none;
}

.lmInput:focus {
  border-color: var(--accent);
}

.lmInput:disabled {
  opacity: 0.6;
}

.lmHint {
  font-size: 13.5px;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}

.lmBoxes {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.lmBox {
  width: 44px;
  height: 52px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 22px;
  font-weight: 800;
  text-align: center;
  outline: none;
}

.lmBox:focus {
  border-color: var(--accent);
}

.lmBox:disabled {
  opacity: 0.6;
}

.lmBtn {
  min-height: 42px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  padding: 0 14px;
}

.lmBtn:disabled {
  opacity: 0.6;
  cursor: default;
}

.lmRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.lmLink {
  border: 0;
  background: transparent;
  color: var(--text-soft);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 6px 4px;
}

.lmLink:hover:not(:disabled) {
  color: var(--text);
}

.lmLink:disabled {
  opacity: 0.5;
  cursor: default;
}

.lmDone {
  display: grid;
  justify-items: center;
  gap: 6px;
  text-align: center;
  padding: 8px 0;
}

.lmDoneIcon {
  color: #22c55e;
}

.lmDoneTitle {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.lmDoneText {
  font-size: 13.5px;
  color: var(--text-soft);
}
</style>
