import { readonly, ref } from 'vue'
import { isEmailBindingRequired } from 'combox-api'

/**
 * Legacy email-binding migration state (migration 000044).
 *
 * NOTE: this project has no pinia (no dependency, no src/stores before this
 * file), so the store is a plain-Vue reactive singleton. It plays the exact
 * role the task assigns to the "pinia auth-store": a single `migrationRequired`
 * flag plus setters, shared between AuthFlow (trigger), App.vue (mount point)
 * and LegacyMigrationModal (consumer).
 *
 * There is also no central ApiError interceptor in the app (every feature
 * catches API errors locally), so `notifyLegacyMigration()` below is the one
 * global choke point: any call site passes its caught error through it, and a
 * 403 {code: EMAIL_BINDING_REQUIRED} opens the modal instead of surfacing a
 * dead-end error. Wired into AuthFlow's login; other screens can reuse it
 * without duplicating interceptors.
 */
const migrationRequired = ref(false)
/** Optional email hint pre-filling step 1 (e.g. the login identity, when it is an email). */
const migrationEmail = ref('')

export function useLegacyMigrationState() {
  return {
    migrationRequired: readonly(migrationRequired),
    migrationEmail: readonly(migrationEmail),
  }
}

/** Opens the binding modal (e.g. login answered `migration_required: true`). */
export function requestLegacyMigration(email = ''): void {
  migrationEmail.value = email
  migrationRequired.value = true
}

/** Closes the modal and drops the hint (called after a successful verify or a logout-close). */
export function resolveLegacyMigration(): void {
  migrationRequired.value = false
  migrationEmail.value = ''
}

/**
 * Global 403 interceptor helper. Returns true when `error` is the API's
 * "bind an email first" rejection — the modal is opened and the caller must
 * NOT show its own error text. Returns false for anything else. The optional
 * `email` pre-fills step 1 only when it really is an email (legacy nick
 * logins pass '' so the modal starts empty instead of echoing the nick).
 */
export function notifyLegacyMigration(error: unknown, email = ''): boolean {
  if (!isEmailBindingRequired(error)) return false
  if (email && !migrationEmail.value) migrationEmail.value = email
  migrationRequired.value = true
  return true
}
