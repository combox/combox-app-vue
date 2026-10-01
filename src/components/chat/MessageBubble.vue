<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { ApiError, listTranslateLanguages, parseMessageContent, translateText, TRANSLATE_MAX_TEXT_LENGTH } from 'combox-api'
import type { TranslateLanguage } from 'combox-api'
import { formatMessageTime, isComboxUrl, normalizeAvatarSrc, openComboxAwareUrl } from './chatUtils'
import { openAvatarPreview } from '../../utils/avatarViewer'
import { avatarColorFor } from '../../utils/avatarColor'
import { openProfileModal } from '../../utils/profileModal'
import { renderMessageHtml } from '../../utils/markdown'
import LinkPreviewCard from './LinkPreviewCard.vue'
import LazyDecodedImage from './LazyDecodedImage.vue'
import MessageMedia from './MessageMedia.vue'
import PollCard from './PollCard.vue'
import ReactionBar from './ReactionBar.vue'
import type { ResolvedAttachment, ViewMessage } from './chatTypes'
import type { Poll } from '../../utils/pollFormat'
import { applyPollUpdate, resolvePoll } from '../../utils/pollState'

const props = defineProps<{
  message: ViewMessage
  mine: boolean
  currentUserId: string
  deliveryStatus?: string
  mediaOverlayOpen: boolean
  currentUserAvatarSrc?: string
  avatarByUserId?: Record<string, string>
  senderNameByUserId?: Record<string, string>
  senderRoleByUserId?: Record<string, string>
  showSenderMeta?: boolean
  showSenderAvatar?: boolean
  reserveAvatarSpace?: boolean
  isPublicChannel?: boolean
  commentsEnabled?: boolean
  canComment?: boolean
  canReact?: boolean
  isTopLevelPost?: boolean
  commentCount?: number
  selectionMode?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
  react: [payload: { messageID: string; emoji: string }]
  openContextMenu: [payload: { x: number; y: number; message: ViewMessage }]
  openReactionPicker: [payload: { x: number; y: number; messageId: string }]
  openUserInfo: [userID: string]
  openUsername: [username: string]
  replyToMessage: [message: ViewMessage]
  openDiscussion: [message: ViewMessage]
  jumpToMessage: [messageId: string]
  toggleSelect: [message: ViewMessage]
}>()

const { locale, t } = useI18n()
const toast = useToast()

const NO_PREVIEW_TOKEN_RE = /\[\[nopreview:([^\]]+)\]\]/gi

function parseNoPreviewTokens(text: string): { cleanText: string; suppressedUrls: Set<string> } {
  const suppressedUrls = new Set<string>()
  if (!text) return { cleanText: '', suppressedUrls }
  const cleanText = text.replace(NO_PREVIEW_TOKEN_RE, (_match, encoded) => {
    const raw = String(encoded || '').trim()
    if (!raw) return ''
    try {
      suppressedUrls.add(decodeURIComponent(raw))
    } catch {
      // ignore bad token
    }
    return ''
  })
  return { cleanText, suppressedUrls }
}

function isPreviewEligibleUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (!host) return false
    if (host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1') return false
    if (host.endsWith('.local') || host.endsWith('.internal')) return false

    // Basic private IP blocks (IPv4).
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (a === 10) return false
      if (a === 192 && b === 168) return false
      if (a === 172 && b >= 16 && b <= 31) return false
      return true
    }

    // Hostnames without a dot are typically local/dev.
    if (!host.includes('.')) return false
    return true
  } catch {
    return false
  }
}

const parsedText = computed(() => parseNoPreviewTokens(props.message.text || ''))
const visibleText = computed(() => parsedText.value.cleanText || '')
const showText = computed(() => Boolean(visibleText.value.trim()))
/** Vote/close responses live in an override map so a feed rebuild cannot drop them. */
const poll = computed<Poll | null>(() => resolvePoll(props.message.raw.poll))
const timeText = computed(() => formatMessageTime(props.message.raw.created_at))
const isEdited = computed(() => Boolean((props.message.raw.edited_at || '').trim()))
const normalizedDeliveryStatus = computed(() => (props.deliveryStatus || '').trim().toLowerCase())
const statusMeta = computed(() => {
  const s = normalizedDeliveryStatus.value
  if (s === 'read') return { icon: 'mdi-check-all', cls: 'mbStatusRead', title: t('chat.status_read', undefined, 'Read') }
  if (s === 'delivered') return { icon: 'mdi-check-all', cls: 'mbStatusSent', title: t('chat.status_delivered', undefined, 'Delivered') }
  if (s === 'sent') return { icon: 'mdi-check', cls: 'mbStatusSent', title: t('chat.status_sent', undefined, 'Sent') }
  if (s === 'error' || s === 'failed') return { icon: 'mdi-alert-circle', cls: 'mbStatusError', title: t('chat.status_error', undefined, 'Failed to send') }
  if (s === 'sending' || s === 'pending') return { icon: 'mdi-clock-outline', cls: 'mbStatusPending', title: t('chat.status_sending', undefined, 'Sending') }
  return { icon: 'mdi-check', cls: 'mbStatusSent', title: t('chat.status_sent', undefined, 'Sent') }
})
const senderUserID = computed(() => (props.message.raw.user_id || '').trim())
const rawMessageMeta = computed<Record<string, unknown>>(
  () => ((props.message.raw && typeof props.message.raw === 'object' ? props.message.raw : {}) as Record<string, unknown>),
)
const viewCount = computed(() => {
  const raw = rawMessageMeta.value
  const candidates = [raw.views_count, raw.view_count, raw.views, raw.seen_count, raw.seen]
  for (const value of candidates) {
    const n = typeof value === 'number' ? value : Number(String(value || '').trim())
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
})
const senderAvatar = computed(() => normalizeAvatarSrc((props.avatarByUserId || {})[senderUserID.value] || ''))
const senderName = computed(() => {
  const fromMap = ((props.senderNameByUserId || {})[senderUserID.value] || '').trim()
  if (fromMap) return fromMap
  const rawName = String(rawMessageMeta.value.sender_name || '').trim()
  if (rawName) return rawName
  const rawUsername = String(rawMessageMeta.value.sender_username || '').trim()
  return rawUsername
})
const senderRole = computed(() => ((props.senderRoleByUserId || {})[senderUserID.value] || '').trim())
const replySender = computed(() => (props.message.raw.reply_to_message_sender_name || '').trim())
const replyPreview = computed(() => {
  const raw = parseMessageContent(props.message.raw.reply_to_message_preview || '').text.trim()
  return raw.length > 140 ? `${raw.slice(0, 140).trim()}…` : raw
})
const hasReply = computed(() => Boolean((props.message.raw.reply_to_message_id || '').trim()))
const forwardOriginName = computed(() => String(props.message.raw.forward_origin_name || '').trim())
const forwardOriginUserID = computed(() => String(props.message.raw.forward_origin_user_id || '').trim())
const forwardOriginRedacted = computed(() => Boolean(props.message.raw.forward_origin_redacted))
const hasForwardOrigin = computed(
  () => Boolean(forwardOriginName.value || forwardOriginUserID.value || forwardOriginRedacted.value),
)
const forwardOriginAvatar = computed(() => normalizeAvatarSrc(props.message.raw.forward_origin_avatar_data_url || ''))
const forwardAvatarSrc = computed(() =>
  normalizeAvatarSrc(forwardOriginAvatar.value || (props.avatarByUserId || {})[forwardOriginUserID.value] || ''),
)
const forwardClickable = computed(() => Boolean(forwardOriginUserID.value) && !forwardOriginRedacted.value)
const forwardLabel = computed(() => {
  if (forwardOriginRedacted.value) return t('chat.forwarded_hidden', undefined, 'Hidden forwarder')
  return forwardOriginName.value || senderName.value || t('chat.unknown_sender', undefined, 'Unknown')
})
const forwardInitials = computed(() => {
  const source = forwardLabel.value.trim()
  if (!source) return '?'
  return source.slice(0, 1).toUpperCase()
})
const allAttachmentsAreImages = computed(
  () => props.message.attachments.length > 0 && props.message.attachments.every((item) => item.kind === 'image'),
)
const isVideoOnly = computed(
  () => !showText.value && props.message.attachments.length === 1 && props.message.attachments[0]?.kind === 'video',
)
const isImageOnly = computed(
  () => !showText.value && props.message.attachments.length > 0 && props.message.attachments.every((item) => item.kind === 'image'),
)
const hasVideoAttachment = computed(() => props.message.attachments.some((item) => item.kind === 'video'))
const showCommentAction = computed(() =>
  Boolean(props.isPublicChannel && props.commentsEnabled && props.isTopLevelPost),
)
const linkUrls = computed(() => {
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)\b/gi
  const found: string[] = []
  const seen = new Set<string>()
  for (const match of visibleText.value.matchAll(re)) {
    const raw = (match[1] || '').trim()
    if (!raw) continue
    if (seen.has(raw)) continue
    seen.add(raw)
    found.push(raw)
  }
  return found
})
const previewLink = computed(() => {
  // tweb-like: show a single preview only when there's exactly one link.
  if (poll.value) return ''
  if (linkUrls.value.length !== 1) return ''
  const raw = linkUrls.value[0] || ''
  const resolvedHref = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  if (isComboxUrl(resolvedHref)) return ''
  if (parsedText.value.suppressedUrls.has(resolvedHref)) return ''
  if (!isPreviewEligibleUrl(resolvedHref)) return ''
  return resolvedHref
})
const textHtml = computed(() =>
  renderMessageHtml(visibleText.value, { copyLabel: t('markdown.copy_code', undefined, 'Copy code') }),
)

