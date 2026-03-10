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

const props = defineProps<{
  currentUserAvatarSrc: string
  currentUserDisplayName: string
  currentUsername: string
  currentBirthDate: string
  settingsLoading: boolean
  settingsSaving: boolean
  settingsError: string
  settingsSuccess: string
  profileDraft: { first_name: string; last_name: string; username: string; birth_date: string }
  sessionIdleDays: number
  passwordDraft: { current: string; next: string }
  passwordSaving: boolean
  emailDraft: { email: string; oldCode: string; newCode: string }
  emailStep: 'old' | 'new' | 'confirm'
  emailBusy: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:session-days', value: number): void
  (e: 'save-profile'): void
  (e: 'save-password'): void
  (e: 'start-email-flow'): void
  (e: 'verify-old-code'): void
  (e: 'send-new-email-code'): void
  (e: 'confirm-new-email'): void
}>()

const editMode = ref(false)
const { t } = useI18n()

const themePrefs = ref<ThemePrefs>(loadThemePrefs())
const effectiveTheme = computed(() => resolveEffectiveTheme(themePrefs.value.mode))
const systemTheme = computed(() => resolveEffectiveTheme('system'))

const APP_BG_LIGHT =
  'radial-gradient(circle at top left, rgba(255, 255, 255, 0.92), rgba(238, 242, 247, 0.95) 42%), linear-gradient(180deg, #f5f7fb 0%, #edf1f6 100%)'
const APP_BG_DARK =
  'radial-gradient(circle at top left, rgba(36, 36, 44, 0.92), rgba(11, 11, 12, 0.95) 42%), linear-gradient(180deg, #0b0b0c 0%, #050506 100%)'

const systemAppBgPreview = computed(() => (systemTheme.value === 'dark' ? APP_BG_DARK : APP_BG_LIGHT))

function updateTheme(patch: Partial<ThemePrefs>) {
  themePrefs.value = { ...themePrefs.value, ...patch }
  applyTheme(themePrefs.value)
  saveThemePrefs(themePrefs.value)
}

function setThemeMode(mode: ThemeMode) {
  const before = { ...themePrefs.value }
  updateTheme({ mode })

  // Telegram Web-like behavior: selecting Dark should immediately feel "dark",
  // even if the user never configured dark wallpaper/colors before.
  const effective = resolveEffectiveTheme(mode)

  if (effective === 'dark') {
    const looksLight =
      before.wallpaperDark === 'paper' ||
      before.wallpaperDark === 'sky' ||
      before.wallpaperDark === 'mint' ||
      before.wallpaperDark === 'lavender' ||
      before.wallpaperDark === 'peach'

    if (looksLight) {
      updateTheme({ wallpaperDark: 'midnight', customWallpaperBaseDark: '#111827' })
    } else if ((before.customWallpaperBaseDark || '').toLowerCase() === '#dbeafe') {
      updateTheme({ customWallpaperBaseDark: '#111827' })
    }

    return
  }

  if (effective === 'light') {
    if (before.wallpaperLight === 'midnight') {
      updateTheme({ wallpaperLight: 'paper', customWallpaperBaseLight: '#dbeafe' })
    }
  }
}

function setWallpaper(id: WallpaperId) {
  if (effectiveTheme.value === 'dark') {
    updateTheme({ wallpaperDark: id })
    return
  }
  updateTheme({ wallpaperLight: id })
}

function setAccent(id: AccentId) {
  updateTheme({ accent: id })
}

function setCustomAccent(hex: string) {
  updateTheme({ accent: 'custom', customAccent: hex })
}

function setCustomWallpaperBase(hex: string) {
  if (effectiveTheme.value === 'dark') {
    updateTheme({ wallpaperDark: 'custom', customWallpaperBaseDark: hex })
    return
  }
  updateTheme({ wallpaperLight: 'custom', customWallpaperBaseLight: hex })
}

function wallpaperPreview(id: WallpaperId): string {
  const patch = effectiveTheme.value === 'dark' ? { wallpaperDark: id } : { wallpaperLight: id }
  return resolveWallpaperCss({ ...themePrefs.value, ...patch }, effectiveTheme.value)
}

