<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ComboxClient } from 'combox-api'
import PageShell from '../components/core/PageShell.vue'
import TGRow from '../components/settings/TGRow.vue'
import MyAccountSettings from '../components/settings/MyAccountSettings.vue'
import NotificationsSettings from '../components/settings/NotificationsSettings.vue'
import PrivacySecuritySettings from '../components/settings/PrivacySecuritySettings.vue'
import ChatSettings from '../components/settings/ChatSettings.vue'
import FoldersSettings from '../components/settings/FoldersSettings.vue'
import RecommendedFolders from '../components/settings/RecommendedFolders.vue'
import AdvancedSettings from '../components/settings/AdvancedSettings.vue'
import PowerSavingSettings from '../components/settings/PowerSavingSettings.vue'
import LanguageSettings from '../components/settings/LanguageSettings.vue'
import AboutSettings from '../components/settings/AboutSettings.vue'
import AvatarViewer from '../components/core/AvatarViewer.vue'
import { APP_VERSION } from '../components/settings/aboutMeta'
import { useUserSettings } from '../components/settings/userSettingsMeta'
import {
  applyInterfaceScale,
  applyPowerSaving,
  loadInterfaceScale,
  loadPowerSaving,
  saveInterfaceScale,
  syncNotificationBridge,
} from '../components/settings/settingsEffects'
import { useI18n } from '../i18n/i18n'
import { normalizeAvatarSrc } from '../utils/avatar'
import '../components/settings/settingsShared.css'

type Page =
  | 'main'
  | 'account'
  | 'notifications'
  | 'privacy'
  | 'chat'
  | 'folders'
  | 'advanced'
  | 'power'
  | 'language'
  | 'about'

const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const client = new ComboxClient()
const userSettings = useUserSettings()

const page = ref<Page>('main')
const foldersKey = ref(0)
const privacyRef = ref<{ goBack: () => boolean } | null>(null)

const avatarSrc = ref('')
const displayName = ref('')
const username = ref('')

const scaleEnabled = ref(false)
const scalePercent = ref(100)

const initials = computed(() => {
  const parts = displayName.value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return (username.value.trim().slice(0, 1).toUpperCase() || '?')
  if (parts.length === 1) return (parts[0] || '?').slice(0, 1).toUpperCase()
  return `${(parts[0] || '').slice(0, 1)}${(parts[1] || '').slice(0, 1)}`.toUpperCase()
})

const languageLabel = computed(() => (locale.value === 'ru' ? 'Русский' : 'English'))

const pageTitle = computed(() => {
  switch (page.value) {
    case 'account':
      return t('settings.tg.account.title', undefined, 'My Account')
    case 'notifications':
      return t('settings.notifications_nav', undefined, 'Notifications and Sounds')
    case 'privacy':
      return t('settings.privacy', undefined, 'Privacy & security')
    case 'chat':
      return t('settings.tg.chat.title', undefined, 'Chat Settings')
    case 'folders':
      return t('settings.folders', undefined, 'Folders')
    case 'advanced':
      return t('settings.tg.advanced.title', undefined, 'Advanced')
    case 'power':
      return t('settings.tg.power.nav', undefined, 'Battery and Animations')
    case 'language':
      return t('common.language', undefined, 'Language')
    case 'about':
      return t('settings.about_combox', undefined, 'About ComBox')
    default:
      return t('settings.title', undefined, 'Settings')
  }
})

function openPage(next: Page): void {
  page.value = next
}

// Deep link for the chat sidebar hamburger menu (/settings?section=account):
// it must land directly in the TG-style account editor, reusing this page
// instead of the removed sidebar settings pane.
const SECTION_PAGES: Record<string, Page> = {
  main: 'main',
  account: 'account',
  notifications: 'notifications',
  privacy: 'privacy',
  chat: 'chat',
  folders: 'folders',
  advanced: 'advanced',
  power: 'power',
  language: 'language',
  about: 'about',
}

function applySectionFromRoute(): void {
  const raw = route.query.section
  const key = (Array.isArray(raw) ? raw[0] : raw || '').toString().trim().toLowerCase()
  if (key && SECTION_PAGES[key]) page.value = SECTION_PAGES[key]
}

