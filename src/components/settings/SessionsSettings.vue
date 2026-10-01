<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listAuthSessions, revokeOtherAuthSessions, type AuthSession } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { formatSessionDate, logoutNow, sessionDeviceLabel, terminateSession } from './sessionMeta'
import './settingsShared.css'

const { t } = useI18n()
const toast = useToast()

const sessions = ref<AuthSession[]>([])
const loading = ref(false)
const loadError = ref('')
const busySession = ref('')
const busyAll = ref(false)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    sessions.value = await listAuthSessions()
  } catch (caught) {
    loadError.value =
      caught instanceof Error ? caught.message : t('settings.sessions_load_failed', undefined, 'Could not load sessions')
  } finally {
    loading.value = false
  }
}

const otherSessions = () => sessions.value.filter((session) => !session.current)

async function terminate(session: AuthSession): Promise<void> {
  if (busySession.value || busyAll.value) return
  busySession.value = session.id
  try {
    await terminateSession(session.id)
    if (session.current) {
      toast.success(t('settings.session_ended', undefined, 'Session ended'))
      await logoutNow()
      window.setTimeout(() => window.location.reload(), 700)
      return
    }
    toast.success(t('settings.session_terminated', undefined, 'Session terminated'))
    await load()
  } catch (caught) {
    toast.error(
      caught instanceof Error ? caught.message : t('settings.session_revoke_failed', undefined, 'Could not terminate the session'),
    )
    await load()
  } finally {
    busySession.value = ''
  }
}

async function terminateOthers(): Promise<void> {
  if (busyAll.value || busySession.value || otherSessions().length === 0) return
  busyAll.value = true
  try {
    const revoked = await revokeOtherAuthSessions()
    toast.success(
      t('settings.sessions_others_ended', { count: revoked }, '{count} other sessions terminated'),
    )
    await load()
  } catch (caught) {
    toast.error(
      caught instanceof Error ? caught.message : t('settings.session_revoke_failed', undefined, 'Could not terminate the session'),
    )
    await load()
  } finally {
    busyAll.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="hubSectionIntro">
    <div class="hubSectionIntroIcon"><v-icon icon="mdi-cellphone-link" size="24" /></div>
    <div>
      <div class="hubSectionIntroTitle">{{ t('settings.active_sessions', undefined, 'Active sessions') }}</div>
      <div class="hubSectionIntroText">
        {{ t('settings.active_sessions_intro', undefined, 'Devices that are signed in to your account right now.') }}
      </div>
    </div>
  </section>

  <section class="settingsCard settingsCard--full">
    <div class="settingsCard__title">{{ t('settings.sessions_title', undefined, 'Devices') }}</div>
    <div class="settingsSectionText">
      {{ t('settings.sessions_hint', undefined, 'Terminate anything you do not recognise to sign it out.') }}
    </div>

    <v-alert v-if="loadError" type="error" class="mb-4">{{ loadError }}</v-alert>

    <div v-if="loading && sessions.length === 0" class="seSkeleton">
      <span v-for="n in 3" :key="n" class="seSkeletonRow" />
    </div>

    <div v-else-if="sessions.length > 0" class="accList">
      <div v-for="session in sessions" :key="session.id" class="accRow accRow--muted">
        <span class="accRowIcon">
          <v-icon :icon="session.current ? 'mdi-monitor' : 'mdi-cellphone'" size="20" />
        </span>
        <span class="accRowMain">
          <span class="accRowTitle">
            {{ sessionDeviceLabel(session.user_agent) || t('settings.session_unknown_device', undefined, 'Unknown device') }}
            <span v-if="session.current" class="seBadge">
              {{ t('settings.this_device', undefined, 'This device') }}
            </span>
          </span>
          <span class="accRowSub">
            {{ session.ip_address || '—' }}<span v-if="session.created_at"> · {{ formatSessionDate(session.created_at) }}</span>
          </span>
        </span>
        <button
          type="button"
          class="settingsBtn settingsBtn--danger seTerminate"
          :disabled="Boolean(busySession) || busyAll"
          @click="terminate(session)"
        >
          <v-progress-circular v-if="busySession === session.id" indeterminate :size="14" :width="2" />
          {{ t('settings.terminate', undefined, 'Terminate') }}
        </button>
      </div>
    </div>

    <div v-else-if="!loading" class="seEmpty">
      {{ t('settings.sessions_empty', undefined, 'No other active sessions.') }}
    </div>

    <div class="seActions">
      <v-btn
        class="settingsBtn settingsBtn--soft"
        variant="outlined"
        rounded="xl"
        :disabled="otherSessions().length === 0"
        :loading="busyAll"
        @click="terminateOthers"
      >
        {{ t('settings.terminate_others', undefined, 'Terminate all other sessions') }}
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.seBadge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  vertical-align: middle;
}

.seTerminate {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
}

.seTerminate:disabled {
  opacity: 0.5;
  cursor: default;
}

.seActions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

.seEmpty,
.seSkeleton {
  padding: 8px 2px;
  font-size: 13.5px;
  color: var(--text-muted);
}

.seSkeleton {
  display: grid;
  gap: 10px;
}

.seSkeletonRow {
  display: block;
  height: 54px;
  border-radius: 18px;
  background: var(--surface-soft);
  animation: sePulse 1.2s ease-in-out infinite;
}

@keyframes sePulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (max-width: 560px) {
  .seActions {
    justify-content: stretch;
  }
}
</style>
