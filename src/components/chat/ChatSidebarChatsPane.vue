<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { ChatFolder, ChatItem, SearchResults, SearchUserResult } from 'combox-api'
import { firstPreviewAttachment, normalizeAvatarSrc, splitSenderPreview, stripMarkdownForPreview, summarizeMessagePreview } from './chatUtils'
import { openAvatarPreview } from '../../utils/avatarViewer'
import { avatarColorFor } from '../../utils/avatarColor'
import { chatScopeFromTab, type AttachmentThumb } from './chatSidebar.types'
import { chatDraftPreview, chatDrafts } from './chatWorkspace.drafts'
import { useI18n } from '../../i18n/i18n'
import ChatFoldersBar from './ChatFoldersBar.vue'
import TypingIndicator from './TypingIndicator.vue'
import { ALL_FOLDERS_ID } from './chatFolders'

const props = withDefaults(defineProps<{
  search: string
  selectedFilterTab: number
  unreadAll: number
  unreadDirect: number
  unreadGroup: number
  unreadChannel: number
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
  typingByChatId: Record<string, Record<string, number>>
  mutedChatIDs: Record<string, boolean>
  archiveOpen: boolean
  folders: ChatFolder[]
  activeFolderId: string
  /** Kind-unfiltered chats for the folder bar badges (props.chats is tab-filtered). */
  barChats?: ChatItem[]
}>(), {
  barChats: () => [],
})

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
  (e: 'chat-context-mute', chat: ChatItem): void
  (e: 'chat-context-leave', chat: ChatItem): void
  (e: 'chat-context-delete', chat: ChatItem): void
  (e: 'chat-context-archive', chat: ChatItem): void
  (e: 'chat-context-pin', chat: ChatItem): void
  (e: 'chat-reorder', payload: { scope: string; items: { chat_id: string; order: number }[] }): void
  (e: 'chat-context-read', chat: ChatItem): void
  (e: 'chat-context-clear', chat: ChatItem): void
  (e: 'open-archive'): void
  (e: 'close-archive'): void
  (e: 'collapse-group'): void
  (e: 'select-folder', folderID: string): void
  (e: 'create-folder'): void
  (e: 'chat-folder-toggle', payload: { chat: ChatItem; folder: ChatFolder }): void
}>()

const { t } = useI18n()

const archivedChats = computed(() => props.chats.filter((chat) => Boolean(chat.archived)))

// A pin belongs to the tab it was created in, so it is only shown there.
const scopeKey = computed(() => chatScopeFromTab(props.selectedFilterTab))

const isPinnedHere = (chat: ChatItem) => Boolean(chat.pinned) && (chat.pin_scope || 'all') === scopeKey.value

/**
 * Saved Messages self-chat (backend chat_kind 'saved', one per user, created
 * lazily by ListChats). It is rendered with a bookmark avatar and the
 * localized title, and it always stays first in "All chats" — ahead of even
 * pinned chats, like in Telegram. Pin/mute/archive are meaningless for it, so
 * the context menu hides those entries (see the template below).
 */
function isSavedChat(chat: ChatItem): boolean {
  return String(chat.kind || '').trim() === 'saved'
}

function savedChatTitle(): string {
  return t('chat.saved_messages', undefined, 'Saved Messages')
}

function chatDraftFor(chat: ChatItem): string {
  const id = String(chat.id || '').trim()
  if (!id) return ''
  // The row of the chat you are typing in must keep its normal preview — the
  // "Draft:" badge only makes sense once you have left the conversation.
  if (id === String(props.selectedChatID || '').trim()) return ''
  const text = chatDrafts.value[id] || ''
  return text.trim() ? chatDraftPreview(text) : ''
}

/** Tapping the group you are already inside collapses straight back to All/Groups. */
function onShelfClick(chat: ChatItem) {
  const id = String(chat.id || '').trim()
  const isGroup = String(chat.kind || '').trim() === 'group'
  if (props.compact && isGroup && id && id === String(props.selectedChatID || '').trim()) {
    emit('collapse-group')
    return
  }
  emit('select-chat', id)
}


const showArchiveRow = computed(() => {
  if (props.compact || props.archiveOpen) return false
  if (props.search.trim()) return false
  if (props.selectedFilterTab !== 0) return false
  // A folder lists its own chats; the archive stays reachable from "All chats".
  if (props.activeFolderId !== ALL_FOLDERS_ID) return false
  return archivedChats.value.length > 0
})

const displayChats = computed(() => {
  const base = props.archiveOpen ? archivedChats.value : props.chats.filter((chat) => !chat.archived)
  // The self-chat is never archived (the menu hides Archive for it), but if a
  // stale archived flag ever arrives it must not hijack the top slot: saved
  // leads only the regular list, the archive view keeps its own order.
  const saved = props.archiveOpen ? [] : base.filter(isSavedChat)
  const restBase = base.filter((chat) => !isSavedChat(chat))
  const pinned = restBase.filter(isPinnedHere).sort((a, b) => (b.pin_order || 0) - (a.pin_order || 0))
  const rest = restBase.filter((chat) => !isPinnedHere(chat))
  return [...saved, ...pinned, ...rest]
})

/** An empty folder must say so instead of rendering a blank list. */
const showFolderEmpty = computed(() => {
  if (props.compact || props.archiveOpen) return false
  if (props.activeFolderId === ALL_FOLDERS_ID) return false
  if (props.search.trim()) return false
  return displayChats.value.length === 0
})

const dragState = ref<{ chatID: string; overID: string } | null>(null)

const itemsEl = ref<HTMLElement | null>(null)