/* --- R19 message translation (TG-like: menu item → block under the original) --- */

const TRANSLATE_TARGET_KEY = 'combox_translate_target'
const TRANSLATE_EVENT = 'combox:translate-message'
const TRANSLATE_SOURCE_AUTO = 'auto'

type TranslateCacheEntry = { text: string; source: string; target: string }
type TranslateSharedState = {
  cache: Map<string, TranslateCacheEntry>
  languages: TranslateLanguage[] | null
  languagesPromise: Promise<TranslateLanguage[]> | null
}

/** Module-level (shared across bubble instances) translation cache + language list. */
function translateShared(): TranslateSharedState {
  const holder = window as unknown as { __comboxTranslate?: TranslateSharedState }
  if (!holder.__comboxTranslate) {
    holder.__comboxTranslate = { cache: new Map(), languages: null, languagesPromise: null }
  }
  return holder.__comboxTranslate
}

function normalizeLangCode(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0] || ''
}

function defaultTranslateTarget(): string {
  return locale.value === 'ru' ? 'ru' : 'en'
}

function readStoredTranslateTarget(): string {
  try {
    const raw = normalizeLangCode(window.localStorage.getItem(TRANSLATE_TARGET_KEY))
    if (raw) return raw
  } catch {
    // storage unavailable — fall back to the interface language
  }
  return defaultTranslateTarget()
}

const translateOpen = ref(false)
const translateCollapsed = ref(false)
const translateLoading = ref(false)
const translateError = ref('')
const translateCanRetry = ref(false)
const translateNeedsSource = ref(false)
const translateResult = ref('')
const translateDetectedSource = ref('')
const translateTarget = ref(readStoredTranslateTarget())
const translateSourceSel = ref<string>(TRANSLATE_SOURCE_AUTO)
const translateLangs = ref<TranslateLanguage[]>(translateShared().languages || [])
const translateLangsLoading = ref(false)
const translateRequestID = ref(0)

const translateMessageID = computed(() => String(props.message.raw.id || '').trim())

/** Cache key: (messageID + target) per spec, plus source + text fingerprint so edits can't serve stale text. */
function translateCacheKey(target: string, sourceSel: string): string {
  const text = visibleText.value
  return `${translateMessageID.value}::${target}::${sourceSel}::${[...text].length}:${text.slice(0, 64)}`
}

function translateLangName(code: unknown): string {
  const clean = normalizeLangCode(code)
  const found = translateLangs.value.find((item) => normalizeLangCode(item.code) === clean)
  if (found && found.name.trim()) return found.name.trim()
  return clean ? clean.toUpperCase() : '?'
}

const translateMeta = computed(() => {
  const toName = translateLangName(translateTarget.value)
  const fromCode =
    translateSourceSel.value === TRANSLATE_SOURCE_AUTO ? translateDetectedSource.value : translateSourceSel.value
  const fromName = fromCode ? translateLangName(fromCode) : ''
  if (fromName) return t('chat.translated_from_to', { source: fromName, target: toName }, `${fromName} → ${toName}`)
  return t('chat.translated_to', { target: toName }, `Translated · ${toName}`)
})

async function ensureTranslateLanguages(): Promise<void> {
  const shared = translateShared()
  if (shared.languages) {
    translateLangs.value = shared.languages
    return
  }
  if (shared.languagesPromise) {
    try {
      translateLangs.value = await shared.languagesPromise
    } catch {
      // list failed; selectors stay empty until the next attempt
    }
    return
  }
  translateLangsLoading.value = true
  const pending = listTranslateLanguages()
  shared.languagesPromise = pending
  try {
    const items = await pending
    shared.languages = items
    translateLangs.value = items
    if (items.length > 0 && !items.some((item) => normalizeLangCode(item.code) === normalizeLangCode(translateTarget.value))) {
      translateTarget.value = defaultTranslateTarget()
    }
  } catch {
    shared.languagesPromise = null
  } finally {
    translateLangsLoading.value = false
  }
}

