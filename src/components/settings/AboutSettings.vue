<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { APP_SITE_URL, APP_VERSION } from './aboutMeta'
import { logoutNow } from './sessionMeta'
import './settingsShared.css'

const { t } = useI18n()
const toast = useToast()

const loggingOut = ref(false)

async function handleLogout(): Promise<void> {
  if (loggingOut.value) return
  loggingOut.value = true
  try {
    await logoutNow()
    toast.success(t('settings.logged_out', undefined, 'Signed out'))
    window.setTimeout(() => window.location.reload(), 500)
  } catch {
    loggingOut.value = false
    toast.error(t('settings.logout_failed', undefined, 'Could not sign out'))
  }
}
</script>

<template>
  <section class="hubSectionIntro">
    <div class="hubSectionIntroIcon"><v-icon icon="mdi-information-outline" size="24" /></div>
    <div>
      <div class="hubSectionIntroTitle">{{ t('settings.about_combox', undefined, 'About ComBox') }}</div>
      <div class="hubSectionIntroText">
        {{ t('settings.about_intro', undefined, 'A fast, private messenger that lives right in your browser.') }}
      </div>
    </div>
  </section>

  <section class="settingsCard">
    <div class="infoList">
      <div class="infoRow">
        <div class="infoRow__icon"><v-icon icon="mdi-tag-outline" size="18" /></div>
        <div class="infoRow__body">
          <div class="infoRow__value">{{ APP_VERSION }}</div>
          <div class="infoRow__label">{{ t('settings.app_version', undefined, 'App version') }}</div>
        </div>
      </div>
      <div class="infoRow">
        <div class="infoRow__icon"><v-icon icon="mdi-cloud-check-outline" size="18" /></div>
        <div class="infoRow__body">
          <div class="infoRow__value">{{ t('settings.status_online', undefined, 'Active & running') }}</div>
          <div class="infoRow__label">{{ t('settings.server_status', undefined, 'Server status') }}</div>
        </div>
      </div>
      <div class="infoRow">
        <div class="infoRow__icon"><v-icon icon="mdi-incognito" size="18" /></div>
        <div class="infoRow__body">
          <div class="infoRow__value">{{ t('settings.privacy_first', undefined, 'Private by design') }}</div>
          <div class="infoRow__label">{{ t('settings.privacy_first_hint', undefined, 'Messages stay on your device') }}</div>
        </div>
      </div>
    </div>
  </section>

  <section class="settingsCard">
    <div class="settingsCard__title">{{ t('settings.about_title', undefined, 'About') }}</div>
    <div class="settingsSectionText">
      {{
        t(
          'settings.about_text',
          undefined,
          'ComBox is an open messenger: your chats, calls and music in one place, with privacy settings you control yourself.',
        )
      }}
    </div>
    <a class="abLink" :href="APP_SITE_URL" target="_blank" rel="noopener noreferrer">
      <v-icon icon="mdi-web" size="16" />
      {{ t('settings.website', undefined, 'Project website') }}
      <v-icon icon="mdi-open-in-new" size="14" class="abLinkIcon" />
    </a>
  </section>

  <section class="settingsCard">
    <div class="settingsCard__title">{{ t('settings.account_actions', undefined, 'Account') }}</div>
    <div class="settingsSectionText">
      {{ t('settings.logout_hint', undefined, 'Sign out of this device. Other sessions stay signed in.') }}
    </div>
    <v-btn
      color="error"
      class="settingsBtn abLogout"
      variant="outlined"
      rounded="xl"
      :loading="loggingOut"
      @click="handleLogout"
    >
      {{ t('settings.logout', undefined, 'Log out') }}
    </v-btn>
  </section>
</template>

<style scoped>
.abLink {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.abLink:hover {
  background: var(--accent);
  color: var(--link-on-accent, #fff);
}

.abLinkIcon {
  opacity: 0.75;
}

.abLogout {
  flex: 0 0 auto;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 700;
}
</style>
