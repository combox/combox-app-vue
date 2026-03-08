<script setup lang="ts">
import type { ChatItem } from 'combox-api'
import { computed } from 'vue'
import { useI18n } from '../../i18n/i18n'
import PhotoViewer from './PhotoViewer.vue'
import VideoViewer from './VideoViewer.vue'

const props = defineProps<{
  viewerSrc: string
  videoViewer: { attachmentID: string; src: string; poster?: string; filename?: string } | null
  selectedChat: ChatItem | null
  chatMenuAnchor: { top: number; left: number; width: number; height: number } | null
  isSelectedChatMuted: boolean
}>()

const emit = defineEmits<{
  closePhotoViewer: []
  closeVideoViewer: []
  closeChatMenu: []
  openInfo: []
  openMessageSearch: []
  toggleMuteSelectedChat: []
  leaveChat: [payload: { onSuccess: () => void; onError: (message: string) => void }]
  openImage: [src: string]
  openVideo: [payload: { attachmentID: string; src: string; poster?: string; filename?: string }]
}>()

const { t } = useI18n()

function openInfo() {
  emit('closeChatMenu')
  emit('openInfo')
}

function openMessageSearch() {
  emit('closeChatMenu')
  emit('openMessageSearch')
}

function toggleMute() {
  emit('closeChatMenu')
  emit('toggleMuteSelectedChat')
}

function leaveGroup() {
  emit('closeChatMenu')
  emit('leaveChat', {
    onSuccess: () => {},
    onError: () => {},
  })
}

const chatMenuStyle = computed(() => {
  const anchor = props.chatMenuAnchor
  if (!anchor) return {}
  return {
    top: `${anchor.top + 8}px`,
    left: `${Math.max(12, anchor.left - 94)}px`,
  }
})
</script>

<template>
  <div class="ovRoot">
    <PhotoViewer :open="Boolean(props.viewerSrc)" :src="props.viewerSrc" @close="emit('closePhotoViewer')" />
    <VideoViewer
      :open="Boolean(props.videoViewer)"
      :attachment-i-d="props.videoViewer?.attachmentID || ''"
      :src="props.videoViewer?.src || ''"
      :poster="props.videoViewer?.poster || ''"
      :filename="props.videoViewer?.filename || ''"
      @close="emit('closeVideoViewer')"
    />

    <Teleport to="body">
      <transition name="cmFade">
        <div v-if="props.chatMenuAnchor" class="cmOverlay" @click="emit('closeChatMenu')" />
      </transition>
      <transition name="cmPop">
        <div v-if="props.chatMenuAnchor" class="chatMenu" :style="chatMenuStyle" @click.stop>
          <button type="button" class="chatMenuItem" @click="openInfo">{{ t('chat.chat_info') }}</button>
          <button type="button" class="chatMenuItem" @click="openMessageSearch">{{ t('chat.search') }}</button>
          <button type="button" class="chatMenuItem" @click="toggleMute">{{ props.isSelectedChatMuted ? t('chat.unmute') : t('chat.mute') }}</button>
          <button
            v-if="props.selectedChat && !props.selectedChat.is_direct"
            type="button"
            class="chatMenuItem chatMenuItemDanger"
            @click="leaveGroup"
          >
            {{ t('chat.leave_chat') }}
          </button>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ovRoot {
  position: relative;
  width: 100%;
  height: 100%;
}

.cmOverlay {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: transparent;
}

.chatMenu {
  position: fixed;
  z-index: 91;
  min-width: 156px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--shadow-soft);
}

.cmFade-enter-active,
.cmFade-leave-active {
  transition: opacity 140ms ease;
}

.cmFade-enter-from,
.cmFade-leave-to {
  opacity: 0;
}

.cmPop-enter-active,
.cmPop-leave-active {
  transition:
    opacity 120ms ease,
    transform 140ms ease;
  transform-origin: top right;
}

.cmPop-enter-from,
.cmPop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.chatMenuItem {
  width: 100%;
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.chatMenuItem:hover {
  background: var(--surface-soft);
}

.chatMenuItemDanger {
  color: #d32f2f;
}

.chatMenuItemDanger:hover {
  background: rgba(211, 47, 47, 0.08);
}
</style>
