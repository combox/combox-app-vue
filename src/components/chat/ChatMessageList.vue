<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import EmojiPicker from './EmojiPicker.vue'
import MessageContextMenu from './MessageContextMenu.vue'
import MessageBubble from './MessageBubble.vue'
import type { ViewMessage } from './chatTypes'
import type { MessageStatus } from './chatWorkspace.types'

const CHAT_SCROLL_STORAGE_KEY = 'combox.chat.scroll.v1'

const emit = defineEmits<{
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
  react: [payload: { messageID: string; emoji: string }]
  openContextMenu: [payload: { x: number; y: number; message: ViewMessage }]
  closeContextMenu: []
  copyContextMessage: []
  replyContextMessage: []
  deleteContextMessage: []
  openContextReactionPicker: []
  closeContextReactionPicker: []
  selectReactionFromPicker: [emoji: string]
  markRead: [payload: { chatID: string; messageIDs: string[] }]
  nearBottom: [value: boolean]
  openUserInfo: [userID: string]
}>()

const { t } = useI18n()
const props = defineProps<{
  loading: boolean
  errorText: string
  messages: ViewMessage[]
  selectedChatID: string
  messageSearch: string
  currentUserId: string
  currentUserAvatarSrc?: string
  avatarByUserId?: Record<string, string>
  senderNameByUserId?: Record<string, string>
  senderRoleByUserId?: Record<string, string>
  showSenderMeta?: boolean
  contextMenu: { x: number; y: number; message: ViewMessage } | null
  contextReactionAnchor: { x: number; y: number; messageId: string } | null
  mediaOverlayOpen: boolean
  deliveryStatusByMessage: Record<string, MessageStatus>
}>()

const containerRef = ref<HTMLElement | null>(null)
const isNearBottom = ref(true)
const newMessagesBelowCount = ref(0)
const lastMessageCount = ref(0)
const pendingRestoreChatID = ref(props.selectedChatID)
const scrollIndexByChat = ref(readSavedChatScroll())
let scrollPersistTimer: number | null = null

function readSavedChatScroll(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(CHAT_SCROLL_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const [chatID, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[chatID] = Math.floor(value)
    }
    return out
  } catch {
    return {}
  }
}

function persistScrollPosition(chatID: string, scrollTop: number) {
  if (!chatID || !Number.isFinite(scrollTop) || scrollTop < 0) return
  scrollIndexByChat.value = { ...scrollIndexByChat.value, [chatID]: Math.floor(scrollTop) }
  if (scrollPersistTimer) window.clearTimeout(scrollPersistTimer)
  scrollPersistTimer = window.setTimeout(() => {
    window.localStorage.setItem(CHAT_SCROLL_STORAGE_KEY, JSON.stringify(scrollIndexByChat.value))
    scrollPersistTimer = null
  }, 180)
}

function flushScrollStorageNow() {
  if (scrollPersistTimer) {
    window.clearTimeout(scrollPersistTimer)
    scrollPersistTimer = null
  }
  window.localStorage.setItem(CHAT_SCROLL_STORAGE_KEY, JSON.stringify(scrollIndexByChat.value))
}

function updateNearBottom(container: HTMLElement) {
  const remaining = Math.max(0, container.scrollHeight - (container.scrollTop + container.clientHeight))
  isNearBottom.value = remaining <= 120
  if (isNearBottom.value) newMessagesBelowCount.value = 0
}

function scrollToBottom(force = false) {
  const container = containerRef.value
  if (!container) return
  const target = container.scrollHeight
  const distance = Math.abs(container.scrollTop - target)
  if (!force && distance < 24) return
  container.scrollTo({ top: target, behavior: force ? 'smooth' : 'auto' })
  isNearBottom.value = true
  newMessagesBelowCount.value = 0
}

function emitMarkRead() {
  if (!props.selectedChatID || !isNearBottom.value) return
  const ids = props.messages
    .filter((message) => message.raw.user_id && message.raw.user_id !== props.currentUserId)
    .map((message) => message.raw.id)
    .filter(Boolean)
  if (ids.length > 0) emit('markRead', { chatID: props.selectedChatID, messageIDs: ids })
}

function onScroll(event: Event) {
  const container = event.currentTarget as HTMLElement
  updateNearBottom(container)
  emit('nearBottom', isNearBottom.value)
  if (props.selectedChatID && !props.messageSearch) persistScrollPosition(props.selectedChatID, container.scrollTop)
}

