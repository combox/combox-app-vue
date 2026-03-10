<script setup lang="ts">
import { ref } from 'vue'
import AuthFlow from '../components/auth/AuthFlow.vue'
import { useI18n } from '../i18n/i18n'

const { locale, setLocale, t } = useI18n()
const langOpen = ref(false)

const LANG_ROWS = [
  { id: 'en', title: t('common.lang_native_en'), subtitle: t('common.lang_name_en'), enabled: true },
  { id: 'ru', title: t('common.lang_native_ru'), subtitle: t('common.lang_name_ru'), enabled: true },
  { id: 'de', title: t('common.lang_native_de'), subtitle: t('common.lang_name_de'), enabled: false },
  { id: 'fr', title: t('common.lang_native_fr'), subtitle: t('common.lang_name_fr'), enabled: false },
  { id: 'it', title: t('common.lang_native_it'), subtitle: t('common.lang_name_it'), enabled: false },
  { id: 'nl', title: t('common.lang_native_nl'), subtitle: t('common.lang_name_nl'), enabled: false },
  { id: 'pl', title: t('common.lang_native_pl'), subtitle: t('common.lang_name_pl'), enabled: false },
  { id: 'uk', title: t('common.lang_native_uk'), subtitle: t('common.lang_name_uk'), enabled: false },
] as const

function selectLocale(id: string, enabled: boolean) {
  if (!enabled) return
  setLocale(id as 'en' | 'ru')
  langOpen.value = false
}
</script>

<template>
  <div class="auth-main">
    <v-sheet class="auth-sheet" border>
      <v-btn icon variant="outlined" size="small" class="lang-btn" :aria-label="t('common.language')" @click="langOpen = true">
        <v-icon icon="mdi-translate" />
      </v-btn>
      <AuthFlow />
    </v-sheet>

    <v-navigation-drawer v-model="langOpen" location="right" temporary :width="420" class="lang-drawer">
      <div class="d-flex align-center ga-2 px-4 pt-4 pb-3 lang-header">
        <v-btn icon variant="text" size="small" :aria-label="t('auth.back')" @click="langOpen = false">
          <v-icon icon="mdi-arrow-left" />
        </v-btn>
        <div class="text-h6 font-weight-bold">{{ t('common.language') }}</div>
      </div>
      <v-divider />
      <div class="px-4 pt-4 pb-2 text-medium-emphasis text-caption">{{ t('common.interface_language') }}</div>
      <v-list density="compact" class="lang-list">
        <v-list-item
          v-for="item in LANG_ROWS"
          :key="item.id"
          :title="item.title"
          :subtitle="item.subtitle"
          :disabled="!item.enabled"
          :active="locale === item.id"
          @click="selectLocale(item.id, item.enabled)"
        >
          <template #prepend>
            <v-radio :model-value="locale === item.id" :disabled="!item.enabled" density="compact" />
          </template>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>
  </div>
</template>

<style scoped>
.auth-main {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: var(--app-bg);
}

.auth-sheet {
  width: min(480px, 100%);
  position: relative;
  padding: 16px;
  border-radius: var(--radius-card);
  background: var(--surface) !important;
  color: var(--text);
  border-color: var(--border) !important;
  box-shadow: var(--shadow-soft);
}

@media (min-width: 600px) {
  .auth-sheet {
    padding: 24px;
  }
}

.lang-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 34px;
  height: 34px;
  border-radius: 0;
  color: var(--text-soft);
  border-color: var(--border-strong);
}

.lang-header {
  font-weight: 600;
}

.lang-list {
  padding-bottom: 8px;
}

:deep(.lang-drawer .v-navigation-drawer__content) {
  width: min(420px, 100vw);
}

:deep(.lang-drawer .v-list-item) {
  border-radius: 0;
}

:deep(.lang-drawer .v-list-item--active) {
  background: var(--surface-soft);
}
</style>
