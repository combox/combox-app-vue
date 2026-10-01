<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ToastHost from './components/core/ToastHost.vue'
import LegacyMigrationModal from './components/auth/LegacyMigrationModal.vue'
import PollCreateDialog from './components/chat/PollCreateDialog.vue'
import FolderImportModal from './components/chat/FolderImportModal.vue'
import { useI18n } from './i18n/i18n'
import { closePollCreateDialog, pollCreateTarget } from './utils/pollCreate'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
// Landmark audit fix (single change allowed in this file): Home (/) and
// Settings (/settings) already render exactly one <main> via PageShell, while
// /auth has none — so only the auth route gets a <main> wrapper here. This
// keeps exactly one main landmark on every route (nested/duplicated mains
// would fail the same audit).
const needsMainLandmark = computed(() => route.path === '/auth' || route.path.startsWith('/auth/'))
/**
 * Shared folder deep link (/folder/:token). The modal lives next to ToastHost
 * — outside <main>/<router-view> — so the single-main-landmark audit stays
 * green and the route component (HomePage) keeps rendering behind it.
 */
const folderInviteToken = computed(() => {
  if (!route.path.startsWith('/folder/')) return ''
  const raw = route.params.token
  const token = Array.isArray(raw) ? raw[0] : raw
  return String(token || '').trim()
})

function closeFolderInvite() {
  void router.push('/')
}

function onFolderImported() {
  // The sidebar behind the modal keeps its folder list: poke it to reload.
  window.dispatchEvent(new Event('combox:folders-changed'))
}
const isOffline = ref(!window.navigator.onLine)
const deferredInstallPrompt = ref<BeforeInstallPromptEvent | null>(null)
const canInstall = computed(() => Boolean(deferredInstallPrompt.value))

function handleOnline() {
  isOffline.value = false
}

function handleOffline() {
  isOffline.value = true
}

function handleBeforeInstallPrompt(event: Event) {
  event.preventDefault()
  deferredInstallPrompt.value = event as BeforeInstallPromptEvent
}

function handleAppInstalled() {
  deferredInstallPrompt.value = null
}

async function installApp() {
  const promptEvent = deferredInstallPrompt.value
  if (!promptEvent) return
  await promptEvent.prompt()
  const choice = await promptEvent.userChoice
  if (choice.outcome !== 'accepted') return
  deferredInstallPrompt.value = null
}

onMounted(() => {
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.addEventListener('appinstalled', handleAppInstalled)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.removeEventListener('appinstalled', handleAppInstalled)
})
</script>

<template>
  <v-app>
    <div class="appStatusStack">
      <div v-if="isOffline" class="appStatus appStatus--offline">
        <v-icon icon="mdi-wifi-off" size="16" />
        <span class="appStatusText">{{ t('app.offline_notice', undefined, 'You are offline') }}</span>
      </div>
      <div v-if="canInstall" class="appStatus appStatus--install">
        <v-icon icon="mdi-cellphone-arrow-down" size="16" />
        <span class="appStatusText">{{ t('app.install_ready', undefined, 'Install the app for quick access') }}</span>
        <button type="button" class="appInstallBtn" @click="installApp">
          {{ t('app.install_action', undefined, 'Install') }}
        </button>
      </div>
    </div>
    <main v-if="needsMainLandmark"><router-view /></main>
    <router-view v-else />
    <PollCreateDialog :chat-id="pollCreateTarget?.chatID ?? ''" @close="closePollCreateDialog" />
    <FolderImportModal v-if="folderInviteToken" :token="folderInviteToken" @close="closeFolderInvite" @imported="onFolderImported" />
    <ToastHost />
    <!-- Legacy email-binding: Teleports to body itself, stays outside <main> like ToastHost. -->
    <LegacyMigrationModal />
  </v-app>
</template>

<style scoped>
.appStatusStack {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 5000;
  display: grid;
  gap: 10px;
  width: min(360px, calc(100% - 24px));
  pointer-events: none;
}

.appStatus {
  min-height: 42px;
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  pointer-events: auto;
  font-size: 12px;
  font-weight: 700;
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
}

.appStatusText {
  line-height: 1.3;
  flex: 1 1 auto;
  min-width: 0;
}

.appStatus--offline {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.appStatus--install {
  background: color-mix(in srgb, var(--surface, #ffffff) 88%, transparent);
  color: var(--text, #0f172a);
  border: 1px solid var(--border, rgba(15, 23, 42, 0.22));
}

.appInstallBtn {
  border: 0;
  height: 28px;
  border-radius: 999px;
  padding: 0 11px;
  background: #4a90d9;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex: 0 0 auto;
  cursor: pointer;
}

.appInstallBtn:hover {
  background: #347ecb;
}

@media (max-width: 720px) {
  .appStatusStack {
    top: 8px;
    left: 8px;
    right: 8px;
    width: auto;
  }
}
</style>
