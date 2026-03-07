<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { searchDirectory, type AuthUser, type ChatItem, type ChatMemberProfile, type SearchUserResult } from 'combox-api'
import { normalizeAvatarSrc } from './chatUtils'

const props = defineProps<{
  selectedChat: ChatItem | null
  currentUser: AuthUser | null
  chatMembers: ChatMemberProfile[]
}>()

const emit = defineEmits<{
  close: []
  saveProfile: [payload: { title: string; avatarDataUrl?: string | null; onSuccess: () => void; onError: (message: string) => void }]
  addMembers: [memberIDs: string[]]
  updateMemberRole: [payload: { userID: string; role: 'member' | 'moderator' | 'admin' }]
  removeMember: [userID: string]
  leaveChat: [payload: { onSuccess: () => void; onError: (message: string) => void }]
}>()

const addQuery = ref('')
const addBusy = ref(false)
const addResults = ref<SearchUserResult[]>([])
const title = ref((props.selectedChat?.title || '').trim())
const avatarPreview = ref(normalizeAvatarSrc(props.selectedChat?.avatar_data_url || ''))
const avatarDataUrl = ref<string | null>(null)
const saveBusy = ref(false)
const saveError = ref('')

const currentRole = computed(() => {
  const currentUserID = (props.currentUser?.id || '').trim()
  if (!currentUserID) return ''
  const ownMember = props.chatMembers.find((item) => item.user_id === currentUserID)
  return (ownMember?.role || '').trim().toLowerCase()
})
const canManageRoles = computed(() => currentRole.value === 'owner' || currentRole.value === 'admin')
const adminCount = computed(() => props.chatMembers.filter((item) => ['owner', 'admin', 'moderator'].includes((item.role || '').trim().toLowerCase())).length)
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
const visibleAddResults = computed(() => {
  const existing = new Set(props.chatMembers.map((item) => item.user_id))
  return addResults.value.filter((user) => !existing.has(user.id) && user.id !== props.currentUser?.id)
})
const hasUnsavedChanges = computed(() => {
  const originalTitle = (props.selectedChat?.title || '').trim()
  const currentTitle = title.value.trim()
  return currentTitle !== originalTitle || avatarDataUrl.value !== null
})

