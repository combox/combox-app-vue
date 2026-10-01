<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import MessageContextMenu from './MessageContextMenu.vue'
import MessageBubble from './MessageBubble.vue'
import ReactionEmojiPicker from './ReactionEmojiPicker.vue'
import type { ViewMessage } from './chatTypes'
import type { MessageStatus } from './chatWorkspace.types'
import type { ChatCallItem } from 'combox-api'
import { deleteChatCall } from 'combox-api'
import { useToast } from '../../composables/useToast'
import { registerChatListActions, unregisterChatListActions } from '../../utils/chatListActions'
import { CHAT_LIST_ACTIONS } from './chatWorkspace.actions.list'
import { getSharedMediaLazyQueue } from './mediaLazyQueue'

const CHAT_SCROLL_STORAGE_KEY = 'combox.chat.scroll.v1'

const emit = defineEmits<{
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
  react: [payload: { messageID: string; emoji: string }]
  openContextMenu: [payload: { x: number; y: number; message: ViewMessage }]
  closeContextMenu: []
  openReactionPicker: [payload: { x: number; y: number; messageId: string }]
  copyContextMessage: [text?: string]
  unpinPinnedMessage: []
  replyContextMessage: []
  forwardContextMessage: []
  editContextMessage: []
  deleteContextMessage: []
  saveContextMessage: []
  pinContextMessage: []
  copyLinkContextMessage: []
  reportContextMessage: []
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

const { t, locale } = useI18n()
const props = defineProps<{
  loading: boolean
  errorText: string
  messages: ViewMessage[]
  callRows?: ChatCallItem[]
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
  canSaveContextMessage?: boolean
  canPinContextMessage?: boolean
  pinnedContextMessage?: boolean
  pinnedMessage?: ViewMessage | null
  channelTitle?: string
}>()

type MessageThread = {
  post: ViewMessage
  comments: ViewMessage[]
}

const contextReactions = computed(() => props.contextMenu?.message?.raw.reactions || [])

const contextReactionNames = computed(() => props.senderNameByUserId || {})
const contextReactionAvatars = computed(() => props.avatarByUserId || {})

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

function selectFromContextMenu() {
  const message = props.contextMenu?.message
  emit('closeContextMenu')
  if (message) toggleSelectMessage(message)
}

function forwardSelection() {
  const list = selectedMessages.value
  if (list.length === 0) return
  emit('forwardSelectedMessages', list)
  clearSelection()
}

const toast = useToast()

const deletedCallIds = ref<Set<string>>(new Set())
const callContextMenu = ref<{ x: number; y: number; call: ChatCallItem } | null>(null)

function openCallContextMenu(event: MouseEvent, call: ChatCallItem) {
  event.preventDefault()
  emit('closeContextMenu')
  callContextMenu.value = { x: event.clientX, y: event.clientY, call }
}

function closeCallContextMenu() {
  callContextMenu.value = null
}

async function deleteCallFromMenu() {
  const target = callContextMenu.value
  callContextMenu.value = null
  if (!target) return
  const chatID = (props.selectedChatID || '').trim()
  const callID = (target.call.id || '').trim()
  if (!chatID || !callID) return

  const previous = new Set(deletedCallIds.value)
  previous.add(callID)
  deletedCallIds.value = previous

  try {
    await deleteChatCall(chatID, callID)
    toast.success(t('chat.call_deleted', undefined, 'Call history entry removed'))
  } catch (error) {
    const restored = new Set(deletedCallIds.value)
    restored.delete(callID)
    deletedCallIds.value = restored
    toast.error(error instanceof Error ? error.message : t('chat.call_delete_failed', undefined, 'Could not delete the call'))
  }
}

const pinnedBannerVisible = computed(() => {
  const pinned = props.pinnedMessage
  if (!pinned) return false
  const id = String(pinned.raw.id || '').trim()
  if (!id) return false
  return props.messages.some((message) => String(message.raw.id || '').trim() === id)
})

const pinnedPreview = computed(() => {
  const pinned = props.pinnedMessage
  if (!pinned) return ''
  const text = (pinned.text || '').trim()
  if (text) return text
  const first = pinned.attachments[0]
  if (first) return first.filename || t('chat.message', undefined, 'Message')
  return t('chat.message', undefined, 'Message')
})

const pinnedTitle = computed(() => {
  const pinned = props.pinnedMessage
  if (!pinned) return ''
  const userID = String(pinned.raw.user_id || '').trim()
  const name = userID ? ((props.senderNameByUserId || {})[userID] || '').trim() : ''
  return name || t('chat.pinned_message', undefined, 'Pinned message')
})

function unpinFromBanner() {
  if (props.canPinContextMessage === false) return
  emit('unpinPinnedMessage')
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

type FeedRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'call'; key: string; call: ChatCallItem }
  | { kind: 'thread'; key: string; threadIndex: number; thread: MessageThread }

function callTime(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function dayKeyAndLabel(value: string): { key: string; label: string } | null {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return null
  const date = new Date(parsed)
  const startOfDay = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000)
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  if (dayDiff === 0) return { key, label: t('chat.date.today', undefined, 'Today') }
  if (dayDiff === 1) return { key, label: t('chat.date.yesterday', undefined, 'Yesterday') }
  const month = new Intl.DateTimeFormat(locale.value, { month: 'long' }).format(date)
  return { key, label: `${date.getDate()} ${month} ${date.getFullYear()}` }
}

function callDurationText(secondsRaw: number): string {
  const total = Math.max(0, Math.floor(secondsRaw))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(rest).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

function isStreamCall(call: ChatCallItem): boolean {
  return (call.kind || '').trim() === 'broadcast'
}

function callRowIcon(call: ChatCallItem): string {
  if (isStreamCall(call)) return 'mdi-broadcast'
  return call.missed ? 'mdi-phone-off' : 'mdi-phone'
}

function callRowText(call: ChatCallItem): string {
  if (isStreamCall(call)) {
    const label = t('chat.stream.live', undefined, 'Live stream')
    const streamSeconds = Number(call.duration_seconds) || 0
    return streamSeconds > 0 ? `${label} · ${callDurationText(streamSeconds)}` : label
  }
  if (call.missed) return t('chat.call.missed', undefined, 'Missed call')
  const label = call.direction === 'outgoing' ? t('chat.call.outgoing', undefined, 'Outgoing call') : t('chat.call.incoming', undefined, 'Incoming call')
  const seconds = Number(call.duration_seconds) || 0
  if (seconds <= 0) return label
  return `${label} · ${callDurationText(seconds)}`
}

function callRowTime(call: ChatCallItem): string {
  const parsed = Date.parse(call.started_at)
  if (!Number.isFinite(parsed)) return ''
  return new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(new Date(parsed))
}

const feedRows = computed<FeedRow[]>(() => {
  const threads = threadedMessages.value
  const rows: FeedRow[] = []
  const usedKeys = new Set<string>()
  const uniqueKey = (base: string): string => {
    let key = base
    let suffix = 2
    while (usedKeys.has(key)) {
      key = `${base}:${suffix}`
      suffix += 1
    }
    usedKeys.add(key)
    return key
  }
  const searching = Boolean(props.messageSearch.trim())
  const calls = searching
    ? []
    : (props.callRows || [])
        .filter((call) => !deletedCallIds.value.has(String(call.id || '').trim()))
        .slice()
        .sort((a, b) => callTime(a.started_at) - callTime(b.started_at))

  let lastDayKey = ''
  const pushDay = (value: string) => {
    const info = dayKeyAndLabel(value)
    if (!info || info.key === lastDayKey) return
    lastDayKey = info.key
    rows.push({ kind: 'date', key: uniqueKey(`date:${info.key}`), label: info.label })
  }
  const pushCall = (call: ChatCallItem) => {
    pushDay(call.started_at)
    rows.push({ kind: 'call', key: uniqueKey(`call:${call.id}`), call })
  }

  let callIndex = 0
  for (let index = 0; index < threads.length; index += 1) {
    const thread = threads[index]
    const threadTime = callTime(thread.post.raw.created_at)
    while (callIndex < calls.length && callTime(calls[callIndex].started_at) <= threadTime) {
      pushCall(calls[callIndex])
      callIndex += 1
    }
    pushDay(thread.post.raw.created_at)
    rows.push({ kind: 'thread', key: uniqueKey(`thread:${thread.post.raw.id}`), threadIndex: index, thread })
  }
  while (callIndex < calls.length) {
    pushCall(calls[callIndex])
    callIndex += 1
  }
  return rows
})

const visibleCallCount = computed(
  () => (props.callRows || []).filter((call) => !deletedCallIds.value.has(String(call.id || '').trim())).length,
)

watch(
  () => props.selectedChatID,
  (chatID, prevChatID) => {
    deletedCallIds.value = new Set()
    callContextMenu.value = null
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

/**
 * Bridge for the three-dot chat menu ("To Beginning" / "Clear history").
 * The list is prop driven, so `reload` re-uses the workspace history loader
 * instead of fetching anything itself.
 */
const workspaceListActions = inject(CHAT_LIST_ACTIONS, null)

function scrollToTop() {
  const container = containerRef.value
  if (!container) return
  container.scrollTo({ top: 0, behavior: 'smooth' })
}

function reload() {
  void workspaceListActions?.reloadActiveChat()
}

onMounted(() => {
  // `beforeunload` disables BFCache. Use `pagehide` instead.
  window.addEventListener('pagehide', handlePageHide)
  registerChatListActions(workspaceListActions ? { scrollToTop, reload } : { scrollToTop })
})

onBeforeUnmount(() => {
  window.removeEventListener('pagehide', handlePageHide)
  unregisterChatListActions(workspaceListActions ? ['scrollToTop', 'reload'] : ['scrollToTop'])
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

    <div
      v-else-if="pinnedBannerVisible && pinnedMessage"
      class="pinBar"
      role="button"
      tabindex="0"
      @click="jumpToMessage(String(pinnedMessage.raw.id || ''))"
      @keydown.enter.prevent="jumpToMessage(String(pinnedMessage.raw.id || ''))"
    >
      <v-icon icon="mdi-pin" size="16" class="pinBarIcon" />
      <div class="pinBarBody">
        <div class="pinBarTitle">{{ pinnedTitle }}</div>
        <div class="pinBarPreview">{{ pinnedPreview }}</div>
      </div>
      <button
        v-if="canPinContextMessage !== false"
        type="button"
        class="pinBarAction"
        :title="t('chat.unpin', undefined, 'Unpin')"
        @click.stop="unpinFromBanner"
      >
        <v-icon icon="mdi-pin-off-outline" size="16" />
      </button>
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

    <template v-else-if="messages.length === 0 && visibleCallCount === 0">
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
            @open-reaction-picker="$emit('openReactionPicker', $event)"
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
            @open-reaction-picker="$emit('openReactionPicker', $event)"
          />
        </div>
      </div>
      <div v-else class="discussionEmpty">{{ t('chat.no_comments_yet', undefined, 'No comments here yet...') }}</div>
    </div>

    <div v-else class="messageStack">
      <template v-for="row in feedRows" :key="row.key">
        <div v-if="row.kind === 'date'" class="dateRow">
          <span class="dateChip">{{ row.label }}</span>
        </div>
        <div
          v-else-if="row.kind === 'call'"
          class="callRow"
          :class="{ stream: isStreamCall(row.call) }"
          :title="channelTitle || undefined"
          v-long-context
          @contextmenu="openCallContextMenu($event, row.call)"
        >
          <span class="callRowIcon">
            <v-icon :icon="callRowIcon(row.call)" size="16" />
          </span>
          <span class="callRowText">{{ callRowText(row.call) }}</span>
          <span class="callRowTime">{{ callRowTime(row.call) }}</span>
        </div>
        <div
          v-else
          class="messageItem"
          :data-message-id="row.thread.post.raw.id"
          :class="{
            postThread: Boolean(isPublicChannel) && !(row.thread.post.raw.reply_to_message_id || '').trim(),
            highlight: highlightedMessageId === row.thread.post.raw.id,
            selected: selectedMessageIds.has(String(row.thread.post.raw.id || '').trim()),
          }"
        >
          <MessageBubble
            :message="row.thread.post"
            :mine="row.thread.post.raw.user_id === currentUserId"
            :current-user-id="currentUserId"
            :delivery-status="deliveryStatusByMessage[row.thread.post.raw.id]?.status"
            :media-overlay-open="mediaOverlayOpen"
            :current-user-avatar-src="currentUserAvatarSrc"
            :avatar-by-user-id="avatarByUserId"
            :sender-name-by-user-id="senderNameByUserId"
            :sender-role-by-user-id="senderRoleByUserId"
            :show-sender-meta="shouldShowSenderHeader(row.threadIndex)"
            :show-sender-avatar="shouldShowAvatar(row.threadIndex)"
            :reserve-avatar-space="Boolean(showSenderMeta && row.thread.post.raw.user_id)"
            :is-public-channel="Boolean(isPublicChannel)"
            :comments-enabled="Boolean(commentsEnabled)"
            :can-comment="Boolean(canComment)"
            :can-react="canReact"
            :is-top-level-post="Boolean(isPublicChannel) && !(row.thread.post.raw.reply_to_message_id || '').trim()"
            :comment-count="row.thread.comments.length"
            :selection-mode="selectionMode"
            :selected="selectedMessageIds.has(String(row.thread.post.raw.id || '').trim())"
            @open-image="$emit('openImage', $event)"
            @open-video="$emit('openVideo', $event)"
            @open-user-info="$emit('openUserInfo', $event)"
            @open-username="$emit('openUsername', $event)"
            @reply-to-message="$emit('replyToMessage', $event)"
            @open-discussion="$emit('openDiscussion', $event)"
            @react="$emit('react', $event)"
            @open-context-menu="$emit('openContextMenu', $event)"
            @open-reaction-picker="$emit('openReactionPicker', $event)"
            @toggle-select="toggleSelectMessage"
            @jump-to-message="jumpToMessage"
          />
        </div>
      </template>
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
    :show-save="canSaveContextMessage"
    :show-pin="Boolean(canPinContextMessage)"
    :pinned="Boolean(pinnedContextMessage)"
    :reactions="contextReactions"
    :reaction-names="contextReactionNames"
    :reaction-avatars="contextReactionAvatars"
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
    @copy="(text) => $emit('copyContextMessage', text)"
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
    @save="$emit('saveContextMessage')"
    @pin="$emit('pinContextMessage')"
    @copy-link="$emit('copyLinkContextMessage')"
    @report="$emit('reportContextMessage')"
    @select="selectFromContextMenu"
  />

  <MessageContextMenu
    :open="Boolean(callContextMenu)"
    :x="callContextMenu?.x || 0"
    :y="callContextMenu?.y || 0"
    mode="call"
    :show-delete="true"
    :show-react="false"
    @close="closeCallContextMenu"
    @delete="deleteCallFromMenu"
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
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.selBar {
  position: relative;
  flex: 0 0 auto;
  z-index: 40;
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
  background: var(--surface-soft-hover);
}

.selBtn.muted {
  background: transparent;
  color: var(--text-muted);
}

.messageList {
  position: relative;
  flex: 1 1 auto;
  height: auto;
  overflow: auto;
  min-height: 0;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(15, 23, 42, 0.16) transparent;
  /* The chat wallpaper must stay untouched: no dimming layer, no blur. */
  background: transparent;
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
  padding: 6px 16px 14px;
}

.messageStack {
  padding: 10px 16px 14px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 10px;
  min-height: 100%;
}

.messageItem {
  content-visibility: auto;
  contain-intrinsic-size: 220px;
  contain: layout paint style;
  transform: translateZ(0);
}

.messageItem.selected {
  position: relative;
  z-index: 1;
}

.messageItem.highlight {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
  border-radius: 14px;
  animation: highlightPulse 1600ms ease-out;
}

.dateRow {
  position: sticky;
  top: 8px;
  z-index: 2;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.dateChip {
  box-sizing: border-box;
  width: 170px;
  padding: 5px 12px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);
}

.callRow {
  align-self: center;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(460px, 100%);
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  transition: background 120ms ease;
}

.callRow:hover {
  background: var(--surface-soft-hover);
}

.callRow.stream {
  border-style: dashed;
  color: var(--accent);
}

.callRow.stream .callRowIcon,
.callRow.stream .callRowTime {
  color: var(--accent);
  opacity: 0.85;
}

.pinBar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-soft);
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.pinBar:hover {
  background: var(--surface-soft-hover);
}

.pinBarIcon {
  flex: 0 0 auto;
  color: var(--accent);
}

.pinBarBody {
  flex: 1 1 auto;
  min-width: 0;
}

.pinBarTitle {
  font-size: 12px;
  font-weight: 800;
  color: var(--accent);
}

.pinBarPreview {
  font-size: 13px;
  color: var(--text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pinBarAction {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
}

.pinBarAction:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.callRowIcon {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
}

.callRowText {
  min-width: 0;
}

.callRowTime {
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  opacity: 0.75;
}

@keyframes highlightPulse {
  0% { outline-color: rgba(0, 0, 0, 0); }
  20% { outline-color: var(--accent); }
  100% { outline-color: rgba(0, 0, 0, 0); }
}

.discussionStack {
  padding: 18px 18px 24px;
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
  padding: 32px 16px 14px;
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
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
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
  border: 1px solid color-mix(in srgb, var(--text-muted) 35%, transparent);
  background: var(--surface-strong);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  backdrop-filter: blur(18px) saturate(160%);
  border-radius: 14px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.32);
  overflow: hidden;
  animation: uiPopIn 140ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

@keyframes uiPopIn {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .reactionPickerPopover { animation: none; }
}
</style>