async function runTranslate(): Promise<void> {
  const raw = visibleText.value.trim()
  if (!raw) return
  if ([...raw].length > TRANSLATE_MAX_TEXT_LENGTH) {
    const message = t(
      'chat.translate_too_long',
      { max: TRANSLATE_MAX_TEXT_LENGTH },
      `Message is too long to translate (max ${TRANSLATE_MAX_TEXT_LENGTH} characters).`,
    )
    translateError.value = message
    translateCanRetry.value = false
    translateNeedsSource.value = false
    toast.error(message)
    return
  }
  const requestID = translateRequestID.value + 1
  translateRequestID.value = requestID
  const target = normalizeLangCode(translateTarget.value) || defaultTranslateTarget()
  const sourceSel = normalizeLangCode(translateSourceSel.value) || TRANSLATE_SOURCE_AUTO
  const key = translateCacheKey(target, sourceSel)
  const cached = translateShared().cache.get(key)
  if (cached) {
    translateResult.value = cached.text
    translateDetectedSource.value = cached.source
    translateError.value = ''
    translateCanRetry.value = false
    translateNeedsSource.value = false
    translateCollapsed.value = false
    return
  }
  translateLoading.value = true
  translateError.value = ''
  translateCanRetry.value = false
  translateNeedsSource.value = false
  try {
    const result = await translateText(raw, target, sourceSel === TRANSLATE_SOURCE_AUTO ? undefined : sourceSel)
    if (translateRequestID.value !== requestID) return
    translateShared().cache.set(key, { text: result.text, source: result.source, target: result.target })
    translateResult.value = result.text
    translateDetectedSource.value = result.source
    translateCollapsed.value = false
  } catch (error) {
    if (translateRequestID.value !== requestID) return
    const code = error instanceof ApiError ? error.code : ''
    if (code === 'detect_not_supported') {
      translateNeedsSource.value = true
      translateCanRetry.value = false
      translateError.value = t(
        'chat.translate_choose_source',
        undefined,
        'Auto-detect is not supported by the translator. Please choose the source language.',
      )
      return
    }
    if (code === 'rate_limited') {
      const message = t('chat.translate_rate_limited', undefined, 'Too many requests. Please try again later.')
      translateError.value = message
      translateCanRetry.value = true
      toast.error(message)
      return
    }
    if (code === 'upstream_failed') {
      const message = t('chat.translate_upstream_failed', undefined, 'Translation service unavailable. Please try again.')
      translateError.value = message
      translateCanRetry.value = true
      toast.error(message)
      return
    }
    if (code === 'unsupported_language') {
      const message = t('chat.translate_unsupported_language', undefined, 'This language pair is not supported.')
      translateError.value = message
      translateCanRetry.value = false
      toast.error(message)
      return
    }
    const message = t('chat.translate_failed', undefined, 'Translation failed. Please try again.')
    translateError.value = message
    translateCanRetry.value = true
    toast.error(message)
  } finally {
    if (translateRequestID.value === requestID) translateLoading.value = false
  }
}

function openTranslate(): void {
  if (!visibleText.value.trim()) return
  translateOpen.value = true
  translateCollapsed.value = false
  void (async () => {
    await ensureTranslateLanguages()
    await runTranslate()
  })()
}

function onTranslateEvent(event: Event): void {
  try {
    const detail = (event as CustomEvent<{ messageID?: unknown }>).detail
    const id = String(detail?.messageID || '').trim()
    if (!id || id !== translateMessageID.value) return
    openTranslate()
  } catch {
    // ignore malformed translate requests
  }
}

onMounted(() => {
  window.addEventListener(TRANSLATE_EVENT, onTranslateEvent)
})

onBeforeUnmount(() => {
  window.removeEventListener(TRANSLATE_EVENT, onTranslateEvent)
})

watch(translateTarget, (next) => {
  const clean = normalizeLangCode(next) || defaultTranslateTarget()
  try {
    window.localStorage.setItem(TRANSLATE_TARGET_KEY, clean)
  } catch {
    // storage unavailable
  }
  if (translateOpen.value && !translateCollapsed.value) void runTranslate()
})

watch(translateSourceSel, () => {
  if (translateOpen.value && !translateCollapsed.value) void runTranslate()
})

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  try {
    ;(window as unknown as { __comboxLastContextMessage?: { id: string; text: string } }).__comboxLastContextMessage =
      {
        id: String(props.message.raw.id || ''),
        text: visibleText.value,
      }
  } catch {
    // stash unavailable; the menu falls back to showing Translate
  }
  emit('openContextMenu', { x: event.clientX, y: event.clientY, message: props.message })
}

function onReact(emoji: string) {
  emit('react', { messageID: props.message.raw.id, emoji })
}

/** The card owns its optimistic copy; this only records the authoritative payload. */
function onPollChange(payload: { messageID: string; poll: Poll }) {
  applyPollUpdate(props.message.raw.poll, payload.poll)
}

function imageGalleryStyle(attachments: ResolvedAttachment[]) {
  const columns = attachments.length >= 2 ? 2 : 1
  return {
    gridTemplateColumns: columns === 2 ? 'repeat(2, 1fr)' : '1fr',
  }
}

function openSenderInfo() {
  if (!senderUserID.value) return
  // Discussion mode or group: allow opening info for others.
  // For 'mine', we usually don't open, but in discussions it's fine.
  emit('openUserInfo', senderUserID.value)
}

function onSenderAvatarClick() {
  if (senderAvatar.value) {
    openAvatarPreview(senderAvatar.value, senderName.value || senderUserID.value || '', {
      ownerId: senderUserID.value,
      ownerKind: 'user',
    })
    return
  }
  openSenderInfo()
}

function legacyCopyText(text: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    // Clipboard API unavailable and legacy path failed - nothing else to try.
    return false
  }
}

function markCodeCopied(button: Element): void {
  const icon = button.querySelector('.mdi')
  const restore = (): void => {
    if (icon) {
      icon.classList.remove('mdi-check')
      icon.classList.add('mdi-content-copy')
    }
    button.setAttribute('title', t('markdown.copy_code', undefined, 'Copy code'))
  }
  if (icon) {
    icon.classList.remove('mdi-content-copy')
    icon.classList.add('mdi-check')
  }
  button.setAttribute('title', t('markdown.copied', undefined, 'Copied'))
  window.setTimeout(restore, 1500)
}

