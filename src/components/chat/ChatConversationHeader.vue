<script setup lang="ts">
import { useI18n } from '../../i18n/i18n'
import { openAvatarPreview } from '../../utils/avatarViewer'
import { avatarColorFor } from '../../utils/avatarColor'
import TypingIndicator from './TypingIndicator.vue'
const props = defineProps<{
  title: string
  subtitle: string
  typingLabel?: string
  avatarText: string
  avatarSrc?: string
  searchOpen: boolean
  searchValue: string
  showBack?: boolean
  backAriaLabel?: string
  streamMode?: boolean
  /**
   * Owner of the avatar, so the fullscreen viewer can lazy-load the photo
   * history. Both stay optional on purpose: the header is rendered by
   * ChatWorkspace, which does not pass them yet, so the viewer keeps showing
   * the single photo until that wiring lands.
   */
  ownerId?: string
  ownerKind?: 'user' | 'chat'
}>()

const emit = defineEmits<{
  openInfo: []
  openSearch: []
  closeSearch: []
  updateSearch: [value: string]
  openMenu: [anchor: { top: number; left: number; width: number; height: number }]
  back: []
  startCall: []
}>()
const { t } = useI18n()

function openMenu(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  emit('openMenu', { top: rect.bottom, left: rect.left, width: rect.width, height: rect.height })
}

function previewAvatar(event: MouseEvent) {
  event.stopPropagation()
  openAvatarPreview(event.currentTarget?.getAttribute('data-src') || '', props.title, {
    ownerId: props.ownerId,
    ownerKind: props.ownerKind,
  })
}
</script>

<template>
  <header class="convHeader">
    <div class="convInner">
      <template v-if="searchOpen">
        <div class="convSearch">
          <v-icon icon="mdi-magnify" size="18" class="convSearchIcon" />
          <input
            class="convSearchInput"
            :value="searchValue"
            autofocus
            :placeholder="t('chat.search')"
            @input="emit('updateSearch', ($event.target as HTMLInputElement).value)"
          />
          <button type="button" class="convActionBtn" :aria-label="t('chat.close_search')" @click="emit('closeSearch')">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
      </template>

      <template v-else>
        <button v-if="showBack" type="button" class="convActionBtn convBackBtn" :aria-label="backAriaLabel || t('chat.back')" @click="emit('back')">
          <v-icon icon="mdi-arrow-left" size="18" />
        </button>
        <div
          class="convPeer"
          role="button"
          tabindex="0"
          @click="emit('openInfo')"
          @keydown.enter.prevent="emit('openInfo')"
          @keydown.space.prevent="emit('openInfo')"
        >
          <button
            v-if="avatarSrc"
            type="button"
            class="convAvatarWrap convAvatarBtn"
            :data-src="avatarSrc"
            :aria-label="t('chat.preview_avatar', undefined, 'View avatar')"
            @click="previewAvatar"
          >
            <img class="convAvatarImg" :src="avatarSrc" alt="" />
          </button>
          <div v-else class="convAvatarFallback" :style="{ background: avatarColorFor(title) }">{{ avatarText }}</div>
          <div class="convMeta">
            <div class="convTitle">{{ title }}</div>
            <div v-if="typingLabel" class="convSubtitle convTyping">
              <TypingIndicator />
              <span>{{ typingLabel }}</span>
            </div>
            <div v-else class="convSubtitle">{{ subtitle }}</div>
          </div>
        </div>
      </template>

      <div class="convActions">
        <button
          type="button"
          class="convActionBtn"
          :aria-label="streamMode ? t('call.start_stream', undefined, 'Start stream') : t('call.start_audio', undefined, 'Start audio call')"
          :title="streamMode ? t('call.start_stream', undefined, 'Start stream') : t('call.start_audio', undefined, 'Start audio call')"
          @click="emit('startCall')"
        >
          <v-icon :icon="streamMode ? 'mdi-broadcast' : 'mdi-phone'" size="18" />
        </button>
        <button type="button" class="convActionBtn" :aria-label="t('chat.search')" :title="t('chat.search')" @click="emit('openSearch')">
          <v-icon icon="mdi-magnify" size="18" />
        </button>
        <button type="button" class="convActionBtn" :aria-label="t('chat.menu')" :title="t('chat.menu')" @click="openMenu">
          <v-icon icon="mdi-dots-vertical" size="18" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.convHeader {
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--surface);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}

.convInner {
  width: 100%;
  min-height: 63px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.convPeer {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 auto;
  cursor: pointer;
}

.convBackBtn {
  margin-right: 2px;
}

.convMeta {
  min-width: 0;
  flex: 1 1 auto;
}

.convAvatarWrap,
.convAvatarFallback {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 auto;
}

.convAvatarBtn {
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}

.convTitle {
  font-size: 18px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--text);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.convSubtitle {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.convTyping {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--accent);
}

.convAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.convAvatarFallback {
  display: grid;
  place-items: center;
  background: var(--avatar-fallback);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -.02em;
}

.convActions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  margin-left: auto;
}

.convActionBtn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.convActionBtn:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.convSearch {
  min-width: 0;
  flex: 1;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
}

.convSearchIcon {
  color: var(--text-muted);
}

.convSearchInput {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 16px;
  color: var(--text);
}

@media (max-width: 720px) {
  .convInner {
    padding: 8px;
    gap: 6px;
  }
  .convTitle {
    font-size: 16px;
  }
  .convActionBtn {
    width: 34px;
    height: 34px;
  }
}
</style>
