<script lang="ts">
import {
  changePassword,
  confirmEmailChange,
  forceRefreshSession,
  getAttachment,
  getProfile,
  searchDirectory,
  type AuthUser,
  type ChatItem,
  type SearchResults,
  type SearchUserResult,
  sendNewEmailCode,
  startEmailChange,
  updateProfile,
  updateSessionIdleTTL,
  verifyOldEmailCode,
} from 'combox-api'
import { computed, defineComponent, ref, watch, type PropType } from 'vue'
import { useI18n } from '../../i18n/i18n'
import ChatSidebarChatsPane from './ChatSidebarChatsPane.vue'
import ChatSidebarSettingsPane from './ChatSidebarSettingsPane.vue'
import ChatSidebarTopicsPane from './ChatSidebarTopicsPane.vue'
import type { AttachmentThumb, GroupChannelItem } from './chatSidebar.types'

export default defineComponent({
  name: 'ChatSidebar',
  components: { ChatSidebarChatsPane, ChatSidebarSettingsPane, ChatSidebarTopicsPane },
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
    unreadByChatId: { type: Object as PropType<Record<string, number>>, default: () => ({}) },
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
  ],
  setup(props, { emit }) {
    const { t } = useI18n()
    const lastAttachmentPreviewById = ref<Record<string, AttachmentThumb>>({})
    const requestedAttachmentIDs = new Set<string>()
    const createMenuOpen = ref(false)
    const settingsLoading = ref(false)
    const settingsSaving = ref(false)
    const settingsError = ref('')
    const settingsSuccess = ref('')
    const createDialog = ref<{ open: boolean; kind: 'group' | 'channel'; title: string; slug: string; isPublic: boolean; avatarDataUrl: string | null; saving: boolean; error: string }>({ open: false, kind: 'group', title: '', slug: '', isPublic: true, avatarDataUrl: null, saving: false, error: '' })
    const createMemberQuery = ref('')
    const createMemberResults = ref<SearchUserResult[]>([])
    const createMemberIDs = ref<string[]>([])
    const createMemberBusy = ref(false)
    const profileDraft = ref({ first_name: '', last_name: '', username: '', birth_date: '' })
    const sessionIdleDays = ref(30)
    const passwordDraft = ref({ current: '', next: '' })
    const passwordSaving = ref(false)
    const emailDraft = ref({ email: '', oldCode: '', newCode: '' })
    const emailStep = ref<'old' | 'new' | 'confirm'>('old')
    const emailBusy = ref(false)
    const topicCreateOpen = ref(false)
    const topicCreateTitle = ref('')
    const topicCreateType = ref<'text' | 'voice'>('text')
    const topicCreateError = ref('')

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
        }).catch(() => {})
      }
    }, { immediate: true })

    function onOpenSettings() { createMenuOpen.value = false; void loadSettings(); emit('openSettings') }
    function onCloseSettings() { emit('closeSettings') }
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
    function pickCreateAvatar() {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : ''
          if (!result) return
          createDialog.value = { ...createDialog.value, avatarDataUrl: result }
        }
        reader.readAsDataURL(file)
      }
      input.click()
    }
    function addCreateMember(user: SearchUserResult) { if (!user.id || createMemberIDs.value.includes(user.id) || user.id === props.currentUserId) return; createMemberIDs.value = [...createMemberIDs.value, user.id]; if (!createMemberResults.value.some((item) => item.id === user.id)) createMemberResults.value = [...createMemberResults.value, user]; createMemberQuery.value = '' }
    function removeCreateMember(userID: string) { createMemberIDs.value = createMemberIDs.value.filter((id) => id !== userID) }
    function openTopicCreate() { if (!props.canCreateChannel) return; topicCreateOpen.value = true; topicCreateTitle.value = ''; topicCreateType.value = 'text'; topicCreateError.value = '' }
    function closeTopicCreate() { topicCreateOpen.value = false; topicCreateTitle.value = ''; topicCreateType.value = 'text'; topicCreateError.value = '' }
    function submitTopicCreate() { const title = topicCreateTitle.value.trim(); if (!title) { topicCreateError.value = t('chat.topic_name_required'); return } emit('createGroupChannel', { title, channel_type: topicCreateType.value }); closeTopicCreate() }

    async function submitCreateDialog() {
      const title = createDialog.value.title.trim()
      if (!title) { createDialog.value = { ...createDialog.value, error: t('chat.title_required') }; return }
      if (createDialog.value.kind === 'group' && createMemberIDs.value.length === 0) { createDialog.value = { ...createDialog.value, error: t('chat.add_participant_required') }; return }
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

    async function loadSettings() {
      settingsLoading.value = true; settingsError.value = ''; settingsSuccess.value = ''
      try {
        const profile = (await getProfile()) as AuthUser
        profileDraft.value = {
          first_name: (profile.first_name || '').trim(),
          last_name: (profile.last_name || '').trim(),
          username: (profile.username || '').trim(),
          birth_date: (profile.birth_date || '').trim(),
        }
        const ttlSec = Number(profile.session_idle_ttl_seconds || 0)
        if (ttlSec > 0) sessionIdleDays.value = Math.max(1, Math.round(ttlSec / 86400))
      } catch (error) {
        settingsError.value = error instanceof Error ? error.message : t('settings.load_failed')
      } finally { settingsLoading.value = false }
    }
    async function saveProfileSettings() {
      settingsSaving.value = true; settingsError.value = ''; settingsSuccess.value = ''
      try {
        await updateProfile({
          first_name: profileDraft.value.first_name.trim(),
          last_name: profileDraft.value.last_name.trim() || undefined,
          username: profileDraft.value.username.trim(),
          birth_date: profileDraft.value.birth_date.trim() || undefined,
        })
        await updateSessionIdleTTL(Math.max(1, Math.round(sessionIdleDays.value)) * 86400)
        await forceRefreshSession(); await loadSettings(); settingsSuccess.value = t('settings.profile_saved')
      } catch (error) { settingsError.value = error instanceof Error ? error.message : t('settings.profile_update_failed') } finally { settingsSaving.value = false }
    }
    async function savePassword() {
      passwordSaving.value = true; settingsError.value = ''; settingsSuccess.value = ''
      try { await changePassword(passwordDraft.value.current, passwordDraft.value.next); passwordDraft.value = { current: '', next: '' }; settingsSuccess.value = t('settings.password_changed') }
      catch (error) { settingsError.value = error instanceof Error ? error.message : t('settings.verify_code_failed') }
      finally { passwordSaving.value = false }
    }
    async function startEmailFlow() { emailBusy.value = true; settingsError.value=''; settingsSuccess.value=''; try { await startEmailChange(); emailStep.value='old'; settingsSuccess.value=t('settings.code_sent_current') } catch (error) { settingsError.value = error instanceof Error ? error.message : t('settings.start_email_change_failed') } finally { emailBusy.value = false } }
    async function verifyOldCode() { emailBusy.value = true; settingsError.value=''; settingsSuccess.value=''; try { const ok = await verifyOldEmailCode(emailDraft.value.oldCode.trim()); if (!ok) throw new Error(t('settings.invalid_old_email_code')); emailStep.value='new'; settingsSuccess.value=t('settings.old_email_verified') } catch (error) { settingsError.value = error instanceof Error ? error.message : t('settings.verify_old_email_code_failed') } finally { emailBusy.value = false } }
    async function sendNewEmailCodeStep() { emailBusy.value = true; settingsError.value=''; settingsSuccess.value=''; try { await sendNewEmailCode(emailDraft.value.email.trim()); emailStep.value='confirm'; settingsSuccess.value=t('settings.code_sent_new') } catch (error) { settingsError.value = error instanceof Error ? error.message : t('settings.send_new_email_code_failed') } finally { emailBusy.value = false } }
    async function confirmNewEmailStep() { emailBusy.value = true; settingsError.value=''; settingsSuccess.value=''; try { await confirmEmailChange(emailDraft.value.newCode.trim()); emailDraft.value = { email:'', oldCode:'', newCode:'' }; emailStep.value='old'; settingsSuccess.value=t('settings.email_changed') } catch (error) { settingsError.value = error instanceof Error ? error.message : t('settings.confirm_new_email_failed') } finally { emailBusy.value = false } }

    watch(() => props.sidebarPanel, (panel) => { if (panel === 'settings') void loadSettings() }, { immediate: true })

    return { t, emit, createMenuOpen, settingsLoading, settingsSaving, settingsError, settingsSuccess, createDialog, createMemberQuery, createMemberResults, createMemberIDs, createMemberBusy, profileDraft, sessionIdleDays, passwordDraft, passwordSaving, emailDraft, emailStep, emailBusy, topicCreateOpen, topicCreateTitle, topicCreateType, topicCreateError, showDirectory, filteredDirectoryUsers, visibleCreateMemberResults, lastAttachmentPreviewById, onOpenSettings, onCloseSettings, onCreateGroup, onCreateChannel, closeCreateDialog, submitCreateDialog, addCreateMember, removeCreateMember, pickCreateAvatar, saveProfileSettings, savePassword, startEmailFlow, verifyOldCode, sendNewEmailCodeStep, confirmNewEmailStep, openTopicCreate, closeTopicCreate, submitTopicCreate }
  },
})
</script>

