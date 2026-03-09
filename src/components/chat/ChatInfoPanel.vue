<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { getAttachmentDownloadURL } from 'combox-api'
import type { AuthUser, ChatInviteLink, ChatItem, ChatMemberProfile, LocalProfile } from 'combox-api'
import { normalizeAvatarSrc } from './chatUtils'
import type { ViewMessage } from './chatTypes'
import GroupEditPanel from './GroupEditPanel.vue'
import ChannelPanel from './PublicChannelPanel.vue'
import { useI18n } from '../../i18n/i18n'

const props = defineProps<{
  open: boolean
  selectedChat: ChatItem | null
  subtitle: string
  currentUser: AuthUser | null
  localProfile: LocalProfile | null
  peerProfile: { username?: string; first_name?: string; last_name?: string; email?: string; birth_date?: string; avatar_data_url?: string } | null
  focusedUserProfile: { id?: string; username?: string; first_name?: string; last_name?: string; email?: string; birth_date?: string; avatar_data_url?: string } | null
  chatMembers: ChatMemberProfile[]
  removedChatMembers: ChatMemberProfile[]
  selectedChatInviteLinks: ChatInviteLink[]
  messages: ViewMessage[]
  directPeerId: string
  mutedChatIDs: Record<string, boolean>
}>()

const emit = defineEmits<{
  close: []
  saveGroupProfile: [payload: {
    title: string
    avatarDataUrl?: string | null
    commentsEnabled?: boolean
    reactionsEnabled?: boolean
    isPublic?: boolean
    publicSlug?: string | null
    onSuccess: () => void
    onError: (message: string) => void
  }]
  addMembers: [memberIDs: string[]]
  updateMemberRole: [payload: { userID: string; role: 'member' | 'moderator' | 'admin' | 'subscriber' | 'banned' }]
  removeMember: [userID: string]
  leaveChat: [payload: { onSuccess: () => void; onError: (message: string) => void }]
  subscribeChannel: []
  unsubscribeChannel: []
  createInviteLink: [title?: string]
  openDirectChat: [userID: string]
  toggleMuteChat: []
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
}>()

const { t } = useI18n()

const activeTab = ref<'media' | 'files' | 'links' | 'members'>(props.selectedChat?.is_direct ? 'media' : 'members')
const manageMembers = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const activeProfile = computed(() => props.focusedUserProfile || props.peerProfile)
const isUserInfoMode = computed(() => Boolean(props.focusedUserProfile?.id))
const isGroupMode = computed(() => Boolean(props.selectedChat && !props.selectedChat.is_direct && !isUserInfoMode.value))

watch(
  () => props.selectedChat?.id,
  () => {
    activeTab.value = props.selectedChat?.is_direct ? 'media' : 'members'
    manageMembers.value = false
  },
)