const selectedWallpaper = computed(() => (effectiveTheme.value === 'dark' ? themePrefs.value.wallpaperDark : themePrefs.value.wallpaperLight))
const selectedWallpaperBase = computed(() =>
  effectiveTheme.value === 'dark' ? themePrefs.value.customWallpaperBaseDark || '#111827' : themePrefs.value.customWallpaperBaseLight || '#dbeafe',
)

const initials = computed(() => {
  const first = props.profileDraft.first_name.trim().slice(0, 1).toUpperCase()
  const last = props.profileDraft.last_name.trim().slice(0, 1).toUpperCase()
  return `${first}${last}`.trim() || (props.currentUsername || props.currentUserDisplayName || t('settings.user_fallback')).slice(0, 1).toUpperCase()
})

const displayName = computed(() => {
  const draft = `${props.profileDraft.first_name} ${props.profileDraft.last_name}`.trim()
  return draft || props.currentUserDisplayName || props.currentUsername || t('settings.user_fallback')
})

const birthdayText = computed(() => {
  const raw = (props.profileDraft.birth_date || props.currentBirthDate || '').trim()
  if (!raw) return '—'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
})

function handleBack() {
  if (editMode.value) {
    editMode.value = false
    return
  }
  emit('close')
}
</script>

<template>
  <div class="spRoot">
    <header class="spHeader">
      <button type="button" class="spIconBtn" :aria-label="t('chat.back')" @click="handleBack">
        <v-icon icon="mdi-arrow-left" size="18" />
      </button>
      <div class="spTitle">{{ editMode ? t('settings.edit_profile') : t('settings.title') }}</div>
      <div class="spHeaderActions">
        <button v-if="!editMode" type="button" class="spIconBtn" :aria-label="t('settings.edit_profile')" @click="editMode = true">
          <v-icon icon="mdi-pencil-outline" size="18" />
        </button>
      </div>
    </header>

    <div class="spScroll">
      <div v-if="settingsError" class="spAlert spAlert--error">{{ settingsError }}</div>
      <div v-if="settingsSuccess" class="spAlert spAlert--success">{{ settingsSuccess }}</div>

      <template v-if="!editMode">
        <section class="spHeroView">
          <div v-if="currentUserAvatarSrc" class="spHeroAvatar">
            <img :src="currentUserAvatarSrc" alt="" class="spAvatarImg" />
          </div>
          <div v-else class="spHeroAvatar spHeroAvatar--fallback">{{ initials }}</div>
          <div class="spHeroName">{{ displayName }}</div>
          <div class="spHeroStatus">{{ t('settings.online') }}</div>
        </section>

        <section class="spInfoList">
          <article class="spInfoRow">
            <div class="spInfoIcon"><v-icon icon="mdi-at" size="20" /></div>
            <div class="spInfoBody">
              <div class="spInfoValue">@{{ props.profileDraft.username || props.currentUsername || t('settings.username').toLowerCase() }}</div>
              <div class="spInfoLabel">{{ t('settings.username') }}</div>
            </div>
          </article>

          <article class="spInfoRow">
            <div class="spInfoIcon"><v-icon icon="mdi-cake-variant-outline" size="20" /></div>
            <div class="spInfoBody">
              <div class="spInfoValue">{{ birthdayText }}</div>
              <div class="spInfoLabel">{{ t('settings.birth_date') }}</div>
            </div>
          </article>

          <article class="spInfoRow">
            <div class="spInfoIcon"><v-icon icon="mdi-timer-outline" size="20" /></div>
            <div class="spInfoBody">
              <div class="spInfoValue">{{ t('settings.session_duration_days', { count: props.sessionIdleDays }, `${props.sessionIdleDays} days`) }}</div>
              <div class="spInfoLabel">{{ t('settings.session_duration') }}</div>
            </div>
          </article>
        </section>

        <section class="spSection">
          <div class="spSectionTitle">{{ t('settings.appearance', {}, 'Appearance') }}</div>

          <div class="spRow spRow--stack">
            <div class="spRowLabel">{{ t('settings.theme', {}, 'Theme') }}</div>
            <div class="spThemeCards">
              <button type="button" class="spThemeCard" :class="{ active: themePrefs.mode === 'system' }" @click="setThemeMode('system')">
                <div class="spThemePreview" :style="{ background: systemAppBgPreview }" />
                <div class="spThemeName">{{ t('settings.theme_system', {}, 'System') }}</div>
                <div class="spThemeHint">{{ systemTheme === 'dark' ? t('settings.theme_dark', {}, 'Dark') : t('settings.theme_light', {}, 'Light') }}</div>
              </button>

              <button type="button" class="spThemeCard" :class="{ active: themePrefs.mode === 'light' }" @click="setThemeMode('light')">
                <div class="spThemePreview spThemePreview--light" />
                <div class="spThemeName">{{ t('settings.theme_light', {}, 'Light') }}</div>
                <div class="spThemeHint">{{ t('settings.theme_light', {}, 'Light') }}</div>
              </button>

              <button type="button" class="spThemeCard" :class="{ active: themePrefs.mode === 'dark' }" @click="setThemeMode('dark')">
                <div class="spThemePreview spThemePreview--dark" />
                <div class="spThemeName">{{ t('settings.theme_dark', {}, 'Dark') }}</div>
                <div class="spThemeHint">{{ t('settings.theme_dark', {}, 'Dark') }}</div>
              </button>
            </div>
          </div>

          <div class="spRow spRow--stack">
            <div class="spRowLabel">{{ t('settings.chat_wallpaper', {}, 'Chat wallpaper') }}</div>
            <div class="spWallpapers">
              <button
                v-for="w in wallpaperPresets"
                :key="w.id"
                type="button"
                class="spWallpaperTile"
                :class="{ active: selectedWallpaper === w.id }"
                :style="{ background: wallpaperPreview(w.id) }"
                :aria-label="w.id"
                @click="setWallpaper(w.id)"
              />
            </div>
            <label class="spInline">
              <span class="spInlineLabel">{{ t('settings.wallpaper_color', {}, 'Wallpaper color') }}</span>
              <input
                type="color"
                class="spColorInput"
                :value="selectedWallpaperBase"
                @input="setCustomWallpaperBase(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <div class="spRow spRow--stack">
            <div class="spRowLabel">{{ t('settings.accent_color', {}, 'Accent color') }}</div>
            <div class="spAccents">
              <button
                v-for="a in accentPresets"
                :key="a.id"
                type="button"
                class="spAccentDot"
                :class="{ active: themePrefs.accent === a.id }"
                :style="{ background: a.id === 'custom' ? (themePrefs.customAccent || a.hex) : a.hex }"
                :aria-label="a.id"
                @click="setAccent(a.id)"
              />
            </div>
            <label class="spInline">
              <span class="spInlineLabel">{{ t('settings.custom', {}, 'Custom') }}</span>
              <input
                type="color"
                class="spColorInput"
                :value="themePrefs.customAccent || '#4a90d9'"
                @input="setCustomAccent(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="spEditHero">
          <div v-if="currentUserAvatarSrc" class="spEditAvatar">
            <img :src="currentUserAvatarSrc" alt="" class="spAvatarImg" />
            <div class="spEditAvatarOverlay"><v-icon icon="mdi-camera-plus-outline" size="34" /></div>
          </div>
          <div v-else class="spEditAvatar spHeroAvatar--fallback">
            {{ initials }}
            <div class="spEditAvatarOverlay"><v-icon icon="mdi-camera-plus-outline" size="34" /></div>
          </div>
        </section>

        <section class="spSection">
          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.first_name') }}</span>
            <input v-model="profileDraft.first_name" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.last_name') }}</span>
            <input v-model="profileDraft.last_name" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.username') }}</span>
            <input v-model="profileDraft.username" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.birth_date') }}</span>
            <input v-model="profileDraft.birth_date" type="date" class="spInput" :disabled="settingsLoading || settingsSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.session_duration') }}</span>
            <input
              :value="sessionIdleDays"
              type="number"
              min="1"
              max="365"
              class="spInput"
              :disabled="settingsLoading || settingsSaving"
              @input="$emit('update:session-days', Number(($event.target as HTMLInputElement).value || 1))"
            />
          </label>

          <button type="button" class="spBtn spBtn--primary" :disabled="settingsLoading || settingsSaving" @click="emit('save-profile')">
            {{ settingsSaving ? t('settings.save_profile_busy') : t('settings.save_profile') }}
          </button>
        </section>

        <section class="spSection">
          <div class="spSectionTitle">{{ t('settings.password') }}</div>
          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.current_password') }}</span>
            <input v-model="passwordDraft.current" type="password" class="spInput" :disabled="passwordSaving" />
          </label>

          <label class="spField">
            <span class="spFieldLabel">{{ t('settings.new_password') }}</span>
            <input v-model="passwordDraft.next" type="password" class="spInput" :disabled="passwordSaving" />
          </label>

          <button type="button" class="spBtn spBtn--primary" :disabled="passwordSaving" @click="emit('save-password')">
            {{ passwordSaving ? t('settings.changing_password') : t('settings.change_password') }}
          </button>
        </section>

        <section class="spSection">
          <div class="spSectionTitle">{{ t('settings.email_change') }}</div>
          <div class="spHint">{{ t('settings.email_change_intro') }}</div>

          <template v-if="emailStep === 'old'">
            <button
              v-if="!emailDraft.oldCode"
              type="button"
              class="spBtn spBtn--soft"
              :disabled="emailBusy"
              @click="emit('start-email-flow')"
            >
              {{ emailBusy ? t('settings.sending') : t('settings.send_code_current') }}
            </button>
            <label class="spField">
              <span class="spFieldLabel">{{ t('settings.code_current') }}</span>
              <input v-model="emailDraft.oldCode" class="spInput" :disabled="emailBusy" />
            </label>
            <button type="button" class="spBtn spBtn--primary" :disabled="emailBusy" @click="emit('verify-old-code')">
              {{ emailBusy ? t('settings.checking') : t('settings.verify_old_email_code') }}
            </button>
          </template>

          <template v-else-if="emailStep === 'new'">
            <label class="spField">
              <span class="spFieldLabel">{{ t('settings.new_email') }}</span>
              <input v-model="emailDraft.email" class="spInput" :disabled="emailBusy" />
            </label>
            <button type="button" class="spBtn spBtn--primary" :disabled="emailBusy" @click="emit('send-new-email-code')">
              {{ emailBusy ? t('settings.sending') : t('settings.send_code_new') }}
            </button>
          </template>

          <template v-else>
            <label class="spField">
              <span class="spFieldLabel">{{ t('settings.code_new') }}</span>
              <input v-model="emailDraft.newCode" class="spInput" :disabled="emailBusy" />
            </label>
            <button type="button" class="spBtn spBtn--primary" :disabled="emailBusy" @click="emit('confirm-new-email')">
              {{ emailBusy ? t('settings.confirming') : t('settings.confirm_email_change') }}
            </button>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.spRoot {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--surface-strong);
}

