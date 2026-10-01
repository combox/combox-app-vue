<script setup lang="ts">
import { type ChatItem } from 'combox-api'
import { computed, nextTick, ref } from 'vue'
import type { GroupChannelItem } from './chatSidebar.types'
import { stripMarkdownForPreview, summarizeMessagePreview } from './chatUtils'
import { chatDraftPreview, chatDrafts } from './chatWorkspace.drafts'
import { useI18n } from '../../i18n/i18n'

const props = defineProps<{
  chats: ChatItem[]
  selectedChatID: string
  search: string
  unreadByChatId: Record<string, number>
  groupTitle: string
  groupMemberCount: number
  groupChannels: GroupChannelItem[]
  selectedGroupChannelID: string
  loadingGroupChannels: boolean
  canCreateChannel: boolean
  topicCreateOpen: boolean
  topicCreateTitle: string
  topicCreateType: 'text' | 'voice'
  topicCreateError: string
  mutedChatIDs: Record<string, boolean>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:search', value: string): void
  (e: 'select-chat', chatID: string): void
  (e: 'select-channel', channelID: string): void
  (e: 'open-topic-create'): void
  (e: 'close-topic-create'): void
  (e: 'submit-topic-create'): void
  (e: 'update:topic-title', value: string): void
  (e: 'update:topic-type', value: 'text' | 'voice'): void
  (e: 'open-group-menu', anchor: { top: number; left: number; width: number; height: number }): void
  (e: 'chat-context-pin', chat: ChatItem): void
  (e: 'chat-context-mute', chat: ChatItem): void
  (e: 'chat-context-read', chat: ChatItem): void
  (e: 'chat-context-clear', chat: ChatItem): void
  (e: 'chat-context-leave', chat: ChatItem): void
  (e: 'chat-context-delete', chat: ChatItem): void
  (e: 'open-channel-settings', channel: GroupChannelItem): void
}>()

const { t } = useI18n()

function formatTopicMeta(value?: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * R16: a topic row shows the real last-message time, never the topic creation
 * date. Migrated topics were created "now" (2026-09-30) while their messages
 * are Feb-Apr 2026, so channel.createdAt would paint Sep 30 over real dates.
 * GroupChannelItem extends ChatItem, so last_message_at survives the
 * visibleGroupChannels spread; empty topics (no last_message_at) show no date.
 */
function topicRowDate(channel: GroupChannelItem): string {
  const lastStamp = (channel.last_message_at || '').trim()
  if (!lastStamp) return ''
  return formatTopicMeta(lastStamp)
}

function formatTopicPreview(raw: string): string {
  return stripMarkdownForPreview(summarizeMessagePreview(raw || '', {
    gif: t('chat.gif'),
    video: t('chat.video'),
    photo: t('chat.photo'),
    audio: t('chat.audio'),
    file: t('chat.file'),
    empty: t('chat.no_messages'),
    voice: t('chat.audio_message', undefined, 'Voice message'),
    round: t('chat.video_message', undefined, 'Video message'),
  }))
}

function topicDraftFor(channel: GroupChannelItem): string {
  const id = String(channel?.id || '').trim()
  if (!id) return ''
  // A topic you are currently inside shows its normal preview, never the
  // "Draft:" badge — the draft only becomes visible once you leave it.
  if (id === String(props.selectedGroupChannelID || '').trim()) return ''
  const text = chatDrafts.value[id] || ''
  return text.trim() ? chatDraftPreview(text) : ''
}

const visibleChannels = computed(() => {
  return props.groupChannels
})

type ChannelMenuState = { open: boolean; x: number; y: number; channel: GroupChannelItem | null }
const channelMenu = ref<ChannelMenuState>({ open: false, x: 0, y: 0, channel: null })
const channelMenuEl = ref<HTMLElement | null>(null)

const MENU_MARGIN = 8

/**
 * The sidebar list only holds top level chats, while group channels come from
 * `listChannels`. Resolve the real chat when we have it (the virtual General
 * channel *is* the group) and otherwise fall back to the channel payload,
 * which is already a full ChatItem, so every menu action keeps its data.
 */
function channelChat(channel: GroupChannelItem | null): ChatItem | null {
  const id = (channel?.id || '').trim()
  if (!id || !channel) return null
  return props.chats.find((chat) => (chat.id || '').trim() === id) || channel
}

function isChannelMuted(channel: GroupChannelItem | null): boolean {
  return Boolean(props.mutedChatIDs?.[(channel?.id || '').trim()])
}

function openGroupMenu(event: MouseEvent) {
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  emit('open-group-menu', { top: rect.top, left: rect.left, width: rect.width, height: rect.height })
}

function openChannelContext(event: MouseEvent, channel: GroupChannelItem) {
  event.preventDefault()
  event.stopPropagation()
  const x = Math.min(event.clientX, window.innerWidth - MENU_MARGIN)
  const y = Math.min(event.clientY, window.innerHeight - MENU_MARGIN)
  channelMenu.value = { open: true, x, y, channel }
  void nextTick(() => clampChannelMenu())
}

function closeChannelContext() {
  if (!channelMenu.value.open) return
  channelMenu.value = { open: false, x: 0, y: 0, channel: null }
}

function clampChannelMenu() {
  const menu = channelMenuEl.value
  if (!menu || !channelMenu.value.open) return
  const rect = menu.getBoundingClientRect()
  const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - rect.width - MENU_MARGIN)
  const maxTop = Math.max(MENU_MARGIN, window.innerHeight - rect.height - MENU_MARGIN)
  const nextLeft = Math.min(Math.max(channelMenu.value.x, MENU_MARGIN), maxLeft)
  const nextTop = Math.min(Math.max(channelMenu.value.y, MENU_MARGIN), maxTop)
  if (nextLeft !== channelMenu.value.x || nextTop !== channelMenu.value.y) {
    channelMenu.value = { ...channelMenu.value, x: nextLeft, y: nextTop }
  }
}