/**
 * Hit-test the pointer against the rendered pinned rows instead of relying on
 * whichever element happens to sit under the cursor: rows can be covered by a
 * leaving TransitionGroup node, a gap, or the unpinned tail of the list, and
 * drops then silently fail — most often while dragging downwards.
 */
function pinnedDropTarget(clientY: number): ChatItem | null {
  const root = itemsEl.value
  const pinned = displayChats.value.filter(isPinnedHere)
  if (!pinned.length || !root) return null
  const byID = new Map(pinned.map((chat) => [chat.id, chat]))
  const rows = Array.from(root.querySelectorAll<HTMLElement>('.cpItem'))
  let below: ChatItem | null = null
  for (const row of rows) {
    const chatID = (row.dataset.chatId || '').trim()
    const chat = byID.get(chatID)
    if (!chat) continue
    const rect = row.getBoundingClientRect()
    if (clientY >= rect.top && clientY < rect.bottom) return chat
    if (clientY >= rect.bottom) below = chat
  }
  // Above the block → first pinned row; past its end → last pinned row.
  return below || pinned[0]
}

function overListDrag(event: DragEvent) {
  if (!dragState.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const target = pinnedDropTarget(event.clientY)
  if (target && dragState.value.overID !== target.id) {
    dragState.value = { ...dragState.value, overID: target.id }
  } else if (!target && dragState.value.overID) {
    dragState.value = { ...dragState.value, overID: '' }
  }
}

function dropList(event: DragEvent) {
  if (!dragState.value) return
  event.preventDefault()
  const sourceID = dragState.value.chatID
  const target = pinnedDropTarget(event.clientY)
  dragState.value = null
  if (!target || sourceID === target.id) return
  applyReorder(sourceID, target.id)
}

function startRowDrag(event: DragEvent, chat: ChatItem) {
  // The saved row is fixed at the top and never joins the pinned reorder block.
  if (isSavedChat(chat) || !isPinnedHere(chat)) {
    event.preventDefault()
    return
  }
  dragState.value = { chatID: chat.id, overID: '' }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', chat.id)
  }
}

function applyReorder(sourceID: string, targetID: string) {
  if (!sourceID || sourceID === targetID) return
  const pinned = displayChats.value.filter(isPinnedHere)
  const fromIndex = pinned.findIndex((item) => item.id === sourceID)
  const toIndex = pinned.findIndex((item) => item.id === targetID)
  if (fromIndex < 0 || toIndex < 0) return
  const next = [...pinned]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  // Fresh descending stamps: they are unique even for chats pinned before
  // per-scope ordering existed, and keep "newest pin on top" afterwards.
  const base = Date.now()
  emit('chat-reorder', {
    scope: scopeKey.value,
    items: next.map((item, index) => ({ chat_id: item.id, order: base - index })),
  })
}

function endRowDrag() {
  dragState.value = null
}

function previewAvatar(
  event: MouseEvent,
  src: string,
  title: string,
  owner: { ownerId?: string; ownerKind?: 'user' | 'chat' } = {},
) {
  event.stopPropagation()
  openAvatarPreview(src, title, { ownerId: owner.ownerId, ownerKind: owner.ownerKind || 'user' })
}

function chatOwner(chat: ChatItem): { ownerId?: string; ownerKind: 'user' | 'chat' } {
  if (chat.is_direct) {
    return chat.peer_user_id
      ? { ownerId: String(chat.peer_user_id), ownerKind: 'user' }
      : { ownerKind: 'chat' }
  }
  return chat.id ? { ownerId: String(chat.id), ownerKind: 'chat' } : { ownerKind: 'chat' }
}

type ChatContextMenuState = { open: boolean; x: number; y: number; chat: ChatItem | null }
const chatContextMenu = ref<ChatContextMenuState>({ open: false, x: 0, y: 0, chat: null })
const rootEl = ref<HTMLElement | null>(null)
const ctxMenuEl = ref<HTMLElement | null>(null)

const CTX_MENU_MARGIN = 8

function openChatContextMenu(event: MouseEvent, chat: ChatItem) {
  event.preventDefault()
  event.stopPropagation()
  const x = Math.min(event.clientX, window.innerWidth - CTX_MENU_MARGIN)
  const y = Math.min(event.clientY, window.innerHeight - CTX_MENU_MARGIN)
  chatContextMenu.value = { open: true, x, y, chat }
  folderSubOpen.value = false
  void nextTick(() => clampContextMenuIntoRoot())
}

function closeChatContextMenu() {
  chatContextMenu.value = { open: false, x: 0, y: 0, chat: null }
  folderSubOpen.value = false
}

/**
 * Chat context menu → "Add to folder" submenu. Only custom folders are
 * listed: the virtual defaults (All/Direct/Channels/Groups) are kind filters,
 * so toggling membership in them is meaningless.
 */
const folderSubOpen = ref(false)

function folderMemberIds(folder: ChatFolder): string[] {
  return folder.chat_ids || []
}

function isChatInFolder(chat: ChatItem, folder: ChatFolder): boolean {
  const id = String(chat.id || '').trim()
  return Boolean(id) && folderMemberIds(folder).includes(id)
}

function toggleChatFolder(chat: ChatItem, folder: ChatFolder) {
  emit('chat-folder-toggle', { chat, folder })
}

/** Keeps the body-teleported menu inside the viewport so it never gets clipped. */
function clampContextMenuIntoRoot() {
  const menu = ctxMenuEl.value
  if (!menu || !chatContextMenu.value.open) return

  const padding = CTX_MENU_MARGIN
  const menuRect = menu.getBoundingClientRect()
  const maxLeft = Math.max(padding, window.innerWidth - menuRect.width - padding)
  const maxTop = Math.max(padding, window.innerHeight - menuRect.height - padding)

  const nextLeft = Math.min(Math.max(chatContextMenu.value.x, padding), maxLeft)
  const nextTop = Math.min(Math.max(chatContextMenu.value.y, padding), maxTop)

  if (nextLeft !== chatContextMenu.value.x || nextTop !== chatContextMenu.value.y) {
    chatContextMenu.value = { ...chatContextMenu.value, x: nextLeft, y: nextTop }
  }
}