function copyCodeBlock(button: Element): void {
  try {
    const block = button.closest('.mbCodeBlock')
    const code = block ? block.querySelector('pre code') : null
    const text = code ? code.textContent || '' : ''
    if (!text) return
    const clipboard = navigator.clipboard
    if (clipboard && typeof clipboard.writeText === 'function') {
      clipboard
        .writeText(text)
        .then(() => markCodeCopied(button))
        .catch(() => {
          if (legacyCopyText(text)) markCodeCopied(button)
        })
      return
    }
    if (legacyCopyText(text)) markCodeCopied(button)
  } catch {
    // Never let a clipboard failure break the click handler.
  }
}

function openProfileForUser(userID: string, username = '', name = '') {
  const id = (userID || '').trim()
  if (!id) return
  openProfileModal(id, {
    username: (username || '').trim(),
    name: (name || '').trim(),
    openChat: (handle) => emit('openUsername', handle),
  })
}

function onForwardClick() {
  if (!forwardClickable.value || props.selectionMode) return
  openProfileForUser(forwardOriginUserID.value, '', forwardOriginName.value)
}

function onBubbleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null

  if ((event.ctrlKey || event.metaKey || event.shiftKey) && !target?.closest('a')) {
    event.preventDefault()
    event.stopPropagation()
    emit('toggleSelect', props.message)
    return
  }

  if (props.selectionMode && !target?.closest('a, button, [role="button"], input, textarea, select, video')) {
    event.preventDefault()
    event.stopPropagation()
    emit('toggleSelect', props.message)
    return
  }

  const copyButton = target?.closest('[data-copy-code]') as HTMLElement | null
  if (copyButton) {
    event.preventDefault()
    copyCodeBlock(copyButton)
    return
  }

  const anchor = target?.closest('a.mbLink') as HTMLAnchorElement | null
  if (anchor) {
    const href = (anchor.getAttribute('href') || '').trim()
    if (!href || !isComboxUrl(href)) return
    event.preventDefault()
    openComboxAwareUrl(href)
    return
  }
  const userRef = target?.closest('a.mbUserRef') as HTMLAnchorElement | null
  if (userRef) {
    const username = (userRef.dataset.mention || userRef.dataset.username || '').trim()
    if (!username) return
    event.preventDefault()
    // The profile popup resolves the handle and offers the Message action.
    openProfileModal('', { username, openChat: (handle) => emit('openUsername', handle) })
    return
  }

  const spoiler = target?.closest('.mbSpoiler') as HTMLElement | null
  if (spoiler) {
    event.preventDefault()
    spoiler.classList.toggle('mbSpoilerOpen')
  }
}

function startComment() {
  emit('openDiscussion', props.message)
}

function onReplyClick() {
  const targetId = (props.message.raw.reply_to_message_id || '').trim()
  if (!targetId) return
  emit('jumpToMessage', targetId)
}
</script>

