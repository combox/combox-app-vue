<script setup lang="ts">
import type { ChatItem, SearchResults, SearchUserResult } from 'combox-api'
import { firstPreviewAttachmentId, normalizeAvatarSrc, summarizeMessagePreview } from './chatUtils'
import type { AttachmentThumb } from './chatSidebar.types'
import { useI18n } from '../../i18n/i18n'

const props = defineProps<{
  search: string
  selectedFilterTab: number
  unreadAll: number
  unreadDirect: number
  unreadGroup: number
  unreadByChatId: Record<string, number>
  loading: boolean
  showDirectory: boolean
  searchingDirectory: boolean
  directoryQuery: string
  filteredDirectoryUsers: SearchUserResult[]
  directoryResults: SearchResults
  chats: ChatItem[]
  selectedChatID: string
  compact: boolean
  createMenuOpen: boolean
  canCreateChannel: boolean
  lastAttachmentPreviewById: Record<string, AttachmentThumb>
}>()

const emit = defineEmits<{
  (e: 'update:search', value: string): void
  (e: 'select-tab', value: number): void
  (e: 'toggle-create-menu'): void
  (e: 'close-create-menu'): void
  (e: 'open-settings'): void
  (e: 'create-group'): void
  (e: 'create-channel'): void
  (e: 'select-chat', chatID: string): void
  (e: 'select-directory-chat', chat: SearchResults['chats'][number]): void
  (e: 'select-directory-user', user: SearchUserResult): void
}>()

const { t } = useI18n()

function chatPreview(chat: ChatItem): string {
  return summarizeMessagePreview(chat.last_message_preview || '', {
    gif: t('chat.gif'),
    video: t('chat.video'),
    photo: t('chat.photo'),
    audio: t('chat.audio'),
    file: t('chat.file'),
    empty: t('chat.standard'),
  })
}

function firstAttachmentThumb(chat: ChatItem): string {
  const attachmentID = firstPreviewAttachmentId(chat.last_message_preview || '')
  if (!attachmentID) return ''
  return props.lastAttachmentPreviewById[attachmentID]?.preview_url || props.lastAttachmentPreviewById[attachmentID]?.url || ''
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay())
  if (date >= startOfToday) {
    // Today: show time
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (date >= startOfWeek) {
    // This week: show weekday
    return date.toLocaleDateString([], { weekday: 'short' })
  } else {
    // Older: show short date
    const sameYear = date.getFullYear() === now.getFullYear()
    return date.toLocaleDateString([], sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: '2-digit' })
  }
}
</script>

