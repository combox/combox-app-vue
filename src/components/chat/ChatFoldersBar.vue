<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { deleteChatFolder, markChatAsRead, type ChatFolder, type ChatItem } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import ConfirmDialog from '../core/ConfirmDialog.vue'
import { useConfirm } from '../core/useConfirm'
import FolderCreateDialog from './FolderCreateDialog.vue'
import {
  ALL_FOLDERS_ID,
  DEFAULT_FOLDER_CHANNEL_ID,
  DEFAULT_FOLDER_DIRECT_ID,
  DEFAULT_FOLDER_GROUP_ID,
  DEFAULT_FOLDER_ICONS,
  chatMatchesDefaultKind,
  currentFolderIdOf,
  defaultFolderKindOf,
  defaultFolderUnreadSum,
  folderUnreadSum,
  sortFoldersForBar,
  unreadBadgeLabel,
  type DefaultFolderKind,
} from './chatFolders'

const props = defineProps<{
  folders: ChatFolder[]
  activeFolderId: string
  unreadByChatId: Record<string, number>
  /** Full (kind-unfiltered) chat list for the Direct/Channels/Groups badges. */
  chats: ChatItem[]
}>()

const emit = defineEmits<{
  (e: 'select', folderID: string): void
  (e: 'create'): void
}>()

const { t } = useI18n()
const toast = useToast()
const router = useRouter()
const folderConfirm = useConfirm()

const sortedFolders = computed(() => sortFoldersForBar(props.folders))

/**
 * A stored folder id that has not resolved yet (first load, or the folder was
 * deleted) must still light up a tab — "All" is the safe active state.
 * Virtual default ids pass through; only unknown custom ids fall back.
 */
const currentFolderId = computed(() => currentFolderIdOf(props.folders, props.activeFolderId))

type DefaultTab = { id: string; kind: DefaultFolderKind; label: string }

const defaultTabs = computed<DefaultTab[]>(() => [
  { id: ALL_FOLDERS_ID, kind: 'all', label: t('chat.tab_all', undefined, 'All') },
  { id: DEFAULT_FOLDER_DIRECT_ID, kind: 'direct', label: t('chat.tab_direct', undefined, 'Direct') },
  { id: DEFAULT_FOLDER_CHANNEL_ID, kind: 'channel', label: t('chat.tab_channels', undefined, 'Channels') },
  { id: DEFAULT_FOLDER_GROUP_ID, kind: 'group', label: t('chat.tab_groups', undefined, 'Groups') },
])

function isActive(folderID: string): boolean {
  return currentFolderId.value === folderID
}

function defaultUnread(kind: DefaultFolderKind): number {
  return defaultFolderUnreadSum(kind, props.chats, props.unreadByChatId)
}

function folderUnread(folder: ChatFolder): number {
  return folderUnreadSum(folder, props.unreadByChatId)
}

function folderIcon(folder: ChatFolder): string {
  return String(folder.icon || '').trim()
}

function isMdiFolderIcon(value: string): boolean {
  return value.startsWith('mdi-')
}

function folderName(folder: ChatFolder): string {
  return String(folder.name || '').trim()
}

function select(folderID: string) {
  emit('select', folderID)
}

const barEl = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
let resizeObserver: ResizeObserver | null = null

function updateScrollState(): void {
  const el = barEl.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) {
    canScrollLeft.value = false
    canScrollRight.value = false
    return
  }
  canScrollLeft.value = el.scrollLeft > 1
  canScrollRight.value = el.scrollLeft < max - 1
}

function scrollBarBy(delta: number): void {
  const el = barEl.value
  if (!el) return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  el.scrollBy({ left: delta, behavior: reduce ? 'auto' : 'smooth' })
}

/**
 * Desktop vertical wheel over a horizontal strip does nothing natively
 * (Shift+wheel already arrives as deltaX and is left to the browser).
 * Translate a vertical intent into horizontal scroll only while the bar
 * itself can move that way — at the edges the event is left alone so the
 * chat list / page keeps scrolling vertically. Touch is untouched.
 */
function onBarWheel(event: WheelEvent): void {
  const el = barEl.value
  if (!el) return
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  if (event.deltaY === 0) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return
  const goingRight = event.deltaY > 0
  const atEdge = goingRight ? el.scrollLeft >= max - 1 : el.scrollLeft <= 1
  if (atEdge) return
  event.preventDefault()
  el.scrollLeft += event.deltaY
}

