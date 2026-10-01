<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  createChatFolder,
  listChats,
  setChatFolderChats,
  updateChatFolder,
  type ChatFolder,
  type ChatItem,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { normalizeAvatarSrc } from '../../utils/avatar'
import { avatarColorFor } from '../../utils/avatarColor'
import FolderChatsModal from './FolderChatsModal.vue'

/**
 * The single create/edit UI for chat folders (Telegram-style). It is opened
 * from the folder bar "+" and from FoldersSettings ("New folder" / edit), so
 * both entries share one flow instead of two parallel incompatible editors.
 *
 * Server contract (verified against the SDK): create takes
 * `{ name, icon, chat_ids }`, update patches `{ name, icon }`, membership is
 * replaced wholesale via setChatFolderChats. The server knows no
 * excluded-chats or color tags, so this dialog renders none.
 *
 * Header mirrors Telegram Desktop: a round folder-avatar button (current
 * icon + pencil badge) opens the "Choose an icon" popover, next to it the
 * Folder name input. Chat picking lives in FolderChatsModal behind the
 * "Add Chats" button; this dialog only keeps the resulting chat_ids.
 */
const MAX_NAME = 32
/** MDI names like `mdi-folder-outline` are longer than legacy emoji, so keep room. */
const MAX_ICON = 64
const MAX_CHATS = 1000

/**
 * Telegram-style folder icon picker. Every name below exists in
 * src/plugins/mdi-subset.css, so the subset font renders them. TG originals
 * like cat/book/gamepad/lamp/plane/star/home are NOT in the subset and would
 * render blank — the closest in-subset analogues are used instead
 * (crown → shield-crown, charts → poll, work → package-variant,
 * travel → earth, files → file-document/folder-zip). `mdi-robot` covers bots.
 */
const FOLDER_ICONS: string[] = [
  'mdi-folder-outline',
  'mdi-view-list',
  'mdi-account-outline',
  'mdi-account-group-outline',
  'mdi-bullhorn-outline',
  'mdi-forum-outline',
  'mdi-message-outline',
  'mdi-package-variant-closed',
  'mdi-music-note',
  'mdi-playlist-music',
  'mdi-image-outline',
  'mdi-video-outline',
  'mdi-file-document-outline',
  'mdi-folder-zip',
  'mdi-heart-outline',
  'mdi-gift-outline',
  'mdi-flag-outline',
  'mdi-pin-outline',
  'mdi-archive-outline',
  'mdi-bell-outline',
  'mdi-poll',
  'mdi-palette-outline',
  'mdi-earth',
  'mdi-shield-crown-outline',
  'mdi-robot',
]

function isMdiIcon(value: string): boolean {
  return value.startsWith('mdi-')
}

const props = defineProps<{
  open: boolean
  /** Null for "new folder", a folder for "edit". */
  folder: ChatFolder | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', folder: ChatFolder): void
}>()

const { t } = useI18n()
const toast = useToast()

const name = ref('')
const icon = ref('')
const chatIds = ref<string[]>([])
const saving = ref(false)
const error = ref('')
const iconOpen = ref(false)
const chatsModalOpen = ref(false)
const avatarWrapRef = ref<HTMLElement | null>(null)

const chats = ref<ChatItem[]>([])
const chatsLoading = ref(false)
const chatsError = ref('')
let chatsLoaded = false

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}

function resetFromFolder(): void {
  error.value = ''
  saving.value = false
  iconOpen.value = false
  chatsModalOpen.value = false
  name.value = props.folder ? String(props.folder.name || '') : ''
  icon.value = props.folder ? String(props.folder.icon || '') : ''
  chatIds.value = props.folder ? [...(props.folder.chat_ids || [])] : []
}

async function loadChats(): Promise<void> {
  chatsLoading.value = true
  chatsError.value = ''
  try {
    const list = await listChats()
    chats.value = [...list].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
    chatsLoaded = true
  } catch (caught) {
    chatsError.value = messageOf(caught, t('settings.folders_chats_failed', undefined, 'Could not load your chats'))
  } finally {
    chatsLoading.value = false
  }
}