<template>
  <div class="cpRoot" :class="{ compact }">
    <template v-if="compact">
      <div class="cpShelfHeader">
        <button type="button" class="cpIconBtn" :aria-label="t('chat.menu')" @click="emit('open-settings')">
          <v-icon icon="mdi-menu" size="18" />
        </button>
      </div>

      <div class="cpShelfList">
        <button
          v-for="chat in chats"
          :key="chat.id"
          type="button"
          class="cpShelfItem"
          :class="{ selected: chat.id === selectedChatID }"
          @click="emit('select-chat', chat.id)"
        >
          <img
            v-if="normalizeAvatarSrc(chat.avatar_data_url || '')"
            class="cpAvatarImg shelf"
            :src="normalizeAvatarSrc(chat.avatar_data_url || '')"
            :alt="chat.title"
          />
          <div v-else class="cpAvatar shelf">{{ chat.title.slice(0, 1).toUpperCase() }}</div>
          <span v-if="(unreadByChatId[chat.id] || 0) > 0" class="cpShelfUnread">
            {{ unreadByChatId[chat.id] > 99 ? '99+' : unreadByChatId[chat.id] }}
          </span>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="cpHeader can-have-forum">
        <div class="cpTitleRow row-row">
          <button type="button" class="cpIconBtn" :aria-label="t('chat.menu')" @click="emit('open-settings')">
            <v-icon icon="mdi-menu" size="18" />
          </button>
          <div class="cpTitle sidebar-header__title">{{ t('chat.title') }}</div>
        </div>
        <button type="button" class="cpIconBtn" :aria-label="t('chat.create', undefined, 'Create')" @click="emit('toggle-create-menu')">
          <v-icon icon="mdi-plus" size="20" />
        </button>
      </div>

      <div class="cpSearchWrap can-have-forum">
        <v-icon icon="mdi-magnify" size="18" class="cpSearchIcon" />
        <input class="cpSearchInput input-search" :value="search" :placeholder="t('chat.search')" @input="emit('update:search', ($event.target as HTMLInputElement).value)" />
        <button v-if="search" type="button" class="cpSearchClear" :aria-label="t('chat.clear')" @click="emit('update:search', '')">
          <v-icon icon="mdi-close" size="16" />
        </button>
      </div>

      <div v-if="createMenuOpen" class="cpCreateOverlay" @click="emit('close-create-menu')" />
      <div v-if="createMenuOpen" class="cpCreateMenu">
        <button type="button" class="cpCreateItem" @click="emit('create-group')">{{ t('chat.create_group') }}</button>
        <button type="button" class="cpCreateItem" @click="emit('create-channel')">{{ t('chat.create_channel') }}</button>
      </div>

      <div class="cpTabs folders-tabs-scrollable">
        <button type="button" class="cpTab" :class="{ active: selectedFilterTab === 0 }" @click="emit('select-tab', 0)">{{ t('chat.tab_all') }}</button>
        <button type="button" class="cpTab" :class="{ active: selectedFilterTab === 1 }" @click="emit('select-tab', 1)">{{ t('chat.tab_direct') }}</button>
        <button type="button" class="cpTab" :class="{ active: selectedFilterTab === 2 }" @click="emit('select-tab', 2)">{{ t('chat.tab_groups') }}</button>
      </div>

      <div class="cpProgress"><div v-if="loading" class="cpProgressBar" /></div>

      <div class="cpList chatlist">
        <template v-if="showDirectory">
          <div v-if="!directoryQuery" class="cpEmpty">{{ t('chat.type_at_search') }}</div>
          <div v-else-if="searchingDirectory" class="cpEmpty">{{ t('chat.loading_short') }}</div>

          <div v-if="filteredDirectoryUsers.length > 0" class="cpSubheader">{{ t('chat.people') }}</div>
          <button v-for="user in filteredDirectoryUsers" :key="`u:${user.id}`" type="button" class="cpItem" @click="emit('select-directory-user', user)">
            <img v-if="normalizeAvatarSrc(user.avatar_data_url || '')" class="cpAvatarImg" :src="normalizeAvatarSrc(user.avatar_data_url || '')" :alt="user.username" />
            <div v-else class="cpAvatar">{{ (user.first_name || user.username || '?').slice(0, 1).toUpperCase() }}</div>
            <div class="cpMain">
              <div class="cpPrimary">{{ `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username }}</div>
              <div class="cpSecondary">@{{ user.username }}</div>
            </div>
          </button>

          <div v-if="directoryResults.chats.length > 0" class="cpSubheader">{{ t('chat.public_chats') }}</div>
          <button v-for="chat in directoryResults.chats" :key="`c:${chat.id}`" type="button" class="cpItem" @click="emit('select-directory-chat', chat)">
            <img v-if="normalizeAvatarSrc((chat as any).avatar_data_url || '')" class="cpAvatarImg" :src="normalizeAvatarSrc((chat as any).avatar_data_url || '')" :alt="chat.title" />
            <div v-else class="cpAvatar">{{ chat.title.slice(0, 1).toUpperCase() }}</div>
            <div class="cpMain">
              <div class="cpPrimary">{{ chat.title }}</div>
              <div class="cpSecondary">{{ chat.public_slug ? `@${chat.public_slug}` : chat.kind }}</div>
            </div>
          </button>
        </template>

        <template v-else>
          <button
            v-for="chat in chats"
            :key="chat.id"
            type="button"
            class="cpItem chatlist-chat"
            :class="{ selected: chat.id === selectedChatID }"
            @click="emit('select-chat', chat.id)"
          >
            <img v-if="normalizeAvatarSrc(chat.avatar_data_url || '')" class="cpAvatarImg" :src="normalizeAvatarSrc(chat.avatar_data_url || '')" :alt="chat.title" />
            <div v-else class="cpAvatar">{{ chat.title.slice(0, 1).toUpperCase() }}</div>
            <div class="cpMain">
              <div class="cpPrimary">{{ chat.title }}</div>
              <div class="cpSecondaryWrap">
                <img v-if="firstAttachmentThumb(chat)" class="cpThumb" :src="firstAttachmentThumb(chat)" alt="attachment" />
                <span class="cpSecondary">{{ chatPreview(chat) }}</span>
              </div>
            </div>
            <div class="cpMeta">
              <div class="cpDate">{{ formatDate(chat.created_at) }}</div>
              <span v-if="(unreadByChatId[chat.id] || 0) > 0" class="cpUnread">{{ unreadByChatId[chat.id] > 99 ? '99+' : unreadByChatId[chat.id] }}</span>
            </div>
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Root: full height, grid so list can scroll */
.cpRoot {
  height: 100%;
  min-height: 0;
  background: var(--surface);
  backdrop-filter: blur(18px);
  position: relative;
  display: flex;
  flex-direction: column;
}

/* Compact (shelf) mode */
.cpRoot.compact {
  background: var(--bg-elevated);
}

/* ── Buttons ── */
.cpIconBtn,.cpSearchClear {
  width: 36px; height: 36px; border: 0; background: transparent;
  color: var(--text-soft); display: grid; place-items: center;
  cursor: pointer; border-radius: 50%; flex-shrink: 0;
  transition: background 120ms;
}
.cpIconBtn:hover,.cpSearchClear:hover { background: var(--accent-soft); color: var(--accent-strong); }

/* ── Header ── */
.cpHeader { padding: 6px 8px 4px 14px; display: flex; align-items: center; justify-content: space-between; min-height: 52px; }
.cpTitleRow { display: flex; align-items: center; gap: 4px; }
.cpTitle { font-size: 20px; font-weight: 800; line-height: 1; color: var(--text); }

/* ── Search ── */
.cpSearchWrap {
  margin: 0 10px 6px;
  height: 36px;
  border-radius: 999px;
  background: var(--surface-soft);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--border);
}
.cpSearchInput { width: 100%; border: 0; outline: 0; background: transparent; font-size: 14px; color: var(--text); }
.cpSearchInput::placeholder { color: var(--text-muted); }

/* ── Create menu ── */
.cpCreateOverlay { position: absolute; inset: 0; z-index: 5; background: transparent; }
.cpCreateMenu {
  position: absolute; top: 54px; right: 12px; z-index: 6;
  min-width: 156px; max-width: 190px;
  background: var(--surface-strong); border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-soft);
  padding: 4px 0;
}
.cpCreateItem {
  width: 100%; min-height: 34px; padding: 0 12px;
  border: 0; background: transparent; text-align: left;
  cursor: pointer; font-size: 13px; color: var(--text);
  transition: background 100ms;
}
.cpCreateItem:hover { background: var(--surface-soft); }
.cpCreateItem.disabled { opacity: .4; cursor: default; }

/* ── Filter tabs ── */
.cpTabs {
  display: flex; gap: 6px; padding: 0 10px 8px;
  overflow: auto; border-bottom: 1px solid var(--border);
  scrollbar-width: none;
}
.cpTabs::-webkit-scrollbar { display: none; }
.cpTab {
  min-height: 30px; padding: 0 14px;
  border: 0; border-radius: 999px;
  background: var(--surface-soft);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; color: var(--text-soft);
  white-space: nowrap; cursor: pointer;
  transition: background 150ms, color 150ms;
}
.cpTab.active { background: var(--accent); color: #fff; }

/* ── Progress ── */
.cpProgress { height: 2px; flex-shrink: 0; }
.cpProgressBar {
  width: 100%; height: 100%;
  background: linear-gradient(90deg, rgba(25,118,210,.12), #1976d2, rgba(25,118,210,.12));
  background-size: 200% 100%;
  animation: cpBar 1s linear infinite;
}
@keyframes cpBar { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* ── Chat list ── */
.cpList { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 4px 0; scrollbar-width: none; -ms-overflow-style: none; }
.cpList::-webkit-scrollbar { width: 0; height: 0; display: none; }
.cpSubheader { padding: 6px 14px 4px; font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; }
.cpEmpty { padding: 16px 14px; color: var(--text-muted); font-size: 14px; }

/* Chat row — Telegram-style: 54px avatar, proper spacing */
.cpItem {
  width: 100%; margin: 0;
  border: 0; background: transparent;
  display: grid;
  grid-template-columns: 54px minmax(0,1fr) auto;
  gap: 0 10px;
  align-items: center;
  padding: 8px 12px 8px 14px;
  text-align: left;
  cursor: pointer;
  transition: background 100ms;
  min-height: 72px;
}
.cpItem:hover { background: rgba(0,0,0,.04); }
.cpItem.selected { background: var(--surface-selected); }

/* Avatar */
.cpAvatarImg, .cpAvatar {
  width: 54px; height: 54px; border-radius: 50%;
  justify-self: center; flex-shrink: 0;
}
.cpAvatarImg { object-fit: cover; display: block; }
.cpAvatar {
  display: grid; place-items: center;
  background: var(--avatar-fallback); color: #fff;
  font-size: 20px; font-weight: 700;
  letter-spacing: -.02em;
}

/* Text area */
.cpMain { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cpPrimary {
  color: var(--text); font-weight: 600; font-size: 15px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cpSecondaryWrap { display: flex; align-items: center; gap: 5px; min-width: 0; }
.cpThumb { width: 18px; height: 18px; border-radius: 4px; object-fit: cover; flex: 0 0 auto; }
.cpSecondary {
  color: var(--text-muted); font-size: 13.5px; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Meta (date + badge) */
.cpMeta {
  align-self: stretch;
  display: flex; flex-direction: column;
  align-items: flex-end; justify-content: center;
  gap: 5px; min-width: 52px; padding-left: 4px;
}
.cpDate { color: var(--text-muted); font-size: 12px; white-space: nowrap; }
.cpUnread {
  min-width: 20px; height: 20px; border-radius: 10px;
  background: var(--accent); color: #fff;
  font-size: 12px; font-weight: 600;
  display: inline-grid; place-items: center; padding: 0 6px;
}

/* ── Shelf (compact) mode ── */
.cpShelfHeader { display: grid; place-items: center; padding: 10px 0 8px; flex-shrink: 0; }
.cpShelfList {
  flex: 1 1 0; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 4px 0 12px;
  scrollbar-width: none; -ms-overflow-style: none;
}
.cpShelfList::-webkit-scrollbar { display: none; }
.cpShelfItem {
  width: 54px; height: 54px; border: 0; background: transparent;
  display: grid; place-items: center;
  border-radius: 14px; position: relative;
  cursor: pointer; transition: background 100ms;
}
.cpShelfItem.selected { background: var(--accent-soft); }
.cpShelfItem:hover:not(.selected) { background: var(--surface-soft-hover); }
.cpShelfUnread {
  position: absolute; right: 0; bottom: 0;
  min-width: 17px; height: 17px; padding: 0 4px;
  font-size: 10px; font-weight: 700;
  border-radius: 999px; background: var(--accent); color: #fff;
  display: grid; place-items: center;
  border: 2px solid rgba(243, 246, 251, 0.92);
}
.cpAvatarImg.shelf, .cpAvatar.shelf { width: 44px; height: 44px; font-size: 16px; }
</style>