function copyChannelLink(channel: GroupChannelItem) {
  const chat = channelChat(channel)
  const slug = (chat?.public_slug || '').trim()
  closeChannelContext()
  if (!slug || !navigator.clipboard?.writeText) return
  void navigator.clipboard.writeText(`${window.location.origin}/#${slug}`)
}

const menuChat = computed(() => channelChat(channelMenu.value.channel))
/** owner / admin / moderator may manage a channel (rename, delete). */
const menuCanManage = computed(() => ['owner', 'admin', 'moderator'].includes((menuChat.value?.viewer_role || '').trim().toLowerCase()))
/** The General channel is the group itself: leaving it means leaving the group. */
const menuIsGeneral = computed(() => Boolean(channelMenu.value.channel?.isGeneral))

const isVoiceChannel = (channel: { channel_type?: string }) => (channel.channel_type || '').trim() === 'voice'
const menuCanDelete = computed(() => {
  const chat = menuChat.value
  if (!chat || chat.is_direct) return false
  if (menuIsGeneral.value) return false
  return menuCanManage.value
})
const menuIsPinned = computed(() => Boolean(menuChat.value?.pinned))
const menuCanCopyLink = computed(() => Boolean((menuChat.value?.public_slug || '').trim()))
const menuShowRead = computed(() => (channelMenu.value.channel?.unread || 0) > 0)
const menuCanMute = computed(() => Boolean(menuChat.value))
</script>

