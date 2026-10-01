<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  createChatFolder,
  listChatFolders,
  resolveChatFolderInvite,
  type ChatFolder,
  type ResolvedFolderInvite,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'

/**
 * Import preview for a shared folder deep link (/folder/:token). The server
 * never auto-joins on resolve: this modal previews the folder and creates a
 * local copy with the chats the viewer already belongs to (is_member).
 *
 * Missing server capability: there is no join-by-public_slug endpoint in the
 * SDK (only invite-token accepts and subscribe-by-chatID), so public chats
 * the viewer never joined render as "unavailable" and are left out instead of
 * showing a dead Join button.
 */
const MAX_NAME = 32

const props = defineProps<{
  token: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'imported', folder: ChatFolder): void
}>()

const { t } = useI18n()
const toast = useToast()

const loading = ref(false)
const error = ref('')
const preview = ref<ResolvedFolderInvite | null>(null)
const adding = ref(false)
const addError = ref('')
const alreadyAdded = ref(false)

function apiCodeOf(caught: unknown): string {
  if (caught && typeof caught === 'object' && 'code' in caught) {
    return String((caught as { code?: unknown }).code || '').toLowerCase()
  }
  return caught instanceof Error ? caught.message.toLowerCase() : ''
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}

async function resolve(): Promise<void> {
  const clean = String(props.token || '').trim()
  loading.value = true
  error.value = ''
  addError.value = ''
  alreadyAdded.value = false
  preview.value = null
  if (!clean) {
    loading.value = false
    error.value = t('chat.folder_invalid_link', undefined, 'This invite link is invalid or has been revoked')
    return
  }
  try {
    preview.value = await resolveChatFolderInvite(clean)
  } catch (caught) {
    const code = apiCodeOf(caught)
    error.value = code.includes('not_found')
      ? t('chat.folder_invalid_link', undefined, 'This invite link is invalid or has been revoked')
      : messageOf(caught, t('chat.folder_load_failed', undefined, 'Could not load the shared folder'))
  } finally {
    loading.value = false
  }
}

watch(() => props.token, () => {
  void resolve()
}, { immediate: true })

/** Chats the viewer belongs to: the only ones a local copy can contain. */
const availableChats = computed(() => (preview.value?.chats || []).filter((chat) => chat.is_member))

/** Public-but-not-joined and private chats stay out — no join API exists. */
const unavailableChats = computed(() => (preview.value?.chats || []).filter((chat) => !chat.is_member))

const previewName = computed(() => String(preview.value?.folder_name || '').trim())
const previewIcon = computed(() => String(preview.value?.folder_emoji || '').trim())
const totalCount = computed(() => preview.value?.chats.length || 0)

function kindLabel(kindRaw: string): string {
  const kind = String(kindRaw || '').trim()
  if (kind === 'direct') return t('chat.direct', undefined, 'Direct messages')
  if (kind === 'group') return t('chat.group', undefined, 'Group chat')
  if (kind === 'channel' || kind === 'standalone_channel') return t('chat.channel', undefined, 'Channel')
  if (kind === 'bot') return t('chat.kind_bot', undefined, 'Bot')
  return t('chat.channel', undefined, 'Channel')
}

function close(): void {
  if (adding.value) return
  emit('close')
}

function suffixName(base: string, n: number): string {
  return `${base} (${n})`.slice(0, MAX_NAME)
}