<template>
  <div v-if="isVideoOnly || isImageOnly" class="mbRow" :class="{ mine }">
    <button v-if="showSenderAvatar" type="button" class="mbAuthorAvatar" :class="{ mine }" :style="{ background: avatarColorFor(senderUserID) }" @click="onSenderAvatarClick">
      <img v-if="senderAvatar" :src="senderAvatar" alt="" class="mbAuthorAvatarImg" />
      <span v-else>{{ (senderName || senderUserID || '?').slice(0, 1).toUpperCase() }}</span>
    </button>
    <div v-else-if="reserveAvatarSpace" class="mbAvatarSpacer" :class="{ mine }" aria-hidden="true" />
    <div class="mbMain">
      <div v-if="!mine && showSenderMeta && senderName" class="mbSenderHeader">
        <span class="mbSenderName" role="button" tabindex="0" @click="openSenderInfo" @keydown.enter.prevent="openSenderInfo">{{ senderName }}</span>
        <span v-if="senderRole" class="mbSenderRole">{{ senderRole }}</span>
      </div>
      <div class="mbMediaOnly" v-long-context @contextmenu="onContextMenu" @click="onBubbleClick">
      <div
        v-if="hasForwardOrigin"
        class="mbForward"
        :class="{ mbForwardClickable: forwardClickable }"
        :role="forwardClickable ? 'button' : undefined"
        :tabindex="forwardClickable ? 0 : undefined"
        @click="onForwardClick"
        @keydown.enter.prevent="onForwardClick"
        @keydown.space.prevent="onForwardClick"
      >
        <span
          v-if="!forwardOriginRedacted"
          class="mbForwardAvatar"
          :style="{ background: avatarColorFor(forwardOriginUserID || forwardLabel) }"
        >
          <img v-if="forwardAvatarSrc" :src="forwardAvatarSrc" alt="" class="mbForwardAvatarImg" />
          <span v-else>{{ forwardInitials }}</span>
        </span>
        <v-icon v-else icon="mdi-forward" size="14" class="mbForwardIcon" />
        <span class="mbForwardLabel">{{ t('chat.forwarded_from', undefined, 'Forwarded from') }}</span>
        <span class="mbForwardName">{{ forwardLabel }}</span>
        <v-icon v-if="forwardClickable" icon="mdi-chevron-right" size="14" class="mbForwardChevron" />
      </div>
      <div
        v-if="isImageOnly && message.attachments.length > 1"
        class="mbImageGallery"
        :style="imageGalleryStyle(message.attachments)"
      >
        <button
          v-for="attachment in message.attachments"
          :key="attachment.id"
          type="button"
          class="mbGalleryItem"
          @click="attachment.url && $emit('openImage', attachment.url)"
        >
          <LazyDecodedImage
            :src="attachment.url || attachment.previewUrl"
            :preview-src="attachment.previewUrl"
            :alt="attachment.filename || 'image'"
            img-class="mbGalleryImage"
          />
        </button>
      </div>

      <template v-else>
        <MessageMedia
          v-for="attachment in message.attachments"
          :key="attachment.id"
          :attachment="attachment"
          :media-overlay-open="mediaOverlayOpen"
          @open-image="$emit('openImage', $event)"
          @open-video="$emit('openVideo', $event)"
        />
      </template>

      <footer class="mbMeta mbMetaMedia">
        <v-icon
          v-if="isEdited"
          icon="mdi-pencil"
          size="12"
          class="mbEditedIcon"
        />
        <template v-if="viewCount > 0">
          <v-icon icon="mdi-eye-outline" size="13" class="mbViewsIcon" />
          <span>{{ viewCount }}</span>
        </template>
        <span>{{ timeText }}</span>
        <v-icon
          v-if="mine"
          :icon="statusMeta.icon"
          size="13"
          :class="statusMeta.cls"
          :title="statusMeta.title"
        />
      </footer>

      <ReactionBar
        v-if="Array.isArray(message.raw.reactions) && message.raw.reactions.length > 0"
        :reactions="message.raw.reactions"
        :current-user-id="currentUserId"
        :current-user-avatar-src="currentUserAvatarSrc"
        :avatar-by-user-id="avatarByUserId"
        :can-react="canReact"
        :show-count="Boolean(isPublicChannel)"
        @react="onReact"
      />
      </div>
    </div>
  </div>

  <div v-else class="mbRow" :class="{ mine }">
    <button v-if="showSenderAvatar" type="button" class="mbAuthorAvatar" :class="{ mine }" :style="{ background: avatarColorFor(senderUserID) }" @click="onSenderAvatarClick">
      <img v-if="senderAvatar" :src="senderAvatar" alt="" class="mbAuthorAvatarImg" />
      <span v-else>{{ (senderName || senderUserID || '?').slice(0, 1).toUpperCase() }}</span>
    </button>
    <div v-else-if="reserveAvatarSpace" class="mbAvatarSpacer" :class="{ mine }" aria-hidden="true" />
    <div class="mbMain">
      <div v-if="!mine && showSenderMeta && senderName" class="mbSenderHeader">
        <span class="mbSenderName" role="button" tabindex="0" @click="openSenderInfo" @keydown.enter.prevent="openSenderInfo">{{ senderName }}</span>
        <span v-if="senderRole" class="mbSenderRole">{{ senderRole }}</span>
      </div>
      <article
        class="mbBubble"
        :class="{ mine, hasVideoAttachment, selected: Boolean(selectionMode && selected) }"
        v-long-context
        @contextmenu="onContextMenu"
        @click="onBubbleClick"
      >
        <div class="mbBubbleContent">
          <div
            v-if="hasForwardOrigin"
            class="mbForward"
            :class="{ mbForwardClickable: forwardClickable }"
            :role="forwardClickable ? 'button' : undefined"
            :tabindex="forwardClickable ? 0 : undefined"
            :aria-label="forwardClickable ? `${t('chat.forwarded_from', undefined, 'Forwarded from')} ${forwardLabel}` : undefined"
            @click="onForwardClick"
            @keydown.enter.prevent="onForwardClick"
            @keydown.space.prevent="onForwardClick"
          >
            <span
              v-if="!forwardOriginRedacted"
              class="mbForwardAvatar"
              :style="{ background: avatarColorFor(forwardOriginUserID || forwardLabel) }"
            >
              <img v-if="forwardAvatarSrc" :src="forwardAvatarSrc" alt="" class="mbForwardAvatarImg" />
              <span v-else>{{ forwardInitials }}</span>
            </span>
            <v-icon v-else icon="mdi-forward" size="14" class="mbForwardIcon" />
            <span class="mbForwardLabel">{{ t('chat.forwarded_from', undefined, 'Forwarded from') }}</span>
            <span class="mbForwardName">{{ forwardLabel }}</span>
            <v-icon v-if="forwardClickable" icon="mdi-chevron-right" size="14" class="mbForwardChevron" />
          </div>

          <div v-if="hasReply" class="mbReply" role="button" tabindex="0" @click.stop="onReplyClick" @keydown.enter.prevent="onReplyClick" @keydown.space.prevent="onReplyClick">
            <div class="mbReplyAccent" aria-hidden="true" />
            <div class="mbReplyBody">
              <div class="mbReplySender">{{ replySender || t('chat.reply') }}</div>
              <div class="mbReplyPreview">{{ replyPreview || t('chat.message') }}</div>
            </div>
          </div>

          <PollCard
            v-if="poll"
            :poll="poll"
            :message="message.raw"
            :current-user-id="currentUserId"
            :sender-name-by-user-id="senderNameByUserId"
            @voted="onPollChange"
            @stopped="onPollChange"
          />
          <div v-else-if="showText" class="mbText" v-html="textHtml" />
          <p v-else-if="message.attachments.length === 0" class="mbText">{{ t('chat.empty_message') }}</p>

          <div v-if="translateOpen" class="mbTranslate">
            <div class="mbTranslateHead">
              <div class="mbTranslateLangs">
                <label class="mbTranslateField">
                  <span class="mbTranslateFieldLabel">{{ t('chat.translate_from', undefined, 'From') }}</span>
                  <select
                    v-model="translateSourceSel"
                    class="mbTranslateSelect"
                    :class="{ mbTranslateNeedsSource: translateNeedsSource }"
                    :disabled="translateLoading"
                    @click.stop
                  >
                    <option value="auto">{{ t('chat.translate_auto', undefined, 'Auto') }}</option>
                    <option v-for="lang in translateLangs" :key="`src-${lang.code}`" :value="lang.code">
                      {{ lang.name }}
                    </option>
                  </select>
                </label>
                <span class="mbTranslateArrow" aria-hidden="true">→</span>
                <label class="mbTranslateField">
                  <span class="mbTranslateFieldLabel">{{ t('chat.translate_to', undefined, 'To') }}</span>
                  <select v-model="translateTarget" class="mbTranslateSelect" :disabled="translateLoading" @click.stop>
                    <option v-for="lang in translateLangs" :key="`tgt-${lang.code}`" :value="lang.code">
                      {{ lang.name }}
                    </option>
                  </select>
                </label>
              </div>
              <button type="button" class="mbTranslateToggle" @click.stop="translateCollapsed = !translateCollapsed">
                {{
                  translateCollapsed
                    ? t('chat.show_translation', undefined, 'Show translation')
                    : t('chat.show_original', undefined, 'Show original')
                }}
              </button>
            </div>
            <div v-if="!translateCollapsed" class="mbTranslateBody">
              <div v-if="translateLoading" class="mbTranslateLoading">
                {{ t('chat.translate_loading', undefined, 'Translating…') }}
              </div>
              <div v-else-if="translateError" class="mbTranslateError">
                <span class="mbTranslateErrorText">{{ translateError }}</span>
                <button
                  v-if="translateCanRetry"
                  type="button"
                  class="mbTranslateRetry"
                  @click.stop="runTranslate"
                >
                  {{ t('chat.translate_retry', undefined, 'Retry') }}
                </button>
              </div>
              <template v-else-if="translateResult">
                <p class="mbTranslateText">{{ translateResult }}</p>
                <div class="mbTranslateMeta">{{ translateMeta }}</div>
              </template>
            </div>
          </div>

          <div v-if="previewLink" class="mbLinkList">
            <LinkPreviewCard
              :url="previewLink"
              :media-overlay-open="mediaOverlayOpen"
              @open-video="$emit('openVideo', $event)"
            />
          </div>

          <div v-if="message.attachments.length > 0" class="bubbleAttachments" :class="{ mediaOnlyGrid: allAttachmentsAreImages && message.attachments.length > 1 }">
            <template v-if="allAttachmentsAreImages && message.attachments.length > 1">
              <div class="mbImageGallery inBubble" :style="imageGalleryStyle(message.attachments)">
                <button
                  v-for="attachment in message.attachments"
                  :key="attachment.id"
                  type="button"
                  class="mbGalleryItem"
                  @click="attachment.url && $emit('openImage', attachment.url)"
                >
                  <LazyDecodedImage
                    :src="attachment.url"
                    :preview-src="attachment.previewUrl"
                    :alt="attachment.filename || 'image'"
                    img-class="mbGalleryImage"
                  />
                </button>
              </div>
            </template>
            <template v-else>
              <MessageMedia
                v-for="attachment in message.attachments"
                :key="attachment.id"
                :attachment="attachment"
                :media-overlay-open="mediaOverlayOpen"
                @open-image="$emit('openImage', $event)"
                @open-video="$emit('openVideo', $event)"
              />
            </template>
          </div>

          <footer class="mbMeta">
            <v-icon
              v-if="isEdited"
              icon="mdi-pencil"
              size="12"
              class="mbEditedIcon"
            />
            <template v-if="viewCount > 0">
              <v-icon icon="mdi-eye-outline" size="13" class="mbViewsIcon" />
              <span>{{ viewCount }}</span>
            </template>
            <span>{{ timeText }}</span>
            <v-icon
              v-if="mine"
              :icon="statusMeta.icon"
              size="13"
              :class="statusMeta.cls"
              :title="statusMeta.title"
            />
          </footer>

          <ReactionBar
            v-if="Array.isArray(message.raw.reactions) && message.raw.reactions.length > 0"
            :reactions="message.raw.reactions"
            :current-user-id="currentUserId"
            :current-user-avatar-src="currentUserAvatarSrc"
            :avatar-by-user-id="avatarByUserId"
            :can-react="canReact"
            :show-count="Boolean(isPublicChannel)"
            @react="onReact"
          />
        </div>
        <button v-if="showCommentAction" type="button" class="mbCommentFooter" @click.stop="startComment">
          <span class="mbCommentFooterLeft">
            <v-icon icon="mdi-comment-outline" size="16" />
            <span class="mbCommentFooterText">
              {{
                (props.commentCount || 0) > 0
                  ? t('chat.comments_count', { count: props.commentCount || 0 }, `${props.commentCount || 0} comments`)
                  : t('chat.leave_comment', undefined, 'Leave a comment')
              }}
            </span>
          </span>
          <v-icon icon="mdi-chevron-right" size="18" />
        </button>
      </article>
    </div>
  </div>
