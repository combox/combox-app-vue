<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import MessageContextMenu from './MessageContextMenu.vue'
import MessageBubble from './MessageBubble.vue'
import ReactionEmojiPicker from './ReactionEmojiPicker.vue'
import type { ViewMessage } from './chatTypes'
import type { MessageStatus } from './chatWorkspace.types'
import { getSharedMediaLazyQueue } from './mediaLazyQueue'

const CHAT_SCROLL_STORAGE_KEY = 'combox.chat.scroll.v1'

const emit = defineEmits<{
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
  react: [payload: { messageID: string; emoji: string }]
  openContextMenu: [payload: { x: number; y: number; message: ViewMessage }]
  closeContextMenu: []
  copyContextMessage: []
  replyContextMessage: []
  forwardContextMessage: []
  editContextMessage: []
  deleteContextMessage: []
  openContextReactionPicker: []
  closeContextReactionPicker: []
  selectReactionFromPicker: [emoji: string]
  markRead: [payload: { chatID: string; messageIDs: string[] }]
  nearBottom: [value: boolean]
  openUserInfo: [userID: string]
  openUsername: [username: string]
  replyToMessage: [message: ViewMessage]
  openDiscussion: [message: ViewMessage]
  forwardSelectedMessages: [messages: ViewMessage[]]
}>()

const { t } = useI18n()
const props = defineProps<{
  loading: boolean
  errorText: string
  messages: ViewMessage[]
  selectedChatID: string
  isPublicChannel?: boolean
  discussionMode?: boolean
  commentsEnabled?: boolean
  canComment?: boolean
  canReact?: boolean
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
  canEditContextMessage?: boolean
  canDeleteContextMessage?: boolean
}>()

type MessageThread = {
  post: ViewMessage
  comments: ViewMessage[]
}

const containerRef = ref<HTMLElement | null>(null)
const isNearBottom = ref(true)
const newMessagesBelowCount = ref(0)
const lastMessageCount = ref(0)
const highlightedMessageId = ref('')
let highlightTimer: number | null = null
const pendingRestoreChatID = ref(props.selectedChatID)
const reactionPickerRef = ref<HTMLElement | null>(null)
const reactionPickerX = ref(0)
const reactionPickerY = ref(0)
const scrollIndexByChat = ref(readSavedChatScroll())
let scrollPersistTimer: number | null = null

const mediaQueue = getSharedMediaLazyQueue()
let scrollUnlockTimer: number | null = null
let scrollRafPending = false
let lastScrollContainer: HTMLElement | null = null

const selectionMode = ref(false)
const selectedMessageIds = ref<Set<string>>(new Set())

const selectedMessages = computed(() => {
  const ids = selectedMessageIds.value
  if (!selectionMode.value || ids.size === 0) return []
  return props.messages.filter((m) => ids.has(String(m.raw.id || '').trim()))
})

function clearSelection() {
  selectionMode.value = false
  selectedMessageIds.value = new Set()
}

function toggleSelectMessage(message: ViewMessage) {
  const id = String(message.raw.id || '').trim()
  if (!id) return
  if (!selectionMode.value) selectionMode.value = true
  const next = new Set(selectedMessageIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedMessageIds.value = next
  if (selectedMessageIds.value.size === 0) selectionMode.value = false
}

function forwardSelection() {
  const list = selectedMessages.value
  if (list.length === 0) return
  emit('forwardSelectedMessages', list)
  clearSelection()
}

function lockMediaDuringScroll() {
  mediaQueue.lock()
  if (scrollUnlockTimer) window.clearTimeout(scrollUnlockTimer)
  scrollUnlockTimer = window.setTimeout(() => {
    scrollUnlockTimer = null
    mediaQueue.unlock()
  }, 120)
}

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
  const unread = props.messages
    .filter((message) => message.raw.user_id && message.raw.user_id !== props.currentUserId)
    .map((message) => ({ id: String(message.raw.id || '').trim(), chatID: String(message.raw.chat_id || '').trim() }))
    .filter((item) => item.id)

  if (unread.length === 0) return

  if (props.discussionMode) {
    const byChat = new Map<string, string[]>()
    for (const item of unread) {
      const chatID = item.chatID || props.selectedChatID
      const list = byChat.get(chatID) ?? []
      list.push(item.id)
      byChat.set(chatID, list)
    }
    for (const [chatID, ids] of byChat.entries()) {
      if (ids.length > 0) emit('markRead', { chatID, messageIDs: ids })
    }
    return
  }

  const ids = unread.map((item) => item.id)
  if (ids.length > 0) emit('markRead', { chatID: props.selectedChatID, messageIDs: ids })
}