async function addFolder(): Promise<void> {
  if (!preview.value || adding.value || loading.value) return
  const ids = availableChats.value.map((chat) => String(chat.id || '').trim()).filter(Boolean)
  if (ids.length === 0) return
  adding.value = true
  addError.value = ''
  try {
    const base = (previewName.value || t('chat.folder_shared_fallback', undefined, 'Shared folder')).slice(0, MAX_NAME)
    // Same name + every available chat already inside → nothing new to add.
    try {
      const existing = await listChatFolders()
      const same = existing.find((folder) => String(folder.name || '') === base)
      if (same && ids.every((id) => (same.chat_ids || []).includes(id))) {
        alreadyAdded.value = true
        adding.value = false
        return
      }
    } catch {
      // The duplicate check is best-effort; creation below still validates.
    }
    // The backend rejects duplicate names (already_exists), so retry with a
    // numeric suffix instead of dying on "create anyway".
    let attempt = base
    let created: ChatFolder | null = null
    for (let n = 1; n <= 6; n += 1) {
      try {
        created = await createChatFolder({
          name: attempt,
          icon: previewIcon.value,
          chat_ids: ids,
        })
        break
      } catch (caught) {
        const code = apiCodeOf(caught)
        if (code.includes('already_exists') && n < 6) {
          attempt = suffixName(base, n + 1)
          continue
        }
        throw caught
      }
    }
    if (!created) throw new Error(t('chat.folder_import_failed', undefined, 'Could not add the folder'))
    toast.success(t('chat.folder_added', undefined, 'Folder added'))
    emit('imported', created)
    emit('close')
  } catch (caught) {
    addError.value = messageOf(caught, t('chat.folder_import_failed', undefined, 'Could not add the folder'))
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <div class="fiOverlay" @click.self="close">
    <div class="fiDialog" role="dialog" aria-modal="true" :aria-label="t('chat.folder_import_title', undefined, 'Shared folder')">
      <div class="fiTitle">{{ t('chat.folder_import_title', undefined, 'Shared folder') }}</div>

      <div v-if="loading" class="fiEmpty">{{ t('common.loading', undefined, 'Loading…') }}</div>
      <div v-else-if="error" class="fiError">{{ error }}</div>

      <template v-else-if="preview">
        <div class="fiHead">
          <span v-if="previewIcon" class="fiGlyph" aria-hidden="true">{{ previewIcon }}</span>
          <span v-else class="fiGlyphFallback"><v-icon icon="mdi-folder-outline" size="20" /></span>
          <span class="fiName">{{ previewName || t('chat.folder_shared_fallback', undefined, 'Shared folder') }}</span>
          <span class="fiCount">{{ t('settings.folders_chat_count', { count: totalCount }, '{count} chats') }}</span>
        </div>

        <div v-if="alreadyAdded" class="fiNote">
          {{ t('chat.folder_already_added', undefined, 'You already have this folder with the same chats.') }}
        </div>
        <div v-if="addError" class="fiError">{{ addError }}</div>

        <div class="fiList">
          <div v-for="chat in availableChats" :key="`a:${chat.id}`" class="fiRow">
            <span class="fiRowIcon"><v-icon icon="mdi-check-circle-outline" size="16" /></span>
            <span class="fiRowMain">
              <span class="fiRowTitle">{{ chat.title }}</span>
              <span class="fiRowSub">{{ kindLabel(chat.kind) }} · {{ t('chat.folder_will_add', undefined, 'Will be added') }}</span>
            </span>
          </div>
          <div v-for="chat in unavailableChats" :key="`u:${chat.id}`" class="fiRow unavailable">
            <span class="fiRowIcon"><v-icon icon="mdi-alert-circle-outline" size="16" /></span>
            <span class="fiRowMain">
              <span class="fiRowTitle">{{ chat.title }}</span>
              <span class="fiRowSub">{{ kindLabel(chat.kind) }} · {{ t('chat.folder_unavailable', undefined, 'Unavailable — you are not a member') }}</span>
            </span>
          </div>
          <div v-if="totalCount === 0" class="fiEmpty">
            {{ t('chat.folders_empty', undefined, 'No chats in this folder') }}
          </div>
        </div>

        <div v-if="availableChats.length === 0 && totalCount > 0 && !alreadyAdded" class="fiNote">
          {{ t('chat.folder_nothing_to_add', undefined, 'Nothing to add: you are not a member of these chats.') }}
        </div>

        <div class="fiActions">
          <button type="button" class="fiBtn muted" :disabled="adding" @click="close">
            {{ alreadyAdded ? t('common.close', undefined, 'Close') : t('common.cancel', undefined, 'Cancel') }}
          </button>
          <button
            v-if="!alreadyAdded"
            type="button"
            class="fiBtn"
            :disabled="adding || availableChats.length === 0"
            @click="addFolder"
          >
            {{ adding ? t('common.loading', undefined, 'Loading…') : t('chat.folder_add', undefined, 'Add folder') }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fiOverlay {
  position: fixed;
  inset: 0;
  z-index: 9600;
  background: rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
  padding: 16px;
}

.fiDialog {
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

.fiTitle {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.fiEmpty {
  font-size: 13.5px;
  color: var(--text-muted);
}

.fiError {
  font-size: 13px;
  color: #ef4444;
}

.fiNote {
  font-size: 13px;
  color: var(--text-soft);
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 9px 12px;
}

.fiHead {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fiGlyph {
  font-size: 22px;
  line-height: 1;
}

.fiGlyphFallback {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--accent-strong);
  flex: 0 0 auto;
}

.fiName {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fiCount {
  flex: 0 0 auto;
  min-width: 24px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.fiList {
  display: grid;
  gap: 4px;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 6px;
}

.fiRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
}

.fiRow.unavailable {
  opacity: 0.72;
}

.fiRowIcon {
  flex: 0 0 auto;
  color: var(--accent-strong);
}

.fiRow.unavailable .fiRowIcon {
  color: var(--text-muted);
}

.fiRowMain {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.fiRowTitle {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fiRowSub {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fiActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.fiBtn {
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

.fiBtn.muted {
  background: var(--surface-soft);
  color: var(--text-soft);
  border: 1px solid var(--border);
}

.fiBtn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