watch(
  () => route.query.section,
  () => applySectionFromRoute(),
)

function goBack(): void {
  if (page.value === 'privacy' && privacyRef.value?.goBack()) return
  if (page.value !== 'main') {
    page.value = 'main'
    return
  }
  void router.push('/')
}

function close(): void {
  void router.push('/')
}

function onScaleToggle(next: boolean | null): void {
  scaleEnabled.value = next === true
  saveInterfaceScale({ enabled: scaleEnabled.value, percent: scalePercent.value })
}

function onScalePercent(next: number): void {
  scalePercent.value = Math.max(80, Math.min(150, Math.round(next) || 100))
  saveInterfaceScale({ enabled: scaleEnabled.value, percent: scalePercent.value })
}

async function loadHeader(): Promise<void> {
  try {
    const data = await client.getProfile()
    avatarSrc.value = normalizeAvatarSrc(data.avatar_data_url || '')
    username.value = data.username || ''
    const full = `${data.first_name || ''} ${data.last_name || ''}`.trim()
    displayName.value = full || (data.username ? `@${data.username}` : '')
  } catch {
    // The header stays placeholder; every section loads and reports on its own.
  }
}

onMounted(() => {
  const scale = loadInterfaceScale()
  scaleEnabled.value = scale.enabled
  scalePercent.value = scale.percent
  applyInterfaceScale(scale)
  applyPowerSaving(loadPowerSaving())
  applySectionFromRoute()
  void loadHeader()
  // Push the server master into the live runtime gate as early as possible.
  void userSettings.load().then(() => syncNotificationBridge(userSettings.values))
})
</script>