.spHeader {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-strong);
}

.spHeaderActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spTitle {
  font-size: 1.15rem;
  line-height: 1;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text);
}

.spIconBtn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.spScroll {
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px 18px;
  display: grid;
  align-content: start;
  gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.18) transparent;
}

.spScroll::-webkit-scrollbar { width: 8px; }
.spScroll::-webkit-scrollbar-track { background: transparent; }
.spScroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.16);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.spAlert {
  border-radius: 14px;
  padding: 10px 12px;
  font-size: .84rem;
  font-weight: 600;
}

.spAlert--error { background: #fee2e2; color: #b91c1c; }
.spAlert--success { background: #dcfce7; color: #166534; }

.spHeroView {
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 4px 0 0;
}

.spHeroAvatar,
.spEditAvatar {
  width: 82px;
  height: 82px;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.spHeroAvatar--fallback {
  display: grid;
  place-items: center;
  background: var(--avatar-fallback);
  color: #fff;
  font-size: 1.55rem;
  font-weight: 800;
}

.spAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.spHeroName {
  font-size: 1.05rem;
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: -.05em;
  text-align: center;
  color: var(--text);
}

.spHeroStatus {
  color: var(--text-muted);
  font-size: .8rem;
}

.spInfoList {
  display: grid;
  gap: 8px;
}

.spInfoRow {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border-radius: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-soft);
}

.spInfoIcon {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.spInfoValue {
  font-size: .95rem;
  font-weight: 800;
  color: var(--text);
}

.spInfoLabel {
  margin-top: 2px;
  font-size: .8rem;
  color: var(--text-muted);
}

.spEditHero {
  display: grid;
  justify-items: center;
  padding: 2px 0 0;
}

.spEditAvatarOverlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.22);
  color: #fff;
}

.spSection {
  display: grid;
  gap: 10px;
  padding: 14px;
  border-radius: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-soft);
}