watch(() => props.open, (open) => {
  if (!open) {
    detachPopoverListeners()
    return
  }
  resetFromFolder()
  if (!chatsLoaded && !chatsLoading.value) void loadChats()
}, { immediate: true })

onBeforeUnmount(() => {
  detachPopoverListeners()
})

const iconIsMdi = computed(() => isMdiIcon(icon.value.trim()))
const iconIsLegacyEmoji = computed(() => {
  const raw = icon.value.trim()
  return raw.length > 0 && !isMdiIcon(raw)
})

/** Chats already picked for this folder, in picked order (for the preview). */
const selectedChats = computed(() => {
  const byId = new Map(chats.value.map((chat) => [chat.id, chat]))
  const rows: ChatItem[] = []
  for (const id of chatIds.value) {
    const chat = byId.get(id)
    if (chat) rows.push(chat)
  }
  return rows
})

function onDocumentPointerDown(event: Event): void {
  const root = avatarWrapRef.value
  if (root && event.target instanceof Node && !root.contains(event.target)) {
    iconOpen.value = false
    detachPopoverListeners()
  }
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    iconOpen.value = false
    detachPopoverListeners()
  }
}

function attachPopoverListeners(): void {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeyDown)
}

function detachPopoverListeners(): void {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeyDown)
}

function toggleIconPopover(): void {
  if (saving.value) return
  iconOpen.value = !iconOpen.value
  if (iconOpen.value) attachPopoverListeners()
  else detachPopoverListeners()
}

function closeIconPopover(): void {
  iconOpen.value = false
  detachPopoverListeners()
}

function selectFolderIcon(glyph: string): void {
  icon.value = icon.value.trim() === glyph ? '' : glyph
  closeIconPopover()
}

function clearFolderIcon(): void {
  icon.value = ''
  closeIconPopover()
}

function openChatsModal(): void {
  if (saving.value) return
  if (!chatsLoaded && !chatsLoading.value) void loadChats()
  chatsModalOpen.value = true
}

function confirmChats(ids: string[]): void {
  chatIds.value = [...ids]
  chatsModalOpen.value = false
}

function removeChat(chatID: string): void {
  chatIds.value = chatIds.value.filter((id) => id !== chatID)
}

function selectedAvatarSrc(chat: ChatItem): string {
  return normalizeAvatarSrc(chat.avatar_data_url || '')
}

function selectedAvatarFallback(chat: ChatItem): string {
  return String(chat.title || '?').slice(0, 1).toUpperCase() || '?'
}

function close(): void {
  if (saving.value) return
  emit('close')
}