<template>
  <aside class="tpPanel">
      <header class="tpHeader">
        <button type="button" class="tpIconBtn" :aria-label="t('chat.close')" @click="emit('close')">
          <v-icon icon="mdi-arrow-left" size="18" />
        </button>
        <div class="tpHeadText">
          <h3 class="tpTitle">{{ groupTitle }}</h3>
          <p class="tpSubtitle">{{ t('chat.participants', { count: Math.max(0, groupMemberCount || 0) }, `${Math.max(0, groupMemberCount || 0)} participants`) }}</p>
        </div>
        <div class="tpActions">
          <button
            v-if="canCreateChannel"
            type="button"
            class="tpIconBtn"
            :aria-label="t('chat.new_topic')"
            :title="t('chat.new_topic')"
            @click="emit('open-topic-create')"
          >
            <v-icon icon="mdi-plus" size="18" />
          </button>
          <button type="button" class="tpIconBtn" :aria-label="t('chat.settings')" :title="t('chat.settings')" @click="openGroupMenu">
            <v-icon icon="mdi-dots-vertical" size="22" />
          </button>
        </div>
      </header>

      <section class="tpList">
        <p v-if="loadingGroupChannels" class="tpPlaceholder">{{ t('chat.loading_topics') }}</p>
        <button
          v-for="channel in visibleChannels"
          :key="channel.id"
          type="button"
          class="tpRow"
          :class="{ selected: selectedGroupChannelID === channel.id }"
          @click="emit('select-channel', channel.id)"
          v-long-context
          @contextmenu="openChannelContext($event, channel)"
        >
          <div class="tpTopLine" :class="{ voice: isVoiceChannel(channel) }">
            <span class="tpName">
              <v-icon
                v-if="isVoiceChannel(channel)"
                class="tpHash tpVoiceIcon"
                icon="mdi-volume-high"
                size="15"
              />
              <span v-else class="tpHash" aria-hidden="true">{{ (channel.icon_emoji || '').trim() || '#' }}</span>
              {{ channel.title }}
            </span>
            <span v-if="topicRowDate(channel)" class="tpMeta">
              {{ topicRowDate(channel) }}
            </span>
          </div>
          <div class="tpBottomLine">
            <span v-if="topicDraftFor(channel)" class="tpPreview tpDraftText"><b class="tpDraftLabel">{{ t('chat.draft', undefined, 'Draft:') }}</b> {{ topicDraftFor(channel) }}</span>
            <span v-else class="tpPreview">{{ formatTopicPreview(channel.lastPreview || '') }}</span>
            <span v-if="(channel.unread || 0) > 0" class="tpUnread">{{ channel.unread }}</span>
          </div>
        </button>
      </section>

      <div v-if="topicCreateOpen" class="tpCreateBackdrop" @click.self="emit('close-topic-create')">
        <aside class="tpCreateSheet">
          <div class="tpCreateHeader">
            <h4 class="tpCreateTitle">{{ t('chat.new_topic') }}</h4>
            <button
              type="button"
              class="tpIconBtn"
              :aria-label="t('chat.close')"
              @click="emit('close-topic-create')"
            >
              <v-icon icon="mdi-close" size="18" />
            </button>
          </div>
          <p class="tpCreateHint">{{ t('chat.topic_create_hint') }}</p>
          <label class="tpFieldLabel" for="topic-title-input">{{ t('chat.topic_name') }}</label>
          <input
            id="topic-title-input"
            class="tpCreateInput"
            type="text"
            maxlength="64"
            :placeholder="t('chat.topic_name')"
            :value="topicCreateTitle"
            @input="emit('update:topic-title', ($event.target as HTMLInputElement).value)"
            @keydown.enter.prevent="emit('submit-topic-create')"
          />
          <div class="tpTypeRow">
            <button
              type="button"
              class="tpTypeChip"
              :class="{ active: topicCreateType === 'text' }"
              @click="emit('update:topic-type', 'text')"
            >
              {{ t('chat.topic_type_text') }}
            </button>
            <button
              type="button"
              class="tpTypeChip"
              :class="{ active: topicCreateType === 'voice' }"
              @click="emit('update:topic-type', 'voice')"
            >
              {{ t('chat.topic_type_voice') }}
            </button>
          </div>
          <p v-if="topicCreateError" class="tpCreateError">{{ topicCreateError }}</p>
          <div class="tpCreateActions">
            <button type="button" class="tpPrimaryButton" @click="emit('submit-topic-create')">
              {{ t('chat.create') }}
            </button>
            <button type="button" class="tpSecondaryButton" @click="emit('close-topic-create')">
              {{ t('common.cancel') }}
            </button>
          </div>
        </aside>
      </div>

      <Teleport to="body">
        <div v-if="channelMenu.open" class="tpCtxOverlay" @click="closeChannelContext" @contextmenu.prevent="closeChannelContext" />
        <div
          v-if="channelMenu.open && channelMenu.channel"
          ref="channelMenuEl"
          class="tpCtxMenu"
          :style="{ left: `${channelMenu.x}px`, top: `${channelMenu.y}px` }"
        >
          <button type="button" class="tpCtxItem" @click="emit('select-channel', channelMenu.channel.id); closeChannelContext()">
            <v-icon class="tpCtxIcon" icon="mdi-arrow-right-circle-outline" size="17" />
            <span>{{ t('chat.open', undefined, 'Open') }}</span>
          </button>
          <button v-if="menuCanManage" type="button" class="tpCtxItem" @click="emit('open-channel-settings', channelMenu.channel); closeChannelContext()">
            <v-icon class="tpCtxIcon" icon="mdi-cog-outline" size="17" />
            <span>{{ t('chat.channel_settings', undefined, 'Channel settings') }}</span>
          </button>
          <button v-if="menuChat" type="button" class="tpCtxItem" @click="emit('chat-context-pin', menuChat); closeChannelContext()">
            <v-icon class="tpCtxIcon" :icon="menuIsPinned ? 'mdi-pin-off-outline' : 'mdi-pin-outline'" size="17" />
            <span>{{ menuIsPinned ? t('chat.unpin', undefined, 'Unpin') : t('chat.pin', undefined, 'Pin') }}</span>
          </button>
          <button v-if="menuCanMute" type="button" class="tpCtxItem" @click="emit('chat-context-mute', menuChat); closeChannelContext()">
            <v-icon class="tpCtxIcon" :icon="isChannelMuted(channelMenu.channel) ? 'mdi-bell-outline' : 'mdi-bell-off-outline'" size="17" />
            <span>{{ isChannelMuted(channelMenu.channel) ? t('chat.unmute', undefined, 'Unmute') : t('chat.mute', undefined, 'Mute') }}</span>
          </button>
          <button
            v-if="menuShowRead"
            type="button"
            class="tpCtxItem"
            @click="emit('chat-context-read', menuChat); closeChannelContext()"
          >
            <v-icon class="tpCtxIcon" icon="mdi-check-all" size="17" />
            <span>{{ t('chat.mark_read', undefined, 'Mark as read') }}</span>
          </button>
          <button v-if="menuCanCopyLink" type="button" class="tpCtxItem" @click="copyChannelLink(channelMenu.channel)">
            <v-icon class="tpCtxIcon" icon="mdi-link-variant" size="17" />
            <span>{{ t('chat.copy_link', undefined, 'Copy link') }}</span>
          </button>
          <button v-if="menuChat" type="button" class="tpCtxItem danger" @click="emit('chat-context-clear', menuChat); closeChannelContext()">
            <v-icon class="tpCtxIcon" icon="mdi-notification-clear-all" size="17" />
            <span>{{ t('chat.clear_history', undefined, 'Clear history') }}</span>
          </button>
          <button
            v-if="menuCanDelete"
            type="button"
            class="tpCtxItem danger"
            @click="emit('chat-context-delete', menuChat); closeChannelContext()"
          >
            <v-icon class="tpCtxIcon" icon="mdi-delete-outline" size="17" />
            <span>{{ t('chat.delete_channel', undefined, 'Delete channel') }}</span>
          </button>
        </div>
      </Teleport>
  </aside>