const displayName = computed(() => {
  const peerName = `${(activeProfile.value?.first_name || '').trim()} ${(activeProfile.value?.last_name || '').trim()}`.trim()
  return peerName || (props.selectedChat?.title || t('chat.title'))
})
const avatarSrc = computed(() => normalizeAvatarSrc(activeProfile.value?.avatar_data_url || props.selectedChat?.avatar_data_url || ''))
const usernameLine = computed(() => {
  const peerRaw = (activeProfile.value || {}) as Record<string, unknown>
  const nested = ((peerRaw.profile as Record<string, unknown> | undefined) || {}) as Record<string, unknown>
  const fromProfile =
    (typeof peerRaw.username === 'string' ? peerRaw.username : '') ||
    (typeof peerRaw.user_name === 'string' ? peerRaw.user_name : '') ||
    (typeof nested.username === 'string' ? nested.username : '') ||
    (typeof nested.user_name === 'string' ? nested.user_name : '')
  const fromTitle = (props.selectedChat?.title || '').trim().replace(/^@+/, '')
  const value = fromProfile.trim() || (fromTitle.includes(' ') ? '' : fromTitle)
  return value ? `@${value}` : '-'
})
const birthday = computed(() => {
  const peerRaw = (activeProfile.value || {}) as Record<string, unknown>
  const nested = ((peerRaw.profile as Record<string, unknown> | undefined) || {}) as Record<string, unknown>
  const raw = (
    (typeof peerRaw.birth_date === 'string' ? peerRaw.birth_date : '') ||
    (typeof peerRaw.birthDate === 'string' ? peerRaw.birthDate : '') ||
    (typeof nested.birth_date === 'string' ? nested.birth_date : '') ||
    (typeof nested.birthDate === 'string' ? nested.birthDate : '')
  ).trim()
  if (!raw) return '-'
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleDateString()
})
const memberItems = computed(() =>
  props.chatMembers.map((member) => {
    const profile = member.profile
    const fullName = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim()
    return {
      id: member.user_id,
      role: (member.role || 'member').trim() || 'member',
      joinedAt: member.joined_at || '',
      username: profile?.username || '',
      displayName: fullName || profile?.username || member.user_id,
      avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
    }
  }),
)
const currentGroupRole = computed(() => {
  if (isStandaloneChannel.value) return ((props.selectedChat?.viewer_role || '').trim().toLowerCase())
  if (props.selectedChat?.is_direct) return ''
  const currentUserID = (props.currentUser?.id || '').trim()
  if (!currentUserID) return ''
  const ownMember = props.chatMembers.find((item) => item.user_id === currentUserID)
  return (ownMember?.role || '').trim().toLowerCase()
})
const canManageGroup = computed(() => currentGroupRole.value === 'owner' || currentGroupRole.value === 'admin' || currentGroupRole.value === 'moderator')
const isStandaloneChannel = computed(() => (props.selectedChat?.kind || '').trim() === 'standalone_channel')
const canViewChannelMembers = computed(() => {
  if (!isStandaloneChannel.value) return true
  return currentGroupRole.value === 'owner' || currentGroupRole.value === 'admin'
})
const publicSubscriberCount = computed(() => Number(props.selectedChat?.subscriber_count || props.chatMembers.length || 0))
const isSubscribedToChannel = computed(() => {
  if (!isStandaloneChannel.value) return false
  return ['owner', 'admin', 'subscriber'].includes(currentGroupRole.value)
})
const mediaItems = computed(() =>
  props.messages
    .flatMap((message) =>
      message.attachments
        .filter((attachment) => attachment.kind === 'image' || attachment.kind === 'video')
        .map((attachment) => ({
          id: attachment.id,
          src: attachment.previewUrl || attachment.url,
          fullSrc: attachment.url || attachment.previewUrl,
          kind: attachment.kind,
          alt: attachment.filename || attachment.kind,
          filename: attachment.filename || '',
        })),
    )
    .filter((item) => Boolean(item.src))
    .slice(-120)
    .reverse(),
)
const fileItems = computed(() =>
  props.messages
    .flatMap((message) =>
      message.attachments
        .filter((attachment) => attachment.kind !== 'image' && attachment.kind !== 'video')
        .map((attachment) => ({
          id: attachment.id,
          name: attachment.filename || 'file',
          kind: attachment.kind || 'file',
          url: attachment.url,
        })),
    )
    .slice(-120)
    .reverse(),
)
const linkItems = computed(() => {
  const seen = new Set<string>()
  const found: string[] = []
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)\b/gi
  for (const message of props.messages) {
    for (const match of (message.text || '').matchAll(re)) {
      const raw = (match[1] || '').trim()
      const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      if (!url || seen.has(url)) continue
      seen.add(url)
      found.push(url)
    }
  }
  return found.slice(-200).reverse()
})