function scrollActiveIntoView(): void {
  const el = barEl.value
  if (!el) return
  const active = el.querySelector<HTMLElement>('.cfTab.active')
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/**
 * R20: right-click menu on folder tabs. Custom folders offer Edit + Remove
 * (danger); virtual tabs (All/Direct/Channels/Groups) offer Mark as read +
 * Edit Folders and never a delete. Positioned at the cursor, closed by
 * overlay click or Esc. No bulk read endpoint exists in comboxApi.chat.d.ts
 * (only markChatAsRead(chatID)), so Mark as read loops per-chat calls.
 */
type FolderCtxMode = 'custom' | 'virtual'

const ctxMenu = ref({ open: false, x: 0, y: 0, mode: 'custom' as FolderCtxMode, folderId: '', title: '' })
const ctxMenuEl = ref<HTMLElement | null>(null)
const editOpen = ref(false)
const editingFolder = ref<ChatFolder | null>(null)
const markReadBusy = ref(false)
const removeBusy = ref(false)

function closeFolderMenu(): void {
  if (ctxMenu.value.open) ctxMenu.value = { ...ctxMenu.value, open: false }
}

function onCtxKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeFolderMenu()
}

function clampCtxMenu(): void {
  const menu = ctxMenuEl.value
  if (!menu || !ctxMenu.value.open) return
  const padding = 8
  const rect = menu.getBoundingClientRect()
  const maxLeft = Math.max(padding, window.innerWidth - rect.width - padding)
  const maxTop = Math.max(padding, window.innerHeight - rect.height - padding)
  const nextLeft = Math.min(Math.max(ctxMenu.value.x, padding), maxLeft)
  const nextTop = Math.min(Math.max(ctxMenu.value.y, padding), maxTop)
  if (nextLeft !== ctxMenu.value.x || nextTop !== ctxMenu.value.y) {
    ctxMenu.value = { ...ctxMenu.value, x: nextLeft, y: nextTop }
  }
}

function openFolderMenu(event: MouseEvent, mode: FolderCtxMode, folderId: string, title: string): void {
  event.preventDefault()
  event.stopPropagation()
  const x = Math.min(event.clientX, window.innerWidth - 8)
  const y = Math.min(event.clientY, window.innerHeight - 8)
  ctxMenu.value = { open: true, x, y, mode, folderId, title }
  void nextTick(() => clampCtxMenu())
}

function startEditFolder(): void {
  const target = props.folders.find((item) => item.id === ctxMenu.value.folderId) || null
  if (!target) {
    closeFolderMenu()
    return
  }
  editingFolder.value = target
  editOpen.value = true
  closeFolderMenu()
}

function closeEditFolder(): void {
  editOpen.value = false
  editingFolder.value = null
}

function notifyFoldersChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('combox:folders-changed'))
  } catch {
    // Non-fatal: ChatSidebar listens to this to reload; direct emit below still works.
  }
}

function onEditSaved(): void {
  editOpen.value = false
  editingFolder.value = null
  notifyFoldersChanged()
}

async function askRemoveFolder(): Promise<void> {
  const target = props.folders.find((item) => item.id === ctxMenu.value.folderId) || null
  const title = ctxMenu.value.title || target?.name || ''
  closeFolderMenu()
  if (!target || removeBusy.value) return
  const ok = await folderConfirm.openConfirm({
    title: t('settings.delete_folder', undefined, 'Delete folder') + (title ? ` "${title}"` : ''),
    text: t('settings.folders_delete_confirm', undefined, 'Delete this folder?'),
    okLabel: t('common.delete', undefined, 'Delete'),
    danger: true,
  })
  if (!ok) return
  removeBusy.value = true
  try {
    await deleteChatFolder(target.id)
    toast.success(t('settings.folders_deleted', undefined, 'Folder deleted'))
    notifyFoldersChanged()
    if (currentFolderId.value === target.id) emit('select', ALL_FOLDERS_ID)
  } catch (caught) {
    toast.error(
      caught instanceof Error && caught.message
        ? caught.message
        : t('settings.folders_delete_failed', undefined, 'Could not delete the folder'),
    )
  } finally {
    removeBusy.value = false
  }
}

function folderChatIdsForRead(folderId: string): string[] {
  if (folderId === ALL_FOLDERS_ID) {
    return (props.chats || []).map((chat) => String(chat.id || '').trim()).filter(Boolean)
  }
  const kind = defaultFolderKindOf(folderId)
  if (kind) {
    if (kind === 'all') {
      return (props.chats || []).map((chat) => String(chat.id || '').trim()).filter(Boolean)
    }
    return (props.chats || [])
      .filter((chat) => chatMatchesDefaultKind(chat, kind))
      .map((chat) => String(chat.id || '').trim())
      .filter(Boolean)
  }
  const folder = props.folders.find((item) => item.id === folderId)
  return [...(folder?.chat_ids || [])].map((id) => String(id || '').trim()).filter(Boolean)
}

