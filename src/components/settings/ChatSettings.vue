<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../../i18n/i18n'
import {
  accentPresets,
  applyTheme,
  loadThemePrefs,
  resolveEffectiveTheme,
  resolveWallpaperCss,
  saveThemePrefs,
  wallpaperPresets,
  type AccentId,
  type ThemeMode,
  type ThemePrefs,
  type WallpaperId,
} from '../../theme/theme'
import './settingsShared.css'

const { t } = useI18n()

const prefs = ref<ThemePrefs>(loadThemePrefs())
const effective = computed(() => resolveEffectiveTheme(prefs.value.mode))

function update(patch: Partial<ThemePrefs>): void {
  prefs.value = { ...prefs.value, ...patch }
  applyTheme(prefs.value)
  saveThemePrefs(prefs.value)
}

function setMode(mode: ThemeMode): void {
  const before = { ...prefs.value }
  update({ mode })
  // Same Telegram Web-like correction as the sidebar pane: picking Dark must
  // feel dark even when the dark side was never configured before.
  const next = resolveEffectiveTheme(mode)
  if (next === 'dark') {
    const looksLight =
      before.wallpaperDark === 'paper' ||
      before.wallpaperDark === 'sky' ||
      before.wallpaperDark === 'mint' ||
      before.wallpaperDark === 'lavender' ||
      before.wallpaperDark === 'peach'
    if (looksLight) update({ wallpaperDark: 'midnight', customWallpaperBaseDark: '#111827' })
    else if ((before.customWallpaperBaseDark || '').toLowerCase() === '#dbeafe') {
      update({ customWallpaperBaseDark: '#111827' })
    }
    return
  }
  if (next === 'light' && before.wallpaperLight === 'midnight') {
    update({ wallpaperLight: 'paper', customWallpaperBaseLight: '#dbeafe' })
  }
}

function setWallpaper(id: WallpaperId): void {
  if (effective.value === 'dark') update({ wallpaperDark: id })
  else update({ wallpaperLight: id })
}

function wallpaperPreview(id: WallpaperId): string {
  const patch = effective.value === 'dark' ? { wallpaperDark: id } : { wallpaperLight: id }
  return resolveWallpaperCss({ ...prefs.value, ...patch }, effective.value)
}

const selectedWallpaper = computed(() =>
  effective.value === 'dark' ? prefs.value.wallpaperDark : prefs.value.wallpaperLight,
)

const customBase = computed(() =>
  effective.value === 'dark'
    ? prefs.value.customWallpaperBaseDark || '#111827'
    : prefs.value.customWallpaperBaseLight || '#dbeafe',
)

function setCustomBase(hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return
  if (effective.value === 'dark') update({ wallpaperDark: 'custom', customWallpaperBaseDark: hex })
  else update({ wallpaperLight: 'custom', customWallpaperBaseLight: hex })
}

function modeLabel(mode: ThemeMode): string {
  if (mode === 'light') return t('settings.tg.chat.theme_light', undefined, 'Light')
  if (mode === 'dark') return t('settings.tg.chat.theme_dark', undefined, 'Dark')
  return t('settings.tg.chat.theme_system', undefined, 'System')
}
</script>

<template>
  <div class="tgPage">
    <section class="tgCard">
      <div class="tgSectionLabel">{{ t('settings.tg.chat.theme', undefined, 'Color theme') }}</div>
      <div class="tgSegment" role="radiogroup" :aria-label="t('settings.tg.chat.theme', undefined, 'Color theme')">
        <button
          v-for="mode in (['system', 'light', 'dark'] as ThemeMode[])"
          :key="mode"
          type="button"
          class="tgSegmentBtn"
          :class="{ active: prefs.mode === mode }"
          role="radio"
          :aria-checked="prefs.mode === mode"
          @click="setMode(mode)"
        >
          <v-icon :icon="mode === 'system' ? 'mdi-theme-light-dark' : mode === 'light' ? 'mdi-weather-sunny' : 'mdi-weather-night'" size="16" />
          {{ modeLabel(mode) }}
        </button>
      </div>
      <div class="tgHint">
        {{ t('settings.tg.chat.theme_hint', undefined, 'Applies instantly to the whole app and is remembered on this device.') }}
      </div>
    </section>

    <section class="tgCard">
      <div class="tgSectionLabel">{{ t('settings.tg.chat.accent', undefined, 'Accent color') }}</div>
      <div class="tgSwatches">
        <button
          v-for="accent in accentPresets.filter((a) => a.id !== 'custom')"
          :key="accent.id"
          type="button"
          class="tgSwatch"
          :class="{ active: prefs.accent === accent.id }"
          :style="{ background: accent.hex }"
          :aria-label="accent.id"
          :title="accent.id"
          @click="update({ accent: accent.id as AccentId })"
        />
        <label class="tgSwatch tgSwatchCustom" :class="{ active: prefs.accent === 'custom' }" :title="t('settings.custom', undefined, 'Custom')">
          <input
            type="color"
            class="tgColorInput"
            :value="prefs.customAccent || '#4a90d9'"
            @input="update({ accent: 'custom', customAccent: ($event.target as HTMLInputElement).value })"
          />
          <v-icon icon="mdi-palette-outline" size="18" />
        </label>
      </div>
    </section>

    <section class="tgCard">
      <div class="tgSectionLabel">
        {{
          t(
            'settings.tg.chat.wallpaper_side',
            { side: effective === 'dark' ? t('settings.tg.chat.theme_dark', undefined, 'Dark') : t('settings.tg.chat.theme_light', undefined, 'Light') },
            'Chat wallpaper ({side} side)',
          )
        }}
      </div>
      <div class="tgHint">
        {{ t('settings.tg.chat.wallpaper_hint', undefined, 'Switch the theme above to style the other side.') }}
      </div>
      <div class="tgWallGrid">
        <button
          v-for="w in wallpaperPresets.filter((w) => w.id !== 'custom')"
          :key="w.id"
          type="button"
          class="tgWall"
          :class="{ active: selectedWallpaper === w.id }"
          :style="{ background: wallpaperPreview(w.id as WallpaperId) }"
          :aria-label="w.id"
          :title="w.id"
          @click="setWallpaper(w.id as WallpaperId)"
        />
        <label class="tgWall tgWallCustom" :class="{ active: selectedWallpaper === 'custom' }" :title="t('settings.custom', undefined, 'Custom')">
          <input type="color" class="tgColorInput" :value="customBase" @input="setCustomBase(($event.target as HTMLInputElement).value)" />
          <v-icon icon="mdi-palette-outline" size="18" />
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tgSegment {
  display: flex;
}

.tgSegmentBtn {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;
  justify-content: center;
}

.tgSwatchCustom,
.tgWallCustom {
  position: relative;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--text-soft);
  overflow: hidden;
}

.tgColorInput {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
</style>
