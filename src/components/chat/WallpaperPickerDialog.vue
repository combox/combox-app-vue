<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatItem } from 'combox-api'
import { clearChatWallpaper, setChatWallpaper } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { WALLPAPER_PRESETS as PRESETS, type WallpaperPreset } from '../../utils/chatWallpaper'

type WallpaperSelection = { kind: 'none' | 'preset' | 'image'; value?: string }


/** Server cap: `maxWallpaperValueLen = 512 * 1024` on the stored value. */
const MAX_WALLPAPER_BYTES = 512 * 1024
const MAX_WALLPAPER_VALUE_LENGTH = 512 * 1024

const props = defineProps<{
  open: boolean
  chat: ChatItem | null
}>()

const emit = defineEmits<{
  close: []
  /** The workspace paints the chat background with the updated chat. */
  wallpaperChanged: [chat: ChatItem]
}>()

const { t } = useI18n()
const toast = useToast()

const selection = ref<WallpaperSelection>({ kind: 'none' })
const imageDataUrl = ref('')
const errorText = ref('')
const busy = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const currentKind = computed(() => (props.chat?.wallpaper_kind || 'none') as 'none' | 'preset' | 'image')
const currentValue = computed(() => (props.chat?.wallpaper_value || '').trim())

watch(
  () => [props.open, props.chat?.id, currentKind.value, currentValue.value] as const,
  ([open]) => {
    if (!open) return
    errorText.value = ''
    busy.value = false
    if (currentKind.value === 'preset' && currentValue.value) {
      selection.value = { kind: 'preset', value: currentValue.value }
      imageDataUrl.value = ''
      return
    }
    if (currentKind.value === 'image' && currentValue.value) {
      selection.value = { kind: 'image' }
      imageDataUrl.value = currentValue.value
      return
    }
    selection.value = { kind: 'none' }
    imageDataUrl.value = ''
  },
  { immediate: true },
)

const presetById = computed(() => {
  const map = new Map<string, WallpaperPreset>()
  for (const preset of PRESETS) map.set(preset.id, preset)
  return map
})