function shouldShowSenderHeader(index: number): boolean {
  if (!props.showSenderMeta) return false
  const current = props.messages[index]
  if (!current) return false
  const currentUserID = (current.raw.user_id || '').trim()
  if (!currentUserID || currentUserID === props.currentUserId) return false
  if (index === 0) return true
  const prev = props.messages[index - 1]
  if (!prev) return true
  return (prev.raw.user_id || '').trim() !== currentUserID
}

function shouldShowAvatar(index: number): boolean {
  if (!props.showSenderMeta) return false
  const current = props.messages[index]
  if (!current) return false
  const currentUserID = (current.raw.user_id || '').trim()
  if (!currentUserID) return false
  if (index === props.messages.length - 1) return true
  const next = props.messages[index + 1]
  if (!next) return true
  return (next.raw.user_id || '').trim() !== currentUserID
}

watch(
  () => props.selectedChatID,
  (chatID, prevChatID) => {
    const container = containerRef.value
    if (container && prevChatID && !props.messageSearch) {
      persistScrollPosition(prevChatID, container.scrollTop)
      flushScrollStorageNow()
    }
    pendingRestoreChatID.value = chatID
    newMessagesBelowCount.value = 0
    lastMessageCount.value = 0
  },
)

const handleBeforeUnload = () => {
  const container = containerRef.value
  if (container && props.selectedChatID && !props.messageSearch) {
    persistScrollPosition(props.selectedChatID, container.scrollTop)
  }
  flushScrollStorageNow()
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  const container = containerRef.value
  if (container && props.selectedChatID && !props.messageSearch) {
    persistScrollPosition(props.selectedChatID, container.scrollTop)
  }
  flushScrollStorageNow()
})

watch(
  () => [props.selectedChatID, props.messages.length, props.messageSearch] as const,
  async () => {
    if (!props.selectedChatID || !props.messages.length || props.messageSearch) return
    if (pendingRestoreChatID.value !== props.selectedChatID) return
    await nextTick()
    const container = containerRef.value
    if (!container) return
    const saved = scrollIndexByChat.value[props.selectedChatID]
    pendingRestoreChatID.value = ''
    container.scrollTop = typeof saved === 'number' ? saved : container.scrollHeight
    updateNearBottom(container)
    emit('nearBottom', isNearBottom.value)
    emitMarkRead()
  },
  { immediate: true },
)

watch(
  () => props.messages.length,
  async (count, prev) => {
    const wasNearBeforeUpdate = isNearBottom.value
    lastMessageCount.value = prev || 0
    await nextTick()
    const container = containerRef.value
    if (!container) return
    if (count <= (prev || 0)) {
      updateNearBottom(container)
      emit('nearBottom', isNearBottom.value)
      emitMarkRead()
      return
    }
    const remaining = Math.max(0, container.scrollHeight - (container.scrollTop + container.clientHeight))
    const added = count - (prev || 0)
    if (wasNearBeforeUpdate || remaining < 120 || !prev || props.messageSearch) {
      scrollToBottom(false)
    } else {
      newMessagesBelowCount.value += added
    }
    emit('nearBottom', isNearBottom.value)
    emitMarkRead()
  },
)

watch(
  () => isNearBottom.value,
  () => {
    emit('nearBottom', isNearBottom.value)
    emitMarkRead()
  },
)
</script>