.spSectionTitle {
  font-size: .92rem;
  font-weight: 800;
  color: var(--text);
}

.spHint {
  color: var(--text-muted);
  font-size: .82rem;
  line-height: 1.45;
}

.spField {
  display: grid;
  gap: 5px;
}

.spFieldLabel {
  font-size: .78rem;
  font-weight: 700;
  color: var(--text-soft);
}

.spInput {
  width: 100%;
  height: 38px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-soft);
  padding: 0 12px;
  font-size: .9rem;
  color: var(--text);
  outline: none;
}

.spInput:focus {
  border-color: rgba(74, 144, 217, 0.38);
  box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.12);
}

.spBtn {
  min-height: 38px;
  border: 0;
  border-radius: 14px;
  padding: 0 14px;
  font-size: .88rem;
  font-weight: 800;
  cursor: pointer;
}

.spBtn--primary {
  background: linear-gradient(135deg, #4a90d9 0%, #2563eb 100%);
  color: #fff;
}

.spBtn--soft {
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.spBtn:disabled {
  opacity: .64;
  cursor: default;
}

.spRow {
  display: grid;
  gap: 10px;
}

.spRow--stack {
  gap: 12px;
}

.spRowLabel {
  font-size: .82rem;
  font-weight: 800;
  color: var(--text-soft);
}

.spPills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.spThemeCards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.spThemeCard {
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface-soft);
  padding: 10px;
  display: grid;
  gap: 8px;
  text-align: left;
  cursor: pointer;
}

.spThemeCard.active {
  outline: 3px solid rgba(74, 144, 217, 0.22);
  border-color: rgba(74, 144, 217, 0.28);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-soft));
}

