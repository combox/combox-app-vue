<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { parseMessageContent } from 'combox-api'
import { formatMessageTime, isComboxUrl, normalizeAvatarSrc, openComboxAwareUrl, toCurrentOriginComboxUrl } from './chatUtils'
import LinkPreviewCard from './LinkPreviewCard.vue'
import MessageMedia from './MessageMedia.vue'
import ReactionBar from './ReactionBar.vue'
import type { ResolvedAttachment, ViewMessage } from './chatTypes'

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
}>()

const emit = defineEmits<{
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
  react: [payload: { messageID: string; emoji: string }]
  openContextMenu: [payload: { x: number; y: number; message: ViewMessage }]
  openUserInfo: [userID: string]
}>()

const { t } = useI18n()
const visibleText = computed(() => props.message.text || '')
const showText = computed(() => Boolean(visibleText.value.trim()))
const timeText = computed(() => formatMessageTime(props.message.raw.created_at))
const normalizedDeliveryStatus = computed(() => (props.deliveryStatus || '').trim().toLowerCase())
const senderUserID = computed(() => (props.message.raw.user_id || '').trim())
const senderAvatar = computed(() => normalizeAvatarSrc((props.avatarByUserId || {})[senderUserID.value] || ''))
const senderName = computed(() => ((props.senderNameByUserId || {})[senderUserID.value] || '').trim())
const senderRole = computed(() => ((props.senderRoleByUserId || {})[senderUserID.value] || '').trim())
const replySender = computed(() => (props.message.raw.reply_to_message_sender_name || '').trim())
const replyPreview = computed(() => parseMessageContent(props.message.raw.reply_to_message_preview || '').text.trim())
const hasReply = computed(() => Boolean((props.message.raw.reply_to_message_id || '').trim()))
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
const linkItems = computed(() => {
  const re = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)\b/gi
  const found = new Set<string>()
  for (const match of visibleText.value.matchAll(re)) {
    const raw = (match[1] || '').trim()
    if (raw) found.add(raw)
  }
  return Array.from(found)
})
const textHtml = computed(() => {
  const escaped = visibleText.value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped
    .replace(/\b((?:https?:\/\/|www\.)[^\s<>"'`]+)\b/gi, (raw) => {
      const resolvedHref = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
      const combox = isComboxUrl(resolvedHref)
      const href = combox ? toCurrentOriginComboxUrl(resolvedHref) : resolvedHref
      const target = combox ? '_self' : '_blank'
      const rel = combox ? '' : ' rel="noreferrer noopener"'
      return `<a class="mbLink" href="${href}" target="${target}"${rel}>${raw}</a>`
    })
    .replace(/\n/g, '<br>')
})

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  emit('openContextMenu', { x: event.clientX, y: event.clientY, message: props.message })
}

function onReact(emoji: string) {
  emit('react', { messageID: props.message.raw.id, emoji })
}

function imageGalleryStyle(attachments: ResolvedAttachment[]) {
  const columns = attachments.length >= 2 ? 2 : 1
  return { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
}

function openSenderInfo() {
  if (!senderUserID.value || props.mine) return
  emit('openUserInfo', senderUserID.value)
}

function onBubbleClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const anchor = target?.closest('a.mbLink') as HTMLAnchorElement | null
  if (!anchor) return
  const href = (anchor.getAttribute('href') || '').trim()
  if (!href || !isComboxUrl(href)) return
  event.preventDefault()
  openComboxAwareUrl(href)
}
</script>