</template>

<style scoped>
.mbRow {
  display: flex;
  justify-content: flex-start;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
}

.mbRow.mine {
  justify-content: flex-end;
}

.mbBubble {
  position: relative;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  width: auto;
  min-width: 0;
  border-radius: 14px 14px 14px 8px;
  background: var(--msg-bubble-in);
  border: 1px solid var(--border);
  color: var(--text);
  overflow: hidden;
  -webkit-backdrop-filter: blur(var(--msg-glass-blur)) saturate(150%);
  backdrop-filter: blur(var(--msg-glass-blur)) saturate(150%);
}

.mbBubble.mine {
  background: var(--msg-bubble-out);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 14px 14px 8px 14px;
  color: var(--text);
  -webkit-backdrop-filter: blur(var(--msg-glass-blur)) saturate(150%);
  backdrop-filter: blur(var(--msg-glass-blur)) saturate(150%);
}

html[data-theme='dark'] .mbBubble.mine {
  color: #fff;
}

html[data-theme='dark'] .mbBubble.mine .mbMeta,
html[data-theme='dark'] .mbBubble.mine .mbStatusSent,
html[data-theme='dark'] .mbBubble.mine .mbStatusPending,
html[data-theme='dark'] .mbBubble.mine .mbEditedIcon,
html[data-theme='dark'] .mbBubble.mine .mbViewsIcon {
  color: rgba(255, 255, 255, 0.72);
}

html[data-theme='dark'] .mbBubble.mine .mbStatusRead {
  color: #fff;
}

html[data-theme='dark'] .mbBubble.mine .mbReplyAccent {
  background: rgba(255, 255, 255, 0.4);
}

html[data-theme='dark'] .mbBubble.mine .mbReplySender {
  color: #fff;
}

html[data-theme='dark'] .mbBubble.mine .mbReplyPreview {
  color: rgba(255, 255, 255, 0.78);
}

.mbBubbleContent {
  padding: 10px 12px 6px;
  width: 100%;
}

.mbCommentFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
  background: color-mix(in srgb, currentColor 6%, transparent);
  color: var(--text-soft);
  font-size: 13px;
  font-weight: 600;
  transition: background 120ms;
  cursor: pointer;
  margin: 0;
}

.mbCommentFooter:hover {
  background: color-mix(in srgb, currentColor 11%, transparent);
}

.mbBubble.mine .mbCommentFooter {
  border-top-color: color-mix(in srgb, currentColor 14%, transparent);
  background: color-mix(in srgb, currentColor 7%, transparent);
  color: inherit;
}

.mbBubble.mine .mbCommentFooter:hover {
  background: color-mix(in srgb, currentColor 13%, transparent);
}