.spThemePreview {
  height: 54px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background-size: cover;
}

.spThemePreview--light {
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.92), rgba(238, 242, 247, 0.95) 42%),
    linear-gradient(180deg, #f5f7fb 0%, #edf1f6 100%);
}

.spThemePreview--dark {
  background:
    radial-gradient(circle at top left, rgba(36, 36, 44, 0.92), rgba(11, 11, 12, 0.95) 42%),
    linear-gradient(180deg, #0b0b0c 0%, #050506 100%);
}

.spThemeName {
  font-size: .86rem;
  font-weight: 900;
  color: var(--text);
}

.spThemeHint {
  margin-top: -6px;
  font-size: .78rem;
  font-weight: 800;
  color: var(--text-muted);
}

.spPill {
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text-soft);
  font-weight: 800;
  font-size: .84rem;
  cursor: pointer;
}

.spPill.active {
  border-color: rgba(74, 144, 217, 0.38);
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.spWallpapers {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.spWallpaperTile {
  height: 54px;
  border-radius: 16px;
  border: 1px solid var(--border);
  box-shadow: 0 10px 18px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  background-size: cover;
}

.spWallpaperTile.active {
  outline: 3px solid rgba(74, 144, 217, 0.28);
  border-color: rgba(74, 144, 217, 0.32);
}

.spAccents {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.spAccentDot {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 2px solid var(--surface-strong);
  box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
  cursor: pointer;
}

.spAccentDot.active {
  outline: 3px solid rgba(74, 144, 217, 0.22);
}

.spInline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
}

.spInlineLabel {
  font-size: .82rem;
  font-weight: 800;
  color: var(--text-soft);
}

.spColorInput {
  width: 44px;
  height: 32px;
  border-radius: 12px;
  padding: 0;
  border: 1px solid var(--border);
  background: transparent;
  cursor: pointer;
}

@media (max-width: 720px) {
  .spThemeCards {
    grid-template-columns: 1fr;
  }
  .spWallpapers {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
