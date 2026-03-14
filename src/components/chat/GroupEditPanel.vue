<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { searchDirectory, type AuthUser, type ChatInviteLink, type ChatItem, type ChatMemberProfile, type SearchUserResult } from 'combox-api'
import { normalizeAvatarSrc } from './chatUtils'
import { useI18n } from '../../i18n/i18n'

type PanelMode = 'main' | 'admins' | 'add_admin' | 'members' | 'removed' | 'links'

const props = defineProps<{
  selectedChat: ChatItem | null
  currentUser: AuthUser | null
  chatMembers: ChatMemberProfile[]
  removedChatMembers?: ChatMemberProfile[]
  inviteLinks?: ChatInviteLink[]
}>()

const emit = defineEmits<{
  close: []
  saveProfile: [payload: { title: string; avatarDataUrl?: string | null; onSuccess: () => void; onError: (message: string) => void }]
  addMembers: [memberIDs: string[]]
  updateMemberRole: [payload: { userID: string; role: 'member' | 'moderator' | 'admin' }]
  removeMember: [userID: string]
  leaveChat: [payload: { onSuccess: () => void; onError: (message: string) => void }]
  createInviteLink: [title?: string]
}>()

const { t } = useI18n()
const panelMode = ref<PanelMode>('main')

const addQuery = ref('')
const addBusy = ref(false)
const addResults = ref<SearchUserResult[]>([])
const adminSearchQuery = ref('')
const title = ref((props.selectedChat?.title || '').trim())
const avatarPreview = ref(normalizeAvatarSrc(props.selectedChat?.avatar_data_url || ''))
const avatarDataUrl = ref<string | null>(null)
const saveBusy = ref(false)
const saveError = ref('')

const inviteLinks = computed(() => props.inviteLinks || [])
const removedChatMembers = computed(() => props.removedChatMembers || [])

const currentRole = computed(() => {
  const currentUserID = (props.currentUser?.id || '').trim()
  if (!currentUserID) return ''
  const ownMember = props.chatMembers.find((item) => item.user_id === currentUserID)
  return (ownMember?.role || '').trim().toLowerCase()
})

const canManageRoles = computed(() => currentRole.value === 'owner' || currentRole.value === 'admin')
const admins = computed(() => normalizedMembers.value.filter((item) => ['owner', 'admin', 'moderator'].includes(item.role)))
const adminCount = computed(() => admins.value.length)

const normalizedMembers = computed(() =>
  props.chatMembers.map((member) => {
    const profile = member.profile
    const displayName = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() || profile?.username || member.user_id
    return {
      id: member.user_id,
      role: (member.role || 'member').trim().toLowerCase() || 'member',
      username: profile?.username || '',
      displayName,
      avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
      isCurrentUser: member.user_id === props.currentUser?.id,
    }
  }),
)

const removedUsers = computed(() =>
  removedChatMembers.value.map((member) => {
    const profile = member.profile
    const displayName = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() || profile?.username || member.user_id
    return {
      id: member.user_id,
      username: profile?.username || '',
      displayName,
      avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
    }
  }),
)

const visibleAddResults = computed(() => {
  const existing = new Set(props.chatMembers.map((item) => item.user_id))
  return addResults.value.filter((user) => !existing.has(user.id) && user.id !== props.currentUser?.id)
})

const hasUnsavedChanges = computed(() => {
  const originalTitle = (props.selectedChat?.title || '').trim()
  return title.value.trim() !== originalTitle || avatarDataUrl.value !== null
})

watch(
  () => props.selectedChat,
  (chat) => {
    title.value = (chat?.title || '').trim()
    avatarPreview.value = normalizeAvatarSrc(chat?.avatar_data_url || '')
    avatarDataUrl.value = null
    saveError.value = ''
    panelMode.value = 'main'
  },
  { immediate: true },
)

