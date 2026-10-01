<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  deleteChatFolder,
  listChatFolders,
  updateChatFolder,
  type ChatFolder,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import FolderCreateDialog from '../chat/FolderCreateDialog.vue'
import FolderShareDialog from '../chat/FolderShareDialog.vue'
import './settingsShared.css'

const MAX_FOLDERS = 12

const { t } = useI18n()
const toast = useToast()

const folders = ref<ChatFolder[]>([])
const loading = ref(false)
const loadError = ref('')
const actionBusy = ref(false)
const confirmDeleteId = ref('')

/** FolderCreateDialog is the single create/edit flow (also opened from the bar "+"). */
const dialogOpen = ref(false)
const editingFolder = ref<ChatFolder | null>(null)

/** FolderShareDialog state. */
const shareOpen = ref(false)
const shareFolder = ref<ChatFolder | null>(null)

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}

function isMdiFolderIcon(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith('mdi-')
}

function folderGlyph(folder: ChatFolder): string {
  return String(folder.icon || '').trim()
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const list = await listChatFolders()
    folders.value = [...list].sort((a, b) => a.position - b.position)
  } catch (caught) {
    loadError.value = messageOf(caught, t('settings.folders_load_failed', undefined, 'Could not load folders'))
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  if (folders.value.length >= MAX_FOLDERS) {
    loadError.value = t('settings.folders_limit', { max: MAX_FOLDERS }, 'You can keep at most {max} folders')
    return
  }
  loadError.value = ''
  editingFolder.value = null
  dialogOpen.value = true
}

function openEdit(folder: ChatFolder): void {
  loadError.value = ''
  editingFolder.value = folder
  dialogOpen.value = true
}

function openRow(folder: ChatFolder): void {
  if (confirmDeleteId.value) return
  openEdit(folder)
}

function closeDialog(): void {
  dialogOpen.value = false
  editingFolder.value = null
}

async function onDialogSaved(): Promise<void> {
  dialogOpen.value = false
  editingFolder.value = null
  await load()
}

function openShare(folder: ChatFolder): void {
  shareFolder.value = folder
  shareOpen.value = true
}

function closeShare(): void {
  shareOpen.value = false
  shareFolder.value = null
}

function askDelete(folder: ChatFolder): void {
  confirmDeleteId.value = folder.id
}

function cancelDelete(): void {
  confirmDeleteId.value = ''
}

async function confirmDelete(): Promise<void> {
  const target = confirmDeleteId.value
  if (!target || actionBusy.value) return
  actionBusy.value = true
  try {
    await deleteChatFolder(target)
    confirmDeleteId.value = ''
    toast.success(t('settings.folders_deleted', undefined, 'Folder deleted'))
    await load()
  } catch (caught) {
    const message = messageOf(caught, t('settings.folders_delete_failed', undefined, 'Could not delete the folder'))
    confirmDeleteId.value = ''
    loadError.value = message
    toast.error(message)
  } finally {
    actionBusy.value = false
  }
}

