<script setup lang="ts">
import { type ChatItem } from 'combox-api'
import { computed } from 'vue'
import type { GroupChannelItem } from './chatSidebar.types'
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

function formatTopicPreview(raw: string): string {
  return (raw || '').trim() || t('chat.no_messages')
}

const visibleChannels = computed(() => {
  return props.groupChannels
})
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
          <button type="button" class="tpIconBtn" :aria-label="t('chat.search')" :title="t('chat.search')">
            <v-icon icon="mdi-magnify" size="18" />
          </button>
        </div>
      </header>

      <div class="tpSearchWrap">
        <v-icon icon="mdi-magnify" size="18" class="tpSearchIcon" />
        <input
          class="tpSearchInput"
          :value="search"
          :placeholder="t('chat.search')"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
        <button
          v-if="search"
          type="button"
          class="tpSearchClear"
          :aria-label="t('chat.clear')"
          @click="emit('update:search', '')"
        >
          <v-icon icon="mdi-close" size="16" />
        </button>
      </div>

      <section class="tpList">
        <p v-if="loadingGroupChannels" class="tpPlaceholder">{{ t('chat.loading_topics') }}</p>
        <button
          v-for="channel in visibleChannels"
          :key="channel.id"
          type="button"
          class="tpRow"
          :class="{ selected: selectedGroupChannelID === channel.id }"
          @click="emit('select-channel', channel.id)"
        >
          <div class="tpTopLine">
            <span class="tpName"># {{ channel.title }}</span>
            <span v-if="formatTopicMeta(channel.createdAt)" class="tpMeta">
              {{ formatTopicMeta(channel.createdAt) }}
            </span>
          </div>
          <div class="tpBottomLine">
            <span class="tpPreview">{{ formatTopicPreview(channel.lastPreview || '') }}</span>
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
  </aside>
</template>

<style scoped>
.tpPanel { position:relative; display:grid; grid-template-rows:auto auto minmax(0,1fr); min-width:0; height:100%; background:#f3f3f3; color:#0f172a; }
.tpHeader { display:flex; align-items:center; gap:12px; padding:10px 14px 8px; border-bottom:1px solid rgba(0,0,0,.08); background:#f3f3f3; }
.tpHeadText { min-width:0; flex:1 1 auto; }
.tpTitle { margin:0; font-size:16px; font-weight:600; line-height:1.2; letter-spacing:-0.02em; }
.tpSubtitle { margin:3px 0 0; color:#7b8794; font-size:12px; }
.tpActions { display:flex; align-items:center; gap:2px; }
.tpIconBtn { width:30px; height:30px; border:0; border-radius:10px; background:transparent; color:rgba(0,0,0,.72); display:grid; place-items:center; cursor:pointer; }
.tpIconBtn:hover { background:rgba(0,0,0,.06); }
.tpSearchWrap { margin:10px 14px 0; height:42px; border-radius:22px; background:#e7e9ee; display:flex; align-items:center; gap:10px; padding:0 14px; }
.tpSearchIcon,.tpSearchClear { color:rgba(0,0,0,.5); }
.tpSearchClear { width:24px; height:24px; border:0; background:transparent; display:grid; place-items:center; cursor:pointer; }
.tpSearchInput { width:100%; border:0; outline:0; background:transparent; color:#111827; font-size:15px; }
.tpList { overflow:auto; padding:8px 10px 12px; min-height:0; scrollbar-width:none; -ms-overflow-style:none; }
.tpList::-webkit-scrollbar { width:0; height:0; display:none; }
.tpPlaceholder { margin:8px 6px; color:#8994a8; font-size:12px; }
.tpRow { width:100%; margin:0 0 6px; padding:11px 12px; border:0; border-radius:14px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.tpRow:hover { background:#eceef3; }
.tpRow.selected { background:#dde3f3; box-shadow:inset 0 0 0 1px rgba(146, 159, 190, 0.32); }
.tpTopLine,.tpBottomLine { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.tpBottomLine { margin-top:4px; }
.tpName { min-width:0; font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tpMeta { flex:none; color:#7f8ca1; font-size:12px; }
.tpPreview { min-width:0; color:#7f8ca1; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tpUnread { flex:none; min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:#1976d2; color:#fff; font-size:11px; font-weight:700; line-height:18px; text-align:center; }
.tpCreateBackdrop { position:absolute; inset:0; display:flex; justify-content:flex-end; background:rgba(0,0,0,.18); }
.tpCreateSheet { width:min(100%,320px); padding:16px 14px; border-left:1px solid rgba(0,0,0,.12); background:#fff; }
.tpCreateHeader { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.tpCreateTitle { margin:0; font-size:24px; font-weight:700; }
.tpCreateHint { margin:10px 0 14px; color:#6b7280; font-size:12px; }
.tpFieldLabel { display:block; margin-bottom:8px; color:#334155; font-size:12px; }
.tpCreateInput { width:100%; height:46px; padding:0 12px; border-radius:12px; border:1px solid #d4d9e4; background:#fff; color:#111827; }
.tpTypeRow { display:flex; gap:8px; margin-top:14px; }
.tpTypeChip { height:38px; padding:0 14px; border:1px solid #d4d9e4; border-radius:999px; background:#fff; color:#334155; font-weight:700; cursor:pointer; }
.tpTypeChip.active { border-color:#8a76ff; background:rgba(124,104,255,.12); color:#3125cf; }
.tpCreateError { margin:8px 0 0; color:#dc2626; font-size:12px; }
.tpCreateActions { display:grid; gap:10px; margin-top:16px; }
.tpPrimaryButton,.tpSecondaryButton { height:42px; border-radius:12px; font-weight:700; cursor:pointer; }
.tpPrimaryButton { border:none; background:#4a8cff; color:#fff; }
.tpSecondaryButton { border:1px solid #d4d9e4; background:#fff; color:#334155; }
</style>