async function downloadAttachment(attachmentID: string, filename: string, fallbackURL?: string) {
  let href = (fallbackURL || '').trim()
  let name = (filename || '').trim() || 'file'
  try {
    const payload = await getAttachmentDownloadURL(attachmentID)
    if (payload.url) href = payload.url
    if (payload.filename?.trim()) name = payload.filename.trim()
  } catch {
    // fallback to current url
  }
  if (!href) return
  const trigger = (url: string) => {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.rel = 'noreferrer'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  try {
    const response = await fetch(href)
    if (!response.ok) throw new Error('download_failed')
    const blob = await response.blob()
    const objectURL = URL.createObjectURL(blob)
    trigger(objectURL)
    window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
  } catch {
    trigger(href)
  }
}

function openGroupSettings() {
  if (props.selectedChat?.is_direct) return
  activeTab.value = 'members'
  manageMembers.value = !manageMembers.value
  void nextTick(() => {
    rootRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}
</script>

<template>
  <aside v-show="open" ref="rootRef" class="ipRoot">
    <ChannelPanel
      v-if="selectedChat && isStandaloneChannel"
      :selected-chat="selectedChat"
      :subtitle="subtitle"
      :current-user="currentUser"
      :chat-members="chatMembers"
      :removed-chat-members="removedChatMembers"
      :invite-links="selectedChatInviteLinks"
      :muted="Boolean(mutedChatIDs[selectedChat.id])"
      @close="emit('close')"
      @save-profile="emit('saveGroupProfile', $event)"
      @update-member-role="emit('updateMemberRole', $event)"
      @remove-member="emit('removeMember', $event)"
      @subscribe="emit('subscribeChannel')"
      @unsubscribe="emit('unsubscribeChannel')"
      @create-invite-link="emit('createInviteLink', $event)"
      @open-direct-chat="emit('openDirectChat', $event)"
      @toggle-mute="emit('toggleMuteChat')"
    />
    <template v-else>
    <GroupEditPanel
      v-if="manageMembers && !selectedChat?.is_direct && canManageGroup"
      :selected-chat="selectedChat"
      :current-user="currentUser"
      :chat-members="chatMembers"
      @save-profile="emit('saveGroupProfile', $event)"
      @leave-chat="emit('leaveChat', $event)"
      @close="manageMembers = false"
      @add-members="emit('addMembers', $event)"
      @update-member-role="emit('updateMemberRole', $event)"
      @remove-member="emit('removeMember', $event)"
    />
    <template v-else>
    <div class="ipHeader">
      <div class="ipHeaderLeft">
        <button type="button" class="ipIconBtn" :aria-label="t('chat.back')" @click="emit('close')">
          <v-icon icon="mdi-arrow-left" size="18" />
        </button>
        <div class="ipTitle">{{ isGroupMode ? t('chat.group_info') : t('chat.settings') }}</div>
      </div>
      <div class="ipHeaderActions">
        <button v-if="!selectedChat?.is_direct && canManageGroup" type="button" class="ipIconBtn" :aria-label="t('chat.group_settings')" @click="openGroupSettings">
          <v-icon :icon="manageMembers ? 'mdi-cog' : 'mdi-cog-outline'" size="18" />
        </button>
        <button type="button" class="ipIconBtn" :aria-label="t('chat.close')" @click="emit('close')">
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>
    </div>

    <div class="ipHero">
      <div v-if="avatarSrc" class="ipHeroAvatar">
        <img class="ipAvatarImg" :src="avatarSrc" alt="" />
      </div>
      <div v-else class="ipHeroAvatarFallback">{{ displayName.slice(0, 1).toUpperCase() }}</div>
      <div class="ipName">{{ displayName }}</div>
      <div v-if="subtitle" class="ipSubtitle">{{ subtitle }}</div>
    </div>

    <div v-if="selectedChat?.is_direct || isUserInfoMode" class="ipMetaSection">
      <div class="ipMetaRow">
        <v-icon icon="mdi-at" size="18" class="ipMetaIcon" />
        <div>
          <div class="ipMetaValue">{{ usernameLine }}</div>
          <div class="ipMetaLabel">{{ t('chat.username') }}</div>
        </div>
      </div>
      <div class="ipMetaRow">
        <v-icon icon="mdi-calendar-month-outline" size="18" class="ipMetaIcon" />
        <div>
          <div class="ipMetaValue">{{ birthday }}</div>
          <div class="ipMetaLabel">{{ t('chat.birthday') }}</div>
        </div>
      </div>
    </div>

    <div class="ipTabs">
      <button
        v-if="!selectedChat?.is_direct && !isUserInfoMode"
        type="button"
        class="ipTab"
        :class="{ active: activeTab === 'members' }"
        @click="activeTab = 'members'"
      >
        {{ t('chat.members') }}
      </button>
      <button type="button" class="ipTab" :class="{ active: activeTab === 'media' }" @click="activeTab = 'media'">{{ t('chat.media') }}</button>
      <button type="button" class="ipTab" :class="{ active: activeTab === 'files' }" @click="activeTab = 'files'">{{ t('chat.files_tab') }}</button>
      <button type="button" class="ipTab" :class="{ active: activeTab === 'links' }" @click="activeTab = 'links'">{{ t('chat.links') }}</button>
    </div>

    <div class="ipBody">
      <div v-if="activeTab === 'members'" class="ipList">
        <div v-if="isStandaloneChannel" class="ipChannelSummary">
          <div class="ipChannelCount">
            <div class="ipChannelCountValue">{{ publicSubscriberCount }}</div>
            <div class="ipChannelCountLabel">{{ t('chat.subscribers', { count: publicSubscriberCount }, `${publicSubscriberCount} subscribers`) }}</div>
          </div>
          <button
            v-if="!canViewChannelMembers"
            type="button"
            class="ipSubscribeBtn"
            @click="isSubscribedToChannel ? emit('unsubscribeChannel') : emit('subscribeChannel')"
          >
            {{ isSubscribedToChannel ? t('chat.unsubscribe', undefined, 'Unsubscribe') : t('chat.subscribe', undefined, 'Subscribe') }}
          </button>
        </div>
        <template v-if="canViewChannelMembers && memberItems.length > 0">
          <div v-for="item in memberItems" :key="item.id" class="ipMemberItem">
            <div class="ipMemberAvatar">
              <img v-if="item.avatarSrc" :src="item.avatarSrc" alt="" class="ipMemberAvatarImg" />
              <span v-else class="ipMemberAvatarFallback">{{ item.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="ipMemberMain">
              <div class="ipMemberName">{{ item.displayName }}</div>
              <div class="ipMemberMeta">
                <span v-if="item.username">@{{ item.username }}</span>
                <span>{{ item.role }}</span>
              </div>
            </div>
          </div>
        </template>
        <div v-else-if="canViewChannelMembers" class="ipEmpty">{{ t('chat.no_participants') }}</div>
      </div>

      <div v-else-if="activeTab === 'media'" class="ipMediaGrid">
        <template v-if="mediaItems.length > 0">
          <div v-for="item in mediaItems" :key="item.id" class="ipMediaTile">
            <button
              type="button"
              class="ipMediaOpen"
              @click="item.kind === 'video' ? emit('openVideo', { attachmentID: item.id, src: item.fullSrc, poster: item.src, filename: item.filename }) : emit('openImage', item.fullSrc)"
            >
              <img :src="item.src" :alt="item.alt" class="ipMediaImg" />
            </button>
            <div v-if="item.kind === 'video'" class="ipVideoFlag">{{ t('chat.video_label') }}</div>
          </div>
        </template>
        <div v-else class="ipEmpty">{{ t('chat.no_media') }}</div>
      </div>

      <div v-else-if="activeTab === 'files'" class="ipList">
        <template v-if="fileItems.length > 0">
          <button v-for="item in fileItems" :key="item.id" type="button" class="ipFileItem" @click="downloadAttachment(item.id, item.name, item.url)">
            <div class="ipFileName">{{ item.name }}</div>
            <div class="ipFileKind">{{ item.kind }}</div>
          </button>
        </template>
        <div v-else class="ipEmpty">{{ t('chat.no_files') }}</div>
      </div>

      <div v-else class="ipList">
        <template v-if="linkItems.length > 0">
          <a v-for="item in linkItems" :key="item" :href="item" target="_blank" rel="noreferrer" class="ipLinkItem">{{ item }}</a>
        </template>
        <div v-else class="ipEmpty">{{ t('chat.no_links') }}</div>
      </div>
    </div>
    </template>
    </template>
  </aside>
</template>

<style scoped>
.ipRoot {
  width: 370px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  border-left: 1px solid rgba(15, 23, 42, 0.08);
  background:
    linear-gradient(180deg, rgba(246, 248, 252, 0.96), rgba(255, 255, 255, 0.98));
  height: 100%;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.ipRoot::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.ipHeader {
  min-height: 63px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.ipHeaderLeft {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ipHeaderActions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ipTitle {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -.02em;
}

.ipIconBtn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  color: rgba(15, 23, 42, 0.72);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.ipIconBtn:hover {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}

.ipHero {
  padding: 12px 20px 10px;
  display: grid;
  justify-items: center;
  gap: 6px;
}

.ipHeroAvatar,
.ipHeroAvatarFallback {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  overflow: hidden;
}

.ipAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ipHeroAvatarFallback {
  display: grid;
  place-items: center;
  background: #7aa3cc;
  color: #fff;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -.02em;
}

.ipName {
  font-size: 17px;
  font-weight: 800;
  text-align: center;
  color: rgba(0, 0, 0, 0.88);
  line-height: 1.15;
  max-width: 260px;
}

.ipSubtitle {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  line-height: 1.15;
}

.ipMetaSection {
  padding: 8px 20px 12px;
}

.ipMetaRow {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 0;
}

.ipMetaIcon {
  margin-top: 2px;
  color: rgba(0, 0, 0, 0.62);
}

.ipMetaValue {
  font-size: 16px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.88);
}

.ipMetaLabel {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
}

.ipTabs {
  padding: 4px 16px 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}

.ipTab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: rgba(15, 23, 42, 0.6);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.ipTab.active {
  color: #1d4ed8;
  background: rgba(59, 130, 246, 0.12);
}

.ipBody {
  padding: 14px 16px 20px;
}

.ipMediaGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ipMediaTile {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.ipMediaOpen {
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.ipMediaImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ipVideoFlag {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 10px;
}

.ipList {
  display: grid;
  gap: 8px;
}

.ipChannelSummary {
  display: grid;
  gap: 12px;
  padding: 6px 2px 10px;
}

.ipChannelCount {
  display: grid;
  gap: 2px;
}

.ipChannelCountValue {
  font-size: 28px;
  line-height: 1;
  font-weight: 800;
  color: rgba(0, 0, 0, 0.88);
}

.ipChannelCountLabel {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.56);
}

.ipSubscribeBtn {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid rgba(59, 130, 246, 0.14);
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.1);
  color: #1d4ed8;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.ipManageBox {
  display: grid;
  gap: 8px;
  padding: 0 0 6px;
}

.ipManageState {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(25, 118, 210, 0.22);
  background: rgba(25, 118, 210, 0.06);
}

.ipManageStateTitle {
  font-size: 13px;
  font-weight: 700;
  color: #1565c0;
}

.ipManageClose {
  min-width: 64px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  background: rgba(25, 118, 210, 0.14);
  color: #1565c0;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.ipManageInput {
  width: 100%;
  height: 36px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  padding: 0 10px;
  outline: 0;
  font-size: 14px;
}

.ipManageResults {
  display: grid;
  gap: 6px;
}

.ipManageResult {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.ipMemberItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
}

.ipMemberAvatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  background: #7aa3cc;
  display: grid;
  place-items: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  flex: 0 0 auto;
  letter-spacing: -.02em;
}

.ipMemberAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ipMemberAvatarFallback {
  display: block;
}

.ipMemberMain {
  min-width: 0;
  flex: 1 1 auto;
}

.ipMemberName {
  font-size: 14px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.88);
}

.ipMemberMeta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}


.ipMemberActions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ipRoleBtn,
.ipDangerBtn {
  min-width: 56px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  font-size: 12px;
  cursor: pointer;
}

.ipDangerBtn {
  color: #c62828;
  border-color: rgba(198, 40, 40, 0.24);
}

.ipFileItem,
.ipLinkItem {
  color: inherit;
  text-decoration: none;
}

.ipFileItem {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border: 0;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  cursor: pointer;
}

.ipFileName {
  font-size: 13px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.84);
}

.ipFileKind {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
}

.ipLinkItem {
  display: block;
  padding: 12px 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  color: #2563eb;
  text-decoration: none;
  word-break: break-all;
}

.ipEmpty {
  padding: 4px 0;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
}
</style>