function onScroll(event: Event) {
  lastScrollContainer = event.currentTarget as HTMLElement
  if (scrollRafPending) return
  scrollRafPending = true

  window.requestAnimationFrame(() => {
    scrollRafPending = false
    const container = lastScrollContainer
    if (!container) return

    lockMediaDuringScroll()
    updateNearBottom(container)
    emit('nearBottom', isNearBottom.value)
    if (props.selectedChatID && !props.messageSearch) persistScrollPosition(props.selectedChatID, container.scrollTop)
  })
}

function safeCssEscape(value: string): string {
  const v = (value || '').trim()
  if (!v) return ''
  // Prefer native CSS.escape when available.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const esc = (globalThis as any)?.CSS?.escape
  if (typeof esc === 'function') return esc(v)
  return v.replace(/["\\]/g, '\\$&')
}

async function jumpToMessage(messageIdRaw: string) {
  const messageId = (messageIdRaw || '').trim()
  if (!messageId) return
  await nextTick()
  const container = containerRef.value
  if (!container) return
  const selector = `[data-message-id="${safeCssEscape(messageId)}"]`
  const el = container.querySelector<HTMLElement>(selector)
  if (!el) return

  if (highlightTimer) window.clearTimeout(highlightTimer)
  highlightedMessageId.value = messageId
  highlightTimer = window.setTimeout(() => {
    highlightedMessageId.value = ''
    highlightTimer = null
  }, 1600)

  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

function timeText(value: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(new Date(parsed))
}

async function syncReactionPickerPosition() {
  if (!props.contextReactionAnchor) return
  await nextTick()
  const picker = reactionPickerRef.value
  if (!picker) {
    reactionPickerX.value = props.contextReactionAnchor.x
    reactionPickerY.value = props.contextReactionAnchor.y
    return
  }
  const margin = 8
  const rect = picker.getBoundingClientRect()
  const maxX = Math.max(margin, window.innerWidth - rect.width - margin)
  const maxY = Math.max(margin, window.innerHeight - rect.height - margin)
  reactionPickerX.value = Math.min(Math.max(props.contextReactionAnchor.x, margin), maxX)
  reactionPickerY.value = Math.min(Math.max(props.contextReactionAnchor.y, margin), maxY)
}

const threadedMessages = computed<MessageThread[]>(() => {
  if (props.discussionMode) {
    const [root, ...comments] = props.messages
    if (!root) return []
    return [{ post: root, comments }]
  }
  if (!props.isPublicChannel) {
    return props.messages.map((message) => ({ post: message, comments: [] }))
  }
  const byParent = new Map<string, ViewMessage[]>()
  const topLevel: ViewMessage[] = []
  const orphanReplies: ViewMessage[] = []
  const topLevelIds = new Set<string>()

  for (const message of props.messages) {
    const parentId = (message.raw.reply_to_message_id || '').trim()
    if (!parentId) {
      topLevel.push(message)
      topLevelIds.add(message.raw.id)
      continue
    }
    const bucket = byParent.get(parentId)
    if (bucket) bucket.push(message)
    else byParent.set(parentId, [message])
  }

  for (const [parentId, items] of byParent.entries()) {
    if (!topLevelIds.has(parentId)) orphanReplies.push(...items)
  }

  const threaded = topLevel.map((post) => ({
    post,
    comments: (byParent.get(post.raw.id) || []).slice().sort((a, b) => Date.parse(a.raw.created_at) - Date.parse(b.raw.created_at)),
  }))

  for (const orphan of orphanReplies.sort((a, b) => Date.parse(a.raw.created_at) - Date.parse(b.raw.created_at))) {
    threaded.push({ post: orphan, comments: [] })
  }

  return threaded
})

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

const handlePageHide = () => {
  const container = containerRef.value
  if (container && props.selectedChatID && !props.messageSearch) {
    persistScrollPosition(props.selectedChatID, container.scrollTop)
  }
  flushScrollStorageNow()
}

onMounted(() => {
  // `beforeunload` disables BFCache. Use `pagehide` instead.
  window.addEventListener('pagehide', handlePageHide)
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', handlePageHide)
  const container = containerRef.value
  if (container && props.selectedChatID && !props.messageSearch) {
    persistScrollPosition(props.selectedChatID, container.scrollTop)
  }
  flushScrollStorageNow()
  if (highlightTimer) window.clearTimeout(highlightTimer)
  highlightTimer = null
  highlightedMessageId.value = ''
  if (scrollUnlockTimer) window.clearTimeout(scrollUnlockTimer)
  scrollUnlockTimer = null
  mediaQueue.unlock()
  lastScrollContainer = null
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

watch(
  () => props.contextReactionAnchor,
  () => {
    void syncReactionPickerPosition()
  },
  { deep: true },
)
</script>

<template>
  <div class="messageListWrap">
    <div v-if="selectionMode" class="selBar" @click.stop>
      <div class="selCount">{{ selectedMessageIds.size }} {{ t('chat.selected', undefined, 'selected') }}</div>
      <div class="selActions">
        <button type="button" class="selBtn" @click="forwardSelection">
          <v-icon icon="mdi-forward" size="18" />
          <span>{{ t('chat.forward', undefined, 'Forward') }}</span>
        </button>
        <button type="button" class="selBtn muted" @click="clearSelection">
          <v-icon icon="mdi-close" size="18" />
          <span>{{ t('common.cancel', undefined, 'Cancel') }}</span>
        </button>
      </div>
    </div>

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

    <div v-else-if="discussionMode && threadedMessages.length > 0" class="discussionStack">
      <div class="discussionRootWrap">
        <div class="discussionDateChip">{{ timeText(threadedMessages[0].post.raw.created_at) }}</div>
        <div class="discussionRootCard">
          <MessageBubble
            :message="threadedMessages[0].post"
            :mine="false"
            :current-user-id="currentUserId"
            :delivery-status="deliveryStatusByMessage[threadedMessages[0].post.raw.id]?.status"
            :media-overlay-open="mediaOverlayOpen"
            :current-user-avatar-src="currentUserAvatarSrc"
            :avatar-by-user-id="avatarByUserId"
            :sender-name-by-user-id="senderNameByUserId"
            :sender-role-by-user-id="senderRoleByUserId"
            :show-sender-meta="true"
            :show-sender-avatar="false"
            :reserve-avatar-space="false"
            :is-public-channel="false"
            :comments-enabled="false"
            :can-comment="false"
            :can-react="canReact"
            :is-top-level-post="false"
            :comment-count="0"
            @open-image="$emit('openImage', $event)"
            @open-video="$emit('openVideo', $event)"
            @open-user-info="$emit('openUserInfo', $event)"
            @open-username="$emit('openUsername', $event)"
            @reply-to-message="$emit('replyToMessage', $event)"
            @open-discussion="$emit('openDiscussion', $event)"
            @react="$emit('react', $event)"
            @open-context-menu="$emit('openContextMenu', $event)"
          />
        </div>
        <div class="discussionStarted">{{ t('chat.discussion_started', undefined, 'Discussion started') }}</div>
      </div>

      <div v-if="threadedMessages[0].comments.length > 0" class="discussionComments">
        <div
          v-for="comment in threadedMessages[0].comments"
          :key="comment.raw.id"
          class="discussionCommentItem"
        >
          <MessageBubble
            :message="comment"
            :mine="comment.raw.user_id === currentUserId"
            :current-user-id="currentUserId"
            :delivery-status="deliveryStatusByMessage[comment.raw.id]?.status"
            :media-overlay-open="mediaOverlayOpen"
            :current-user-avatar-src="currentUserAvatarSrc"
            :avatar-by-user-id="avatarByUserId"
            :sender-name-by-user-id="senderNameByUserId"
            :sender-role-by-user-id="senderRoleByUserId"
            :show-sender-meta="true"
            :show-sender-avatar="true"
            :reserve-avatar-space="true"
            :is-public-channel="false"
            :comments-enabled="false"
            :can-comment="false"
            :can-react="canReact"
            :is-top-level-post="false"
            :comment-count="0"
            @open-image="$emit('openImage', $event)"
            @open-video="$emit('openVideo', $event)"
            @open-user-info="$emit('openUserInfo', $event)"
            @open-username="$emit('openUsername', $event)"
            @reply-to-message="$emit('replyToMessage', $event)"
            @open-discussion="$emit('openDiscussion', $event)"
            @react="$emit('react', $event)"
            @open-context-menu="$emit('openContextMenu', $event)"
          />
        </div>
      </div>
      <div v-else class="discussionEmpty">{{ t('chat.no_comments_yet', undefined, 'No comments here yet...') }}</div>
    </div>

    <div v-else class="messageStack">
      <div
        v-for="(thread, index) in threadedMessages"
        :key="thread.post.raw.id"
        class="messageItem"
        :data-message-id="thread.post.raw.id"
        :class="{
          postThread: Boolean(isPublicChannel) && !(thread.post.raw.reply_to_message_id || '').trim(),
          highlight: highlightedMessageId === thread.post.raw.id,
        }"
      >
        <MessageBubble
          :message="thread.post"
          :mine="thread.post.raw.user_id === currentUserId"
          :current-user-id="currentUserId"
          :delivery-status="deliveryStatusByMessage[thread.post.raw.id]?.status"
          :media-overlay-open="mediaOverlayOpen"
          :current-user-avatar-src="currentUserAvatarSrc"
          :avatar-by-user-id="avatarByUserId"
          :sender-name-by-user-id="senderNameByUserId"
          :sender-role-by-user-id="senderRoleByUserId"
          :show-sender-meta="shouldShowSenderHeader(index)"
          :show-sender-avatar="shouldShowAvatar(index)"
          :reserve-avatar-space="Boolean(showSenderMeta && thread.post.raw.user_id)"
          :is-public-channel="Boolean(isPublicChannel)"
          :comments-enabled="Boolean(commentsEnabled)"
          :can-comment="Boolean(canComment)"
          :can-react="canReact"
          :is-top-level-post="Boolean(isPublicChannel) && !(thread.post.raw.reply_to_message_id || '').trim()"
          :comment-count="thread.comments.length"
          :selection-mode="selectionMode"
          :selected="selectedMessageIds.has(String(thread.post.raw.id || '').trim())"
          @open-image="$emit('openImage', $event)"
          @open-video="$emit('openVideo', $event)"
          @open-user-info="$emit('openUserInfo', $event)"
          @open-username="$emit('openUsername', $event)"
          @reply-to-message="$emit('replyToMessage', $event)"
          @open-discussion="$emit('openDiscussion', $event)"
          @react="$emit('react', $event)"
          @open-context-menu="$emit('openContextMenu', $event)"
          @toggle-select="toggleSelectMessage"
          @jump-to-message="jumpToMessage"
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
    :show-delete="canDeleteContextMessage"
    :show-edit="canEditContextMessage"
    :show-react="canReact"
    :views-count="(() => {
      const raw = (contextMenu?.message?.raw || {}) as any
      const candidates = [raw?.views_count, raw?.view_count, raw?.views, raw?.seen_count, raw?.seen]
      for (const value of candidates) {
        const n = typeof value === 'number' ? value : Number(String(value || '').trim())
        if (Number.isFinite(n) && n > 0) return n
      }
      return 0
    })()"
    @close="$emit('closeContextMenu')"
    @copy="$emit('copyContextMessage')"
    @reply="$emit('replyContextMessage')"
    @forward="$emit('forwardContextMessage')"
    @edit="$emit('editContextMessage')"
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
      ref="reactionPickerRef"
      class="reactionPickerPopover"
      :style="{ left: `${reactionPickerX}px`, top: `${reactionPickerY}px` }"
      @click.stop
    >
      <ReactionEmojiPicker
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

.selBar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.selCount {
  font-weight: 800;
  color: var(--text);
  font-size: 13px;
}

.selActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.selBtn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text);
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
}

