<script setup lang="ts">
import { useI18n } from '../../i18n/i18n'
import './settingsShared.css'

const { t, locale, setLocale } = useI18n()

const OPTIONS = [
  { id: 'en' as const, label: 'English', sub: 'English' },
  { id: 'ru' as const, label: 'Русский', sub: 'Russian' },
]
</script>

<template>
  <div class="tgPage">
    <section class="tgCard">
      <div class="tgSectionLabel">{{ t('common.language', undefined, 'Language') }}</div>
      <button
        v-for="option in OPTIONS"
        :key="option.id"
        type="button"
        class="tgRow"
        @click="setLocale(option.id)"
      >
        <span class="tgRowIcon" aria-hidden="true"><v-icon icon="mdi-translate" size="20" /></span>
        <span class="tgRowMain">
          <span class="tgRowTitle">{{ option.label }}</span>
          <span class="tgRowSub">{{ option.sub }}</span>
        </span>
        <v-icon v-if="locale === option.id" icon="mdi-check" size="20" class="tgCheck" />
      </button>
      <div class="tgHint">
        {{ t('settings.tg.language.hint', undefined, 'Applies instantly and is remembered on this device.') }}
      </div>
    </section>
  </div>
</template>

<style scoped>
.tgCheck {
  color: var(--accent-strong);
  flex: 0 0 auto;
}
</style>
