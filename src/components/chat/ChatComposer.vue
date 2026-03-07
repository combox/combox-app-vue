<script setup lang="ts">
import type { GIFItem } from 'combox-api'
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import PendingMediaTile from './PendingMediaTile.vue'
import type { ViewMessage } from './chatTypes'

type PendingFile = {
  id: string
  file: File
  progress: number
}

const INPUT_TEXTAREA_MIN_HEIGHT = 26
const INPUT_TEXTAREA_MAX_HEIGHT = 168

const emit = defineEmits<{
  send: [value: string]
  pickFiles: [files: FileList]
  removePendingFile: [id: string]
  clearReply: []
}>()

const props = defineProps<{
  chatKey: string
  sending: boolean
  disabled: boolean
  pendingFiles: PendingFile[]
  replyToMessage: ViewMessage | null
}>()

const { t } = useI18n()
const ComposerEmojiGifPicker = defineAsyncComponent(() => import('./ComposerEmojiGifPicker.vue'))
const rootRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
const pickerOpen = ref(false)
let pickerPrefetchStarted = false

function prefetchPicker() {
  if (pickerPrefetchStarted) return
  pickerPrefetchStarted = true
  void import('./ComposerEmojiGifPicker.vue')
}

function resizeTextarea() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const nextHeight = Math.max(INPUT_TEXTAREA_MIN_HEIGHT, Math.min(el.scrollHeight, INPUT_TEXTAREA_MAX_HEIGHT))
  el.style.height = `${nextHeight}px`
  el.style.overflowY = el.scrollHeight > INPUT_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
}

watch(draft, () => {
  nextTick(resizeTextarea)
})

watch(
  () => props.chatKey,
  () => {
    draft.value = ''
    pickerOpen.value = false
    nextTick(resizeTextarea)
  },
)

function handleSend() {
  emit('send', draft.value)
  if (!props.sending) {
    draft.value = ''
    nextTick(resizeTextarea)
  }
}

function handleSelectEmoji(emoji: string) {
  draft.value = `${draft.value}${emoji}`
}

function handleSelectGif(item: GIFItem) {
  const url = (item.url || '').trim()
  if (!url || props.disabled || props.sending) return
  emit('send', url)
  pickerOpen.value = false
}

function handleFileChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement | null
  const files = input?.files
  if (files && files.length) emit('pickFiles', files)
  if (input) input.value = ''
}

function onDocPointerDown(event: PointerEvent) {
  if (!pickerOpen.value) return
  const target = event.target as Node | null
  if (!target) return
  if (!rootRef.value?.contains(target)) pickerOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  const preload = () => prefetchPicker()
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    ;(window as Window & { requestIdleCallback?: (cb: IdleRequestCallback) => number }).requestIdleCallback?.(() => preload())
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
})
</script>

<template>
  <div ref="rootRef" class="composer">
    <div v-if="pickerOpen" class="pickerPopover">
      <ComposerEmojiGifPicker
        :open="pickerOpen"
        @select="handleSelectEmoji"
        @select-gif="handleSelectGif"
      />
    </div>

    <div v-if="replyToMessage" class="replyBar">
      <div class="replyMain">
        <div class="replyAuthor">{{ replyToMessage.raw.user_id === '' ? 'Reply' : 'Reply' }}</div>
        <div class="replyPreview">{{ replyToMessage.text || 'Message' }}</div>
      </div>
      <button type="button" class="replyClose" @click="emit('clearReply')">
        <v-icon icon="mdi-close" size="16" />
      </button>
    </div>

    <div v-if="pendingFiles.length > 0" class="composerFiles">
      <PendingMediaTile v-for="item in pendingFiles" :key="item.id" :item="item" @remove="emit('removePendingFile', $event)" />
    </div>

    <div class="composerRow" :aria-disabled="disabled ? 'true' : 'false'">
      <button
        type="button"
        class="composerIcon"
        :disabled="disabled"
        :aria-label="t('chat.emoji', undefined, 'Emoji')"
        @pointerenter="prefetchPicker"
        @focus="prefetchPicker"
        @click="pickerOpen = !pickerOpen"
      >
        <v-icon icon="mdi-emoticon-happy-outline" size="20" />
      </button>

      <textarea
        ref="textareaRef"
        v-model="draft"
        class="composerInput"
        :disabled="disabled"
        :placeholder="t('chat.message', undefined, 'Message')"
        :aria-label="t('chat.message', undefined, 'Message')"
        rows="1"
        spellcheck="false"
        @keydown.enter.exact.prevent="handleSend"
      />

      <button
        type="button"
        class="composerIcon"
        :disabled="disabled"
        :aria-label="t('chat.attach', undefined, 'Attach')"
        @click="fileInputRef?.click()"
      >
        <v-icon icon="mdi-paperclip" size="20" />
      </button>

      <button
        type="button"
        class="composerSend"
        :disabled="disabled || sending"
        :aria-label="t('chat.send', undefined, 'Send')"
        @click="handleSend"
      >
        <v-icon icon="mdi-send" size="20" />
      </button>

      <input
        ref="fileInputRef"
        type="file"
        hidden
        multiple
        accept="image/*,video/*"
        @change="handleFileChange"
      />
    </div>
  </div>
</template>

<style scoped>
.composer {
  width: min(860px, 100%);
  display: grid;
  gap: 6px;
  padding: 0 8px 12px;
  margin: 0 auto;
  position: relative;
}

.pickerPopover {
  position: absolute;
  left: 10px;
  bottom: calc(100% + 8px);
  z-index: 20;
  width: min(410px, calc(100vw - 24px));
  max-width: 100%;
}

.composerFiles {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.replyBar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-left: 3px solid rgba(74, 144, 217, 0.7);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.replyMain {
  min-width: 0;
}

.replyAuthor {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
  line-height: 1.2;
}

.replyPreview {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.replyClose {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.composerRow {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.96);
  border-radius: 22px;
  box-shadow: var(--shadow-soft);
}

.composerInput {
  width: 100%;
  min-height: 26px;
  max-height: 168px;
  height: 26px;
  border: 0;
  outline: 0;
  resize: none;
  overflow-y: hidden;
  background: transparent;
  padding: 0;
  font-size: 15px;
  line-height: 26px;
  font-family: inherit;
  vertical-align: middle;
}

.composerInput::placeholder {
  line-height: 26px;
  color: var(--text-muted);
}

.composerIcon,
.composerSend {
  width: 34px;
  height: 34px;
  border: 0;
  background: transparent;
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
  position: relative;
  border-radius: 12px;
}

.composerSend:disabled,
.composerIcon:disabled {
  opacity: 0.5;
  cursor: default;
}

.composerIcon:hover:not(:disabled),
.composerSend:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}
</style>