.selBtn:hover {
  background: rgba(255, 255, 255, 0.06);
}

.selBtn.muted {
  background: transparent;
  color: var(--text-muted);
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

.messageItem {
  content-visibility: auto;
  contain-intrinsic-size: 220px;
  contain: layout paint style;
  transform: translateZ(0);
}

.messageItem.highlight {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
  border-radius: 14px;
  animation: highlightPulse 1600ms ease-out;
}

@keyframes highlightPulse {
  0% { outline-color: rgba(0, 0, 0, 0); }
  20% { outline-color: var(--accent); }
  100% { outline-color: rgba(0, 0, 0, 0); }
}

.discussionStack {
  padding: 18px 18px 96px;
  display: grid;
  gap: 16px;
  align-content: start;
}

.discussionRootWrap {
  display: grid;
  justify-items: start;
  gap: 10px;
}

.discussionDateChip,
.discussionStarted {
  justify-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 12px;
  font-weight: 700;
}

.discussionRootCard {
  max-width: min(560px, 100%);
}

.discussionComments {
  display: grid;
  gap: 10px;
}

.discussionCommentItem {
  display: grid;
  align-content: start;
}

.discussionEmpty {
  justify-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  font-size: 12px;
  font-weight: 700;
}

.postThread {
  display: grid;
  gap: 0;
}

.commentThread {
  margin-top: 8px;
  margin-left: 18px;
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 10px;
}

.commentThreadLine {
  width: 2px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.18);
  justify-self: center;
}

.commentThreadItems {
  display: grid;
  gap: 8px;
}

.commentThreadHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 2px;
}

.commentThreadCount {
  font-size: 12px;
  font-weight: 700;
  color: rgba(15, 23, 42, 0.6);
}

.commentThreadToggle {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
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
  color: var(--text);
}

.emptySubtitle {
  margin-top: 6px;
  font-size: 14px;
  color: var(--text-muted);
}

.scrollBtn {
  position: absolute;
  right: 24px;
  bottom: calc(22px + env(safe-area-inset-bottom, 0px) + 72px);
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
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

</style>