<template>
  <aside class="sbRoot">
    <ChatSidebarSettingsPane
      v-if="sidebarPanel === 'settings'"
      :current-user-avatar-src="currentUserAvatarSrc"
      :current-user-display-name="currentUserDisplayName"
      :current-username="currentUsername"
      :current-birth-date="profileDraft.birth_date"
      :settings-loading="settingsLoading"
      :settings-saving="settingsSaving"
      :settings-error="settingsError"
      :settings-success="settingsSuccess"
      :profile-draft="profileDraft"
      :session-idle-days="sessionIdleDays"
      :password-draft="passwordDraft"
      :password-saving="passwordSaving"
      :email-draft="emailDraft"
      :email-step="emailStep"
      :email-busy="emailBusy"
      @close="onCloseSettings"
      @update:session-days="sessionIdleDays = $event"
      @save-profile="saveProfileSettings"
      @save-password="savePassword"
      @start-email-flow="startEmailFlow"
      @verify-old-code="verifyOldCode"
      @send-new-email-code="sendNewEmailCodeStep"
      @confirm-new-email="confirmNewEmailStep"
    />

    <div v-else class="sbStage" :class="{ topics: showGroupChannelsPanel }">

      <!-- Shelf: always rendered, always at left edge, no animation -->
      <div v-show="showGroupChannelsPanel" class="sbShelf">
        <ChatSidebarChatsPane
          :search="search"
          :selected-filter-tab="selectedFilterTab"
          :unread-all="unreadAll"
          :unread-direct="unreadDirect"
          :unread-group="unreadGroup"
          :unread-by-chat-id="unreadByChatId"
          :loading="loading"
          :show-directory="false"
          :searching-directory="false"
          :directory-query="''"
          :filtered-directory-users="[]"
          :directory-results="directoryResults"
          :chats="chats"
          :selected-chat-i-d="selectedChatID"
          :compact="true"
          :create-menu-open="false"
          :can-create-channel="canCreateChannel"
          :last-attachment-preview-by-id="lastAttachmentPreviewById"
          :muted-chat-i-ds="mutedChatIDs"
          @update:search="emit('update:search', $event)"
          @select-tab="emit('update:selectedFilterTab', $event)"
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
          :unread-by-chat-id="unreadByChatId"
          :loading="loading"
          :show-directory="showDirectory"
          :searching-directory="searchingDirectory"
          :directory-query="directoryQuery"
          :filtered-directory-users="filteredDirectoryUsers"
          :directory-results="directoryResults"
          :chats="chats"
          :selected-chat-i-d="selectedChatID"
          :compact="false"
          :create-menu-open="createMenuOpen"
          :can-create-channel="canCreateChannel"
          :last-attachment-preview-by-id="lastAttachmentPreviewById"
          :muted-chat-i-ds="mutedChatIDs"
          @update:search="emit('update:search', $event)"
          @select-tab="emit('update:selectedFilterTab', $event)"
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
          <button type="button" class="sbAvatarPicker" @click="pickCreateAvatar">
            <img v-if="createDialog.avatarDataUrl" :src="createDialog.avatarDataUrl" alt="" class="sbAvatarPickerImg" />
            <div v-else class="sbAvatarPickerFallback">{{ (createDialog.title || 'C').slice(0, 1).toUpperCase() }}</div>
          </button>
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
.sbDialogOverlay { position:absolute; inset:0; z-index:20; background:rgba(0,0,0,.18); display:grid; place-items:start center; padding:84px 12px 12px; }
.sbDialog { width:min(100%,340px); background:var(--surface); border:1px solid var(--border); border-radius:10px; box-shadow:0 18px 48px rgba(0,0,0,.22); padding:14px; display:grid; gap:10px; }
.sbDialogTitle { font-size:16px; font-weight:800; color:var(--text); }
.sbDialogText { font-size:13px; color:var(--text-muted); }
.sbFieldInput { height:36px; border:1px solid var(--border); border-radius:8px; padding:0 10px; font-size:14px; background:var(--surface-soft); color:var(--text); outline:none; }
.sbFieldInput:focus { border-color: rgba(74, 144, 217, 0.38); box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.12); }
.sbDialogInput { width:100%; }
.sbDialogUsers { max-height:180px; overflow-y:auto; display:grid; gap:6px; }
.sbDialogUser { width:100%; padding:8px; border:1px solid var(--border); border-radius:10px; background:var(--surface-soft); text-align:left; cursor:pointer; }
.sbDialogUserName { font-size:13px; font-weight:800; color:var(--text); }
.sbDialogUserMeta { font-size:12px; color:var(--text-muted); }
.sbAvatarPicker { width:88px; height:88px; margin:0 auto 2px; padding:0; border:0; border-radius:50%; overflow:hidden; background:transparent; appearance:none; -webkit-appearance:none; display:grid; place-items:center; cursor:pointer; }
.sbAvatarPickerImg { width:100%; height:100%; object-fit:cover; display:block; }
.sbAvatarPickerFallback { width:100%; height:100%; border-radius:50%; display:grid; place-items:center; background:var(--avatar-fallback); color:#fff; font-size:32px; font-weight:800; }
.sbDialogError { font-size:12px; color:#ef4444; }
.sbDialogActions { display:flex; justify-content:flex-end; gap:8px; }
.sbDialogBtn { min-width:86px; height:34px; border:0; border-radius:10px; background:var(--accent); color:#fff; font-size:13px; font-weight:800; cursor:pointer; }
.sbDialogBtn.muted { background:var(--surface-soft); color:var(--text-soft); border:1px solid var(--border); }
.sbTypeSwitch { display:flex; gap:8px; }
.sbTypeBtn { flex:1 1 0; height:34px; border:1px solid var(--border); border-radius:999px; background:var(--surface-soft); color:var(--text-soft); font-size:13px; font-weight:800; cursor:pointer; }
.sbTypeBtn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
</style>