<template>
  <PageShell>
    <div class="hub">
      <section class="hubContent">
        <div class="hubBody hubBody--narrow">
          <template v-if="page === 'main'">
            <header class="tgTopbar">
              <button type="button" class="tgTopbarBtn" :aria-label="t('settings.back', undefined, 'Back')" @click="goBack">
                <v-icon icon="mdi-arrow-left" size="18" />
              </button>
              <div class="tgTopbarTitle">{{ pageTitle }}</div>
              <button type="button" class="tgTopbarBtn" :aria-label="t('common.close', undefined, 'Close')" @click="close">
                <v-icon icon="mdi-close" size="18" />
              </button>
            </header>
            <section class="tgHero">
              <span class="tgHeroAvatar">
                <img v-if="avatarSrc" :src="avatarSrc" alt="" class="tgHeroAvatarImg" />
                <span v-else>{{ initials }}</span>
              </span>
              <div class="tgHeroMain">
                <div class="tgHeroName">{{ displayName || t('settings.title', undefined, 'Settings') }}</div>
                <div class="tgHeroSub">@{{ username || 'username' }}</div>
                <div class="tgHeroStatus">{{ t('settings.status_online', undefined, 'Active & running') }}</div>
              </div>
            </section>

            <section class="tgCard">
              <TGRow
                icon="mdi-account-circle-outline"
                :title="t('settings.tg.account.title', undefined, 'My Account')"
                :sub="t('settings.tg.account.hint', undefined, 'Name, bio, phone, birthday, avatar')"
                @click="openPage('account')"
              />
              <TGRow
                icon="mdi-bell-outline"
                :title="t('settings.notifications_nav', undefined, 'Notifications and Sounds')"
                :sub="t('settings.tg.notif.hint', undefined, 'Global, per-chat, events, calls, badge')"
                @click="openPage('notifications')"
              />
              <TGRow
                icon="mdi-shield-lock-outline"
                :title="t('settings.privacy', undefined, 'Privacy & security')"
                :sub="t('settings.tg.security.hint', undefined, 'Sessions, blocked users, privacy rules')"
                @click="openPage('privacy')"
              />
              <TGRow
                icon="mdi-message-outline"
                :title="t('settings.tg.chat.title', undefined, 'Chat Settings')"
                :sub="t('settings.tg.chat.hint', undefined, 'Theme, accent color, wallpaper')"
                @click="openPage('chat')"
              />
              <TGRow
                icon="mdi-folder-outline"
                :title="t('settings.folders', undefined, 'Folders')"
                :sub="t('settings.tg.folders.hint', undefined, 'Group your chats')"
                @click="openPage('folders')"
              />
              <TGRow
                icon="mdi-database-outline"
                :title="t('settings.tg.advanced.title', undefined, 'Advanced')"
                :sub="t('settings.tg.advanced.hint', undefined, 'Data, storage, auto-download')"
                @click="openPage('advanced')"
              />
              <TGRow
                icon="mdi-timer-outline"
                :title="t('settings.tg.power.nav', undefined, 'Battery and Animations')"
                :sub="t('settings.tg.power.nav_hint', undefined, 'Power saving')"
                @click="openPage('power')"
              />
              <TGRow
                icon="mdi-translate"
                :title="t('common.language', undefined, 'Language')"
                :value="languageLabel"
                @click="openPage('language')"
              />
            </section>

            <section class="tgCard tgCardPad">
              <div class="settingsCard__title">{{ t('settings.tg.scale.title', undefined, 'Interface scale') }}</div>
              <div class="toggleRow">
                <div>
                  <div class="toggleRow__title">{{ t('settings.tg.scale.enable', undefined, 'Custom scale') }}</div>
                  <div class="toggleRow__sub">{{ t('settings.tg.scale.hint', undefined, 'Scales the whole interface from the default 100%.') }}</div>
                </div>
                <v-switch :model-value="scaleEnabled" hide-details inset color="primary" @update:model-value="onScaleToggle" />
              </div>
              <div class="tgSliderRow">
                <input
                  type="range"
                  class="tgSlider"
                  min="80"
                  max="150"
                  step="5"
                  :value="scalePercent"
                  :disabled="!scaleEnabled"
                  :aria-label="t('settings.tg.scale.title', undefined, 'Interface scale')"
                  @input="onScalePercent(Number(($event.target as HTMLInputElement).value))"
                />
                <span class="tgSliderVal">{{ scalePercent }}%</span>
              </div>
            </section>

            <section class="tgCard">
              <TGRow
                icon="mdi-information-outline"
                :title="t('settings.about_combox', undefined, 'About ComBox')"
                :value="APP_VERSION"
                @click="openPage('about')"
              />
            </section>
          </template>

          <template v-else>
            <header class="tgTopbar">
              <button type="button" class="tgTopbarBtn" :aria-label="t('settings.back', undefined, 'Back')" @click="goBack">
                <v-icon icon="mdi-arrow-left" size="18" />
              </button>
              <div class="tgTopbarTitle">{{ pageTitle }}</div>
              <button type="button" class="tgTopbarBtn" :aria-label="t('common.close', undefined, 'Close')" @click="close">
                <v-icon icon="mdi-close" size="18" />
              </button>
            </header>

            <MyAccountSettings v-if="page === 'account'" />
            <NotificationsSettings v-else-if="page === 'notifications'" />
            <PrivacySecuritySettings v-else-if="page === 'privacy'" ref="privacyRef" />
            <ChatSettings v-else-if="page === 'chat'" />
            <template v-else-if="page === 'folders'">
              <div class="tgPage">
                <RecommendedFolders @created="foldersKey += 1" />
                <FoldersSettings :key="foldersKey" />
              </div>
            </template>
            <AdvancedSettings v-else-if="page === 'advanced'" />
            <PowerSavingSettings v-else-if="page === 'power'" />
            <LanguageSettings v-else-if="page === 'language'" />
            <AboutSettings v-else />
          </template>
        </div>
      </section>
    </div>
    <AvatarViewer />
  </PageShell>
</template>

<style scoped>
.hub {
  height: 100dvh;
  overflow: hidden;
  color: var(--text);
}

.hubContent {
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.hubBody {
  padding: 22px 26px 40px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  display: grid;
  gap: 18px;
  align-content: start;
}

.hubBody--narrow {
  max-width: 560px;
}

@media (max-width: 560px) {
  .hubBody {
    padding: 14px 12px 32px;
  }
}
</style>