.mbCommentFooterLeft {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mbCommentFooterText {
  line-height: 1.1;
}

.mbMain {
  min-width: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  max-width: min(65%, 620px);
}

.mbSenderHeader {
  margin-left: 2px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
}

.mbSenderName {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
  cursor: pointer;
}

.mbSenderName:hover {
  color: var(--link);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.mbSenderRole {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: capitalize;
}

.mbAuthorAvatar {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  margin: 0;
  overflow: hidden;
  display: grid;
  place-items: center;
  cursor: pointer;
  background: var(--avatar-fallback);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.mbAuthorAvatar.mine {
  order: 2;
  cursor: default;
}

.mbAuthorAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mbAvatarSpacer {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
}

.mbAvatarSpacer.mine {
  order: 2;
}

.mbRow.mine .mbMain {
  order: 1;
  align-items: flex-end;
}

.mbForward {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-bottom: 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--link);
}

.mbForwardClickable {
  cursor: pointer;
  border-radius: 8px;
}

.mbForwardClickable:hover .mbForwardName {
  color: var(--link);
}

.mbForwardAvatar {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
}

.mbForwardAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mbForwardIcon {
  flex: 0 0 auto;
  color: var(--link);
}

.mbBubble.mine .mbForward,
.mbBubble.mine .mbForwardIcon {
  color: var(--link-on-accent);
}

.mbForwardLabel {
  flex: 0 0 auto;
}

.mbForwardName {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-soft);
}

.mbForwardChevron {
  flex: 0 0 auto;
  margin-left: auto;
  opacity: 0.6;
}

.mbReply {
  display: grid;
  grid-template-columns: 3px 1fr;
  gap: 10px;
  padding: 6px 0 8px;
  margin-bottom: 6px;
}

.mbReplyAccent {
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}

.mbReplyBody {
  min-width: 0;
}

.mbReplySender {
  font-size: 12px;
  font-weight: 800;
  color: var(--text);
}

.mbReplyPreview {
  margin-top: 1px;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mbRow.mine .mbBubble {
  border-bottom-right-radius: 4px;
}

.mbBubble.selected {
  outline: 2px solid rgba(59, 130, 246, 0.55);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.12);
}

.mbBubble.hasVideoAttachment {
  min-width: min(520px, 100%);
}

.mbMediaOnly {
  position: relative;
  display: inline-grid;
  grid-auto-rows: max-content;
  justify-items: start;
  width: auto;
  max-width: 100%;
  gap: 6px;
}

.mbRow.mine .mbMediaOnly {
  justify-items: end;
}

.mbText {
  --mb-code-bg: #171a21;
  --mb-code-fg: #e6edf3;
  --mb-code-head-bg: #101319;
  margin: 0 0 5px;
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.4;
}

/* --- markdown: headings, lists, quotes, rules ------------------------- */

.mbText :deep(.mbHeading) {
  margin: 0.45em 0 0.25em;
  font-weight: 700;
  line-height: 1.3;
  color: var(--text);
}

.mbText :deep(.mbH1) {
  font-size: 1.32em;
}
.mbText :deep(.mbH2) {
  font-size: 1.22em;
}
.mbText :deep(.mbH3) {
  font-size: 1.13em;
}
.mbText :deep(.mbH4) {
  font-size: 1.06em;
}
.mbText :deep(.mbH5) {
  font-size: 1em;
}
.mbText :deep(.mbH6) {
  font-size: 0.94em;
  color: var(--text-soft);
}

.mbText :deep(.mbList) {
  margin: 4px 0;
  padding-left: 1.4em;
  list-style: disc outside;
}

.mbText :deep(.mbListOrdered) {
  list-style: decimal outside;
}

.mbText :deep(.mbList li) {
  margin: 1px 0;
}

.mbText :deep(.mbQuote) {
  margin: 3px 0;
  padding: 1px 0 1px 9px;
  border-left: 3px solid color-mix(in srgb, var(--accent) 55%, transparent);
  color: var(--text-soft);
}

.mbText :deep(.mbHr) {
  height: 0;
  margin: 6px 0;
  border: 0;
  border-top: 1px solid var(--border);
}

/* --- markdown: inline code, spoiler ----------------------------------- */

.mbText :deep(code.mbCode) {
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--text) 12%, transparent);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.9em;
}

.mbText :deep(.mbSpoiler) {
  padding: 0 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text) 45%, transparent);
  color: transparent;
  cursor: pointer;
  transition: background-color 140ms ease;
}

.mbText :deep(.mbSpoiler) * {
  color: transparent !important;
  text-decoration: none !important;
}

.mbText :deep(.mbSpoiler):hover {
  background: color-mix(in srgb, var(--text) 62%, transparent);
}

.mbText :deep(.mbSpoilerOpen) {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  color: inherit;
}

.mbText :deep(.mbSpoilerOpen) * {
  color: inherit !important;
}

/* --- markdown: fenced code block -------------------------------------- */

.mbText :deep(.mbCodeBlock) {
  margin: 5px 0;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--mb-code-fg) 14%, transparent);
  border-radius: 10px;
  background: var(--mb-code-bg);
  color: var(--mb-code-fg);
}

.mbText :deep(.mbCodeHead) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px 5px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--mb-code-fg) 12%, transparent);
  background: var(--mb-code-head-bg);
  font-size: 11px;
  line-height: 1;
}

.mbText :deep(.mbCodeLang) {
  margin-right: auto;
  overflow: hidden;
  color: color-mix(in srgb, var(--mb-code-fg) 72%, transparent);
  font-weight: 600;
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  text-transform: lowercase;
  white-space: nowrap;
}

.mbText :deep(.mbCodeCopy) {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: color-mix(in srgb, var(--mb-code-fg) 70%, transparent);
  cursor: pointer;
  line-height: 1;
  transition: background-color 120ms ease, color 120ms ease;
}

.mbText :deep(.mbCodeCopy:hover) {
  background: color-mix(in srgb, var(--mb-code-fg) 14%, transparent);
  color: var(--mb-code-fg);
}

.mbText :deep(.mbCodeCopy .mdi) {
  font-size: 15px;
}

.mbText :deep(.mbCodePre) {
  margin: 0;
  padding: 9px 11px;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--mb-code-bg);
  color: var(--mb-code-fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--mb-code-fg) 30%, transparent) transparent;
}

.mbText :deep(.mbCodePre code) {
  display: block;
  margin: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: pre;
}

/* --- markdown: hljs token palette ------------------------------------- */

.mbText :deep(.mbCodeBlock .hljs) {
  background: transparent;
  color: var(--mb-code-fg);
}

.mbText :deep(.mbCodeBlock .hljs-comment),
.mbText :deep(.mbCodeBlock .hljs-quote),
.mbText :deep(.mbCodeBlock .hljs-meta) {
  color: #8b949e;
  font-style: italic;
}

.mbText :deep(.mbCodeBlock .hljs-string),
.mbText :deep(.mbCodeBlock .hljs-regexp),
.mbText :deep(.mbCodeBlock .hljs-meta-string),
.mbText :deep(.mbCodeBlock .hljs-link) {
  color: #a5d6ff;
}

.mbText :deep(.mbCodeBlock .hljs-number),
.mbText :deep(.mbCodeBlock .hljs-literal),
.mbText :deep(.mbCodeBlock .hljs-symbol),
.mbText :deep(.mbCodeBlock .hljs-bullet),
.mbText :deep(.mbCodeBlock .hljs-attr),
.mbText :deep(.mbCodeBlock .hljs-attribute),
.mbText :deep(.mbCodeBlock .hljs-property),
.mbText :deep(.mbCodeBlock .hljs-selector-attr),
.mbText :deep(.mbCodeBlock .hljs-selector-class),
.mbText :deep(.mbCodeBlock .hljs-selector-id) {
  color: #79c0ff;
}

