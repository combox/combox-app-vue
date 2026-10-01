<script lang="ts">
import {
  getAttachment,
  listChatFolders,
  searchDirectory,
  setChatFolderChats,
  type ChatFolder,
  type ChatItem,
  type SearchResults,
  type SearchUserResult,
} from 'combox-api'
import { computed, defineComponent, inject, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import ChatSidebarChatsPane from './ChatSidebarChatsPane.vue'
import ChatSidebarTopicsPane from './ChatSidebarTopicsPane.vue'
import FolderCreateDialog from './FolderCreateDialog.vue'
import { CHAT_LIST_ACTIONS } from './chatWorkspace.actions.list'
import { normalizeAvatarSrc } from './chatUtils'
import { chatScopeFromTab, type AttachmentThumb, type GroupChannelItem } from './chatSidebar.types'
import { avatarColorFor } from '../../utils/avatarColor'
import { ALL_FOLDERS_ID, activeFolderOf, chatMatchesDefaultKind, defaultFolderKindOf, isDefaultFolderId, readActiveFolder, sortFoldersForBar, tabIndexForDefaultKind, writeActiveFolder } from './chatFolders'

export default defineComponent({
  name: 'ChatSidebar',
  components: { ChatSidebarChatsPane, ChatSidebarTopicsPane, FolderCreateDialog },
  props: {
    chats: { type: Array as PropType<ChatItem[]>, default: () => [] },
    selectedChatID: { type: String, required: true },
    currentUserId: { type: String, default: '' },
    currentUsername: { type: String, default: '' },
    currentUserDisplayName: { type: String, default: '' },
    currentUserAvatarSrc: { type: String, default: '' },
    search: { type: String, required: true },
    selectedFilterTab: { type: Number, required: true },
    unreadAll: { type: Number, required: true },
    unreadDirect: { type: Number, required: true },
    unreadGroup: { type: Number, required: true },
    unreadChannel: { type: Number, default: 0 },
    unreadByChatId: { type: Object as PropType<Record<string, number>>, default: () => ({}) },
    typingByChatId: { type: Object as PropType<Record<string, Record<string, number>>>, default: () => ({}) },
    mutedChatIDs: { type: Object as PropType<Record<string, boolean>>, default: () => ({}) },
    loading: { type: Boolean, required: true },
    searchingDirectory: { type: Boolean, required: true },
    directoryQuery: { type: String, required: true },
    directoryResults: { type: Object as PropType<SearchResults>, required: true },
    sidebarPanel: { type: String as PropType<'chats' | 'settings'>, required: true },
    canCreateChannel: { type: Boolean, default: false },
    showGroupChannelsPanel: { type: Boolean, default: false },
    groupTitle: { type: String, default: '' },
    groupMemberCount: { type: Number, default: 0 },
    groupChannels: { type: Array as PropType<GroupChannelItem[]>, default: () => [] },
    selectedGroupChannelID: { type: String, default: '' },
    loadingGroupChannels: { type: Boolean, default: false },
  },
  emits: [
    'update:search',
    'update:selectedFilterTab',
    'select',
    'openSettings',
    'closeSettings',
    'createGroup',
    'createChannel',
    'selectDirectoryChat',
    'selectDirectoryUser',
    'closeGroupChannels',
    'selectGroupChannel',
    'createGroupChannel',
    'chatContextMute',
    'chatContextLeave',
    'chatContextDelete',
    'openChannelSettings',
    'openGroupMenu',
  ],
  setup(props, { emit }) {
    const { t } = useI18n()
    const router = useRouter()
    const lastAttachmentPreviewById = ref<Record<string, AttachmentThumb>>({})
    const requestedAttachmentIDs = new Set<string>()
    const createMenuOpen = ref(false)
    const createDialog = ref<{ open: boolean; kind: 'group' | 'channel'; title: string; slug: string; isPublic: boolean; avatarDataUrl: string | null; saving: boolean; error: string }>({ open: false, kind: 'group', title: '', slug: '', isPublic: true, avatarDataUrl: null, saving: false, error: '' })
    const createMemberQuery = ref('')
    const createMemberResults = ref<SearchUserResult[]>([])
    const createMemberIDs = ref<string[]>([])
    const createMemberBusy = ref(false)
    const topicCreateOpen = ref(false)
    const topicCreateTitle = ref('')
    const topicCreateType = ref<'text' | 'voice'>('text')
    const topicCreateError = ref('')
    const archiveOpen = ref(false)
    const clearConfirm = ref<{ open: boolean; chat: ChatItem | null; busy: boolean; error: string }>({ open: false, chat: null, busy: false, error: '' })
    const chatListActions = inject(CHAT_LIST_ACTIONS)
    const toast = useToast()

    // ── Chat folders: loaded here so the filter never leaks into the shared composable ──
    const folders = ref<ChatFolder[]>([])
    const activeFolderId = ref(readActiveFolder())
    const folderDialogOpen = ref(false)
    const folderToggleBusy = ref(false)
    let foldersBusy = false
    let foldersRequest = 0
    let foldersErrorShown = false

    async function loadFolders() {
      if (foldersBusy) return
      foldersBusy = true
      const request = ++foldersRequest
      try {
        const list = await listChatFolders()
        if (request !== foldersRequest) return
        folders.value = sortFoldersForBar(list)
      } catch {
        if (request !== foldersRequest) return
        // No folders to show: the bar degrades to the default tabs only.
        folders.value = []
        if (!foldersErrorShown) {
          foldersErrorShown = true
          toast.error(t('chat.folders_load_failed', undefined, 'Could not load chat folders'))
        }
      } finally {
        foldersBusy = false
      }
    }

    /**
     * The folder bar is the single All/Direct/Channels/Groups filter, so a
     * virtual tab also drives the legacy chat filter upstream (the workspace
     * still owns tab filtering and cannot be touched). A custom folder resets
     * the tab to All so its chats are never hidden by an intersecting filter.
     */
    function selectFolder(folderID: string) {
      const kind = defaultFolderKindOf(folderID)
      if (folderID !== activeFolderId.value) {
        activeFolderId.value = folderID
        writeActiveFolder(folderID)
      }
      archiveOpen.value = false
      const tab = kind ? tabIndexForDefaultKind(kind) : 0
      if (tab !== props.selectedFilterTab) emit('update:selectedFilterTab', tab)
    }

    // A stored id for a custom folder that was deleted (or never existed
    // here) resets to "All" as soon as the real folder list is known.
    // Virtual default ids always resolve, so they never reset.
    watch(folders, (list) => {
      if (activeFolderId.value && !isDefaultFolderId(activeFolderId.value) && !activeFolderOf(list, activeFolderId.value)) {
        activeFolderId.value = ALL_FOLDERS_ID
        writeActiveFolder(ALL_FOLDERS_ID)
      }
    })

    /**
     * Kind-unfiltered chats for the folder bar badges. props.chats is already
     * tab/search-filtered upstream, so the last unfiltered snapshot is cached
     * and reused while a tab or a search narrows the list.
     */
    const fullChatsCache = ref<ChatItem[]>([])
    watch(() => [props.chats, props.selectedFilterTab, props.search] as const, () => {
      if (props.selectedFilterTab === 0 && !props.search.trim()) {
        fullChatsCache.value = props.chats
      }
    }, { immediate: true })
    const barChats = computed(() => {
      if (props.selectedFilterTab === 0 && !props.search.trim()) return props.chats
      return fullChatsCache.value.length > 0 ? fullChatsCache.value : props.chats
    })

    /** Chats the current folder allows through; "All" passes everything. */
    const paneChats = computed(() => {
      const kind = defaultFolderKindOf(activeFolderId.value)
      if (kind) {
        if (kind === 'all') return props.chats
        return props.chats.filter((chat) => chatMatchesDefaultKind(chat, kind))
      }
      const folder = activeFolderOf(folders.value, activeFolderId.value)
      if (!folder) return props.chats
      const allowed = new Set(folder.chat_ids)
      return props.chats.filter((chat) => allowed.has(String(chat.id || '').trim()))
    })

    function openFolderCreate() {
      folderDialogOpen.value = true
    }

    function closeFolderCreate() {
      folderDialogOpen.value = false
    }

    async function onFolderDialogSaved(folder: ChatFolder) {
      folderDialogOpen.value = false
      await loadFolders()
      // A freshly created folder becomes active, like in Telegram.
      activeFolderId.value = folder.id
      writeActiveFolder(folder.id)
      if (props.selectedFilterTab !== 0) emit('update:selectedFilterTab', 0)
    }

    /** Chat context menu "Add to folder" toggle (full-list PUT per SDK). */
    async function onChatFolderToggle(payload: { chat: ChatItem; folder: ChatFolder }) {
      if (folderToggleBusy.value) return
      folderToggleBusy.value = true
      try {
        const chatID = String(payload.chat.id || '').trim()
        if (!chatID) return
        const current = folders.value.find((item) => item.id === payload.folder.id) || payload.folder
        const member = (current.chat_ids || []).includes(chatID)
        const next = member
          ? (current.chat_ids || []).filter((id) => id !== chatID)
          : [...(current.chat_ids || []), chatID]
        const updated = await setChatFolderChats(current.id, next)
        folders.value = folders.value.map((item) => (item.id === updated.id ? updated : item))
      } catch (caught) {
        toast.error(caught instanceof Error && caught.message
          ? caught.message
          : t('chat.folders_toggle_failed', undefined, 'Could not update the folder'))
      } finally {
        folderToggleBusy.value = false
      }
    }

    function onFoldersVisibilityChange() {
      if (document.visibilityState === 'visible') void loadFolders()
    }

    /** Import modal (App.vue) notifies so the new folder appears without reload. */
    function onFoldersChanged() {
      void loadFolders()
    }

    onMounted(() => {
      void loadFolders()
      document.addEventListener('visibilitychange', onFoldersVisibilityChange)
      window.addEventListener('combox:folders-changed', onFoldersChanged)
    })

    onBeforeUnmount(() => {
      document.removeEventListener('visibilitychange', onFoldersVisibilityChange)
      window.removeEventListener('combox:folders-changed', onFoldersChanged)
    })

    const normalizedCurrentUsername = computed(() => (props.currentUsername || '').trim().toLowerCase())
    const showDirectory = computed(() => props.search.trim().length > 0)
    const filteredDirectoryUsers = computed(() =>
      props.directoryResults.users.filter((user) => {
        if (props.currentUserId && user.id === props.currentUserId) return false
        if (!normalizedCurrentUsername.value) return Boolean(user.id)
        return Boolean(user.id) && user.username.trim().toLowerCase() !== normalizedCurrentUsername.value
      }),
    )
    const selectedCreateMembers = computed(() => createMemberIDs.value.map((id) => createMemberResults.value.find((item) => item.id === id)).filter((item): item is SearchUserResult => Boolean(item)))
    const visibleCreateMemberResults = computed(() => createMemberResults.value.filter((user) => !createMemberIDs.value.includes(user.id) && user.id !== props.currentUserId))
    const visibleLastAttachmentIDs = computed(() => {
      const ids: string[] = []
      for (const chat of props.chats) {
        const raw = (chat.last_message_preview || '').match(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi) || []
        ids.push(...raw)
      }
      return Array.from(new Set(ids))
    })

    watch(visibleLastAttachmentIDs, (ids) => {
      for (const attachmentID of ids) {
        if (!attachmentID || requestedAttachmentIDs.has(attachmentID) || lastAttachmentPreviewById.value[attachmentID]) continue
        requestedAttachmentIDs.add(attachmentID)
        void getAttachment(attachmentID).then((payload) => {
          if (lastAttachmentPreviewById.value[attachmentID]) return
          lastAttachmentPreviewById.value = { ...lastAttachmentPreviewById.value, [attachmentID]: { url: payload.url, preview_url: payload.preview_url } }
        }).catch(() => {
          // A transient error must not blacklist the thumbnail for the session.
          requestedAttachmentIDs.delete(attachmentID)
        })
      }
    }, { immediate: true })

    // Own settings live in the canonical TG-style SettingsPage (/settings):
    // the sidebar never renders a competing settings pane, it just routes
    // there. ChatWorkspace.vue cannot be touched, so the workspace-owned
    // sidebarPanel 'settings' state is bounced the same way (see the watcher
    // below) instead of being rendered.
    function onOpenSettings() {
      createMenuOpen.value = false
      try {
        void router.push('/settings')
      } catch {
        // Router unavailable (tests): fall back to the workspace panel state.
        emit('openSettings')
      }
    }
    function onCreateGroup() { createMenuOpen.value = false; createDialog.value = { open: true, kind: 'group', title: '', slug: '', isPublic: true, avatarDataUrl: null, saving: false, error: '' }; createMemberQuery.value = ''; createMemberResults.value = []; createMemberIDs.value = [] }
    function onCreateChannel() {
      createMenuOpen.value = false
      if (props.canCreateChannel) {
        openTopicCreate()
        return
      }
      createDialog.value = { open: true, kind: 'channel', title: '', slug: '', isPublic: true, avatarDataUrl: null, saving: false, error: '' }
      createMemberQuery.value = ''
      createMemberResults.value = []
      createMemberIDs.value = []
    }
    function closeCreateDialog() { createDialog.value = { open: false, kind: createDialog.value.kind, title: '', slug: '', isPublic: true, avatarDataUrl: null, saving: false, error: '' }; createMemberQuery.value = ''; createMemberResults.value = []; createMemberIDs.value = []; createMemberBusy.value = false }
    function onCreateAvatarChange(event: Event) {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      input.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        if (!result) return
        createDialog.value = { ...createDialog.value, avatarDataUrl: result }
      }
      reader.readAsDataURL(file)
    }
    function addCreateMember(user: SearchUserResult) { if (!user.id || createMemberIDs.value.includes(user.id) || user.id === props.currentUserId) return; createMemberIDs.value = [...createMemberIDs.value, user.id]; if (!createMemberResults.value.some((item) => item.id === user.id)) createMemberResults.value = [...createMemberResults.value, user]; createMemberQuery.value = '' }
    function removeCreateMember(userID: string) { createMemberIDs.value = createMemberIDs.value.filter((id) => id !== userID) }
    function openTopicCreate() { if (!props.canCreateChannel) return; topicCreateOpen.value = true; topicCreateTitle.value = ''; topicCreateType.value = 'text'; topicCreateError.value = '' }
    function closeTopicCreate() { topicCreateOpen.value = false; topicCreateTitle.value = ''; topicCreateType.value = 'text'; topicCreateError.value = '' }
    function submitTopicCreate() { const title = topicCreateTitle.value.trim(); if (!title) { topicCreateError.value = t('chat.topic_name_required'); return } emit('createGroupChannel', { title, channel_type: topicCreateType.value }); closeTopicCreate() }

    function onChatContextArchive(chat: ChatItem) { void chatListActions?.toggleArchived(chat) }
    function onChatContextPin(chat: ChatItem) { void chatListActions?.togglePinned(chat, chatScopeFromTab(props.selectedFilterTab)) }
    function onChatReorder(payload: { scope: string; items: { chat_id: string; order: number }[] }) { void chatListActions?.reorderPinned(payload.scope, payload.items) }
    function onChatContextRead(chat: ChatItem) { void chatListActions?.markRead(chat) }
    function onChatContextClear(chat: ChatItem) { clearConfirm.value = { open: true, chat, busy: false, error: '' } }
    function closeClearConfirm() { clearConfirm.value = { open: false, chat: null, busy: false, error: '' } }
    async function confirmClearHistory() {
      const chat = clearConfirm.value.chat
      if (!chat || !chatListActions) { closeClearConfirm(); return }
      clearConfirm.value = { ...clearConfirm.value, busy: true, error: '' }
      const ok = await chatListActions.clearHistory(chat)
      if (ok) { closeClearConfirm(); return }
      clearConfirm.value = { ...clearConfirm.value, busy: false }
    }

    watch(() => props.selectedFilterTab, () => { archiveOpen.value = false })
    watch(() => props.chats.some((chat) => Boolean(chat.archived)), (anyArchived) => { if (!anyArchived) archiveOpen.value = false })

    async function submitCreateDialog() {
      const title = createDialog.value.title.trim()
      if (!title) { createDialog.value = { ...createDialog.value, error: t('chat.title_required') }; return }
      if (createDialog.value.kind === 'channel' && createDialog.value.isPublic && !createDialog.value.slug.trim()) { createDialog.value = { ...createDialog.value, error: t('chat.public_link_required') }; return }
      createDialog.value = { ...createDialog.value, saving: true, error: '' }
      const payload = { title, memberIDs: createDialog.value.kind === 'group' ? createMemberIDs.value.slice() : [], onSuccess: () => closeCreateDialog(), onError: (message: string) => { createDialog.value = { ...createDialog.value, saving: false, error: message || t('chat.request_failed') } } }
      if (createDialog.value.kind === 'group') emit('createGroup', payload)
      else emit('createChannel', { ...payload, publicSlug: createDialog.value.slug.trim(), isPublic: createDialog.value.isPublic, avatarDataUrl: createDialog.value.avatarDataUrl })
    }

    let createMemberTimer: number | null = null
    watch(createMemberQuery, (query) => {
      if (createMemberTimer) window.clearTimeout(createMemberTimer)
      if (!createDialog.value.open || createDialog.value.kind !== 'group') { createMemberResults.value = selectedCreateMembers.value.slice(); return }
      const clean = query.trim()
      if (clean.length < 2) { createMemberResults.value = selectedCreateMembers.value.slice(); return }
      createMemberTimer = window.setTimeout(async () => {
        createMemberBusy.value = true
        try {
          const found = await searchDirectory({ q: clean, scope: 'all', limit: 20 })
          const merged = [...selectedCreateMembers.value]
          for (const user of found.users || []) if (!merged.some((item) => item.id === user.id) && user.id !== props.currentUserId) merged.push(user)
          createMemberResults.value = merged
        } catch {
          createMemberResults.value = selectedCreateMembers.value.slice()
        } finally { createMemberBusy.value = false }
      }, 220)
    })

    watch(() => props.sidebarPanel, (panel, previous) => {
      if (panel === 'settings') {
        // Legacy entry: the workspace switched to its 'settings' panel
        // (ChatWorkspace.vue cannot be touched). The sidebar no longer owns a
        // settings pane — bounce to the canonical /settings and hand the
        // panel back to the chat list so no dead state lingers.
        createMenuOpen.value = false
        try {
          void router.push('/settings')
        } catch {
          // Router unavailable (tests): stay on the chat list.
        }
        emit('closeSettings')
        return
      }
      // Back to the chat list: pick up folders created/edited in settings.
      if (previous === 'settings') void loadFolders()
    }, { immediate: true })

    return { t, avatarColorFor, normalizeAvatarSrc, emit, createMenuOpen, createDialog, createMemberQuery, createMemberResults, createMemberIDs, createMemberBusy, topicCreateOpen, topicCreateTitle, topicCreateType, topicCreateError, showDirectory, filteredDirectoryUsers, visibleCreateMemberResults, selectedCreateMembers, lastAttachmentPreviewById, onOpenSettings, onCreateGroup, onCreateChannel, closeCreateDialog, submitCreateDialog, addCreateMember, removeCreateMember, onCreateAvatarChange, openTopicCreate, closeTopicCreate, submitTopicCreate, archiveOpen, clearConfirm, onChatContextArchive, onChatContextPin, onChatReorder, onChatContextRead, onChatContextClear, closeClearConfirm, confirmClearHistory, folders, activeFolderId, paneChats, barChats, selectFolder, folderDialogOpen, openFolderCreate, closeFolderCreate, onFolderDialogSaved, onChatFolderToggle }
  },
})
</script>

