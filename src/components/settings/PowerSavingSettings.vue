<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useUserSettings } from './userSettingsMeta'
import { applyPowerSaving, loadPowerSaving, savePowerSaving, type PowerSaving } from './settingsEffects'
import './settingsShared.css'

const { t } = useI18n()
const backend = useUserSettings()
const state = ref<PowerSaving>({ all: false, media: false, ui: false })

function patch(next: Partial<PowerSaving>): void {
  state.value = { ...state.value, ...next }
  if (state.value.all) state.value = { all: true, media: true, ui: true }
  savePowerSaving(state.value)
}

onMounted(() => {
  state.value = loadPowerSaving()
  applyPowerSaving(state.value)
  void backend.load()
})
</script>

<template>
  <div class="tgPage">
    <section class="tgCard tgCardPad">
      <div class="settingsCard__title">{{ t('settings.tg.power.title', undefined, 'Power saving') }}</div>
      <div class="settingsSectionText">
        {{ t('settings.tg.power.hint', undefined, 'Disables animations for real via classes on the page root. Stored on this device.') }}
      </div>
      <v-alert v-if="backend.error" type="error" class="mb-4">{{ backend.error }}</v-alert>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.power.all', undefined, 'Disable all animations') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.power.all_hint', undefined, 'Kills every CSS animation and transition in the app.') }}</div>
        </div>
        <v-switch :model-value="state.all" hide-details inset color="primary" @update:model-value="patch({ all: $event ?? false })" />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.power.media', undefined, 'Animated stickers and emoji') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.power.media_hint', undefined, 'Freezes CSS-driven motion on media elements.') }}</div>
        </div>
        <v-switch :model-value="state.media" :disabled="state.all" hide-details inset color="primary" @update:model-value="patch({ media: $event ?? false })" />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.power.ui', undefined, 'Interface animations') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.power.ui_hint', undefined, 'Removes transitions on dialogs, overlays and menus.') }}</div>
        </div>
        <v-switch :model-value="state.ui" :disabled="state.all" hide-details inset color="primary" @update:model-value="patch({ ui: $event ?? false })" />
      </div>

      <div class="toggleRow">
        <div>
          <div class="toggleRow__title">{{ t('settings.tg.power.autoplay', undefined, 'Autoplay media') }}</div>
          <div class="toggleRow__sub">{{ t('settings.tg.power.autoplay_hint', undefined, 'Server-side: stops automatic media playback with power saving.') }}</div>
        </div>
        <v-switch
          :model-value="backend.values.media_autoplay"
          :disabled="Boolean(backend.pending.media_autoplay)"
          hide-details
          inset
          color="primary"
          @update:model-value="backend.set('media_autoplay', $event)"
        />
      </div>
    </section>
  </div>
</template>
