<script setup lang="ts">
import { useI18n } from '../../i18n/i18n'
import StorageSettings from './StorageSettings.vue'
import './settingsShared.css'

const { t } = useI18n()
</script>

<template>
  <div class="tgPage">
    <StorageSettings />
    <section class="tgCard tgCardPad">
      <div class="settingsCard__title">{{ t('settings.tg.advanced.native_title', undefined, 'Native only') }}</div>
      <div class="settingsSectionText">
        {{
          t(
            'settings.tg.advanced.native_hint',
            undefined,
            'Connection type, download path, tray, autostart, spellcheck and data export exist only in native apps. The web version has nothing to configure here.',
          )
        }}
      </div>
    </section>
  </div>
</template>