</template>

<style scoped>
.tpPanel { position:relative; display:grid; grid-template-rows:auto minmax(0,1fr); min-width:0; height:100%; background:var(--bg-elevated); color:var(--text); }
.tpHeader { display:flex; align-items:center; gap:12px; padding:10px 14px 8px; border-bottom:1px solid var(--border); background:var(--bg-elevated); }
.tpHeadText { min-width:0; flex:1 1 auto; }
.tpTitle { margin:0; font-size:16px; font-weight:600; line-height:1.2; letter-spacing:-0.02em; }
.tpSubtitle { margin:3px 0 0; color:var(--text-muted); font-size:12px; }
.tpActions { display:flex; align-items:center; gap:2px; }
.tpIconBtn { width:30px; height:30px; border:0; border-radius:10px; background:transparent; color:var(--text-soft); display:grid; place-items:center; cursor:pointer; }
.tpIconBtn:hover { background:var(--surface-soft); }
.tpList { overflow:auto; padding:8px 10px 12px; min-height:0; scrollbar-width:none; -ms-overflow-style:none; }
.tpList::-webkit-scrollbar { width:0; height:0; display:none; }
.tpPlaceholder { margin:8px 6px; color:var(--text-muted); font-size:12px; }
.tpHash { display:inline-block; width:1.05em; color:var(--text-muted); }
.tpVoiceIcon { color: var(--accent); width:auto; margin-right:2px; }
.tpTopLine.voice .tpName { color: color-mix(in srgb, var(--accent) 70%, var(--text)); }
.tpRow { width:100%; margin:0 0 6px; padding:11px 12px; border:0; border-radius:14px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.tpRow:hover { background:var(--surface-soft-hover); }
.tpRow.selected { background: color-mix(in srgb, var(--accent) 26%, rgba(0,0,0,.18)); }
.tpTopLine,.tpBottomLine { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.tpBottomLine { margin-top:4px; }
.tpName { min-width:0; font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tpMeta { flex:none; color:var(--text-muted); font-size:12px; }
.tpPreview { min-width:0; color:var(--text-muted); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tpUnread { flex:none; min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:var(--accent); color:#fff; font-size:11px; font-weight:800; line-height:18px; text-align:center; }
.tpCreateBackdrop { position:absolute; inset:0; display:flex; justify-content:flex-end; background:rgba(0,0,0,.18); }
.tpCreateSheet { width:min(100%,320px); padding:16px 14px; border-left:1px solid var(--border); background:var(--surface); }
.tpCreateHeader { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.tpCreateTitle { margin:0; font-size:24px; font-weight:700; }
.tpCreateHint { margin:10px 0 14px; color:var(--text-muted); font-size:12px; }
.tpFieldLabel { display:block; margin-bottom:8px; color:var(--text-soft); font-size:12px; }
.tpCreateInput { width:100%; height:46px; padding:0 12px; border-radius:12px; border:1px solid var(--border); background:var(--surface-soft); color:var(--text); outline:none; }
.tpCreateInput:focus { border-color: rgba(74, 144, 217, 0.38); box-shadow: 0 0 0 4px rgba(74, 144, 217, 0.12); }
.tpTypeRow { display:flex; gap:8px; margin-top:14px; }
.tpTypeChip { height:38px; padding:0 14px; border:1px solid var(--border); border-radius:999px; background:var(--surface-soft); color:var(--text-soft); font-weight:800; cursor:pointer; }
.tpTypeChip.active { border-color:rgba(74, 144, 217, 0.42); background:var(--accent-soft); color:var(--accent-strong); }
.tpCreateError { margin:8px 0 0; color:#dc2626; font-size:12px; }
.tpCreateActions { display:grid; gap:10px; margin-top:16px; }
.tpPrimaryButton,.tpSecondaryButton { height:42px; border-radius:12px; font-weight:700; cursor:pointer; }
.tpPrimaryButton { border:none; background:var(--accent); color:#fff; font-weight:800; }
.tpSecondaryButton { border:1px solid var(--border); background:var(--surface-soft); color:var(--text-soft); font-weight:800; }

/* ── Channel context menu (teleported to <body> so no ancestor clips it) ── */
.tpCtxOverlay { position: fixed; inset: 0; z-index: 9490; background: transparent; }
.tpCtxMenu {
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
  animation: tpCtxPop 120ms cubic-bezier(0.2, 0.7, 0.3, 1);
}
.tpCtxItem {
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
.tpCtxItem > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tpCtxIcon { flex: none; opacity: 0.72; transition: opacity 120ms ease, transform 120ms ease; }
.tpCtxItem:hover .tpCtxIcon { opacity: 1; transform: translateX(1px); }
.tpCtxItem:hover { background: var(--surface-soft); }
.tpCtxItem.danger { color: #ff6b6b; }
.tpCtxItem.danger .tpCtxIcon { opacity: 0.9; }
.tpCtxItem.danger:hover { background: rgba(255, 107, 107, 0.12); }
@keyframes tpCtxPop {
  from { opacity: 0; transform: scale(0.94) translateY(-4px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .tpCtxMenu { animation: none; }
}
.tpCtxOverlay { animation: tpCtxFade 100ms ease-out; }
@keyframes tpCtxFade { from { opacity: 0; } to { opacity: 1; } }

.tpDraftText { color: var(--text-muted); font-weight: 400; }
.tpDraftLabel { color: var(--danger, #ef4444); font-weight: 900; }
</style>