function copyChatLink(chat: ChatItem) {
  const slug = (chat.public_slug || '').trim()
  if (!slug || !navigator.clipboard?.writeText) return
  void navigator.clipboard.writeText(`${window.location.origin}/#${slug}`)
}

function isChatMuted(chatID: string) {
  return Boolean(props.mutedChatIDs?.[chatID])
}

function isBotChat(chat: ChatItem) {
  return (chat.kind || '').trim() === 'bot'
}

/** Owners delete their chats instead of leaving them (any non-direct kind). */
function isChatOwner(chat: ChatItem) {
  return ((chat.viewer_role || '').trim().toLowerCase() === 'owner')
}

function canDeleteChat(chat: ChatItem) {
  // The Saved Messages self-chat is a service chat: it can be neither left
  // nor deleted, and members cannot be managed (the backend rejects such ops).
  if (isSavedChat(chat)) return false
  if (chat.is_direct || isBotChat(chat)) return true
  if ((chat.viewer_role || '').trim() !== 'owner') return false
  const kind = (chat.kind || '').trim()
  const parentID = (chat.parent_chat_id || '').trim()
  if (kind === 'standalone_channel' || kind === 'group') return true
  return kind === 'channel' && Boolean(parentID)
}

function deleteLabel(chat: ChatItem) {
  const kind = (chat.kind || '').trim()
  if (kind === 'group') return t('chat.delete_group', undefined, 'Delete group')
  if (kind === 'standalone_channel') return t('chat.delete_channel', undefined, 'Delete channel')
  if (kind === 'channel') return t('chat.delete_topic', undefined, 'Delete topic')
  return t('chat.delete_chat', undefined, 'Delete chat')
}

/** The three parts of a chat row's second line, rendered as separate spans. */
type ChatPreviewLine = { topic: string; sender: string; sep: string; body: string }

/**
 * Author of the newest message when naming them adds context: group and forum
 * topic rows. Direct chats, channels and bots post as themselves, so the title
 * already says who it is.
 */
function chatSenderName(chat: ChatItem): string {
  if (chat.is_direct) return ''
  const kind = (chat.kind || '').trim()
  // The self-chat only ever contains your own messages: no author prefix.
  if (kind === 'saved') return ''
  const isTopic = Boolean((chat.parent_chat_id || '').trim())
  if (kind === 'standalone_channel' || kind === 'bot') return ''
  if (kind === 'channel' && !isTopic) return ''
  return (chat.last_message_sender_name || '').trim()
}

/** `# Topic` tag for a group topic row, when it tells the reader something new. */
function chatTopicPrefix(chat: ChatItem): string {
  if (!(chat.parent_chat_id || '').trim()) return ''
  const title = (chat.title || '').trim()
  if (!title) return ''
  const parent = (chat.parent_title || '').trim()
  if (parent && title === parent) return ''
  return `# ${title} `
}

function emptyPreviewLabel(): string {
  return t('chat.no_messages', undefined, 'No messages yet')
}

function chatPreviewLine(chat: ChatItem): ChatPreviewLine {
  const senderName = chatSenderName(chat)
  // The backend bakes "Name: " into a group preview — strip it before parsing
  // so the name is rendered once, as its own styled span.
  const body = stripMarkdownForPreview(summarizeMessagePreview(splitSenderPreview(chat.last_message_preview || '', senderName), {
    gif: t('chat.gif', undefined, 'GIF'),
    video: t('chat.video', undefined, 'Video'),
    photo: t('chat.photo', undefined, 'Photo'),
    audio: t('chat.audio', undefined, 'Audio'),
    file: t('chat.file', undefined, 'File'),
    empty: emptyPreviewLabel(),
    voice: t('chat.audio_message', undefined, 'Voice message'),
    round: t('chat.video_message', undefined, 'Video message'),
  }))
  // Nothing to attribute when there is no message body at all.
  const sender = body && body !== emptyPreviewLabel() ? senderName : ''
  return { topic: chatTopicPrefix(chat), sender, sep: sender ? ': ' : '', body }
}

/** Telegram style "typing…" row for the chat list. */
function chatTyping(chat: ChatItem): string {
  const count = Object.keys(props.typingByChatId?.[chat.id] || {}).length
  if (count <= 0) return ''
  if (count === 1) return t('chat.typing', undefined, 'typing')
  return t('chat.typing_count', { count }, `${count} users typing…`)
}

type ChatPreviewThumb = { src: string; icon: string }

/** Broken downloads are remembered per chat so a dead thumbnail is not retried forever. */
const thumbFailures = ref<Record<string, string>>({})

function markThumbFailed(chatID: string, src: string) {
  if (!src) return
  thumbFailures.value = { ...thumbFailures.value, [chatID]: src }
}