<template>
  <div v-if="isVideoOnly || isImageOnly" class="mbRow" :class="{ mine }">
    <button v-if="showSenderAvatar" type="button" class="mbAuthorAvatar" :class="{ mine }" @click="openSenderInfo">
      <img v-if="senderAvatar" :src="senderAvatar" alt="" class="mbAuthorAvatarImg" />
      <span v-else>{{ (senderName || senderUserID || '?').slice(0, 1).toUpperCase() }}</span>
    </button>
    <div v-else-if="reserveAvatarSpace" class="mbAvatarSpacer" :class="{ mine }" aria-hidden="true" />
    <div class="mbMain">
      <div v-if="!mine && showSenderMeta && senderName" class="mbSenderHeader">
        <span class="mbSenderName">{{ senderName }}</span>
        <span v-if="senderRole" class="mbSenderRole">{{ senderRole }}</span>
      </div>
      <div class="mbMediaOnly" @contextmenu="onContextMenu" @click="onBubbleClick">
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
          <img class="mbGalleryImage" :src="attachment.url || attachment.previewUrl" :alt="attachment.filename || 'image'" />
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
        <span>{{ timeText }}</span>
        <v-icon
          v-if="mine"
          :icon="normalizedDeliveryStatus === 'read' ? 'mdi-check-all' : 'mdi-check'"
          size="13"
          :class="normalizedDeliveryStatus === 'read' ? 'mbStatusRead' : 'mbStatusSent'"
        />
      </footer>
      </div>
    </div>
  </div>

  <div v-else class="mbRow" :class="{ mine }">
    <button v-if="showSenderAvatar" type="button" class="mbAuthorAvatar" :class="{ mine }" @click="openSenderInfo">
      <img v-if="senderAvatar" :src="senderAvatar" alt="" class="mbAuthorAvatarImg" />
      <span v-else>{{ (senderName || senderUserID || '?').slice(0, 1).toUpperCase() }}</span>
    </button>
    <div v-else-if="reserveAvatarSpace" class="mbAvatarSpacer" :class="{ mine }" aria-hidden="true" />
    <div class="mbMain">
      <div v-if="!mine && showSenderMeta && senderName" class="mbSenderHeader">
        <span class="mbSenderName">{{ senderName }}</span>
        <span v-if="senderRole" class="mbSenderRole">{{ senderRole }}</span>
      </div>
      <article class="mbBubble" :class="{ hasVideoAttachment }" @contextmenu="onContextMenu" @click="onBubbleClick">
      <div v-if="hasReply" class="mbReply">
        <div class="mbReplyAccent" aria-hidden="true" />
        <div class="mbReplyBody">
          <div class="mbReplySender">{{ replySender || 'Reply' }}</div>
          <div class="mbReplyPreview">{{ replyPreview || 'Message' }}</div>
        </div>
      </div>

      <p v-if="showText" class="mbText" v-html="textHtml" />
      <p v-else-if="message.attachments.length === 0" class="mbText">{{ t('chat.empty_message') }}</p>

      <div v-if="linkItems.length > 0" class="mbLinkList">
        <LinkPreviewCard
          v-for="item in linkItems"
          :key="item"
          :url="item"
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
              <img class="mbGalleryImage" :src="attachment.url || attachment.previewUrl" :alt="attachment.filename || 'image'" />
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
        <span>{{ timeText }}</span>
        <v-icon
          v-if="mine"
          :icon="normalizedDeliveryStatus === 'read' ? 'mdi-check-all' : 'mdi-check'"
          size="13"
          :class="normalizedDeliveryStatus === 'read' ? 'mbStatusRead' : 'mbStatusSent'"
        />
      </footer>

      <ReactionBar
        v-if="Array.isArray(message.raw.reactions) && message.raw.reactions.length > 0"
        :reactions="message.raw.reactions"
        :current-user-id="currentUserId"
        :current-user-avatar-src="currentUserAvatarSrc"
        :avatar-by-user-id="avatarByUserId"
        @react="onReact"
      />
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
  display: inline-block;
  max-width: min(720px, 100%);
  width: auto;
  min-width: 0;
  padding: 8px 12px 8px;
  border-radius: 14px 14px 14px 8px;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid var(--border);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
  color: var(--text);
}

.mbMain {
  min-width: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  max-width: min(720px, 100%);
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

.mbReply {
  display: grid;
  grid-template-columns: 3px 1fr;
  gap: 10px;
  padding: 6px 0 8px;
  margin-bottom: 6px;
}

.mbReplyAccent {
  background: rgba(74, 144, 217, 0.55);
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
  background: rgba(226, 238, 255, 0.95);
  border-color: rgba(74, 144, 217, 0.18);
  border-radius: 14px 14px 8px 14px;
}

.mbBubble.hasVideoAttachment {
  min-width: min(520px, 100%);
}

.mbMediaOnly {
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
  margin: 0 0 5px;
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.4;
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
  width: min(640px, 100%);
}

.mbImageGallery {
  width: min(640px, 100%);
  max-width: 100%;
  display: grid;
  gap: 4px;
}

.mbImageGallery.inBubble {
  width: 100%;
}

.mbGalleryItem {
  padding: 0;
  margin: 0;
  border: 0;
  cursor: zoom-in;
  overflow: hidden;
  border-radius: 12px;
  width: 100%;
  display: block;
  background: transparent;
  aspect-ratio: 1 / 1;
}

.mbGalleryImage {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

.mbStatusRead {
  color: var(--accent);
}

:deep(.mbLink) {
  color: var(--accent-strong);
  text-decoration: none;
}

:deep(.mbLink:hover) {
  text-decoration: underline;
}

.mbBubble :deep(.video-preview),
.mbBubble :deep(.lpCard),
.mbBubble :deep(.media-image-wrap),
.mbBubble :deep(.media-placeholder),
.mbBubble :deep(.media-video-placeholder) {
  max-width: 100%;
}

.mbBubble :deep(.lpCard) {
  width: min(560px, 100%);
}

.mbBubble :deep(.video-preview) {
  width: auto;
}
</style>
