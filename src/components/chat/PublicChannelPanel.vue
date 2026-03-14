<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AuthUser, ChatInviteLink, ChatItem, ChatMemberProfile } from 'combox-api'
import { normalizeAvatarSrc } from './chatUtils'
import { useI18n } from '../../i18n/i18n'

type PublicRole = 'subscriber' | 'admin' | 'banned'
type PanelMode = 'info' | 'edit' | 'subscribers' | 'admins' | 'removed' | 'links'

const props = defineProps<{
  selectedChat: ChatItem
  subtitle: string
  currentUser: AuthUser | null
  chatMembers: ChatMemberProfile[]
  removedChatMembers: ChatMemberProfile[]
  inviteLinks: ChatInviteLink[]
  muted: boolean
}>()

const emit = defineEmits<{
  close: []
  saveProfile: [payload: {
    title: string
    avatarDataUrl?: string | null
    commentsEnabled?: boolean
    reactionsEnabled?: boolean
    isPublic?: boolean
    publicSlug?: string | null
    onSuccess: () => void
    onError: (message: string) => void
  }]
  updateMemberRole: [payload: { userID: string; role: PublicRole }]
  removeMember: [userID: string]
  subscribe: []
  unsubscribe: []
  createInviteLink: [title?: string]
  openDirectChat: [userID: string]
  toggleMute: []
}>()

const { t } = useI18n()
const panelMode = ref<PanelMode>('info')
const titleDraft = ref((props.selectedChat?.title || '').trim())
const avatarPreview = ref(normalizeAvatarSrc(props.selectedChat?.avatar_data_url || ''))
const avatarDataUrl = ref<string | null>(null)
const commentsEnabledDraft = ref(Boolean(props.selectedChat?.comments_enabled ?? true))
const reactionsEnabledDraft = ref(Boolean(props.selectedChat?.reactions_enabled ?? true))
const isPublicDraft = ref(Boolean(props.selectedChat?.is_public))
const publicSlugDraft = ref((props.selectedChat?.public_slug || '').trim())
const saveBusy = ref(false)
const saveError = ref('')
const reportNotice = ref('')

const viewerRole = computed(() => ((props.selectedChat?.viewer_role || '').trim().toLowerCase()))
const canManage = computed(() => viewerRole.value === 'owner' || viewerRole.value === 'admin')
const canViewMembers = computed(() => canManage.value)
const isSubscribed = computed(() => ['owner', 'admin', 'subscriber'].includes(viewerRole.value))
const subscriberCount = computed(() => Number(props.selectedChat?.subscriber_count || props.chatMembers.length || 0))
const channelUsername = computed(() => {
  const slug = (props.selectedChat?.public_slug || '').trim().replace(/^@+/, '')
  return slug ? `@${slug}` : ''
})
const channelLink = computed(() => {
  const slug = (props.selectedChat?.public_slug || '').trim()
  if (!slug || typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}#@${encodeURIComponent(slug)}`
})
const channelTypeLabel = computed(() => t('chat.channel', undefined, 'Channel'))
const commentsEnabled = computed(() => Boolean(props.selectedChat?.comments_enabled ?? true))
const reactionsEnabled = computed(() => Boolean(props.selectedChat?.reactions_enabled ?? true))
const primaryInviteLink = computed(() => props.inviteLinks.find((item) => item.is_primary) || props.inviteLinks[0] || null)

const displayName = computed(() => (props.selectedChat?.title || '').trim() || t('chat.channel_info', undefined, 'Channel'))
const avatarLetter = computed(() => displayName.value.slice(0, 1).toUpperCase() || 'C')