function chatPreviewThumb(chat: ChatItem): ChatPreviewThumb {
  const info = firstPreviewAttachment(chat.last_message_preview || '')
  if (info.kind === 'none' || !info.id) return { src: '', icon: '' }

  if (info.kind === 'round') return { src: '', icon: 'mdi-play-circle-outline' }
  if (info.kind === 'voice') return { src: '', icon: 'mdi-microphone-outline' }
  if (info.kind === 'audio') return { src: '', icon: 'mdi-music-note' }
  if (info.kind === 'file') return { src: '', icon: 'mdi-file-outline' }

  const entry = props.lastAttachmentPreviewById[info.id]
  // Video and other media only have a real poster in preview_url; the raw url
  // is the media file itself and would render as a broken <img>.
  const src = info.kind === 'video' ? entry?.preview_url || '' : entry?.preview_url || entry?.url || ''
  if (!src) {
    return { src: '', icon: info.kind === 'video' ? 'mdi-file-video-outline' : 'mdi-image-outline' }
  }
  if (thumbFailures.value[chat.id] === src) {
    return { src: '', icon: info.kind === 'video' ? 'mdi-file-video-outline' : 'mdi-image-outline' }
  }
  return { src, icon: '' }
}

function searchChatAvatarSrc(chat: SearchResults['chats'][number]): string {
  const raw = (chat && typeof chat === 'object' ? chat : {}) as Record<string, unknown>
  return normalizeAvatarSrc(String(raw.avatar_data_url || ''))
}