<template>
  <aside class="sbRoot">
    <div class="sbStage" :class="{ topics: showGroupChannelsPanel }">

      <!-- Shelf: always rendered, always at left edge, no animation -->
      <div v-show="showGroupChannelsPanel" class="sbShelf">
        <ChatSidebarChatsPane
          :search="search"
          :selected-filter-tab="selectedFilterTab"
          :unread-all="unreadAll"
          :unread-direct="unreadDirect"
          :unread-group="unreadGroup"
          :unread-channel="unreadChannel"
          :unread-by-chat-id="unreadByChatId"
          :typing-by-chat-id="typingByChatId"
          :loading="loading"
          :show-directory="false"
          :searching-directory="false"
          :directory-query="''"
          :filtered-directory-users="[]"
          :directory-results="directoryResults"
          :chats="paneChats"
          :selected-chat-i-d="selectedChatID"
          :compact="true"
          :create-menu-open="false"
          :can-create-channel="canCreateChannel"
          :last-attachment-preview-by-id="lastAttachmentPreviewById"
          :muted-chat-i-ds="mutedChatIDs"
          :archive-open="archiveOpen"
          :folders="folders"
          :active-folder-id="activeFolderId"
          :bar-chats="barChats"
          @update:search="emit('update:search', $event)"
          @select-tab="emit('update:selectedFilterTab', $event)"
          @select-folder="selectFolder"
          @create-folder="openFolderCreate"
          @chat-folder-toggle="onChatFolderToggle"
          @toggle-create-menu="createMenuOpen = !createMenuOpen"
          @close-create-menu="createMenuOpen = false"
          @open-settings="onOpenSettings"
          @create-group="onCreateGroup"
          @create-channel="onCreateChannel"
          @select-chat="emit('select', $event)"
          @select-directory-chat="emit('selectDirectoryChat', $event)"
          @select-directory-user="emit('selectDirectoryUser', $event)"
          @chat-context-mute="emit('chatContextMute', $event)"
          @chat-context-leave="emit('chatContextLeave', $event)"
          @chat-context-delete="emit('chatContextDelete', $event)"
          @chat-context-archive="onChatContextArchive"
          @chat-context-pin="onChatContextPin"
          @chat-context-read="onChatContextRead"
          @chat-context-clear="onChatContextClear"
          @open-archive="archiveOpen = true"
          @close-archive="archiveOpen = false"
          @collapse-group="emit('closeGroupChannels')"
        />
      </div>

      <!-- Full chat list: slides out to the right when topics open -->
      <div class="sbChats">
        <ChatSidebarChatsPane
          :search="search"
          :selected-filter-tab="selectedFilterTab"
          :unread-all="unreadAll"
          :unread-direct="unreadDirect"
          :unread-group="unreadGroup"
          :unread-channel="unreadChannel"
          :unread-by-chat-id="unreadByChatId"
          :typing-by-chat-id="typingByChatId"
          :loading="loading"
          :show-directory="showDirectory"
          :searching-directory="searchingDirectory"
          :directory-query="directoryQuery"
          :filtered-directory-users="filteredDirectoryUsers"
          :directory-results="directoryResults"
          :chats="paneChats"
          :selected-chat-i-d="selectedChatID"
          :compact="false"
          :create-menu-open="createMenuOpen"
          :can-create-channel="canCreateChannel"
          :last-attachment-preview-by-id="lastAttachmentPreviewById"
          :muted-chat-i-ds="mutedChatIDs"
          :archive-open="archiveOpen"
          :folders="folders"
          :active-folder-id="activeFolderId"
          :bar-chats="barChats"
          @update:search="emit('update:search', $event)"
          @select-tab="emit('update:selectedFilterTab', $event)"
          @select-folder="selectFolder"
          @create-folder="openFolderCreate"
          @chat-folder-toggle="onChatFolderToggle"
          @toggle-create-menu="createMenuOpen = !createMenuOpen"
          @close-create-menu="createMenuOpen = false"
          @open-settings="onOpenSettings"
          @create-group="onCreateGroup"
          @create-channel="onCreateChannel"
          @select-chat="emit('select', $event)"
          @select-directory-chat="emit('selectDirectoryChat', $event)"
          @select-directory-user="emit('selectDirectoryUser', $event)"
          @chat-context-mute="emit('chatContextMute', $event)"
          @chat-context-leave="emit('chatContextLeave', $event)"
          @chat-context-delete="emit('chatContextDelete', $event)"
          @chat-context-archive="onChatContextArchive"
          @chat-context-pin="onChatContextPin"
          @chat-context-read="onChatContextRead"
          @chat-context-clear="onChatContextClear"
          @chat-reorder="onChatReorder"
          @open-archive="archiveOpen = true"
          @close-archive="archiveOpen = false"
        />
      </div>

      <!-- Topics panel: slides in from right -->
      <div class="sbTopicsSlider">
        <div class="sbTopicsFloating">
          <ChatSidebarTopicsPane
            :chats="chats"
            :selected-chat-i-d="selectedChatID"
            :search="search"
            :unread-by-chat-id="unreadByChatId"
            :muted-chat-i-ds="mutedChatIDs"
            :group-title="groupTitle"
            :group-member-count="groupMemberCount"
            :group-channels="groupChannels"
            :selected-group-channel-i-d="selectedGroupChannelID"
            :loading-group-channels="loadingGroupChannels"
            :can-create-channel="canCreateChannel"
            :topic-create-open="topicCreateOpen"
            :topic-create-title="topicCreateTitle"
            :topic-create-type="topicCreateType"
            :topic-create-error="topicCreateError"
            @close="emit('closeGroupChannels')"
            @update:search="emit('update:search', $event)"
            @open-settings="onOpenSettings"
            @select-chat="emit('select', $event)"
            @select-channel="emit('selectGroupChannel', $event)"
            @open-group-menu="emit('openGroupMenu', $event)"
            @chat-context-pin="onChatContextPin"
            @chat-context-mute="emit('chatContextMute', $event)"
            @chat-context-read="onChatContextRead"
            @chat-context-clear="onChatContextClear"
            @chat-context-leave="emit('chatContextLeave', $event)"
            @chat-context-delete="emit('chatContextDelete', $event)"
            @open-channel-settings="emit('openChannelSettings', $event)"
            @open-topic-create="openTopicCreate"
            @close-topic-create="closeTopicCreate"
            @submit-topic-create="submitTopicCreate"
            @update:topic-title="topicCreateTitle = $event"
            @update:topic-type="topicCreateType = $event"
          />
        </div>
      </div>
    </div>

    <div v-if="createDialog.open" class="sbDialogOverlay" @click.self="closeCreateDialog">
      <div class="sbDialog">
        <div class="sbDialogTitle">{{ createDialog.kind === 'group' ? t('chat.create_group') : t('chat.create_channel') }}</div>
        <div class="sbDialogText">{{ createDialog.kind === 'group' ? t('chat.enter_group_title') : t('chat.enter_channel_title') }}</div>
        <template v-if="createDialog.kind === 'channel'">
          <label class="sbAvatarPicker">
            <input type="file" accept="image/*" class="avatarFileInput" @change="onCreateAvatarChange" />
            <img v-if="createDialog.avatarDataUrl" :src="createDialog.avatarDataUrl" alt="" class="sbAvatarPickerImg" />
            <div v-else class="sbAvatarPickerFallback" :style="{ background: avatarColorFor(createDialog.title || 'C') }">{{ (createDialog.title || 'C').slice(0, 1).toUpperCase() }}</div>
          </label>
        </template>
        <input v-model="createDialog.title" class="sbFieldInput sbDialogInput" :placeholder="createDialog.kind === 'group' ? t('chat.group_title') : t('chat.channel_title')" :disabled="createDialog.saving" @keydown.enter="submitCreateDialog" />
        <template v-if="createDialog.kind === 'channel'">
          <div class="sbTypeSwitch">
            <button type="button" class="sbTypeBtn" :class="{ active: createDialog.isPublic }" @click="createDialog = { ...createDialog, isPublic: true }">{{ t('chat.public') }}</button>
            <button type="button" class="sbTypeBtn" :class="{ active: !createDialog.isPublic }" @click="createDialog = { ...createDialog, isPublic: false }">{{ t('chat.private') }}</button>
          </div>
          <input v-if="createDialog.isPublic" v-model="createDialog.slug" class="sbFieldInput sbDialogInput" :placeholder="t('chat.public_link')" :disabled="createDialog.saving" @keydown.enter="submitCreateDialog" />
        </template>
        <template v-if="createDialog.kind === 'group'">
          <input v-model="createMemberQuery" class="sbFieldInput sbDialogInput" :placeholder="t('chat.add_participants')" :disabled="createDialog.saving" />
          <div v-if="selectedCreateMembers.length > 0" class="sbMemberChips">
            <span v-for="user in selectedCreateMembers" :key="user.id" class="sbMemberChip">
              <img
                v-if="normalizeAvatarSrc(user.avatar_data_url || '')"
                class="sbMemberChipAvatar"
                :src="normalizeAvatarSrc(user.avatar_data_url || '')"
                :alt="user.username"
              />
              <span v-else class="sbMemberChipAvatar sbMemberChipAvatarFallback" :style="{ background: avatarColorFor(user.id) }">{{ (user.first_name || user.username || '?').slice(0, 1).toUpperCase() }}</span>
              <span class="sbMemberChipName">{{ `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username }}</span>
              <button
                type="button"
                class="sbMemberChipRemove"
                :disabled="createDialog.saving"
                :aria-label="t('chat.remove', undefined, 'Remove')"
                @click="removeCreateMember(user.id)"
              >×</button>
            </span>
          </div>
          <div v-if="visibleCreateMemberResults.length > 0" class="sbDialogUsers">
            <button v-for="user in visibleCreateMemberResults" :key="user.id" type="button" class="sbDialogUser" @click="addCreateMember(user)">
              <div class="sbDialogUserName">{{ `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username }}</div>
              <div class="sbDialogUserMeta">@{{ user.username }}</div>
            </button>
          </div>
        </template>
        <div v-if="createDialog.error" class="sbDialogError">{{ createDialog.error }}</div>
        <div class="sbDialogActions">
          <button type="button" class="sbDialogBtn muted" :disabled="createDialog.saving" @click="closeCreateDialog">{{ t('common.cancel') }}</button>
          <button type="button" class="sbDialogBtn" :disabled="createDialog.saving" @click="submitCreateDialog">{{ createDialog.saving ? t('chat.creating') : t('chat.create') }}</button>
        </div>
      </div>
    </div>

    <div v-if="clearConfirm.open" class="sbDialogOverlay" @click.self="closeClearConfirm">
      <div class="sbDialog" role="dialog" aria-modal="true" :aria-label="t('chat.clear_history', undefined, 'Clear history')">
        <div class="sbDialogTitle">{{ t('chat.clear_history', undefined, 'Clear history') }}</div>
        <div class="sbDialogText">{{ t('chat.clear_history_confirm', undefined, 'History will be cleared for you only.') }}</div>
        <div v-if="clearConfirm.chat" class="sbDialogText">{{ clearConfirm.chat.title }}</div>
        <div v-if="clearConfirm.error" class="sbDialogError">{{ clearConfirm.error }}</div>
        <div class="sbDialogActions">
          <button type="button" class="sbDialogBtn muted" :disabled="clearConfirm.busy" @click="closeClearConfirm">{{ t('common.cancel') }}</button>
          <button type="button" class="sbDialogBtn danger" :disabled="clearConfirm.busy" @click="confirmClearHistory">{{ clearConfirm.busy ? t('common.loading') : t('chat.clear_history', undefined, 'Clear history') }}</button>
        </div>
      </div>
    </div>

    <FolderCreateDialog :open="folderDialogOpen" :folder="null" @close="closeFolderCreate" @saved="onFolderDialogSaved" />
  </aside>