watch(
  () => props.selectedChat,
  (chat) => {
    title.value = (chat?.title || '').trim()
    avatarPreview.value = normalizeAvatarSrc(chat?.avatar_data_url || '')
    avatarDataUrl.value = null
    saveError.value = ''
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
      saveError.value = 'Unable to read avatar file'
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function saveProfile() {
  if (saveBusy.value) return
  const cleanTitle = title.value.trim()
  if (!cleanTitle) {
    saveError.value = 'Group title is required'
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
</script>

<template>
  <div class="gpRoot">
    <div class="gpHeader">
      <button type="button" class="gpIconBtn" aria-label="Back" @click="emit('close')">
        <v-icon icon="mdi-arrow-left" size="20" />
      </button>
      <div class="gpTitle">Edit</div>
    </div>

    <div class="gpHero">
      <div class="gpAvatarWrap">
        <img v-if="avatarPreview" :src="avatarPreview" alt="" class="gpAvatar" />
        <div v-else class="gpAvatarFallback">{{ (selectedChat?.title || 'G').slice(0, 1).toUpperCase() }}</div>
      </div>
      <button type="button" class="gpAvatarBtn" @click="pickAvatar">Change photo</button>
    </div>

    <div class="gpSection">
      <div class="gpFieldLabel">Group name</div>
      <input v-model="title" class="gpInput" placeholder="Group name" />
      <div v-if="saveError" class="gpError">{{ saveError }}</div>
      <div class="gpSaveRow">
        <button type="button" class="gpSaveBtn" :disabled="saveBusy || !hasUnsavedChanges" @click="saveProfile">
          {{ saveBusy ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>

    <div class="gpSection">
      <div class="gpStatRow">
        <div>
          <div class="gpStatTitle">Administrators</div>
          <div class="gpStatValue">{{ adminCount }}</div>
        </div>
      </div>
      <div class="gpStatRow">
        <div>
          <div class="gpStatTitle">Members</div>
          <div class="gpStatValue">{{ normalizedMembers.length }}</div>
        </div>
      </div>
    </div>

    <div class="gpSection">
      <div class="gpFieldLabel">Add participants</div>
      <input v-model="addQuery" class="gpInput" placeholder="Search users" />
      <div v-if="addBusy" class="gpHint">Searching...</div>
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
    </div>

    <div class="gpSection">
      <div class="gpSectionTitle">Members</div>
      <div class="gpMemberList">
        <div v-for="member in normalizedMembers" :key="member.id" class="gpMemberItem">
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
            <template v-if="canManageRoles">
              <button type="button" class="gpActionBtn" @click="setRole(member.id, 'member')">Member</button>
              <button type="button" class="gpActionBtn" @click="setRole(member.id, 'moderator')">Mod</button>
              <button type="button" class="gpActionBtn" @click="setRole(member.id, 'admin')">Admin</button>
            </template>
            <button type="button" class="gpDangerBtn" @click="removeMember(member.id)">Remove</button>
          </div>
        </div>
      </div>
    </div>

    <div class="gpSection gpDangerSection">
      <button type="button" class="gpLeaveBtn" @click="leaveCurrentChat">Leave chat</button>
    </div>
  </div>
</template>

<style scoped>
.gpRoot {
  min-height: 100%;
  background: #fff;
  color: rgba(0, 0, 0, 0.88);
}

.gpHeader {
  min-height: 62px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.gpIconBtn {
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  color: rgba(0, 0, 0, 0.72);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.gpTitle {
  font-size: 18px;
  font-weight: 800;
}

.gpHero {
  padding: 10px 20px 18px;
  display: grid;
  justify-items: center;
}

.gpAvatarWrap {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  overflow: hidden;
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
  background: rgba(0, 0, 0, 0.08);
  display: grid;
  place-items: center;
  font-size: 38px;
  font-weight: 800;
}

.gpSection {
  padding: 16px 20px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.gpFieldLabel,
.gpSectionTitle {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.58);
  margin-bottom: 8px;
}

.gpFieldReadonly,
.gpInput {
  width: 100%;
  min-height: 48px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  padding: 0 14px;
  color: rgba(0, 0, 0, 0.88);
  font-size: 16px;
  outline: 0;
}

.gpAvatarBtn,
.gpSaveBtn {
  min-width: 96px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  color: rgba(0, 0, 0, 0.82);
  font-size: 13px;
  cursor: pointer;
}

.gpAvatarBtn {
  margin-top: 10px;
}

.gpSaveRow {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

.gpSaveBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.gpError {
  margin-top: 8px;
  font-size: 12px;
  color: #d32f2f;
}

.gpDangerSection {
  display: flex;
  justify-content: flex-start;
}

.gpLeaveBtn {
  min-width: 110px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(211, 47, 47, 0.24);
  background: #fff;
  color: #d32f2f;
  font-size: 13px;
  cursor: pointer;
}

.gpStatRow {
  padding: 6px 0;
}

.gpStatTitle {
  font-size: 15px;
  font-weight: 700;
}

.gpStatValue {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.58);
}

.gpHint {
  padding-top: 8px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.gpSearchList,
.gpMemberList {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.gpSearchItem,
.gpMemberItem {
  width: 100%;
  padding: 10px 0;
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.gpMiniAvatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.08);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.gpMiniAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gpSearchText {
  min-width: 0;
  flex: 1 1 auto;
}

.gpMemberName {
  font-size: 16px;
  font-weight: 700;
}

.gpMemberMeta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.58);
}

.gpActions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.gpActionBtn,
.gpDangerBtn {
  min-width: 58px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  color: rgba(0, 0, 0, 0.82);
  font-size: 12px;
  cursor: pointer;
}

.gpDangerBtn {
  color: #ff6b6b;
  border-color: rgba(255, 107, 107, 0.24);
}
</style>