let searchTimer: number | null = null
watch(addQuery, (query) => {
  if (searchTimer) window.clearTimeout(searchTimer)
  const clean = query.trim()
  if (clean.length < 2) {
    addResults.value = []
    return
  }
  searchTimer = window.setTimeout(async () => {
    addBusy.value = true
    try {
      const found = await searchDirectory({ q: clean, scope: 'users', limit: 20 })
      addResults.value = Array.isArray(found.users) ? found.users : []
    } catch {
      addResults.value = []
    } finally {
      addBusy.value = false
    }
  }, 220)
})

function goBack() {
  if (panelMode.value === 'add_admin') {
    panelMode.value = 'admins'
    return
  }
  if (panelMode.value !== 'main') {
    panelMode.value = 'main'
    return
  }
  emit('close')
}

function addMember(user: SearchUserResult) {
  emit('addMembers', [user.id])
  addQuery.value = ''
  addResults.value = []
}

function setRole(userID: string, role: 'member' | 'moderator' | 'admin') {
  emit('updateMemberRole', { userID, role })
}

function removeMember(userID: string) {
  emit('removeMember', userID)
}

function restoreRemoved(userID: string) {
  emit('updateMemberRole', { userID, role: 'member' })
}

function pickAvatar() {
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
      avatarDataUrl.value = result
      avatarPreview.value = result
      saveError.value = ''
    }
    reader.onerror = () => {
      saveError.value = t('chat.failed_read_avatar')
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function saveProfile() {
  if (saveBusy.value) return
  const cleanTitle = title.value.trim()
  if (!cleanTitle) {
    saveError.value = t('chat.group_title_required')
    return
  }
  saveBusy.value = true
  saveError.value = ''
  emit('saveProfile', {
    title: cleanTitle,
    avatarDataUrl: avatarDataUrl.value,
    onSuccess: () => {
      saveBusy.value = false
      avatarDataUrl.value = null
    },
    onError: (message: string) => {
      saveBusy.value = false
      saveError.value = message
    },
  })
}

function leaveCurrentChat() {
  emit('leaveChat', {
    onSuccess: () => {
      saveError.value = ''
    },
    onError: (message: string) => {
      saveError.value = message
    },
  })
}

function createLink() {
  emit('createInviteLink')
}

const addAdminCandidates = computed(() => {
  const query = adminSearchQuery.value.trim().toLowerCase()
  const base = normalizedMembers.value.filter((member) => !member.isCurrentUser && member.role === 'member')
  if (!query) return base
  return base.filter((member) => {
    const name = member.displayName.toLowerCase()
    const username = member.username.toLowerCase()
    return name.includes(query) || username.includes(query)
  })
})

function openAddAdminPanel() {
  adminSearchQuery.value = ''
  panelMode.value = 'add_admin'
}

function promoteToAdmin(userID: string) {
  setRole(userID, 'admin')
  panelMode.value = 'admins'
}

function inviteLinkUrl(link: ChatInviteLink | null | undefined): string {
  const token = (link?.token || '').trim()
  if (!token || typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}#link:${encodeURIComponent(token)}`
}

function copyText(value: string) {
  if (!value) return
  void (async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
      }
    } catch (error) {
      void error
    }
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  })()
}
</script>