</template>

<style scoped>
.sbRoot {
  border-right: 1px solid var(--border);
  overflow: hidden;
  height: 100%;
  min-height: 0;
  background: var(--bg-elevated);
  position: relative;
}

/* Stage */
.sbStage {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  --shelf-w: 72px;
  --dur: 260ms;
  --ease: cubic-bezier(.25, .46, .45, .94);
  background: var(--bg-elevated);
}

/* Shelf: always at left, always visible, no animation at all */
.sbShelf {
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: var(--shelf-w);
  z-index: 1;
  overflow: hidden;
  background: var(--bg-elevated);
}

/* Full chat list: full size, just fades out instantly when topics open */
.sbChats {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  background: var(--surface);
  opacity: 1;
  visibility: visible;
  transition: opacity 140ms ease, visibility 0s linear 140ms;
}

/* Keep the list mounted so opening topics does not reflow the whole stage. */
.sbStage.topics .sbChats {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 100ms ease, visibility 0s linear 0s;
}

/* Topics panel: slide in via transform to avoid layout thrash. */
.sbTopicsSlider {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: var(--shelf-w);
  z-index: 3;
  overflow: hidden;
  transform: translateX(100%);
  opacity: 0;
  pointer-events: none;
  transition: transform var(--dur) var(--ease), opacity 140ms ease;
  will-change: transform, opacity;
}

