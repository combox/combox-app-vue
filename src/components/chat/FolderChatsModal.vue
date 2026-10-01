<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ChatItem } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { normalizeAvatarSrc } from '../../utils/avatar'
import { avatarColorFor } from '../../utils/avatarColor'

/**
 * Telegram-style "Include Chats" picker opened from FolderCreateDialog.
 *
 * Chat-type filters mirror only categories that are really distinguishable
 * from ChatItem: `kind` (`direct` / `group` / `standalone_channel` / `bot`)
 * plus `is_direct`. There is NO contacts concept in the project (no
 * friends / directory / starred list — `peer_user_id` is just the DM peer),
 * so Contacts / Non-Contacts filters are deliberately absent instead of
 * faked. Topic rows (`kind: channel` with a parent group) live inside groups
 * and match no filter; they stay visible only while nothing is excluded.
 */
export type FolderChatCategory = 'direct' | 'group' | 'channel' | 'bot'

const TYPE_FILTERS: readonly FolderChatCategory[] = ['direct', 'group', 'channel', 'bot']

const props = withDefaults(defineProps<{
  open: boolean
  chats: ChatItem[]
  selectedIds: string[]
  max?: number
  loading?: boolean
  loadError?: string
}>(), {
  max: 1000,
  loading: false,
  loadError: '',
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', chatIds: string[]): void
}>()

const { t } = useI18n()

const search = ref('')
const activeTypes = ref<FolderChatCategory[]>([...TYPE_FILTERS])
const draft = ref<string[]>([])

watch(() => props.open, (open) => {
  if (!open) return
  draft.value = [...props.selectedIds]
  search.value = ''
  activeTypes.value = [...TYPE_FILTERS]
}, { immediate: true })

function chatCategory(chat: ChatItem): FolderChatCategory | null {
  const kind = (chat.kind || '').trim()
  if (kind === 'bot') return 'bot'
  if (kind === 'standalone_channel') return 'channel'
  if (kind === 'group') return 'group'
  if (kind === 'direct' || Boolean(chat.is_direct)) return 'direct'
  return null
}

function typeLabel(chat: ChatItem): string {
  const category = chatCategory(chat)
  if (category === 'bot') return t('chat.kind_bot', undefined, 'Bot')
  if (category === 'channel') return t('chat.channel', undefined, 'Channel')
  if (category === 'group') return t('chat.group', undefined, 'Group chat')
  return t('chat.direct', undefined, 'Direct messages')
}

function typeFilterLabel(category: FolderChatCategory): string {
  if (category === 'bot') return t('chat.kind_bot', undefined, 'Bot')
  if (category === 'channel') return t('chat.tab_channels', undefined, 'Channels')
  if (category === 'group') return t('chat.tab_groups', undefined, 'Groups')
  return t('chat.tab_direct', undefined, 'Direct')
}

function toggleType(category: FolderChatCategory): void {
  activeTypes.value = activeTypes.value.includes(category)
    ? activeTypes.value.filter((item) => item !== category)
    : [...activeTypes.value, category]
}

const filteredChats = computed(() => {
  const query = search.value.trim().toLowerCase()
  const active = activeTypes.value
  return (props.chats || []).filter((chat) => {
    const category = chatCategory(chat)
    if (category) {
      if (!active.includes(category)) return false
    } else if (active.length !== TYPE_FILTERS.length) {
      // Unclassified rows (e.g. topic `channel` rows) have no real filter;
      // they stay visible only while nothing is excluded.
      return false
    }
    if (!query) return true
    return String(chat.title || '').toLowerCase().includes(query)
  })
})

function isSelected(chatID: string): boolean {
  return draft.value.includes(chatID)
}

function toggleChat(chatID: string): void {
  if (isSelected(chatID)) {
    draft.value = draft.value.filter((id) => id !== chatID)
    return
  }
  if (draft.value.length >= props.max) return
  draft.value = [...draft.value, chatID]
}

function avatarSrc(chat: ChatItem): string {
  return normalizeAvatarSrc(chat.avatar_data_url || '')
}

function avatarFallback(chat: ChatItem): string {
  return String(chat.title || '?').slice(0, 1).toUpperCase() || '?'
}

function close(): void {
  emit('close')
}

function confirm(): void {
  emit('confirm', [...draft.value])
}
</script>

<template>
  <div v-if="open" class="fcModalOverlay" @click.self="close">
    <div
      class="fcModal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('settings.folder_include_chats_title', { selected: draft.length, max }, `Include Chats ${draft.length}/${max}`)"
    >
      <div class="fcModalHead">
        <button type="button" class="fcBack" :title="t('common.cancel', undefined, 'Cancel')" @click="close">
          <v-icon icon="mdi-arrow-left" size="20" />
        </button>
        <div class="fcModalTitle">
          {{ t('settings.folder_include_chats_title', { selected: draft.length, max }, `Include Chats ${draft.length}/${max}`) }}
        </div>
      </div>

      <div class="fcSearch">
        <v-icon icon="mdi-magnify" size="16" class="fcSearchIcon" />
        <input
          v-model="search"
          type="text"
          class="fcSearchInput"
          :placeholder="t('settings.folder_search_chats', undefined, 'Search chats')"
          autocomplete="off"
        />
      </div>

      <div class="fcTypes">
        <div class="fcTypesTitle">{{ t('settings.folder_chat_types', undefined, 'Chat types') }}</div>
        <div class="fcTypeRow">
          <button
            v-for="category in TYPE_FILTERS"
            :key="category"
            type="button"
            class="fcTypeChip"
            :class="{ active: activeTypes.includes(category) }"
            :aria-pressed="activeTypes.includes(category)"
            @click="toggleType(category)"
          >
            <span class="fcTypeCheck" aria-hidden="true">
              <v-icon v-if="activeTypes.includes(category)" icon="mdi-check" size="14" />
            </span>
            {{ typeFilterLabel(category) }}
          </button>
        </div>
      </div>

      <div class="fcList">
        <div v-if="loading" class="fcEmpty">{{ t('common.loading', undefined, 'Loading…') }}</div>
        <div v-else-if="loadError" class="fcError">{{ loadError }}</div>
        <template v-else>
          <button
            v-for="chat in filteredChats"
            :key="chat.id"
            type="button"
            class="fcRow"
            :class="{ selected: isSelected(chat.id) }"
            :aria-pressed="isSelected(chat.id)"
            :disabled="!isSelected(chat.id) && draft.length >= max"
            @click="toggleChat(chat.id)"
          >
            <img v-if="avatarSrc(chat)" :src="avatarSrc(chat)" class="fcAvatar" alt="" />
            <div v-else class="fcAvatar fallback" :style="{ background: avatarColorFor(chat.id) }">{{ avatarFallback(chat) }}</div>
            <span class="fcRowMain">
              <span class="fcRowTitle">{{ chat.title }}</span>
              <span class="fcRowSub">{{ typeLabel(chat) }}</span>
            </span>
            <span class="fcCheck" aria-hidden="true">
              <v-icon v-if="isSelected(chat.id)" icon="mdi-check" size="16" />
            </span>
          </button>
          <div v-if="filteredChats.length === 0" class="fcEmpty">
            {{ t('settings.folder_no_chats', undefined, 'No chats found') }}
          </div>
        </template>
      </div>

      <div class="fcActions">
        <button type="button" class="fcBtn muted" @click="close">
          {{ t('common.cancel', undefined, 'Cancel') }}
        </button>
        <button type="button" class="fcBtn" @click="confirm">
          {{ t('common.done', undefined, 'Done') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fcModalOverlay {
  position: fixed;
  inset: 0;
  z-index: 9650;
  background: rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
  padding: 16px;
}

.fcModal {
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

.fcModalHead {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fcBack {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  flex: none;
}

.fcBack:hover {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.fcModalTitle {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fcSearch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-soft);
}

.fcSearchIcon {
  color: var(--text-muted);
  flex: 0 0 auto;
}

.fcSearchInput {
  flex: 1 1 auto;
  min-width: 0;
  height: 40px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  outline: none;
}

.fcSearchInput::placeholder {
  color: var(--text-muted);
}

.fcTypes {
  display: grid;
  gap: 8px;
}

.fcTypesTitle {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
}

.fcTypeRow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.fcTypeChip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.fcTypeChip.active {
  background: var(--accent-soft);
  border-color: rgba(74, 144, 217, 0.38);
  color: var(--accent-strong);
}

.fcTypeCheck {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  display: grid;
  place-items: center;
  flex: none;
}

.fcTypeChip.active .fcTypeCheck {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.fcList {
  display: grid;
  gap: 2px;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 6px;
}

.fcRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.fcRow:hover:not(:disabled) {
  background: var(--surface-soft);
}

.fcRow.selected {
  background: var(--accent-soft);
}

.fcRow:disabled {
  opacity: 0.5;
  cursor: default;
}

.fcAvatar {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  object-fit: cover;
  flex: none;
}

.fcAvatar.fallback {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 15px;
  font-weight: 800;
}

.fcRowMain {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;
}

.fcRowTitle {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fcRowSub {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fcCheck {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: transparent;
  display: grid;
  place-items: center;
  flex: none;
}

.fcRow.selected .fcCheck {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.fcEmpty {
  padding: 10px 8px;
  font-size: 13.5px;
  color: var(--text-muted);
}

.fcError {
  padding: 10px 8px;
  font-size: 13px;
  color: #ef4444;
}

.fcActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.fcBtn {
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

.fcBtn.muted {
  background: var(--surface-soft);
  color: var(--text-soft);
  border: 1px solid var(--border);
}
</style>