<template>
  <div class="gpRoot">
    <header class="gpHeader">
      <button type="button" class="gpIconBtn" :aria-label="t('chat.back')" @click="goBack">
        <v-icon icon="mdi-arrow-left" size="20" />
      </button>
      <div class="gpTitle">
        {{
          panelMode === 'main' ? t('settings.edit_profile', undefined, 'Edit')
          : panelMode === 'admins' ? t('chat.administrators', undefined, 'Administrators')
          : panelMode === 'add_admin' ? t('chat.add_admin', undefined, 'Add Admin')
          : panelMode === 'members' ? t('chat.members', undefined, 'Members')
          : panelMode === 'removed' ? t('chat.removed_users', undefined, 'Blocked users')
          : t('chat.invite_links', undefined, 'Invite links')
        }}
      </div>
    </header>

    <div class="gpScroll">
      <template v-if="panelMode === 'main'">
        <section class="gpHero">
          <button type="button" class="gpAvatarButton" @click="pickAvatar">
            <div class="gpAvatarWrap">
              <img v-if="avatarPreview" :src="avatarPreview" alt="" class="gpAvatar" />
              <div v-else class="gpAvatarFallback">{{ (selectedChat?.title || 'G').slice(0, 1).toUpperCase() }}</div>
            </div>
            <div class="gpAvatarOverlay">
              <v-icon icon="mdi-camera-plus-outline" size="30" />
            </div>
          </button>
        </section>

        <section class="gpSection">
          <label class="gpField">
            <span class="gpFieldLabel">{{ t('chat.group_title', undefined, 'Group name') }}</span>
            <input v-model="title" class="gpInput" :placeholder="t('chat.group_title')" />
          </label>
          <div v-if="saveError" class="gpError">{{ saveError }}</div>
          <button type="button" class="gpSaveBtn" :disabled="saveBusy || !hasUnsavedChanges" @click="saveProfile">
            {{ saveBusy ? t('chat.saving', undefined, 'Saving...') : t('chat.save', undefined, 'Save') }}
          </button>
        </section>

        <section class="gpSection gpRows">
          <button type="button" class="gpRow" @click="panelMode = 'admins'">
            <div class="gpRowIcon"><v-icon icon="mdi-shield-crown-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.administrators', undefined, 'Administrators') }}</div>
              <div class="gpRowMeta">{{ adminCount }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
          <button type="button" class="gpRow" @click="panelMode = 'links'">
            <div class="gpRowIcon"><v-icon icon="mdi-link-variant" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.invite_links', undefined, 'Invite links') }}</div>
              <div class="gpRowMeta">{{ inviteLinks.length || 1 }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
          <button type="button" class="gpRow" @click="panelMode = 'members'">
            <div class="gpRowIcon"><v-icon icon="mdi-account-group-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.members', undefined, 'Members') }}</div>
              <div class="gpRowMeta">{{ normalizedMembers.length }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
          <button type="button" class="gpRow" @click="panelMode = 'removed'">
            <div class="gpRowIcon"><v-icon icon="mdi-account-cancel-outline" size="20" /></div>
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ t('chat.removed_users', undefined, 'Removed users') }}</div>
              <div class="gpRowMeta">{{ removedUsers.length }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="gpChevron" />
          </button>
        </section>

        <section class="gpSection gpDangerSection">
          <button type="button" class="gpDangerMainBtn" @click="leaveCurrentChat">{{ t('chat.delete_group', undefined, 'Delete Group') }}</button>
        </section>
      </template>

      <template v-else-if="panelMode === 'links'">
        <section class="gpSection">
          <div class="gpFieldLabel">{{ t('chat.primary_link', undefined, 'Primary link') }}</div>
          <div class="gpInput gpInputReadOnly">{{ inviteLinks[0] ? inviteLinkUrl(inviteLinks[0]) : t('chat.no_invite_links', undefined, 'No links found') }}</div>
          <div class="gpInlineActions">
            <button type="button" class="gpSaveBtn" @click="copyText(inviteLinks[0] ? inviteLinkUrl(inviteLinks[0]) : '')">{{ t('chat.copy_link', undefined, 'Copy link') }}</button>
            <button type="button" class="gpSaveBtn" @click="createLink">{{ t('chat.create_new_link', undefined, 'Create a New Link') }}</button>
          </div>
        </section>
        <section v-if="inviteLinks.length > 1" class="gpSection gpRows">
          <article v-for="item in inviteLinks" :key="item.id" class="gpRow gpRowStatic">
            <div class="gpRowBody">
              <div class="gpRowTitle">{{ item.title || t('chat.invite_link', undefined, 'Invite link') }}</div>
              <div class="gpRowMeta">{{ inviteLinkUrl(item) }}</div>
            </div>
            <button type="button" class="gpCircleBtn" @click="copyText(inviteLinkUrl(item))"><v-icon icon="mdi-content-copy" size="16" /></button>
          </article>
        </section>
      </template>

      <template v-else-if="panelMode === 'admins'">
        <section class="gpSection">
          <div class="gpHintStrong">{{ t('chat.admin_help', undefined, 'You can add admins to help you manage your group.') }}</div>
          <button v-if="canManageRoles" type="button" class="gpSaveBtn" @click="openAddAdminPanel">
            {{ t('chat.add_admin', undefined, 'Add Admin') }}
          </button>
        </section>
        <section class="gpSection gpRows">
          <article v-for="member in admins" :key="member.id" class="gpMemberRow">
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
                <span>{{ member.role }}</span>
              </div>
            </div>
            <button v-if="canManageRoles && !member.isCurrentUser && member.role !== 'owner'" type="button" class="gpActionBtn" @click="setRole(member.id, 'member')">
              {{ t('chat.remove_admin', undefined, 'Remove admin') }}
            </button>
          </article>
        </section>
      </template>

      <template v-else-if="panelMode === 'add_admin'">
        <section class="gpSection">
          <div class="gpFieldLabel">{{ t('chat.search', undefined, 'Search') }}</div>
          <input v-model="adminSearchQuery" class="gpInput" :placeholder="t('chat.search', undefined, 'Search')" />
        </section>
        <section class="gpSection gpRows">
          <button
            v-for="member in addAdminCandidates"
            :key="member.id"
            type="button"
            class="gpSearchItem"
            @click="promoteToAdmin(member.id)"
          >
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
                <span>{{ member.role }}</span>
              </div>
            </div>
            <v-icon icon="mdi-account-plus-outline" size="18" class="gpChevron" />
          </button>
          <div v-if="addAdminCandidates.length === 0" class="gpHint">{{ t('chat.no_users_found', undefined, 'No users found') }}</div>
        </section>
      </template>

      <template v-else-if="panelMode === 'members'">
        <section class="gpSection">
          <div class="gpFieldLabel">{{ t('chat.add_participants', undefined, 'Add participants') }}</div>
          <input v-model="addQuery" class="gpInput" :placeholder="t('chat.search', undefined, 'Search')" />
          <div v-if="addBusy" class="gpHint">{{ t('chat.searching', undefined, 'Searching...') }}</div>
          <div v-else-if="visibleAddResults.length > 0" class="gpSearchList">
            <button v-for="user in visibleAddResults" :key="user.id" type="button" class="gpSearchItem" @click="addMember(user)">
              <div class="gpMiniAvatar">
                <img v-if="normalizeAvatarSrc(user.avatar_data_url || '')" :src="normalizeAvatarSrc(user.avatar_data_url || '')" alt="" class="gpMiniAvatarImg" />
                <span v-else>{{ (user.first_name || user.username || '?').slice(0, 1).toUpperCase() }}</span>
              </div>
              <div class="gpSearchText">
                <div class="gpMemberName">{{ `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username }}</div>
                <div class="gpMemberMeta">@{{ user.username }}</div>
              </div>
            </button>
          </div>
        </section>

        <section class="gpSection gpRows">
          <article v-for="member in normalizedMembers" :key="member.id" class="gpMemberRow">
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
                <span>{{ member.role }}</span>
              </div>
            </div>
            <div v-if="!member.isCurrentUser && member.role !== 'owner'" class="gpActions">
              <button type="button" class="gpDangerBtn" @click="removeMember(member.id)">{{ t('chat.remove', undefined, 'Remove') }}</button>
            </div>
          </article>
        </section>
      </template>

      <template v-else>
        <section class="gpSection gpRows">
          <article v-for="member in removedUsers" :key="member.id" class="gpMemberRow">
            <div class="gpMiniAvatar">
              <img v-if="member.avatarSrc" :src="member.avatarSrc" alt="" class="gpMiniAvatarImg" />
              <span v-else>{{ member.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="gpSearchText">
              <div class="gpMemberName">{{ member.displayName }}</div>
              <div class="gpMemberMeta">
                <span v-if="member.username">@{{ member.username }}</span>
              </div>
            </div>
            <button type="button" class="gpActionBtn" @click="restoreRemoved(member.id)">{{ t('chat.restore', undefined, 'Restore') }}</button>
          </article>
          <div v-if="removedUsers.length === 0" class="gpHint">{{ t('chat.no_removed_users', undefined, 'No removed users yet.') }}</div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.gpRoot {
  width: 390px;
  max-width: 100%;
  flex: 0 0 auto;
  min-height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--surface);
  color: var(--text);
  border-left: 1px solid var(--border);
}

.gpHeader {
  min-height: 62px;
  padding: 12px 14px 10px;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}

.gpIconBtn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.gpTitle {
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -.03em;
}

.gpScroll {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.gpHero {
  display: grid;
  justify-items: center;
  padding: 6px 0;
}

.gpAvatarButton {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  position: relative;
}

.gpAvatarWrap {
  width: 112px;
  height: 112px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-soft);
}

.gpAvatar,
.gpAvatarFallback {
  width: 100%;
  height: 100%;
}

.gpAvatar {
  object-fit: cover;
  display: block;
}

.gpAvatarFallback {
  background: var(--avatar-fallback);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 42px;
  font-weight: 800;
}

.gpAvatarOverlay {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, .24);
  color: #fff;
}

.gpSection {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
}

.gpField {
  display: grid;
  gap: 6px;
}

.gpFieldLabel {
  font-size: .8rem;
  font-weight: 700;
  color: var(--text-muted);
}

.gpInput {
  width: 100%;
  min-height: 42px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, .22);
  background: var(--surface-soft);
  padding: 0 14px;
  color: var(--text);
  font-size: .92rem;
  outline: 0;
}

.gpInputReadOnly {
  display: flex;
  align-items: center;
}

.gpError {
  font-size: .8rem;
  color: #ef4444;
}

.gpSaveBtn {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: #4a90d9;
  color: #fff;
  font-size: .82rem;
  font-weight: 700;
  cursor: pointer;
  justify-self: start;
}

.gpSaveBtn:disabled {
  opacity: .6;
  cursor: default;
}

.gpRows {
  gap: 0;
  padding-top: 2px;
  padding-bottom: 2px;
}

.gpRow {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  cursor: pointer;
}

.gpRow + .gpRow {
  border-top: 1px solid rgba(148, 163, 184, .12);
}

.gpRowStatic {
  cursor: default;
}

.gpRowIcon {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.gpRowBody {
  min-width: 0;
}

.gpRowTitle {
  font-size: .95rem;
  font-weight: 700;
  color: var(--text);
}

.gpRowMeta {
  font-size: .82rem;
  color: var(--text-muted);
}

.gpChevron {
  color: var(--text-muted);
}

.gpInlineActions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.gpCircleBtn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.gpSearchList {
  display: grid;
  gap: 8px;
}

.gpSearchItem,
.gpMemberRow {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, .15);
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-soft, #fff) 90%, transparent);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.gpSearchItem {
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.gpMiniAvatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-soft);
  display: grid;
  place-items: center;
}

.gpMiniAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gpSearchText {
  min-width: 0;
}

.gpMemberName {
  font-size: .92rem;
  font-weight: 700;
  color: var(--text);
}

.gpMemberMeta {
  font-size: .78rem;
  color: var(--text-muted);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.gpActions {
  display: flex;
  gap: 6px;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
}

.gpActionBtn,
.gpDangerBtn {
  min-height: 28px;
  border: 0;
  border-radius: 999px;
  padding: 0 10px;
  font-size: .72rem;
  font-weight: 700;
  cursor: pointer;
}

.gpActionBtn {
  background: rgba(59, 130, 246, .14);
  color: #3b82f6;
}

.gpDangerBtn {
  background: rgba(239, 68, 68, .16);
  color: #ef4444;
}

.gpDangerSection {
  padding-top: 8px;
}

.gpDangerMainBtn {
  min-height: 36px;
  border: 0;
  border-radius: 999px;
  padding: 0 16px;
  background: rgba(239, 68, 68, .16);
  color: #ef4444;
  font-size: .9rem;
  font-weight: 800;
  justify-self: start;
  cursor: pointer;
}

.gpHint {
  color: var(--text-muted);
  font-size: .86rem;
}

.gpHintStrong {
  color: var(--text);
  font-size: .92rem;
  line-height: 1.35;
}

@media (max-width: 1120px) {
  .gpRoot {
    width: 100%;
    border-left: 0;
  }
}
</style>