async function save(): Promise<void> {
  if (saving.value) return
  const cleanName = name.value.trim()
  if (cleanName.length < 1 || cleanName.length > MAX_NAME) {
    error.value = t('settings.folders_name_invalid', undefined, 'The folder name must be 1 to 32 characters long')
    return
  }
  if (chatIds.value.length > MAX_CHATS) {
    error.value = t('settings.folders_too_many_chats', { max: MAX_CHATS }, 'A folder can hold at most {max} chats')
    return
  }
  const cleanIcon = icon.value.trim().slice(0, MAX_ICON)
  saving.value = true
  error.value = ''
  try {
    if (!props.folder) {
      const created = await createChatFolder({ name: cleanName, icon: cleanIcon, chat_ids: chatIds.value })
      toast.success(t('settings.folders_saved', undefined, 'Folder saved'))
      emit('saved', created)
    } else {
      await updateChatFolder(props.folder.id, { name: cleanName, icon: cleanIcon })
      const withChats = await setChatFolderChats(props.folder.id, chatIds.value)
      toast.success(t('settings.folders_saved', undefined, 'Folder saved'))
      emit('saved', withChats)
    }
  } catch (caught) {
    error.value = messageOf(caught, t('settings.folders_save_failed', undefined, 'Could not save the folder'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="open" class="fdDialogOverlay" @click.self="close">
    <div class="fdDialog" role="dialog" aria-modal="true" :aria-label="folder ? t('settings.edit_folder', undefined, 'Edit folder') : t('settings.new_folder', undefined, 'New folder')">
      <div class="fdDialogTitle">
        {{ folder ? t('settings.edit_folder', undefined, 'Edit folder') : t('settings.new_folder', undefined, 'New folder') }}
      </div>

      <div v-if="error" class="fdDialogError">{{ error }}</div>

      <div class="fdHead">
        <div ref="avatarWrapRef" class="fdAvatarWrap">
          <button
            type="button"
            class="fdAvatar"
            :aria-haspopup="true"
            :aria-expanded="iconOpen"
            :title="t('settings.folder_choose_icon', undefined, 'Choose an icon')"
            :disabled="saving"
            @click="toggleIconPopover"
          >
            <v-icon v-if="iconIsMdi" :icon="icon.trim()" size="22" />
            <span v-else-if="iconIsLegacyEmoji" class="fdPreviewEmoji" aria-hidden="true">{{ icon.trim() }}</span>
            <v-icon v-else icon="mdi-folder-outline" size="22" />
          </button>
          <span class="fdAvatarEdit" aria-hidden="true"><v-icon icon="mdi-pencil" size="12" /></span>
          <div v-if="iconOpen" class="fdIconPop" role="group" :aria-label="t('settings.folder_choose_icon', undefined, 'Choose an icon')">
            <div class="fdIconPopTitle">{{ t('settings.folder_choose_icon', undefined, 'Choose an icon') }}</div>
            <div class="fdIconGrid">
              <button
                v-for="glyph in FOLDER_ICONS"
                :key="glyph"
                type="button"
                class="fdIconBtn"
                :class="{ selected: icon.trim() === glyph }"
                :aria-pressed="icon.trim() === glyph"
                :title="glyph"
                :disabled="saving"
                @click="selectFolderIcon(glyph)"
              >
                <v-icon :icon="glyph" size="20" />
              </button>
              <button
                type="button"
                class="fdIconBtn fdIconNone"
                :class="{ selected: !icon.trim() }"
                :aria-pressed="!icon.trim()"
                :title="t('settings.folder_icon_none', undefined, 'No icon')"
                :disabled="saving"
                @click="clearFolderIcon"
              >
                <v-icon icon="mdi-close" size="16" />
              </button>
            </div>
          </div>
        </div>
        <input
          v-model="name"
          type="text"
          class="fdInput fdNameInput"
          maxlength="32"
          autocomplete="off"
          :placeholder="t('settings.folder_name', undefined, 'Folder name')"
          :aria-label="t('settings.folder_name', undefined, 'Folder name')"
          :disabled="saving"
          @keydown.enter="save"
        />
      </div>
      <div v-if="iconIsLegacyEmoji" class="fdLegacy">
        {{ t('settings.folder_icon_legacy', { icon: icon.trim() }, 'Legacy emoji {icon} stays until you pick an icon above') }}
      </div>

      <button type="button" class="fdAddChats" :disabled="saving" @click="openChatsModal">
        <span class="fdAddChatsPlus" aria-hidden="true"><v-icon icon="mdi-plus" size="18" /></span>
        <span class="fdAddChatsText">{{ t('settings.folder_add_chats', undefined, 'Add Chats') }}</span>
        <span v-if="chatIds.length > 0" class="fdCount">{{ chatIds.length }}</span>
      </button>

      <div v-if="chatIds.length > 0" class="fdSelected">
        <div v-for="chat in selectedChats" :key="chat.id" class="fdSelRow">
          <img v-if="selectedAvatarSrc(chat)" :src="selectedAvatarSrc(chat)" class="fdSelAvatar" alt="" />
          <div v-else class="fdSelAvatar fallback" :style="{ background: avatarColorFor(chat.id) }">{{ selectedAvatarFallback(chat) }}</div>
          <span class="fdSelTitle">{{ chat.title }}</span>
          <button
            type="button"
            class="fdSelRemove"
            :title="t('common.remove', undefined, 'Remove')"
            :disabled="saving"
            @click="removeChat(chat.id)"
          >
            <v-icon icon="mdi-close" size="14" />
          </button>
        </div>
        <div v-if="chatsLoading" class="fdEmpty">{{ t('common.loading', undefined, 'Loading…') }}</div>
        <div v-else-if="chatsError" class="fdDialogError">{{ chatsError }}</div>
      </div>

      <div class="fdDialogActions">
        <button type="button" class="fdBtn muted" :disabled="saving" @click="close">
          {{ t('common.cancel', undefined, 'Cancel') }}
        </button>
        <button type="button" class="fdBtn" :disabled="saving" @click="save">
          {{ saving ? t('common.loading', undefined, 'Loading…') : t('common.save', undefined, 'Save') }}
        </button>
      </div>
    </div>

    <FolderChatsModal
      :open="chatsModalOpen"
      :chats="chats"
      :selected-ids="chatIds"
      :max="MAX_CHATS"
      :loading="chatsLoading"
      :load-error="chatsError"
      @close="chatsModalOpen = false"
      @confirm="confirmChats"
    />
  </div>
</template>

<style scoped>
.fdDialogOverlay {
  position: fixed;
  inset: 0;
  z-index: 9600;
  background: rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
  padding: 16px;
}

.fdDialog {
  width: min(100%, 420px);
  max-height: min(92vh, 640px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
  padding: 18px;
  display: grid;
  gap: 12px;
}

.fdDialogTitle {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.fdDialogError {
  font-size: 13px;
  color: #ef4444;
}

.fdHead {
  display: flex;
  align-items: center;
  gap: 12px;
}

.fdAvatarWrap {
  position: relative;
  flex: none;
}

.fdAvatar {
  width: 52px;
  height: 52px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--accent-soft);
  color: var(--accent-strong);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}

.fdAvatar:hover:not(:disabled) {
  border-color: rgba(74, 144, 217, 0.38);
  box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.12);
}

.fdAvatar:disabled {
  opacity: 0.6;
  cursor: default;
}

.fdAvatarEdit {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-items: center;
  border: 2px solid var(--surface);
  pointer-events: none;
}

.fdPreviewEmoji {
  font-size: 22px;
  line-height: 1;
}

.fdIconPop {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 30;
  width: 252px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
  padding: 12px;
  display: grid;
  gap: 8px;
}

.fdIconPopTitle {
  font-size: 13px;
  font-weight: 800;
  color: var(--text);
}

.fdInput {
  height: 38px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 12px;
  font-size: 14px;
  background: var(--surface-soft);
  color: var(--text);
  outline: none;
  width: 100%;
}

.fdInput:focus {
  border-color: rgba(74, 144, 217, 0.38);
  box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.12);
}

.fdNameInput {
  flex: 1 1 auto;
  min-width: 0;
}

.fdIconGrid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}

.fdIconBtn {
  aspect-ratio: 1 / 1;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}

.fdIconBtn:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.fdIconBtn.selected {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.fdIconBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.fdIconNone {
  color: var(--text-muted);
}

.fdLegacy {
  font-size: 12px;
  color: var(--text-muted);
}

.fdAddChats {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-soft);
  color: var(--accent-strong);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}

.fdAddChats:hover:not(:disabled) {
  background: var(--accent-soft);
}

.fdAddChats:disabled {
  opacity: 0.6;
  cursor: default;
}

.fdAddChatsPlus {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-items: center;
  flex: none;
}

.fdAddChatsText {
  flex: 1 1 auto;
  min-width: 0;
}

.fdCount {
  min-width: 24px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  flex: none;
}

.fdSelected {
  display: grid;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 6px;
}

.fdSelRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 10px;
}

.fdSelRow:hover {
  background: var(--surface-soft);
}

.fdSelAvatar {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  object-fit: cover;
  flex: none;
}

.fdSelAvatar.fallback {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
}

.fdSelTitle {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fdSelRemove {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  flex: none;
}

.fdSelRemove:hover:not(:disabled) {
  background: var(--surface-soft);
  color: var(--text);
}

.fdSelRemove:disabled {
  opacity: 0.5;
  cursor: default;
}

.fdEmpty {
  padding: 10px 8px;
  font-size: 13.5px;
  color: var(--text-muted);
}

.fdDialogActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.fdBtn {
  min-width: 86px;
  height: 36px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  padding: 0 14px;
}

.fdBtn.muted {
  background: var(--surface-soft);
  color: var(--text-soft);
  border: 1px solid var(--border);
}

.fdBtn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