async function markFolderRead(): Promise<void> {
  const folderId = ctxMenu.value.folderId
  closeFolderMenu()
  if (markReadBusy.value) return
  const unread = props.unreadByChatId || {}
  const ids = folderChatIdsForRead(folderId).filter((id) => Number(unread[id] || 0) > 0)
  if (ids.length === 0) {
    toast.info(t('chat.mark_read', undefined, 'Mark as read'))
    return
  }
  markReadBusy.value = true
  let failed = 0
  for (const chatID of ids) {
    try {
      await markChatAsRead(chatID)
    } catch {
      failed += 1
    }
  }
  markReadBusy.value = false
  if (failed === 0) {
    toast.success(t('chat.mark_read', undefined, 'Mark as read'))
  } else if (failed < ids.length) {
    toast.error(t('chat.mark_read_failed', undefined, 'Could not mark chat as read'))
  } else {
    toast.error(t('chat.mark_read_failed', undefined, 'Could not mark chat as read'))
  }
}

function openManageFolders(): void {
  closeFolderMenu()
  try {
    void router.push('/settings')
  } catch {
    // Router unavailable (tests): settings stay reachable via the app nav.
  }
}

onMounted(() => {
  updateScrollState()
  scrollActiveIntoView()
  window.addEventListener('resize', updateScrollState)
  window.addEventListener('keydown', onCtxKeydown)
  if (typeof ResizeObserver !== 'undefined' && barEl.value) {
    resizeObserver = new ResizeObserver(() => updateScrollState())
    resizeObserver.observe(barEl.value)
  }
  void nextTick(() => {
    updateScrollState()
    scrollActiveIntoView()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateScrollState)
  window.removeEventListener('keydown', onCtxKeydown)
  resizeObserver?.disconnect()
  resizeObserver = null
})

watch(currentFolderId, () => {
  void nextTick(() => {
    scrollActiveIntoView()
    updateScrollState()
  })
})

watch(sortedFolders, () => {
  void nextTick(updateScrollState)
})
</script>

<template>
  <div class="cfWrap">
    <button
      v-if="canScrollLeft"
      type="button"
      class="cfArrow cfArrowLeft"
      aria-label="Scroll folders left"
      @click="scrollBarBy(-220)"
    >
      <v-icon icon="mdi-chevron-left" size="18" />
    </button>
    <div
      ref="barEl"
      class="cfBar"
      role="tablist"
      :aria-label="t('chat.folders_tabs_label', undefined, 'Chat folders')"
      @wheel="onBarWheel"
      @scroll="updateScrollState"
    >
    <button
      v-for="tab in defaultTabs"
      :key="`default:${tab.id || 'all'}`"
      type="button"
      role="tab"
      class="cfTab"
      :class="{ active: isActive(tab.id) }"
      :aria-selected="isActive(tab.id)"
      :title="tab.label"
      @click="select(tab.id)"
      @contextmenu.prevent="openFolderMenu($event, 'virtual', tab.id, tab.label)"
    >
      <v-icon :icon="DEFAULT_FOLDER_ICONS[tab.kind]" size="16" class="cfIcon" />
      <span class="cfName">{{ tab.label }}</span>
      <span v-if="defaultUnread(tab.kind) > 0" class="cfBadge">{{ unreadBadgeLabel(defaultUnread(tab.kind)) }}</span>
    </button>

    <button
      v-for="folder in sortedFolders"
      :key="folder.id"
      type="button"
      role="tab"
      class="cfTab"
      :class="{ active: isActive(folder.id) }"
      :aria-selected="isActive(folder.id)"
      :title="folderName(folder)"
      @click="select(folder.id)"
      @contextmenu.prevent="openFolderMenu($event, 'custom', folder.id, folderName(folder))"
    >
      <v-icon v-if="isMdiFolderIcon(folderIcon(folder))" :icon="folderIcon(folder)" size="16" class="cfIcon" />
      <span v-else-if="folderIcon(folder)" class="cfEmoji" aria-hidden="true">{{ folderIcon(folder) }}</span>
      <span class="cfName">{{ folderName(folder) }}</span>
      <span v-if="folderUnread(folder) > 0" class="cfBadge">{{ unreadBadgeLabel(folderUnread(folder)) }}</span>
    </button>

    <button
      type="button"
      class="cfTab cfCreate"
      :title="t('chat.folders_create_folder', undefined, 'Create folder')"
      :aria-label="t('chat.folders_create_folder', undefined, 'Create folder')"
      @click="emit('create')"
    >
      <v-icon icon="mdi-plus" size="16" class="cfIcon" />
    </button>
    </div>
    <button
      v-if="canScrollRight"
      type="button"
      class="cfArrow cfArrowRight"
      aria-label="Scroll folders right"
      @click="scrollBarBy(220)"
    >
      <v-icon icon="mdi-chevron-right" size="18" />
    </button>
    <Teleport to="body">
      <div
        v-if="ctxMenu.open"
        class="cfCtxOverlay"
        @click="closeFolderMenu"
        @contextmenu.prevent="closeFolderMenu"
      />
      <div
        v-if="ctxMenu.open"
        ref="ctxMenuEl"
        class="cfCtxMenu"
        role="menu"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
      >
        <template v-if="ctxMenu.mode === 'custom'">
          <button type="button" class="cfCtxItem" role="menuitem" @click="startEditFolder">
            <v-icon icon="mdi-pencil-outline" size="17" class="cfCtxIcon" />
            <span>{{ t('settings.edit_folder', undefined, 'Edit folder') }}</span>
          </button>
          <button
            type="button"
            class="cfCtxItem danger"
            role="menuitem"
            :disabled="removeBusy"
            @click="askRemoveFolder"
          >
            <v-icon icon="mdi-delete-outline" size="17" class="cfCtxIcon" />
            <span>{{ t('settings.delete_folder', undefined, 'Delete folder') }}</span>
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="cfCtxItem"
            role="menuitem"
            :disabled="markReadBusy"
            @click="markFolderRead"
          >
            <v-icon icon="mdi-check-all" size="17" class="cfCtxIcon" />
            <span>{{ t('chat.mark_read', undefined, 'Mark as read') }}</span>
          </button>
          <button type="button" class="cfCtxItem" role="menuitem" @click="openManageFolders">
            <v-icon icon="mdi-folder-outline" size="17" class="cfCtxIcon" />
            <span>{{ t('settings.folders', undefined, 'Folders') }}</span>
          </button>
        </template>
      </div>
    </Teleport>
    <FolderCreateDialog :open="editOpen" :folder="editingFolder" @close="closeEditFolder" @saved="onEditSaved" />
    <ConfirmDialog
      :open="folderConfirm.dialog.open"
      :title="folderConfirm.dialog.title"
      :text="folderConfirm.dialog.text"
      :ok-label="folderConfirm.dialog.okLabel"
      :danger="folderConfirm.dialog.danger"
      @confirm="folderConfirm.acceptConfirm"
      @cancel="folderConfirm.dismissConfirm"
    />
  </div>
</template>

<style scoped>
.cfWrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
  flex: 0 0 auto;
}