/** Localized kind label for directory rows — a raw `kind` is never shown. */
function directoryKindLabel(kindRaw: string): string {
  const kind = (kindRaw || '').trim()
  if (kind === 'direct') return t('chat.direct', undefined, 'Direct messages')
  if (kind === 'group') return t('chat.group', undefined, 'Group chat')
  if (kind === 'channel') return t('chat.channel', undefined, 'Channel')
  if (kind === 'standalone_channel') return t('chat.kind_standalone_channel', undefined, 'Channel')
  if (kind === 'bot') return t('chat.kind_bot', undefined, 'Bot')
  return ''
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

/**
 * R16: the row date is the real last-message time, nothing else. Empty chats
 * ("No messages yet") show no date at all: ChatItem has only
 * last_message_preview + last_message_at (no last_message_id), so the row is
 * dateless when last_message_at is empty. There is deliberately NO fallback to
 * created_at here: migrated chats were created "now" (2026-09-30) while their
 * messages are Feb-Apr 2026, and falling back would paint Sep 30 over real
 * Feb-Apr dates whenever the timestamp is missing.
 */
function chatRowDate(chat: ChatItem): string {
  const lastStamp = (chat.last_message_at || '').trim()
  if (!lastStamp) return ''
  // Show the last activity, not the chat creation (migrated chats were
  // created "now" while their messages are old).
  return formatDate(lastStamp)
}

function chatViewsCount(chat: ChatItem): number {
  const raw = chat as Record<string, unknown>
  const lastMessage = (raw.last_message && typeof raw.last_message === 'object'
    ? raw.last_message
    : {}) as Record<string, unknown>
  const candidates = [
    lastMessage.views_count,
    lastMessage.view_count,
    lastMessage.views,
    lastMessage.seen_count,
    lastMessage.seen,
    raw.last_message_views_count,
    raw.last_message_view_count,
    raw.last_message_views,
    raw.views_count,
    raw.view_count,
    raw.views,
    raw.seen_count,
    raw.seen,
  ]
  for (const value of candidates) {
    const n = typeof value === 'number' ? value : Number(String(value || '').trim())
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}
</script>

<template>
  <div ref="rootEl" class="cpRoot" :class="{ compact }">
    <template v-if="compact">
      <div class="cpShelfHeader">
        <button type="button" class="cpIconBtn" :aria-label="t('chat.menu')" :title="t('chat.menu')" @click="emit('open-settings')">
          <v-icon icon="mdi-menu" size="18" />
        </button>
      </div>

      <div class="cpShelfList">
        <button
          v-for="chat in displayChats"
          :key="chat.id"
          type="button"
          class="cpShelfItem"
          :class="{ selected: chat.id === selectedChatID }"
          v-long-context
          @click="onShelfClick(chat)"
          @contextmenu="openChatContextMenu($event, chat)"
        >
          <img
            v-if="!isSavedChat(chat) && normalizeAvatarSrc(chat.avatar_data_url || '')"
            class="cpAvatarImg shelf"
            :src="normalizeAvatarSrc(chat.avatar_data_url || '')"
            :alt="chat.title"
          />
          <div v-else-if="isSavedChat(chat)" class="cpAvatar shelf cpAvatarSaved" aria-hidden="true">
            <svg class="cpSavedGlyph" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>
          </div>
          <div v-else class="cpAvatar shelf" :style="{ background: avatarColorFor(chat.id) }">{{ chat.title.slice(0, 1).toUpperCase() }}</div>
          <span v-if="(unreadByChatId[chat.id] || 0) > 0" class="cpShelfUnread">
            {{ unreadByChatId[chat.id] > 99 ? '99+' : unreadByChatId[chat.id] }}
          </span>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="cpHeader can-have-forum">
        <div class="cpTitleRow row-row">
          <button type="button" class="cpIconBtn" :aria-label="t('chat.menu')" :title="t('chat.menu')" @click="emit('open-settings')">
            <v-icon icon="mdi-menu" size="18" />
          </button>
          <div class="cpTitle sidebar-header__title">{{ t('chat.title') }}</div>
        </div>
        <button type="button" class="cpIconBtn" :aria-label="t('chat.create', undefined, 'Create')" :title="t('chat.create', undefined, 'Create')" @click="emit('toggle-create-menu')">
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
        <button type="button" class="cpCreateItem" @click="emit('create-group')">
          <v-icon class="cpCreateIcon" icon="mdi-account-group-outline" size="17" />
          <span>{{ t('chat.create_group') }}</span>
        </button>
        <button type="button" class="cpCreateItem" @click="emit('create-channel')">
          <v-icon class="cpCreateIcon" icon="mdi-tag-multiple-outline" size="17" />
          <span>{{ t('chat.create_channel') }}</span>
        </button>
      </div>

      <ChatFoldersBar
        :folders="folders"
        :active-folder-id="activeFolderId"
        :unread-by-chat-id="unreadByChatId"
        :chats="barChats"
        @select="emit('select-folder', $event)"
        @create="emit('create-folder')"
      />

      <div class="cpProgress"><div v-if="loading" class="cpProgressBar" /></div>

      <div ref="itemsEl" class="cpList chatlist" @dragover="overListDrag" @drop="dropList">
        <template v-if="showDirectory">
          <div v-if="searchingDirectory" class="cpEmpty">{{ t('chat.loading_short') }}</div>
          <div
            v-else-if="filteredDirectoryUsers.length === 0 && directoryResults.chats.length === 0 && chats.length === 0"
            class="cpEmpty"
          >{{ t('chat.no_search_results', undefined, 'Nothing found') }}</div>

          <div v-if="filteredDirectoryUsers.length > 0" class="cpSubheader">{{ t('chat.people') }}</div>
          <button v-for="user in filteredDirectoryUsers" :key="`u:${user.id}`" type="button" class="cpItem" @click="emit('select-directory-user', user)">
            <img
              v-if="normalizeAvatarSrc(user.avatar_data_url || '')"
              class="cpAvatarImg cpAvatarImg--btn"
              :src="normalizeAvatarSrc(user.avatar_data_url || '')"
              :alt="user.username"
              @click.stop="previewAvatar($event, normalizeAvatarSrc(user.avatar_data_url || ''), `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username, { ownerId: user.id, ownerKind: 'user' })"
            />
            <div v-else class="cpAvatar" :style="{ background: avatarColorFor(user.id) }">{{ (user.first_name || user.username || '?').slice(0, 1).toUpperCase() }}</div>
            <div class="cpMain">
              <div class="cpPrimary">{{ `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username }}</div>
              <div class="cpSecondary">@{{ user.username }}</div>
            </div>
          </button>

          <div v-if="directoryResults.chats.length > 0" class="cpSubheader">{{ t('chat.public_chats') }}</div>
          <button v-for="chat in directoryResults.chats" :key="`c:${chat.id}`" type="button" class="cpItem" @click="emit('select-directory-chat', chat)">
            <img
              v-if="searchChatAvatarSrc(chat)"
              class="cpAvatarImg cpAvatarImg--btn"
              :src="searchChatAvatarSrc(chat)"
              :alt="chat.title"
              @click.stop="previewAvatar($event, searchChatAvatarSrc(chat), chat.title, chatOwner(chat))"
            />
            <div v-else class="cpAvatar" :style="{ background: avatarColorFor(chat.id) }">{{ chat.title.slice(0, 1).toUpperCase() }}</div>
            <div class="cpMain">
              <div class="cpPrimary">{{ chat.title }}</div>
              <div class="cpSecondary">{{ chat.public_slug ? `@${chat.public_slug}` : directoryKindLabel(chat.kind) }}</div>
            </div>
          </button>
        </template>

        <template v-else>
          <div v-if="loading && !showDirectory && chats.length === 0" class="cpSkeleton">
            <v-skeleton-loader
              v-for="idx in 7"
              :key="idx"
              type="list-item-avatar-two-line"
              class="cpSkeletonRow"
            />
          </div>
          <template v-else>
            <div v-if="archiveOpen && !showDirectory" class="cpArchiveHead">
              <button type="button" class="cpIconBtn" :aria-label="t('chat.back')" @click="emit('close-archive')">
                <v-icon icon="mdi-arrow-left" size="20" />
              </button>
              <div class="cpArchiveTitle">{{ t('chat.archive', undefined, 'Archive') }}</div>
              <span class="cpArchiveCount">{{ archivedChats.length }}</span>
            </div>
            <button
              v-else-if="showArchiveRow"
              type="button"
              class="cpItem cpArchiveRow"
              @click="emit('open-archive')"
            >
              <div class="cpAvatar cpAvatarArchive">
                <v-icon icon="mdi-archive-outline" size="22" />
              </div>
              <div class="cpMain">
                <div class="cpPrimary">{{ t('chat.archive', undefined, 'Archive') }}</div>
              </div>
              <div class="cpMeta">
                <span class="cpArchiveBadge">{{ archivedChats.length }}</span>
              </div>
            </button>
            <div v-if="showFolderEmpty" class="cpEmpty">{{ t('chat.folders_empty', undefined, 'No chats in this folder') }}</div>
            <div v-if="archiveOpen && !showDirectory && displayChats.length === 0" class="cpEmpty">{{ t('chat.no_chats') }}</div>
            <TransitionGroup name="chatRow" tag="div" class="cpChatItems">
              <button
                v-for="chat in displayChats"
                :key="chat.id"
                type="button"
                :data-chat-id="chat.id"
                class="cpItem chatlist-chat"
                :class="{
                  selected: chat.id === selectedChatID,
                  pinned: isPinnedHere(chat),
                  dragging: dragState?.chatID === chat.id,
                  dragOver: dragState?.overID === chat.id,
                }"
                :draggable="isPinnedHere(chat) && !isSavedChat(chat)"
                @click="emit('select-chat', chat.id)"
                v-long-context
                @contextmenu="openChatContextMenu($event, chat)"
                @dragstart="startRowDrag($event, chat)"
                @dragend="endRowDrag"
              >
                <img
                  v-if="!isSavedChat(chat) && normalizeAvatarSrc(chat.avatar_data_url || '')"
                  class="cpAvatarImg cpAvatarImg--btn"
                  :src="normalizeAvatarSrc(chat.avatar_data_url || '')"
                  :alt="chat.title"
                  @click.stop="previewAvatar($event, normalizeAvatarSrc(chat.avatar_data_url || ''), chat.title, chatOwner(chat))"
                />
                <div v-else-if="isSavedChat(chat)" class="cpAvatar cpAvatarSaved" aria-hidden="true">
                  <svg class="cpSavedGlyph" viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>
                </div>
                <div v-else class="cpAvatar" :style="{ background: avatarColorFor(chat.id) }">{{ chat.title.slice(0, 1).toUpperCase() }}</div>
                <div class="cpMain">
                  <div class="cpPrimary">{{ isSavedChat(chat) ? savedChatTitle() : chat.title }}</div>
                  <div class="cpSecondaryWrap">
                    <template v-if="chatTyping(chat)">
                      <span class="cpTypingDots" aria-hidden="true">
                        <TypingIndicator />
                      </span>
                      <span class="cpSecondary cpTypingText">{{ chatTyping(chat) }}</span>
                    </template>
                    <template v-else>
                    <img
                      v-if="chatPreviewThumb(chat).src"
                      class="cpThumb"
                      :src="chatPreviewThumb(chat).src"
                      alt=""
                      @error="markThumbFailed(chat.id, chatPreviewThumb(chat).src)"
                    />
                    <span v-else-if="chatPreviewThumb(chat).icon" class="cpThumbIcon" aria-hidden="true">
                      <v-icon :icon="chatPreviewThumb(chat).icon" size="16" />
                    </span>
                    <span v-if="chatDraftFor(chat)" class="cpSecondary cpDraftText"><b class="cpDraftLabel">{{ t('chat.draft', undefined, 'Draft:') }}</b> {{ chatDraftFor(chat) }}</span>
                    <span v-else class="cpSecondary"><b v-if="chatPreviewLine(chat).topic" class="cpTopic">{{ chatPreviewLine(chat).topic }}</b><b v-if="chatPreviewLine(chat).sender" class="cpSender">{{ chatPreviewLine(chat).sender }}</b><span class="cpPreviewSep">{{ chatPreviewLine(chat).sep }}</span><span class="cpPreviewBody">{{ chatPreviewLine(chat).body }}</span></span>
                    </template>
                  </div>
                </div>
                <div class="cpMeta">
                  <v-icon v-if="isPinnedHere(chat) && !isSavedChat(chat)" icon="mdi-pin" size="13" class="cpPinIcon" />
                  <div class="cpDate">{{ chatRowDate(chat) }}</div>
                  <div v-if="chatViewsCount(chat) > 0" class="cpViews">
                    <v-icon icon="mdi-eye-outline" size="14" class="cpViewsIcon" />
                    <span>{{ chatViewsCount(chat) }}</span>
                  </div>
                  <span v-if="(unreadByChatId[chat.id] || 0) > 0" class="cpUnread">{{ unreadByChatId[chat.id] > 99 ? '99+' : unreadByChatId[chat.id] }}</span>
                </div>
              </button>
            </TransitionGroup>
          </template>
        </template>
      </div>

      <Teleport to="body">
        <div v-if="chatContextMenu.open" class="cpCtxOverlay" @click="closeChatContextMenu" @contextmenu.prevent="closeChatContextMenu" />
        <div
          v-if="chatContextMenu.open && chatContextMenu.chat"
          ref="ctxMenuEl"
          class="cpCtxMenu"
          :style="{ left: `${chatContextMenu.x}px`, top: `${chatContextMenu.y}px` }"
        >
          <button v-if="!isSavedChat(chatContextMenu.chat)" type="button" class="cpCtxItem" @click="emit('chat-context-archive', chatContextMenu.chat); closeChatContextMenu()">
            <v-icon class="cpCtxIcon" :icon="chatContextMenu.chat.archived ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-outline'" size="17" />
            <span>{{ chatContextMenu.chat.archived ? t('chat.unarchive', undefined, 'Unarchive') : t('chat.archive', undefined, 'Archive') }}</span>
          </button>
          <button v-if="!isSavedChat(chatContextMenu.chat)" type="button" class="cpCtxItem" @click="emit('chat-context-pin', chatContextMenu.chat); closeChatContextMenu()">
            <v-icon class="cpCtxIcon" :icon="chatContextMenu.chat.pinned ? 'mdi-pin-off-outline' : 'mdi-pin-outline'" size="17" />
            <span>{{ chatContextMenu.chat.pinned ? t('chat.unpin', undefined, 'Unpin') : t('chat.pin', undefined, 'Pin') }}</span>
          </button>
          <button
            v-if="(unreadByChatId[chatContextMenu.chat.id] || 0) > 0"
            type="button"
            class="cpCtxItem"
            @click="emit('chat-context-read', chatContextMenu.chat); closeChatContextMenu()"
          >
            <v-icon class="cpCtxIcon" icon="mdi-check-all" size="17" />
            <span>{{ t('chat.mark_read', undefined, 'Mark as read') }}</span>
          </button>
          <button v-if="!isSavedChat(chatContextMenu.chat)" type="button" class="cpCtxItem" @click="emit('chat-context-mute', chatContextMenu.chat); closeChatContextMenu()">
            <v-icon class="cpCtxIcon" :icon="isChatMuted(chatContextMenu.chat.id) ? 'mdi-bell-outline' : 'mdi-bell-off-outline'" size="17" />
            <span>{{ isChatMuted(chatContextMenu.chat.id) ? t('chat.unmute', undefined, 'Unmute') : t('chat.mute', undefined, 'Mute') }}</span>
          </button>
          <div
            v-if="folders.length > 0"
            class="cpCtxSubWrap"
            @mouseenter="folderSubOpen = true"
            @mouseleave="folderSubOpen = false"
          >
            <button type="button" class="cpCtxItem" @click="folderSubOpen = !folderSubOpen">
              <v-icon class="cpCtxIcon" icon="mdi-folder-outline" size="17" />
              <span>{{ t('chat.folders_add_to_folder', undefined, 'Add to folder') }}</span>
              <v-icon class="cpCtxArrow" icon="mdi-chevron-right" size="16" />
            </button>
            <div v-if="folderSubOpen" class="cpCtxSub">
              <button
                v-for="folder in folders"
                :key="folder.id"
                type="button"
                class="cpCtxItem"
                @click="toggleChatFolder(chatContextMenu.chat, folder)"
              >
                <v-icon
                  class="cpCtxIcon"
                  :icon="isChatInFolder(chatContextMenu.chat, folder) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
                  size="17"
                />
                <span>{{ folder.name }}</span>
              </button>
            </div>
          </div>
          <button
            v-if="(chatContextMenu.chat.public_slug || '').trim()"
            type="button"
            class="cpCtxItem"
            @click="copyChatLink(chatContextMenu.chat); closeChatContextMenu()"
          >
            <v-icon class="cpCtxIcon" icon="mdi-link-variant" size="17" />
            <span>{{ t('chat.copy_link', undefined, 'Copy link') }}</span>
          </button>
          <button
            type="button"
            class="cpCtxItem danger"
            @click="emit('chat-context-clear', chatContextMenu.chat); closeChatContextMenu()"
          >
            <v-icon class="cpCtxIcon" icon="mdi-notification-clear-all" size="17" />
            <span>{{ t('chat.clear_history', undefined, 'Clear history') }}</span>
          </button>
          <button
            v-if="!chatContextMenu.chat.is_direct && !isBotChat(chatContextMenu.chat) && !isChatOwner(chatContextMenu.chat) && !isSavedChat(chatContextMenu.chat)"
            type="button"
            class="cpCtxItem"
            @click="emit('chat-context-leave', chatContextMenu.chat); closeChatContextMenu()"
          >
            <v-icon class="cpCtxIcon" icon="mdi-exit-to-app" size="17" />
            <span>{{ t('chat.leave_chat') }}</span>
          </button>
          <button
            v-if="canDeleteChat(chatContextMenu.chat)"
            type="button"
            class="cpCtxItem danger"
            @click="emit('chat-context-delete', chatContextMenu.chat); closeChatContextMenu()"
          >
            <v-icon class="cpCtxIcon" icon="mdi-delete-outline" size="17" />
            <span>{{ deleteLabel(chatContextMenu.chat) }}</span>
          </button>
        </div>
      </Teleport>
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
  padding-left: 12px;
  padding-right: 12px;
  border: 1px solid var(--border);
}
.cpSearchIcon {
  flex: none;
  display: flex;
  align-items: center;
}
.cpSearchClear {
  width: 24px;
  height: 24px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
}
.cpSearchInput { width: 100%; border: 0; outline: 0; background: transparent; font-size: 14px; color: var(--text); }
.cpSearchInput::placeholder { color: var(--text-muted); }

/* ── Create menu ── */
.cpCreateOverlay { position: absolute; inset: 0; z-index: 5; background: transparent; }
.cpCreateMenu {
  position: absolute; top: 54px; right: 12px; z-index: 6;
  min-width: 190px; max-width: 240px;
  background: var(--surface-strong); border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-soft);
  padding: 4px 0;
  transform-origin: top right;
  animation: cpCtxPop 120ms cubic-bezier(0.2, 0.7, 0.3, 1);
}
.cpCreateIcon { flex: none; opacity: 0.72; transition: opacity 120ms ease, transform 120ms ease; }
.cpCreateItem:hover .cpCreateIcon { opacity: 1; transform: translateX(1px); }

/* ── Chat context menu (teleported to <body> so no ancestor clips it) ── */
.cpCtxOverlay { position: fixed; inset: 0; z-index: 9490; background: transparent; animation: cpCtxFade 100ms ease-out; }
.cpCtxMenu {
  position: fixed;
  z-index: 9491;
  min-width: 214px;
  max-width: min(280px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-soft);
  padding: 6px;
  transform-origin: top left;
  animation: cpCtxPop 120ms cubic-bezier(0.2, 0.7, 0.3, 1);
}
.cpCtxItem {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 9px 10px;
  border-radius: 10px;
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
}
.cpCtxItem > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cpCtxIcon { flex: none; opacity: 0.72; transition: opacity 120ms ease, transform 120ms ease; }
.cpCtxItem:hover .cpCtxIcon { opacity: 1; transform: translateX(1px); }
.cpCtxItem:hover { background: var(--surface-soft); }
.cpCtxItem.danger { color: #ff6b6b; }
.cpCtxItem.danger .cpCtxIcon { opacity: 0.9; }
.cpCtxItem.danger:hover { background: rgba(255, 107, 107, 0.12); }
/* "Add to folder" submenu: opens to the side of the context menu. */
.cpCtxSubWrap { position: relative; }
.cpCtxArrow { margin-left: auto; opacity: 0.6; }
.cpCtxSub {
  position: absolute;
  left: 100%;
  top: 0;
  z-index: 1;
  min-width: 190px;
  max-width: 240px;
  max-height: min(320px, calc(100vh - 32px));
  overflow-y: auto;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-soft);
  padding: 6px;
}
@keyframes cpCtxPop {
  from { opacity: 0; transform: scale(0.94) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes cpCtxFade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .cpCtxMenu, .cpCtxOverlay { animation: none; }
}
.cpCreateItem {
  width: 100%; min-height: 34px; padding: 0 12px;
  display: flex; align-items: center; gap: 10px;
  border: 0; background: transparent; text-align: left;
  cursor: pointer; font-size: 13px; color: var(--text);
  transition: background-color 100ms, border-radius 100ms;
  border-radius: 12px;
}
.cpCreateItem > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cpCreateItem:hover { background: var(--surface-soft); }
.cpCreateItem:focus-visible { background: var(--surface-soft); outline: none; }
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

.cpChatItems {
  display: block;
}

.chatRow-move,
.chatRow-enter-active,
.chatRow-leave-active {
  transition: transform 200ms ease, opacity 140ms ease;
  will-change: transform, opacity;
}

.chatRow-enter-from {
  opacity: 0;
  transform: translate3d(0, 6px, 0);
}

.chatRow-leave-to {
  opacity: 0;
  transform: translate3d(0, -6px, 0);
}

.chatRow-leave-active {
  position: absolute;
  width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .chatRow-move,
  .chatRow-enter-active,
  .chatRow-leave-active {
    transition: none;
  }
}

/* Chat row — Telegram-style: 54px avatar, proper spacing */
.cpItem {
  width: 100%; margin: 0;
  border: 0; background: transparent;
  display: grid;
  /* The meta column is fixed so every row's status column starts at the same x. */
  grid-template-columns: 54px minmax(0,1fr) 64px;
  gap: 0 10px;
  align-items: center;
  padding: 8px 12px 8px 14px;
  text-align: left;
  cursor: pointer;
  transition: background 100ms;
  min-height: 72px;
}
.cpItem:hover { background: rgba(0,0,0,.04); }
.cpItem.selected {
  background: color-mix(in srgb, var(--accent) 26%, rgba(0,0,0,.18));
}
.cpItem.selected .cpPrimary { color: var(--accent-strong); }
.cpItem.selected .cpSecondary { color: var(--text-soft); }

/* Avatar */
.cpAvatarImg, .cpAvatar {
  width: 54px; height: 54px; border-radius: 50%;
  justify-self: center; flex-shrink: 0;
}
.cpAvatarImg { object-fit: cover; display: block; }
.cpAvatarImg--btn { cursor: pointer; }
.cpAvatar {
  display: grid; place-items: center;
  background: var(--avatar-fallback); color: #fff;
  font-size: 20px; font-weight: 700;
  letter-spacing: -.02em;
}
/* Saved Messages self-chat: bookmark badge instead of an initial. The glyph
 * is inline SVG on purpose — mdi-bookmark-outline is NOT in the MDI subset
 * font (see src/plugins/mdi-subset.css), so a v-icon would render blank. */
.cpAvatarSaved {
  background: linear-gradient(135deg, #4a90d9 0%, #2f6cb3 100%);
  color: #fff;
}
.cpSavedGlyph { display: block; }

/* Text area */
.cpMain { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cpPrimary {
  color: var(--text); font-weight: 600; font-size: 15px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cpSecondaryWrap { display: flex; align-items: center; gap: 5px; min-width: 0; }
.cpThumb {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: cover;
  flex: 0 0 auto;
  background: var(--surface-soft);
  border: 1px solid var(--border);
}
.cpTypingText {
  color: var(--accent);
}
.cpTypingDots {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  color: var(--accent);
}

.cpThumbIcon {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border-radius: 4px;
  color: var(--text-muted);
  background: var(--surface-soft);
}
.cpSecondary {
  color: var(--text-soft); font-size: 13.5px; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cpDraftText { color: var(--text-soft); }
.cpDraftLabel { color: var(--danger, #ef4444); font-weight: 800; }
/* Second line: "# Topic  Sender: message" — the sender stays its own bold span. */
.cpTopic { font-weight: 700; color: var(--accent-strong, var(--text)); }
.cpSender { font-weight: 700; color: var(--text); }

/* Meta (date + badge) */
.cpMeta {
  align-self: stretch;
  display: flex; flex-direction: column;
  align-items: flex-end; justify-content: center;
  gap: 5px; width: 64px; min-width: 0; box-sizing: border-box; padding-left: 4px;
}
.cpDate {
  max-width: 100%; overflow: hidden; text-overflow: ellipsis;
  color: var(--text-soft); opacity: 0.85; font-size: 12px; white-space: nowrap;
}
.cpUnread {
  min-width: 20px; height: 20px; border-radius: 10px;
  background: var(--accent); color: #fff;
  font-size: 12px; font-weight: 600;
  display: inline-grid; place-items: center; padding: 0 6px;
}

.cpViews {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-soft);
  white-space: nowrap;
}

.cpViewsIcon {
  color: var(--text-soft);
  opacity: 0.9;
}

/* ── Archive / pin ── */
.cpArchiveHead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 6px;
  border-bottom: 1px solid var(--border);
}
.cpArchiveTitle { font-size: 15px; font-weight: 700; color: var(--text); }
.cpArchiveCount {
  margin-left: auto;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 12px;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
}
.cpArchiveBadge {
  min-width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 12px;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
  padding: 0 6px;
}
.cpAvatarArchive {
  background: var(--surface-soft);
  color: var(--text-soft);
}
.cpItem.pinned { box-shadow: inset 2px 0 0 var(--accent); }
.cpItem.dragging { opacity: 0.45; }
.cpItem.dragOver { box-shadow: inset 0 2px 0 var(--accent); }
.cpPinIcon { color: var(--accent); }
.cpArchiveRow { background: var(--surface-soft); }
.cpArchiveRow:hover { background: var(--accent-soft); }

/* Loading skeletons */
.cpSkeleton {
  padding: 6px 8px;
  display: grid;
  gap: 4px;
}

.cpSkeletonRow {
  border-radius: 12px;
  overflow: hidden;
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