const normalizedMembers = computed(() =>
  props.chatMembers.map((member) => {
    const profile = member.profile
    const display = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() || profile?.username || member.user_id
    return {
      id: member.user_id,
      role: ((member.role || 'subscriber').trim().toLowerCase()),
      username: (profile?.username || '').trim(),
      displayName: display,
      avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
      subtitle:
        ((member.role || '').trim().toLowerCase() === 'owner')
          ? t('chat.owner', undefined, 'Owner')
          : ((member.role || '').trim().toLowerCase() === 'admin')
            ? t('chat.admin', undefined, 'Admin')
            : props.subtitle || t('chat.subscriber', undefined, 'Subscriber'),
    }
  }),
)

const adminItems = computed(() => normalizedMembers.value.filter((item) => item.role === 'owner' || item.role === 'admin'))
const subscriberItems = computed(() => normalizedMembers.value.filter((item) => item.role !== 'banned'))
const removedItems = computed(() =>
  props.removedChatMembers.map((member) => {
    const profile = member.profile
    const display = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() || profile?.username || member.user_id
    return {
      id: member.user_id,
      username: (profile?.username || '').trim(),
      displayName: display,
      avatarSrc: normalizeAvatarSrc(profile?.avatar_data_url || ''),
      subtitle: t('chat.removed_user_meta', undefined, 'Removed from channel'),
    }
  }),
)

watch(
  () => props.selectedChat,
  (chat) => {
    titleDraft.value = (chat?.title || '').trim()
    avatarPreview.value = normalizeAvatarSrc(chat?.avatar_data_url || '')
    avatarDataUrl.value = null
    commentsEnabledDraft.value = Boolean(chat?.comments_enabled ?? true)
    reactionsEnabledDraft.value = Boolean(chat?.reactions_enabled ?? true)
    isPublicDraft.value = Boolean(chat?.is_public)
    publicSlugDraft.value = (chat?.public_slug || '').trim()
    saveError.value = ''
    panelMode.value = 'info'
  },
  { deep: true },
)

function handleBack() {
  if (panelMode.value !== 'info') {
    panelMode.value = 'info'
    return
  }
  emit('close')
}

function reportChannel() {
  reportNotice.value = t('chat.report_placeholder', undefined, 'Reporting will be available later.')
  window.setTimeout(() => {
    reportNotice.value = ''
  }, 2200)
}