<template>
  <div class="messageListWrap">
    <section ref="containerRef" class="messageList" @scroll="onScroll">
      <v-alert v-if="errorText" type="error" density="compact" variant="tonal" class="ma-3">{{ errorText }}</v-alert>

    <div v-if="loading && messages.length === 0" class="skeletonWrap">
      <v-skeleton-loader
        v-for="idx in 8"
        :key="idx"
        type="list-item-two-line"
        class="mb-2"
        :style="{ maxWidth: idx % 2 === 0 ? '68%' : '52%', marginLeft: idx % 2 === 0 ? '0' : 'auto' }"
      />
    </div>

    <template v-else-if="messages.length === 0">
      <div class="emptyState">
        <div class="emptyTitle">{{ selectedChatID ? t('chat.no_messages') : t('chat.select_chat') }}</div>
        <div class="emptySubtitle">{{ selectedChatID ? '' : t('chat.no_messages') }}</div>
      </div>
    </template>

    <div v-else class="messageStack">
      <div v-for="(message, index) in messages" :key="message.raw.id" class="messageItem">
        <MessageBubble
          :message="message"
          :mine="message.raw.user_id === currentUserId"
          :current-user-id="currentUserId"
          :delivery-status="deliveryStatusByMessage[message.raw.id]?.status"
          :media-overlay-open="mediaOverlayOpen"
          :current-user-avatar-src="currentUserAvatarSrc"
          :avatar-by-user-id="avatarByUserId"
          :sender-name-by-user-id="senderNameByUserId"
          :sender-role-by-user-id="senderRoleByUserId"
          :show-sender-meta="shouldShowSenderHeader(index)"
          :show-sender-avatar="shouldShowAvatar(index)"
          :reserve-avatar-space="Boolean(showSenderMeta && message.raw.user_id)"
          @open-image="$emit('openImage', $event)"
          @open-video="$emit('openVideo', $event)"
          @open-user-info="$emit('openUserInfo', $event)"
          @react="$emit('react', $event)"
          @open-context-menu="$emit('openContextMenu', $event)"
        />
      </div>
    </div>
    </section>

    <button v-if="messages.length > 0" type="button" class="scrollBtn" :class="{ visible: !isNearBottom }" @click="scrollToBottom(true)">
      <v-icon icon="mdi-chevron-down" size="28" />
      <span v-if="newMessagesBelowCount > 0" class="scrollBadge">{{ newMessagesBelowCount > 99 ? '99+' : newMessagesBelowCount }}</span>
    </button>
  </div>

  <MessageContextMenu
    :open="Boolean(contextMenu)"
    :x="contextMenu?.x || 0"
    :y="contextMenu?.y || 0"
    :show-delete="contextMenu?.message.raw.user_id === currentUserId"
    @close="$emit('closeContextMenu')"
    @copy="$emit('copyContextMessage')"
    @reply="$emit('replyContextMessage')"
    @delete="$emit('deleteContextMessage')"
    @react="
      (emoji) => {
        $emit('react', { messageID: contextMenu?.message.raw.id || '', emoji })
        $emit('closeContextMenu')
      }
    "
    @open-picker="$emit('openContextReactionPicker')"
  />

  <Teleport to="body">
    <div
      v-if="contextReactionAnchor"
      class="reactionPickerPopover"
      :style="{ left: `${contextReactionAnchor.x}px`, top: `${contextReactionAnchor.y}px` }"
      @click.stop
    >
      <EmojiPicker
        :open="Boolean(contextReactionAnchor)"
        @select="
          (emoji) => {
            $emit('selectReactionFromPicker', emoji)
            $emit('closeContextReactionPicker')
          }
        "
      />
    </div>
    <div v-if="contextReactionAnchor" class="reactionPickerOverlay" @click="$emit('closeContextReactionPicker')" />
  </Teleport>
</template>

<style scoped>
.messageListWrap {
  position: relative;
  height: 100%;
  min-height: 0;
}

.messageList {
  position: relative;
  height: 100%;
  overflow: auto;
  min-height: 0;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.16) transparent;
}

.messageList::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.messageList::-webkit-scrollbar-track {
  background: transparent;
}

.messageList::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.14);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.messageList::-webkit-scrollbar-thumb:hover {
  background: rgba(15, 23, 42, 0.24);
  border: 2px solid transparent;
  background-clip: padding-box;
}

.skeletonWrap,
.messageStack,
.emptyState {
  width: 100%;
}

.skeletonWrap {
  padding: 6px 12px 96px;
}

.messageStack {
  padding: 10px 16px 96px;
  display: grid;
  gap: 10px;
  align-content: start;
}

.emptyState {
  padding: 32px 16px 96px;
  display: grid;
  place-items: center;
  text-align: center;
}

.emptyTitle {
  font-size: 22px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.88);
}

.emptySubtitle {
  margin-top: 6px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.55);
}

.scrollBtn {
  position: absolute;
  right: 24px;
  bottom: 22px;
  z-index: 4;
  width: 48px;
  height: 48px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  display: grid;
  place-items: center;
  opacity: 0;
  transform: translate3d(0, 10px, 0);
  pointer-events: none;
  transition: opacity 140ms ease, transform 140ms ease;
}

.scrollBtn.visible {
  opacity: 1;
  transform: translate3d(0, 0, 0);
  pointer-events: auto;
}

.scrollBadge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  border-radius: 10px;
  padding: 0 6px;
  background: #1976d2;
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  display: grid;
  place-items: center;
  line-height: 1;
}

.reactionPickerOverlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

.reactionPickerPopover {
  position: fixed;
  z-index: 10001;
  margin-top: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.14);
}

</style>