.sbStage.topics .sbTopicsSlider {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

/* Inner floating: fills its container */
.sbTopicsFloating {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--bg-elevated);
  border-left: 1px solid var(--border);
}

@media (max-width: 960px) {
  .sbStage { --shelf-w: 64px; }
}

/* Dialogs */
.sbDialogOverlay { position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.18); display:grid; place-items:start center; padding:84px 12px 12px; animation: sbOverlayIn 140ms ease-out; }
.sbDialog { width:min(100%,340px); background:var(--surface); border:1px solid var(--border); border-radius:10px; box-shadow:0 18px 48px rgba(0,0,0,.22); padding:14px; display:grid; gap:10px; animation: sbPopIn 160ms cubic-bezier(0.2, 0.7, 0.3, 1); }
@keyframes sbOverlayIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes sbPopIn { from { opacity: 0; transform: translateY(-8px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) { .sbDialogOverlay, .sbDialog { animation: none; } }
.sbDialogTitle { font-size:16px; font-weight:800; color:var(--text); }
.sbDialogText { font-size:13px; color:var(--text-muted); }
.sbFieldInput { height:36px; border:1px solid var(--border); border-radius:8px; padding:0 10px; font-size:14px; background:var(--surface-soft); color:var(--text); outline:none; }
.sbFieldInput:focus { border-color: rgba(74, 144, 217, 0.38); box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.12); }
.sbDialogInput { width:100%; }
.sbDialogUsers { max-height:180px; overflow-y:auto; display:grid; gap:6px; }
.sbDialogUser { width:100%; padding:8px; border:1px solid var(--border); border-radius:10px; background:var(--surface-soft); text-align:left; cursor:pointer; }
.sbDialogUserName { font-size:13px; font-weight:800; color:var(--text); }
.sbDialogUserMeta { font-size:12px; color:var(--text-muted); }
.sbMemberChips { display:flex; flex-wrap:wrap; gap:6px; }
.sbMemberChip { display:inline-flex; align-items:center; gap:6px; max-width:100%; padding:3px 4px 3px 3px; border:1px solid var(--border); border-radius:999px; background:var(--surface-soft); }
.sbMemberChipAvatar { width:22px; height:22px; flex-shrink:0; border-radius:50%; object-fit:cover; display:block; }
.sbMemberChipAvatarFallback { display:grid; place-items:center; background:var(--avatar-fallback); color:#fff; font-size:11px; font-weight:800; }
.sbMemberChipName { max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:700; color:var(--text); }
.sbMemberChipRemove { width:18px; height:18px; flex-shrink:0; padding:0; border:0; border-radius:50%; background:transparent; color:var(--text-soft); font-size:15px; line-height:1; cursor:pointer; display:grid; place-items:center; }
.sbMemberChipRemove:hover { background:var(--border); color:var(--text); }
.sbAvatarPicker { width:88px; height:88px; margin:0 auto 2px; padding:0; border:0; border-radius:50%; overflow:hidden; background:transparent; appearance:none; -webkit-appearance:none; display:grid; place-items:center; cursor:pointer; position:relative; }
.sbAvatarPicker input.avatarFileInput { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; z-index:3; }
.sbAvatarPickerImg { width:100%; height:100%; object-fit:cover; display:block; }
.sbAvatarPickerFallback { width:100%; height:100%; border-radius:50%; display:grid; place-items:center; background:var(--avatar-fallback); color:#fff; font-size:32px; font-weight:800; }
.sbDialogError { font-size:12px; color:#ef4444; }
.sbDialogActions { display:flex; justify-content:flex-end; gap:8px; }
.sbDialogBtn { min-width:86px; height:34px; border:0; border-radius:10px; background:var(--accent); color:#fff; font-size:13px; font-weight:800; cursor:pointer; }
.sbDialogBtn.muted { background:var(--surface-soft); color:var(--text-soft); border:1px solid var(--border); }
.sbDialogBtn.danger { background:#ef4444; color:#fff; }
.sbTypeSwitch { display:flex; gap:8px; }
.sbTypeBtn { flex:1 1 0; height:34px; border:1px solid var(--border); border-radius:999px; background:var(--surface-soft); color:var(--text-soft); font-size:13px; font-weight:800; cursor:pointer; }
.sbTypeBtn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
</style>