const previewStyle = computed<Record<string, string>>(() => {
  if (selection.value.kind === 'image') {
    const url = imageDataUrl.value
    if (url) {
      return {
        backgroundImage: `url("${url}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    }
    return { background: 'var(--surface-soft)' }
  }
  if (selection.value.kind === 'preset') {
    const preset = presetById.value.get(selection.value.value || '')
    if (preset) return { background: preset.css }
  }
  return { background: 'var(--surface-soft)' }
})

const previewIsEmpty = computed(() => selection.value.kind === 'none')

function presetStyle(preset: WallpaperPreset): Record<string, string> {
  return { background: preset.css }
}

function selectNone() {
  selection.value = { kind: 'none' }
  errorText.value = ''
}

function selectPreset(preset: WallpaperPreset) {
  selection.value = { kind: 'preset', value: preset.id }
  errorText.value = ''
}

function pickImage() {
  fileInputRef.value?.click()
}

function fail(message: string) {
  errorText.value = message
  toast.error(message)
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files && input.files[0] ? input.files[0] : null
  input.value = ''
  errorText.value = ''
  if (!file) return
  if (file.size > MAX_WALLPAPER_BYTES) {
    fail(t('chat.wallpaper_too_large', undefined, 'Images must be 512 KB or smaller'))
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    if (!result) {
      fail(t('chat.wallpaper_invalid_file', undefined, 'Could not read that image'))
      return
    }
    if (result.length > MAX_WALLPAPER_VALUE_LENGTH) {
      fail(t('chat.wallpaper_too_large', undefined, 'Images must be 512 KB or smaller'))
      return
    }
    imageDataUrl.value = result
    selection.value = { kind: 'image' }
  }
  reader.onerror = () => {
    fail(t('chat.wallpaper_invalid_file', undefined, 'Could not read that image'))
  }
  reader.readAsDataURL(file)
}

async function apply() {
  const chatID = (props.chat?.id || '').trim()
  if (!chatID || busy.value) return
  errorText.value = ''
  busy.value = true
  try {
    let updated: ChatItem
    if (selection.value.kind === 'image') {
      const dataUrl = imageDataUrl.value
      if (!dataUrl) throw new Error(t('chat.wallpaper_invalid_file', undefined, 'Could not read that image'))
      updated = await setChatWallpaper(chatID, { kind: 'image', value: dataUrl })
    } else if (selection.value.kind === 'preset') {
      const presetID = (selection.value.value || '').trim()
      if (!presetID) throw new Error(t('chat.wallpaper_invalid_file', undefined, 'Could not read that image'))
      updated = await setChatWallpaper(chatID, { kind: 'preset', value: presetID })
    } else {
      updated = await clearChatWallpaper(chatID)
    }
    toast.success(t('chat.wallpaper_applied', undefined, 'Wallpaper updated'))
    emit('wallpaperChanged', updated)
    emit('close')
  } catch (error) {
    fail(error instanceof Error && error.message ? error.message : t('chat.wallpaper_set_failed', undefined, 'Could not set the wallpaper'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="wpOverlay" @click="emit('close')" @contextmenu.prevent="emit('close')" />
    <div v-if="props.open" class="wpDialog" role="dialog" aria-modal="true" :aria-label="t('chat.wallpaper_title', undefined, 'Chat wallpaper')" @click.stop>
      <div class="wpHead">
        <div class="wpTitle">{{ t('chat.wallpaper_title', undefined, 'Chat wallpaper') }}</div>
        <button type="button" class="wpClose" :aria-label="t('common.close', undefined, 'Close')" :disabled="busy" @click="emit('close')">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="wpPreview" :style="previewStyle">
        <div v-if="previewIsEmpty" class="wpPreviewHint">{{ t('chat.wallpaper_none', undefined, 'No wallpaper') }}</div>
      </div>

      <div class="wpRow">
        <button type="button" class="wpChip" :class="{ active: selection.kind === 'none' }" :disabled="busy" @click="selectNone">
          <span class="wpChipSwatch wpChipSwatchNone"><v-icon icon="mdi-image-off-outline" size="16" /></span>
          <span class="wpChipLabel">{{ t('chat.wallpaper_none', undefined, 'No wallpaper') }}</span>
        </button>

        <button
          v-for="preset in PRESETS"
          :key="preset.id"
          type="button"
          class="wpChip"
          :class="{ active: selection.kind === 'preset' && selection.value === preset.id }"
          :disabled="busy"
          :aria-label="t(`chat.wallpaper_preset_${preset.id}`, undefined, preset.label)"
          :title="t(`chat.wallpaper_preset_${preset.id}`, undefined, preset.label)"
          @click="selectPreset(preset)"
        >
          <span class="wpChipSwatch" :style="presetStyle(preset)" />
          <span class="wpChipLabel">{{ t(`chat.wallpaper_preset_${preset.id}`, undefined, preset.label) }}</span>
        </button>

        <button type="button" class="wpChip" :class="{ active: selection.kind === 'image' }" :disabled="busy" @click="pickImage">
          <span class="wpChipSwatch wpChipSwatchPick"><v-icon icon="mdi-image-plus-outline" size="16" /></span>
          <span class="wpChipLabel">{{ t('chat.wallpaper_choose_image', undefined, 'Choose image') }}</span>
        </button>
        <input ref="fileInputRef" type="file" accept="image/*" class="wpFileInput" @change="onFileChange" />
      </div>

      <div v-if="selection.kind === 'image'" class="wpHint">
        {{ imageDataUrl ? t('chat.wallpaper_image_ready', undefined, 'Custom image selected') : t('chat.wallpaper_choose_hint', undefined, 'Pick an image from your device') }}
      </div>
      <div v-if="errorText" class="wpError">{{ errorText }}</div>

      <div class="wpActions">
        <button type="button" class="wpBtn" :disabled="busy" @click="emit('close')">{{ t('common.cancel', undefined, 'Cancel') }}</button>
        <button type="button" class="wpBtn primary" :disabled="busy" @click="apply">
          {{ busy ? t('common.loading', undefined, 'Loading…') : t('chat.wallpaper_apply', undefined, 'Apply') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wpOverlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(15, 23, 42, 0.42);
  animation: wpFade 140ms ease;
}

.wpDialog {
  position: fixed;
  z-index: 121;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(440px, calc(100vw - 24px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 16px;
  display: grid;
  gap: 14px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32);
  animation: wpPop 160ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

@keyframes wpFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes wpPop {
  from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)) scale(0.97); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .wpOverlay,
  .wpDialog {
    animation: none;
  }
}

.wpHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wpTitle {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.wpClose {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.wpClose:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.wpPreview {
  height: 132px;
  border-radius: 14px;
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.wpPreviewHint {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.wpRow {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}

.wpChip {
  display: grid;
  gap: 6px;
  justify-items: center;
  padding: 8px 6px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  cursor: pointer;
}

.wpChip:hover {
  background: var(--surface-soft-hover);
}

.wpChip.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

.wpChip:disabled {
  opacity: 0.6;
  cursor: default;
}

.wpChipSwatch {
  width: 100%;
  height: 42px;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  display: grid;
  place-items: center;
}

.wpChipSwatchNone,
.wpChipSwatchPick {
  background: var(--surface);
  color: var(--text-muted);
}

.wpChipLabel {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-soft);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wpFileInput {
  display: none;
}

.wpHint {
  font-size: 12px;
  color: var(--text-muted);
}

.wpError {
  font-size: 12px;
  font-weight: 700;
  color: #ef4444;
}

.wpActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.wpBtn {
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.wpBtn:hover {
  background: var(--surface-soft-hover);
}

.wpBtn.primary {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}

.wpBtn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
