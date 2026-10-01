<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useUserSettings, type UserSettingKey } from './userSettingsMeta'
import './settingsShared.css'

const { t } = useI18n()
const { values, pending, error, load, set } = useUserSettings()

/** Bytes stored in this origin's localStorage, or null when unavailable. */
function localStorageBytes(): number | null {
  try {
    let total = 0
    let entries = 0
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key) continue
      const value = window.localStorage.getItem(key) ?? ''
      total += (key.length + value.length) * 2
      entries += 1
    }
    return entries > 0 ? total : null
  } catch {
    return null
  }
}

/** Cache size reported by the browser, or null when the API is missing. */
async function cacheBytes(): Promise<number | null> {
  try {
    const storage = navigator.storage
    if (!storage || typeof storage.estimate !== 'function') return null
    const estimate = await storage.estimate()
    return typeof estimate.usage === 'number' ? estimate.usage : null
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

const usage = ref<number | null>(null)

function toggle(key: UserSettingKey, next: boolean | null): void {
  void set(key, next)
}

async function measureUsage(): Promise<void> {
  const local = localStorageBytes()
  usage.value = local ?? (await cacheBytes())
}

onMounted(() => {
  void load()
  void measureUsage()
})
</script>

<template>
  <section class="hubSectionIntro">
    <div class="hubSectionIntroIcon"><v-icon icon="mdi-database-outline" size="24" /></div>
    <div>
      <div class="hubSectionIntroTitle">{{ t('settings.data_storage', undefined, 'Data and Storage') }}</div>
      <div class="hubSectionIntroText">
        {{ t('settings.data_storage_intro', undefined, 'Control traffic usage and what is downloaded automatically.') }}
      </div>
    </div>
  </section>

  <section class="settingsCard settingsCard--full">
    <div class="settingsCard__title">{{ t('settings.data_saver_block', undefined, 'Network') }}</div>
    <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>

    <div class="toggleRow">
      <div>
        <div class="toggleRow__title">{{ t('settings.data_saver', undefined, 'Data saver') }}</div>
        <div class="toggleRow__sub">
          {{ t('settings.data_saver_hint', undefined, 'Reduce the amount of mobile data used by ComBox.') }}
        </div>
      </div>
      <v-switch
        :model-value="values.data_saver"
        :disabled="pending.data_saver"
        hide-details
        inset
        color="primary"
        @update:model-value="toggle('data_saver', $event)"
      />
    </div>

    <div class="toggleRow">
      <div>
        <div class="toggleRow__title">{{ t('settings.auto_download_photos', undefined, 'Auto-download photos') }}</div>
        <div class="toggleRow__sub">
          {{ t('settings.auto_download_photos_hint', undefined, 'Download photos as soon as a chat is opened.') }}
        </div>
      </div>
      <v-switch
        :model-value="values.auto_download_photos"
        :disabled="pending.auto_download_photos"
        hide-details
        inset
        color="primary"
        @update:model-value="toggle('auto_download_photos', $event)"
      />
    </div>

    <div class="toggleRow">
      <div>
        <div class="toggleRow__title">{{ t('settings.auto_download_videos', undefined, 'Auto-download videos') }}</div>
        <div class="toggleRow__sub">
          {{ t('settings.auto_download_videos_hint', undefined, 'Download videos in the background while you browse.') }}
        </div>
      </div>
      <v-switch
        :model-value="values.auto_download_videos"
        :disabled="pending.auto_download_videos"
        hide-details
        inset
        color="primary"
        @update:model-value="toggle('auto_download_videos', $event)"
      />
    </div>

    <div class="toggleRow">
      <div>
        <div class="toggleRow__title">{{ t('settings.auto_download_files', undefined, 'Auto-download files') }}</div>
        <div class="toggleRow__sub">
          {{ t('settings.auto_download_files_hint', undefined, 'Download documents and other files automatically.') }}
        </div>
      </div>
      <v-switch
        :model-value="values.auto_download_files"
        :disabled="pending.auto_download_files"
        hide-details
        inset
        color="primary"
        @update:model-value="toggle('auto_download_files', $event)"
      />
    </div>
  </section>

  <section v-if="usage !== null" class="settingsCard settingsCard--full">
    <div class="settingsCard__title">{{ t('settings.storage_usage', undefined, 'Storage usage') }}</div>
    <div class="infoList">
      <div class="infoRow">
        <div class="infoRow__icon"><v-icon icon="mdi-harddisk" size="18" /></div>
        <div class="infoRow__body">
          <div class="infoRow__value">{{ formatBytes(usage) }}</div>
          <div class="infoRow__label">
            {{ t('settings.storage_usage_hint', undefined, 'Taken by app data and cache on this device.') }}
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