function openAvatarPicker() {
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
      saveError.value = t('chat.save_group_error', undefined, 'Unable to read avatar file')
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function saveProfile() {
  if (saveBusy.value) return
  const title = titleDraft.value.trim()
  if (!title) {
    saveError.value = t('chat.group_title_required', undefined, 'Title is required')
    return
  }
  saveBusy.value = true
  emit('saveProfile', {
    title,
    avatarDataUrl: avatarDataUrl.value,
    commentsEnabled: commentsEnabledDraft.value,
    reactionsEnabled: reactionsEnabledDraft.value,
    isPublic: isPublicDraft.value,
    publicSlug: isPublicDraft.value ? publicSlugDraft.value.trim() : null,
    onSuccess: () => {
      saveBusy.value = false
      panelMode.value = 'info'
      saveError.value = ''
    },
    onError: (message: string) => {
      saveBusy.value = false
      saveError.value = message
    },
  })
}

function copyLink() {
  const value = channelLink.value || inviteLinkUrl(primaryInviteLink.value) || channelUsername.value
  if (!value) return
  void copyText(value)
}

function inviteLinkUrl(link: ChatInviteLink | null | undefined): string {
  const token = (link?.token || '').trim()
  if (!token || typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}${window.location.search}#link:${encodeURIComponent(token)}`
}

function copyInviteLink(link: ChatInviteLink | null | undefined) {
  const value = inviteLinkUrl(link)
  if (!value) return
  void copyText(value)
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // fall through to legacy copy
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
}

function setChannelType(nextPublic: boolean) {
  isPublicDraft.value = nextPublic
  if (!nextPublic) publicSlugDraft.value = ''
}
</script>

<template>
  <aside class="pcRoot">
    <header class="pcHeader">
      <button type="button" class="pcIconBtn" :aria-label="panelMode === 'info' ? t('chat.close') : t('chat.back')" @click="handleBack">
        <v-icon :icon="panelMode === 'info' ? 'mdi-close' : 'mdi-arrow-left'" size="18" />
      </button>
      <div class="pcTitle">
        {{
          panelMode === 'info' ? t('chat.channel_info', undefined, 'Channel Info')
          : panelMode === 'edit' ? t('chat.edit_profile', undefined, 'Edit')
          : panelMode === 'links' ? t('chat.invite_links', undefined, 'Invite links')
          : panelMode === 'subscribers' ? t('chat.subscribers', { count: subscriberCount }, 'Subscribers')
          : panelMode === 'admins' ? t('chat.administrators', undefined, 'Administrators')
          : t('chat.removed_users', undefined, 'Removed users')
        }}
      </div>
      <div class="pcHeaderSpacer" />
    </header>

    <div class="pcScroll">
      <template v-if="panelMode === 'info'">
        <section class="pcHero">
          <div v-if="avatarPreview" class="pcAvatar"><img :src="avatarPreview" alt="" class="pcAvatarImg" /></div>
          <div v-else class="pcAvatar pcAvatar--fallback">{{ avatarLetter }}</div>
          <div class="pcName">{{ displayName }}</div>
          <div class="pcSubtitle">{{ t('chat.subscribers', { count: subscriberCount }, `${subscriberCount} subscribers`) }}</div>
          <div class="pcHeroBadge">{{ channelTypeLabel }}</div>
        </section>

        <section class="pcActionTiles">
          <button type="button" class="pcActionTile" @click="emit('toggleMute')">
            <v-icon :icon="props.muted ? 'mdi-bell-ring-outline' : 'mdi-bell-off-outline'" size="22" />
            <span>{{ props.muted ? t('chat.unmute', undefined, 'Unmute') : t('chat.mute', undefined, 'Mute') }}</span>
          </button>
          <button type="button" class="pcActionTile pcActionTile--wide" @click="isSubscribed ? emit('unsubscribe') : emit('subscribe')">
            <v-icon :icon="isSubscribed ? 'mdi-account-minus-outline' : 'mdi-account-plus-outline'" size="22" />
            <span>{{ isSubscribed ? t('chat.unsubscribe', undefined, 'Unsubscribe') : t('chat.subscribe', undefined, 'Subscribe') }}</span>
          </button>
          <button v-if="canManage" type="button" class="pcActionTile" @click="panelMode = 'edit'">
            <v-icon icon="mdi-tune-variant" size="22" />
            <span>{{ t('chat.manage', undefined, 'Manage') }}</span>
          </button>
          <button v-else type="button" class="pcActionTile" @click="reportChannel">
            <v-icon icon="mdi-flag-outline" size="22" />
            <span>{{ t('chat.report', undefined, 'Report') }}</span>
          </button>
        </section>

        <section v-if="reportNotice" class="pcHintBox pcHintBox--inline">
          <div class="pcHintText">{{ reportNotice }}</div>
        </section>

        <section class="pcFacts">
          <button v-if="channelUsername" type="button" class="pcFactRow" @click="copyLink">
            <div class="pcFactIcon"><v-icon icon="mdi-link-variant" size="20" /></div>
            <div class="pcFactBody">
              <div class="pcFactValue">{{ channelUsername }}</div>
              <div class="pcFactLabel">{{ t('chat.username', undefined, 'Username') }}</div>
            </div>
          </button>

          <div class="pcFactRow pcFactRow--static">
            <div class="pcFactIcon"><v-icon icon="mdi-comment-text-outline" size="20" /></div>
            <div class="pcFactBody">
              <div class="pcFactValue">{{ t('chat.comments', undefined, 'Comments') }}</div>
              <div class="pcFactLabel">{{ commentsEnabled ? t('chat.comments_enabled', undefined, 'Enabled') : t('chat.comments_disabled', undefined, 'Disabled') }}</div>
            </div>
          </div>

          <div class="pcFactRow pcFactRow--static">
            <div class="pcFactIcon"><v-icon icon="mdi-emoticon-outline" size="20" /></div>
            <div class="pcFactBody">
              <div class="pcFactValue">{{ t('chat.reactions', undefined, 'Reactions') }}</div>
              <div class="pcFactLabel">{{ reactionsEnabled ? t('chat.reactions_enabled', undefined, 'Enabled') : t('chat.reactions_disabled', undefined, 'Disabled') }}</div>
            </div>
          </div>

          <button v-if="canViewMembers" type="button" class="pcFactRow" @click="panelMode = 'subscribers'">
            <div class="pcFactIcon"><v-icon icon="mdi-account-group-outline" size="20" /></div>
            <div class="pcFactBody">
              <div class="pcFactValue">{{ t('chat.subscribers', { count: subscriberCount }, `${subscriberCount} subscribers`) }}</div>
              <div class="pcFactLabel">{{ subscriberCount }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="pcChevron" />
          </button>

          <button v-if="canManage" type="button" class="pcFactRow" @click="panelMode = 'admins'">
            <div class="pcFactIcon"><v-icon icon="mdi-shield-crown-outline" size="20" /></div>
            <div class="pcFactBody">
              <div class="pcFactValue">{{ t('chat.administrators', undefined, 'Administrators') }}</div>
              <div class="pcFactLabel">{{ adminItems.length }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="pcChevron" />
          </button>

          <button v-if="canManage" type="button" class="pcFactRow" @click="panelMode = 'links'">
            <div class="pcFactIcon"><v-icon icon="mdi-link-variant" size="20" /></div>
            <div class="pcFactBody">
              <div class="pcFactValue">{{ t('chat.invite_links', undefined, 'Invite links') }}</div>
              <div class="pcFactLabel">{{ inviteLinks.length || 1 }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="pcChevron" />
          </button>

          <button v-if="canManage" type="button" class="pcFactRow" @click="panelMode = 'removed'">
            <div class="pcFactIcon"><v-icon icon="mdi-account-cancel-outline" size="20" /></div>
            <div class="pcFactBody">
              <div class="pcFactValue">{{ t('chat.removed_users', undefined, 'Removed users') }}</div>
              <div class="pcFactLabel">{{ t('chat.manage_removed_users', undefined, 'Manage banned users') }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" class="pcChevron" />
          </button>
        </section>
      </template>

      <template v-else-if="panelMode === 'edit'">
        <section class="pcEditHero">
          <button type="button" class="pcEditAvatarBtn" @click="openAvatarPicker">
            <div v-if="avatarPreview" class="pcAvatar"><img :src="avatarPreview" alt="" class="pcAvatarImg" /></div>
            <div v-else class="pcAvatar pcAvatar--fallback">{{ avatarLetter }}</div>
            <div class="pcAvatarOverlay"><v-icon icon="mdi-camera-plus-outline" size="28" /></div>
          </button>
        </section>

        <section class="pcCard">
          <label class="pcField">
            <span class="pcFieldLabel">{{ t('chat.channel_name', undefined, 'Channel name') }}</span>
            <input v-model="titleDraft" class="pcInput" />
          </label>

          <div class="pcField">
            <span class="pcFieldLabel">{{ t('chat.channel_type', undefined, 'Channel type') }}</span>
            <div class="pcChoiceRow">
              <button type="button" class="pcChoicePill" :class="{ active: isPublicDraft }" @click="setChannelType(true)">
                {{ t('chat.public', undefined, 'Public') }}
              </button>
              <button type="button" class="pcChoicePill" :class="{ active: !isPublicDraft }" @click="setChannelType(false)">
                {{ t('chat.private', undefined, 'Private') }}
              </button>
            </div>
          </div>

          <label class="pcField pcToggleField">
            <span class="pcFieldLabel">{{ t('chat.comments', undefined, 'Comments') }}</span>
            <button type="button" class="pcToggle" :class="{ on: commentsEnabledDraft }" @click="commentsEnabledDraft = !commentsEnabledDraft">
              <span class="pcToggleKnob" />
            </button>
          </label>

          <label class="pcField pcToggleField">
            <span class="pcFieldLabel">{{ t('chat.reactions', undefined, 'Reactions') }}</span>
            <button type="button" class="pcToggle" :class="{ on: reactionsEnabledDraft }" @click="reactionsEnabledDraft = !reactionsEnabledDraft">
              <span class="pcToggleKnob" />
            </button>
          </label>

          <label v-if="isPublicDraft" class="pcField">
            <span class="pcFieldLabel">{{ t('chat.username', undefined, 'Username') }}</span>
            <input v-model="publicSlugDraft" class="pcInput" :placeholder="t('chat.channel_username_placeholder', undefined, 'channel_username')" />
          </label>

          <label class="pcField">
            <span class="pcFieldLabel">{{ t('chat.invite_links', undefined, 'Invite link') }}</span>
            <input :value="isPublicDraft ? (`@${publicSlugDraft || '...'}`) : t('chat.private_channel_no_link', undefined, 'No public link')" class="pcInput" disabled />
          </label>

          <div v-if="saveError" class="pcError">{{ saveError }}</div>

          <button type="button" class="pcSaveBtn" :disabled="saveBusy" @click="saveProfile">
            {{ saveBusy ? t('chat.saving', undefined, 'Saving...') : t('chat.save', undefined, 'Save') }}
          </button>
        </section>

        <section class="pcCard pcFlatList">
          <button type="button" class="pcListRow" @click="copyLink" :disabled="!channelUsername">
            <div>
              <div class="pcListRowTitle">{{ t('chat.copy_link', undefined, 'Copy link') }}</div>
              <div class="pcListRowMeta">{{ channelUsername || t('chat.private_channel_no_link', undefined, 'No public link') }}</div>
            </div>
            <v-icon icon="mdi-content-copy" size="18" />
          </button>

          <button type="button" class="pcListRow" @click="panelMode = 'admins'">
            <div>
              <div class="pcListRowTitle">{{ t('chat.administrators', undefined, 'Administrators') }}</div>
              <div class="pcListRowMeta">{{ adminItems.length }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" />
          </button>

          <button type="button" class="pcListRow" @click="panelMode = 'subscribers'">
            <div>
              <div class="pcListRowTitle">{{ t('chat.subscribers', { count: subscriberCount }, 'Subscribers') }}</div>
              <div class="pcListRowMeta">{{ subscriberCount }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" />
          </button>

          <button type="button" class="pcListRow" @click="panelMode = 'links'">
            <div>
              <div class="pcListRowTitle">{{ t('chat.invite_links', undefined, 'Invite links') }}</div>
              <div class="pcListRowMeta">{{ inviteLinks.length || 1 }}</div>
            </div>
            <v-icon icon="mdi-chevron-right" size="18" />
          </button>
        </section>
      </template>

      <template v-else-if="panelMode === 'links'">
        <section class="pcHintBox">
          <div class="pcHintTitle">{{ t('chat.primary_link', undefined, 'Primary link') }}</div>
          <div class="pcHintText">{{ t('chat.invite_links_hint', undefined, 'Anyone with this link can open the channel.') }}</div>
        </section>

        <section class="pcCard pcFlatList">
          <button type="button" class="pcListRow" @click="copyLink">
            <div>
              <div class="pcListRowTitle">{{ inviteLinkUrl(primaryInviteLink) || t('chat.private_channel_no_link', undefined, 'No public link') }}</div>
              <div class="pcListRowMeta">{{ t('chat.copy_link', undefined, 'Copy link') }}</div>
            </div>
            <v-icon icon="mdi-content-copy" size="18" />
          </button>

          <button type="button" class="pcListRow" @click="emit('createInviteLink')">
            <div>
              <div class="pcListRowTitle">{{ t('chat.create_new_link', undefined, 'Create new link') }}</div>
              <div class="pcListRowMeta">{{ t('chat.additional_link', undefined, 'Additional invite link') }}</div>
            </div>
            <v-icon icon="mdi-plus" size="18" />
          </button>
        </section>

        <section v-if="inviteLinks.length > 0" class="pcCard pcFlatList">
          <article v-for="item in inviteLinks" :key="item.id" class="pcListRow pcListRow--static">
            <div>
              <div class="pcListRowTitle">{{ item.title || (item.is_primary ? t('chat.primary_link', undefined, 'Primary link') : t('chat.invite_link', undefined, 'Invite link')) }}</div>
              <div class="pcListRowMeta">{{ inviteLinkUrl(item) }}</div>
              <div class="pcListRowMeta">{{ item.use_count }} {{ t('chat.uses', undefined, 'uses') }}</div>
            </div>
            <button type="button" class="pcRowCopyBtn" :aria-label="t('chat.copy_link', undefined, 'Copy link')" @click.stop="copyInviteLink(item)">
              <v-icon icon="mdi-content-copy" size="18" />
            </button>
          </article>
        </section>
      </template>

      <template v-else-if="panelMode === 'subscribers'">
        <div class="pcMemberList">
          <article v-for="item in subscriberItems" :key="item.id" class="pcMemberRow" @click="emit('openDirectChat', item.id)">
            <div class="pcMemberAvatar">
              <img v-if="item.avatarSrc" :src="item.avatarSrc" alt="" class="pcMemberAvatarImg" />
              <span v-else class="pcMemberAvatarFallback">{{ item.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="pcMemberBody">
              <div class="pcMemberName">{{ item.displayName }}</div>
              <div class="pcMemberMeta">
                <button v-if="item.username" type="button" class="pcInlineUser" @click.stop="emit('openDirectChat', item.id)">@{{ item.username }}</button>
                <span>{{ item.subtitle }}</span>
              </div>
            </div>
            <div v-if="canManage && item.role !== 'owner'" class="pcMemberActions">
              <button
                v-if="item.role !== 'admin'"
                type="button"
                class="pcMiniBtn"
                @click="emit('updateMemberRole', { userID: item.id, role: 'admin' })"
              >
                {{ t('chat.make_admin', undefined, 'Make admin') }}
              </button>
              <button
                v-if="item.role === 'admin'"
                type="button"
                class="pcMiniBtn"
                @click="emit('updateMemberRole', { userID: item.id, role: 'subscriber' })"
              >
                {{ t('chat.remove_admin', undefined, 'Remove admin') }}
              </button>
              <button type="button" class="pcMiniBtn pcMiniBtn--danger" @click="emit('updateMemberRole', { userID: item.id, role: 'banned' })">
                {{ t('chat.ban', undefined, 'Ban') }}
              </button>
              <button type="button" class="pcMiniBtn pcMiniBtn--danger" @click="emit('removeMember', item.id)">
                {{ t('chat.remove', undefined, 'Remove') }}
              </button>
            </div>
          </article>
        </div>
      </template>

      <template v-else-if="panelMode === 'admins'">
        <section class="pcHintBox">
          <div class="pcHintTitle">{{ t('chat.recent_actions', undefined, 'Recent actions') }}</div>
          <div class="pcHintText">{{ t('chat.public_admins_hint', undefined, 'Admins can publish, edit and remove posts, and manage subscribers.') }}</div>
        </section>

        <div class="pcMemberList">
          <article v-for="item in adminItems" :key="item.id" class="pcMemberRow" @click="emit('openDirectChat', item.id)">
            <div class="pcMemberAvatar">
              <img v-if="item.avatarSrc" :src="item.avatarSrc" alt="" class="pcMemberAvatarImg" />
              <span v-else class="pcMemberAvatarFallback">{{ item.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="pcMemberBody">
              <div class="pcMemberName">{{ item.displayName }}</div>
              <div class="pcMemberMeta">
                <button v-if="item.username" type="button" class="pcInlineUser" @click.stop="emit('openDirectChat', item.id)">@{{ item.username }}</button>
                <span>{{ item.role === 'owner' ? t('chat.owner', undefined, 'Owner') : t('chat.admin', undefined, 'Admin') }}</span>
              </div>
            </div>
            <div v-if="canManage && item.role !== 'owner'" class="pcMemberActions">
              <button type="button" class="pcMiniBtn" @click="emit('updateMemberRole', { userID: item.id, role: 'subscriber' })">
                {{ t('chat.remove_admin', undefined, 'Remove admin') }}
              </button>
            </div>
          </article>
        </div>
      </template>

      <template v-else>
        <section class="pcHintBox">
          <div class="pcHintTitle">{{ t('chat.removed_users', undefined, 'Removed users') }}</div>
          <div class="pcHintText">{{ t('chat.removed_users_hint', undefined, 'Users removed by admins cannot rejoin via invite links.') }}</div>
        </section>
        <div v-if="removedItems.length > 0" class="pcMemberList">
          <article v-for="item in removedItems" :key="item.id" class="pcMemberRow" @click="emit('openDirectChat', item.id)">
            <div class="pcMemberAvatar">
              <img v-if="item.avatarSrc" :src="item.avatarSrc" alt="" class="pcMemberAvatarImg" />
              <span v-else class="pcMemberAvatarFallback">{{ item.displayName.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="pcMemberBody">
              <div class="pcMemberName">{{ item.displayName }}</div>
              <div class="pcMemberMeta">
                <button v-if="item.username" type="button" class="pcInlineUser" @click.stop="emit('openDirectChat', item.id)">@{{ item.username }}</button>
                <span>{{ item.subtitle }}</span>
              </div>
            </div>
            <div v-if="canManage" class="pcMemberActions">
              <button type="button" class="pcMiniBtn" @click="emit('updateMemberRole', { userID: item.id, role: 'subscriber' })">
                {{ t('chat.restore', undefined, 'Restore') }}
              </button>
            </div>
          </article>
        </div>
        <div v-else class="pcHintBox">
          <div class="pcHintText">{{ t('chat.no_removed_users', undefined, 'No removed users yet.') }}</div>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.pcRoot {
  width: 410px;
  flex: 0 0 auto;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-left: 1px solid var(--border);
  background: var(--surface);
}

.pcHeader {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  min-height: 62px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
}

.pcTitle {
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text);
}

.pcHeaderSpacer { width: 34px; height: 34px; }

.pcIconBtn {
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

.pcScroll {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.18) transparent;
}

.pcScroll::-webkit-scrollbar { width: 8px; }
.pcScroll::-webkit-scrollbar-track { background: transparent; }
.pcScroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.16);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.pcHero,
.pcEditHero {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 4px 0 2px;
}

.pcAvatar,
.pcMemberAvatar {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-soft);
}

.pcAvatar--fallback,
.pcMemberAvatarFallback {
  display: grid;
  place-items: center;
  background: var(--avatar-fallback);
  color: #fff;
  font-size: 2rem;
  font-weight: 800;
}

.pcAvatarImg,
.pcMemberAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pcName {
  font-size: 1.2rem;
  font-weight: 800;
  letter-spacing: -.05em;
  color: var(--text);
  text-align: center;
}

.pcSubtitle {
  font-size: .86rem;
  color: var(--text-muted);
}

.pcHeroBadge {
  margin-top: 4px;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: .8rem;
  font-weight: 700;
  color: var(--text-soft);
}

.pcFacts,
.pcCard,
.pcHintBox {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
}

.pcActionTiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.pcActionTile {
  min-height: 68px;
  border: 1px solid var(--border);
  background: var(--surface-strong);
  border-radius: 14px;
  display: grid;
  place-items: center;
  gap: 6px;
  padding: 10px 8px;
  color: var(--text);
  box-shadow: var(--shadow-soft);
  cursor: pointer;
}

.pcActionTile span {
  font-size: .78rem;
  font-weight: 700;
}

.pcActionTile--wide {
  min-width: 0;
}

.pcFactRow,
.pcListRow {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
  color: inherit;
}

.pcFactRow--static {
  cursor: default;
}

.pcListRow:disabled {
  opacity: .6;
  cursor: default;
}

.pcFactIcon {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.pcFactValue,
.pcListRowTitle {
  font-size: .92rem;
  font-weight: 700;
  color: var(--text);
}

.pcFactLabel,
.pcListRowMeta,
.pcHintText {
  font-size: .8rem;
  color: var(--text-muted);
}

.pcSaveBtn,
.pcMiniBtn {
  min-height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: #4a90d9;
  color: #fff;
  font-size: .86rem;
  font-weight: 700;
  cursor: pointer;
}

.pcMiniBtn {
  min-height: 30px;
  padding: 0 12px;
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}

.pcMiniBtn--danger {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}

.pcEditAvatarBtn {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  position: relative;
}

.pcAvatarOverlay {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.24);
  color: #fff;
}

.pcField {
  display: grid;
  gap: 6px;
}

.pcToggleField {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.pcStaticValue {
  width: 100%;
  min-height: 42px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--surface-soft);
  padding: 0 16px;
  display: flex;
  align-items: center;
  font-size: .92rem;
  color: var(--text);
  font-weight: 600;
}

.pcChoiceRow {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.pcChoicePill {
  min-height: 40px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: .88rem;
  font-weight: 700;
  cursor: pointer;
}

.pcChoicePill.active {
  border-color: rgba(59, 130, 246, 0.22);
  background: rgba(59, 130, 246, 0.12);
  color: var(--accent-strong);
}

.pcFieldLabel,
.pcHintTitle {
  font-size: .8rem;
  font-weight: 700;
  color: var(--text);
}

.pcInput {
  width: 100%;
  min-height: 42px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--surface-soft);
  padding: 0 16px;
  font-size: .98rem;
  color: var(--text);
}

.pcInput:disabled {
  opacity: .72;
}

.pcError {
  font-size: .82rem;
  color: #dc2626;
}

.pcToggle {
  width: 44px;
  height: 26px;
  border: 0;
  border-radius: 999px;
  padding: 3px;
  background: rgba(148, 163, 184, 0.28);
  display: flex;
  align-items: center;
  cursor: pointer;
  transition: background 120ms ease;
}

.pcToggle.on {
  background: rgba(59, 130, 246, 0.46);
}

.pcToggleKnob {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.18);
  transform: translateX(0);
  transition: transform 120ms ease;
}

.pcToggle.on .pcToggleKnob {
  transform: translateX(18px);
}

.pcFlatList {
  gap: 14px;
}

.pcMemberList {
  display: grid;
  gap: 10px;
}

.pcMemberRow {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  cursor: pointer;
}

.pcMemberAvatar {
  width: 40px;
  height: 40px;
}

.pcMemberBody {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.pcMemberName {
  font-size: .9rem;
  font-weight: 700;
  color: var(--text);
}

.pcMemberMeta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: .78rem;
  color: var(--text-muted);
}

.pcInlineUser {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent-strong);
  cursor: pointer;
  font: inherit;
}

.pcMemberActions {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.pcChevron {
  color: var(--text-muted);
}

.pcListRow--static {
  cursor: default;
}
.pcRowCopyBtn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: rgba(0,0,0,.04);
  color: var(--text-soft, rgba(0,0,0,.64));
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}
.pcRowCopyBtn:hover {
  background: rgba(0,0,0,.08);
  color: var(--text, rgba(0,0,0,.86));
}
</style>