.cfBar {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  padding: 0 10px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  scroll-padding-left: 32px;
  scroll-padding-right: 32px;
}

.cfBar::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}

.cfTab {
  flex: 0 0 auto;
  flex-shrink: 0;
  min-height: 30px;
  max-width: none;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--surface-soft);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-soft);
  white-space: nowrap;
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
}

.cfTab:hover {
  background: var(--surface-soft-hover);
}

.cfTab.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.cfTab:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 2px;
}

.cfCreate {
  width: 30px;
  height: 30px;
  min-height: 30px;
  aspect-ratio: 1 / 1;
  border-radius: 50%;
  flex: none;
  display: inline-grid;
  place-items: center;
  padding: 0;
}

.cfArrow {
  position: absolute;
  top: 0;
  bottom: 8px;
  z-index: 1;
  width: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-strong);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  flex: none;
}

.cfArrow:hover {
  color: var(--accent-strong);
}

.cfArrow:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 1px;
}

.cfArrowLeft {
  left: 2px;
}

.cfArrowRight {
  right: 2px;
}

.cfIcon {
  flex: none;
  opacity: 0.85;
}

.cfTab.active .cfIcon {
  opacity: 1;
}

.cfEmoji {
  flex: none;
  font-size: 14px;
  line-height: 1;
}

.cfName {
  min-width: 0;
  white-space: nowrap;
}

.cfBadge {
  flex: none;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
}

.cfTab.active .cfBadge {
  background: rgba(255, 255, 255, 0.26);
}

.cfCtxOverlay {
  position: fixed;
  inset: 0;
  z-index: 9490;
  background: transparent;
}

.cfCtxMenu {
  position: fixed;
  z-index: 9491;
  min-width: 214px;
  max-width: min(280px, calc(100vw - 16px));
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-soft);
  padding: 6px;
  transform-origin: top left;
  animation: cfCtxPop 120ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.cfCtxItem {
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

.cfCtxItem > span {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cfCtxIcon {
  flex: none;
  opacity: 0.72;
}

.cfCtxItem:hover:not(:disabled) {
  background: var(--surface-soft);
}

.cfCtxItem:disabled {
  opacity: 0.5;
  cursor: default;
}

.cfCtxItem.danger {
  color: #ff6b6b;
}

.cfCtxItem.danger:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.12);
}

@keyframes cfCtxPop {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(-4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cfTab {
    transition: none;
  }
  .cfCtxMenu {
    animation: none;
  }
}
</style>
