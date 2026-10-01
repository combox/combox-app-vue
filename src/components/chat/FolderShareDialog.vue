<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createChatFolderInvite,
  revokeChatFolderInvite,
  type ChatFolder,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'

/**
 * Share dialog for a chat folder. The backend mints (or returns the live)
 * invite token — only the folder owner may call it — and the client builds
 * the deep link `${origin}/folder/${token}` served by the /folder/:token
 * route + FolderImportModal.
 */
const props = defineProps<{
  open: boolean
  folder: ChatFolder | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const toast = useToast()

const token = ref('')
const busy = ref(false)
const error = ref('')
const copied = ref(false)

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}

watch(() => props.open, (open) => {
  if (!open) return
  token.value = ''
  error.value = ''
  copied.value = false
  busy.value = false
}, { immediate: true })

const link = computed(() => (token.value ? `${window.location.origin}/folder/${token.value}` : ''))

function close(): void {
  if (busy.value) return
  emit('close')
}

async function createLink(): Promise<void> {
  if (!props.folder || busy.value) return
  busy.value = true
  error.value = ''
  try {
    // Returns the still-live token when one exists, otherwise mints a new one.
    const result = await createChatFolderInvite(props.folder.id)
    token.value = String(result.token || '').trim()
    if (!token.value) throw new Error(t('chat.folder_share_failed', undefined, 'Could not create the invite link'))
  } catch (caught) {
    error.value = messageOf(caught, t('chat.folder_share_failed', undefined, 'Could not create the invite link'))
  } finally {
    busy.value = false
  }
}

async function revoke(): Promise<void> {
  if (!props.folder || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await revokeChatFolderInvite(props.folder.id)
    token.value = ''
    copied.value = false
    toast.success(t('chat.folder_link_revoked', undefined, 'Invite link revoked'))
  } catch (caught) {
    error.value = messageOf(caught, t('chat.folder_revoke_failed', undefined, 'Could not revoke the invite link'))
  } finally {
    busy.value = false
  }
}

async function copy(): Promise<void> {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    toast.success(t('chat.folder_copied', undefined, 'Link copied'))
  } catch {
    error.value = t('chat.folder_copy_failed', undefined, 'Could not copy the link')
  }
}
</script>

<template>
  <div v-if="open" class="fsDialogOverlay" @click.self="close">
    <div class="fsDialog" role="dialog" aria-modal="true" :aria-label="t('chat.folder_share_title', undefined, 'Share folder')">
      <div class="fsDialogTitle">{{ t('chat.folder_share_title', undefined, 'Share folder') }}</div>
      <div v-if="folder" class="fsFolderName">
        <span v-if="(folder.icon || '').trim()" class="fsGlyph" aria-hidden="true">{{ (folder.icon || '').trim() }}</span>
        <span class="fsName">{{ folder.name }}</span>
      </div>

      <div v-if="error" class="fsError">{{ error }}</div>

      <template v-if="!token">
        <div class="fsHint">{{ t('chat.folder_share_hint', undefined, 'Anyone with the link can preview this folder and add its chats to their own folders.') }}</div>
        <div class="fsDialogActions">
          <button type="button" class="fsBtn muted" :disabled="busy" @click="close">
            {{ t('common.cancel', undefined, 'Cancel') }}
          </button>
          <button type="button" class="fsBtn" :disabled="busy" @click="createLink">
            {{ busy ? t('common.loading', undefined, 'Loading…') : t('chat.folder_create_link', undefined, 'Create invite link') }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="fsLinkBox">
          <span class="fsLink">{{ link }}</span>
        </div>
        <div class="fsDialogActions fsActionsWrap">
          <button type="button" class="fsBtn danger" :disabled="busy" @click="revoke">
            {{ t('chat.folder_revoke', undefined, 'Revoke') }}
          </button>
          <span class="fsSpacer" />
          <button type="button" class="fsBtn muted" :disabled="busy" @click="close">
            {{ t('common.close', undefined, 'Close') }}
          </button>
          <button type="button" class="fsBtn" :disabled="busy" @click="copy">
            <v-icon icon="mdi-content-copy" size="15" class="fsBtnIcon" />
            {{ copied ? t('chat.folder_copied', undefined, 'Link copied') : t('chat.folder_copy_link', undefined, 'Copy') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fsDialogOverlay {
  position: fixed;
  inset: 0;
  z-index: 9600;
  background: rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
  padding: 16px;
}

.fsDialog {
  width: min(100%, 400px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
  padding: 18px;
  display: grid;
  gap: 12px;
}

.fsDialogTitle {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.fsFolderName {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.fsGlyph {
  font-size: 18px;
  line-height: 1;
}

.fsName {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fsHint {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.45;
}

.fsError {
  font-size: 13px;
  color: #ef4444;
}

.fsLinkBox {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  overflow: hidden;
}

.fsLink {
  display: block;
  font-size: 13px;
  color: var(--accent-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fsDialogActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.fsActionsWrap {
  flex-wrap: wrap;
}

.fsSpacer {
  flex: 1 1 auto;
}

.fsBtn {
  min-width: 86px;
  min-height: 36px;
  border: 0;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.fsBtn.muted {
  background: var(--surface-soft);
  color: var(--text-soft);
  border: 1px solid var(--border);
}

.fsBtn.danger {
  background: transparent;
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
}

.fsBtn:disabled {
  opacity: 0.6;
  cursor: default;
}

.fsBtnIcon {
  flex: none;
}
</style>