.mbText :deep(.mbCodeBlock .hljs-keyword),
.mbText :deep(.mbCodeBlock .hljs-selector-tag),
.mbText :deep(.mbCodeBlock .hljs-doctag),
.mbText :deep(.mbCodeBlock .hljs-deletion) {
  color: #ff7b72;
}

.mbText :deep(.mbCodeBlock .hljs-title),
.mbText :deep(.mbCodeBlock .hljs-title.function_),
.mbText :deep(.mbCodeBlock .hljs-title.class_),
.mbText :deep(.mbCodeBlock .hljs-section) {
  color: #d2a8ff;
}

.mbText :deep(.mbCodeBlock .hljs-built_in),
.mbText :deep(.mbCodeBlock .hljs-type),
.mbText :deep(.mbCodeBlock .hljs-class) {
  color: #ffa657;
}

.mbText :deep(.mbCodeBlock .hljs-variable),
.mbText :deep(.mbCodeBlock .hljs-template-variable),
.mbText :deep(.mbCodeBlock .hljs-params) {
  color: #ffd580;
}

.mbText :deep(.mbCodeBlock .hljs-tag),
.mbText :deep(.mbCodeBlock .hljs-name) {
  color: #7ee787;
}

.mbText :deep(.mbCodeBlock .hljs-addition) {
  color: #3fb950;
}

.mbText :deep(.mbCodeBlock .hljs-emphasis) {
  font-style: italic;
}

.mbText :deep(.mbCodeBlock .hljs-strong) {
  font-weight: 700;
}

.mbLinkList {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  max-width: 100%;
}

.bubbleAttachments {
  display: grid;
  gap: 6px;
  margin-top: 6px;
  max-width: 100%;
}

.bubbleAttachments.mediaOnlyGrid {
  width: min(520px, calc(100vw - 72px));
  max-width: min(760px, calc(100vw - 72px));
}

.mbImageGallery {
  width: min(520px, calc(100vw - 72px));
  max-width: min(760px, calc(100vw - 72px));
  display: grid;
  gap: 4px;
}

.mbImageGallery.inBubble {
  width: min(520px, calc(100vw - 72px));
  max-width: min(760px, calc(100vw - 72px));
}

.mbGalleryItem {
  padding: 0;
  margin: 0;
  border: 0;
  cursor: default;
  overflow: hidden;
  border-radius: 12px;
  width: 100%;
  display: block;
  background: transparent;
  aspect-ratio: 1 / 1;
  content-visibility: auto;
  contain: layout paint size;
  contain-intrinsic-size: 160px 160px;
}

:deep(.mbGalleryImage) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 0;
}

.mbMeta {
  margin-top: 5px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.mbMetaMedia {
  margin-top: 2px;
}

.mbStatusSent {
  color: var(--text-muted);
}

.mbEditedIcon {
  color: var(--text-muted);
  opacity: 0.82;
}

.mbViewsIcon {
  color: var(--text-muted);
  opacity: 0.9;
}

.mbStatusRead {
  color: var(--link);
}

.mbStatusError {
  color: var(--danger);
}

.mbStatusPending {
  color: var(--text-muted);
  animation: mbStatusPulse 1.4s ease-in-out infinite;
}

@keyframes mbStatusPulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

:deep(.mbLink),
:deep(.mbUserRef) {
  color: var(--link);
  text-decoration: none;
}

:deep(.mbLink:hover),
:deep(.mbUserRef:hover) {
  text-decoration: underline;
}

.mbBubble.mine :deep(.mbLink),
.mbBubble.mine :deep(.mbUserRef) {
  color: var(--link-on-accent);
}

.mbBubble :deep(.video-preview),
.mbBubble :deep(.lpCard),
.mbBubble :deep(.media-image-wrap),
.mbBubble :deep(.media-placeholder),
.mbBubble :deep(.media-video-placeholder) {
  max-width: 100%;
}

/* R9: audio/voice must not stretch to the full chat width. */
.mbBubble :deep(.audioPlayer) {
  width: 100%;
  max-width: 340px;
  min-width: 0;
  justify-self: start;
}

.mbBubble :deep(.audioArt),
.mbBubble :deep(.audioSide) {
  flex: 0 0 auto;
}

.mbBubble :deep(.audioBody) {
  min-width: 0;
}

.mbMediaOnly :deep(.audioPlayer) {
  width: 100%;
  max-width: 340px;
  min-width: 0;
  justify-self: start;
}

.mbMediaOnly :deep(.audioArt),
.mbMediaOnly :deep(.audioSide) {
  flex: 0 0 auto;
}

.mbMediaOnly :deep(.audioBody) {
  min-width: 0;
}

@media (max-width: 560px) {
  .mbBubble :deep(.audioPlayer),
  .mbMediaOnly :deep(.audioPlayer) {
    max-width: min(320px, 100%);
  }
}

.mbBubble :deep(.lpCard) {
  width: min(560px, 100%);
}

.mbBubble :deep(.video-preview) {
  width: auto;
}

/* Reactions row: always start from the left, same in Chrome and Firefox. */
.mbBubbleContent :deep(.rbWrap),
.mbMediaOnly :deep(.rbWrap) {
  justify-content: flex-start;
  justify-self: start;
  width: 100%;
  margin-left: 0;
  text-align: left;
}

.mbMediaOnly :deep(.rbWrap) {
  margin-right: auto;
}

/* --- R19 translation block (TG-like, under the original text) --- */

.mbTranslate {
  margin: 6px 0 5px;
  border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  padding-top: 6px;
  display: grid;
  gap: 6px;
}

.mbTranslateHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.mbTranslateLangs {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.mbTranslateField {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.mbTranslateFieldLabel {
  font-weight: 600;
}

.mbTranslateSelect {
  max-width: 130px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
}

.mbTranslateSelect.mbTranslateNeedsSource {
  border-color: var(--danger);
  outline: 1px solid var(--danger);
}

.mbTranslateArrow {
  color: var(--text-muted);
  font-size: 12px;
}

.mbTranslateToggle {
  border: 0;
  background: transparent;
  padding: 2px 4px;
  color: var(--link);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.mbBubble.mine .mbTranslateToggle {
  color: var(--link-on-accent);
}

.mbTranslateToggle:hover {
  text-decoration: underline;
}

.mbTranslateBody {
  min-width: 0;
}

.mbTranslateLoading {
  font-size: 13px;
  color: var(--text-muted);
}

.mbTranslateError {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--danger);
}

.mbTranslateRetry {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  cursor: pointer;
}

.mbTranslateText {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.4;
}

.mbTranslateMeta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