async function move(folder: ChatFolder, delta: -1 | 1): Promise<void> {
  if (actionBusy.value) return
  const index = folders.value.findIndex((item) => item.id === folder.id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= folders.value.length) return
  const current = folders.value[index]
  const neighbour = folders.value[target]
  actionBusy.value = true
  try {
    await updateChatFolder(current.id, { position: neighbour.position })
    await updateChatFolder(neighbour.id, { position: current.position })
    await load()
  } catch (caught) {
    toast.error(messageOf(caught, t('settings.folders_reorder_failed', undefined, 'Could not reorder the folders')))
    await load()
  } finally {
    actionBusy.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="hubSectionIntro">
    <div class="hubSectionIntroIcon"><v-icon icon="mdi-folder-outline" size="24" /></div>
    <div>
      <div class="hubSectionIntroTitle">{{ t('settings.folders', undefined, 'Folders') }}</div>
      <div class="hubSectionIntroText">
        {{ t('settings.folders_intro', undefined, 'Group your chats into folders and switch between them like in Telegram.') }}
      </div>
    </div>
  </section>

  <section class="settingsCard settingsCard--full">
    <div class="fdHead">
      <div class="settingsCard__title fdHeadTitle">{{ t('settings.folders_list_title', undefined, 'Chat folders') }}</div>
      <button type="button" class="settingsBtn settingsBtn--soft fdNew" :disabled="actionBusy" @click="openCreate">
        <v-icon icon="mdi-plus" size="16" />
        {{ t('settings.new_folder', undefined, 'New folder') }}
      </button>
    </div>

    <v-alert v-if="loadError" type="error" class="mb-4">{{ loadError }}</v-alert>

    <div v-if="loading && folders.length === 0" class="fdSkeleton">
      <span v-for="n in 3" :key="n" class="fdSkeletonRow" />
    </div>

    <div v-else-if="folders.length > 0" class="accList">
      <div
        v-for="(folder, index) in folders"
        :key="folder.id"
        class="accRow"
        role="button"
        tabindex="0"
        @click="openRow(folder)"
        @keydown.enter.prevent="openRow(folder)"
      >
        <span class="accRowIcon">
          <v-icon v-if="isMdiFolderIcon(folder.icon)" :icon="folderGlyph(folder)" size="20" />
          <span v-else-if="folderGlyph(folder)" class="fdGlyph" aria-hidden="true">{{ folderGlyph(folder) }}</span>
          <v-icon v-else icon="mdi-folder-outline" size="20" />
        </span>
        <span class="accRowMain">
          <span class="accRowTitle">{{ folder.name }}</span>
          <span class="accRowSub">
            {{ t('settings.folders_chat_count', { count: folder.chat_ids.length }, '{count} chats') }}
          </span>
        </span>

        <span v-if="confirmDeleteId === folder.id" class="fdConfirm" @click.stop>
          <span class="fdConfirmText">{{ t('settings.folders_delete_confirm', undefined, 'Delete this folder?') }}</span>
          <button type="button" class="settingsBtn settingsBtn--danger" :disabled="actionBusy" @click="confirmDelete">
            {{ t('common.delete', undefined, 'Delete') }}
          </button>
          <button type="button" class="fdCancel" :disabled="actionBusy" @click="cancelDelete">
            {{ t('common.cancel', undefined, 'Cancel') }}
          </button>
        </span>

        <span v-else class="fdActions" @click.stop>
          <button
            type="button"
            class="accRowAdd"
            :disabled="index === 0 || actionBusy"
            :aria-label="t('settings.folders_move_up', undefined, 'Move up')"
            @click="move(folder, -1)"
          >
            <v-icon icon="mdi-chevron-up" size="16" />
          </button>
          <button
            type="button"
            class="accRowAdd"
            :disabled="index === folders.length - 1 || actionBusy"
            :aria-label="t('settings.folders_move_down', undefined, 'Move down')"
            @click="move(folder, 1)"
          >
            <v-icon icon="mdi-chevron-down" size="16" />
          </button>
          <button
            type="button"
            class="accRowAdd"
            :aria-label="t('chat.folder_share_title', undefined, 'Share folder')"
            :title="t('chat.folder_share_title', undefined, 'Share folder')"
            @click="openShare(folder)"
          >
            <v-icon icon="mdi-link-variant" size="15" />
          </button>
          <button
            type="button"
            class="accRowAdd"
            :aria-label="t('settings.edit_folder', undefined, 'Edit folder')"
            @click="openEdit(folder)"
          >
            <v-icon icon="mdi-pencil-outline" size="15" />
          </button>
          <button
            type="button"
            class="accRowAdd fdDelete"
            :aria-label="t('settings.delete_folder', undefined, 'Delete folder')"
            @click="askDelete(folder)"
          >
            <v-icon icon="mdi-delete-outline" size="15" />
          </button>
        </span>
      </div>
    </div>

    <div v-else-if="!loading" class="fdEmpty">
      {{ t('settings.folders_empty', undefined, 'No folders yet. Create one to group your chats.') }}
    </div>
  </section>

  <FolderCreateDialog :open="dialogOpen" :folder="editingFolder" @close="closeDialog" @saved="onDialogSaved" />
  <FolderShareDialog :open="shareOpen" :folder="shareFolder" @close="closeShare" />
</template>

<style scoped>
.fdHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.fdHeadTitle {
  margin-bottom: 0;
}

.fdNew,
.fdCancel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
}

.fdNew:disabled {
  opacity: 0.5;
  cursor: default;
}

.fdCancel {
  background: var(--surface-soft);
  color: var(--text);
}

.fdCancel:hover:not(:disabled) {
  background: var(--border);
}

.fdGlyph {
  font-size: 18px;
  line-height: 1;
}

/* R14: strict square for the "+" / row action buttons — equal sides, circle, centered icon. */
.accRowAdd {
  width: 32px;
  height: 32px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
}

.fdActions,
.fdConfirm {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.fdConfirmText {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
}

.fdConfirm .settingsBtn--danger {
  min-height: 32px;
  padding: 0 10px;
}

.accRowAdd:disabled {
  opacity: 0.4;
  cursor: default;
}

.fdDelete:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.fdEmpty {
  padding: 10px 2px;
  font-size: 13.5px;
  color: var(--text-muted);
}

.fdSkeleton {
  display: grid;
  gap: 10px;
}

.fdSkeletonRow {
  display: block;
  height: 60px;
  border-radius: 18px;
  background: var(--surface-soft);
  animation: fdPulse 1.2s ease-in-out infinite;
}

@keyframes fdPulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

@media (max-width: 560px) {
  .fdHead {
    flex-wrap: wrap;
  }

  .fdConfirm {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
