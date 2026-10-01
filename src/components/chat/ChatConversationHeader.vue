<script setup lang="ts">
import { useI18n } from '../../i18n/i18n'
import { openAvatarPreview } from '../../utils/avatarViewer'
import { avatarColorFor } from '../../utils/avatarColor'
import TypingIndicator from './TypingIndicator.vue'
const props = withDefaults(
  defineProps<{
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
     * BUG 2 guard: true while the newly selected chat is still loading
     * (messages/members). When true the header must not render the stale
     * subtitle/typing of the previous chat — it renders a skeleton instead.
     * Wired by ChatWorkspace (see integration note below), defaults to false
     * so existing usages keep working.
     */
    loading?: boolean
    /**
     * BUG 3 guard: false hides the call/broadcast button (phone/broadcast in
     * convActions). Defaults to true so nothing breaks before ChatWorkspace
     * passes the real permission.
     */
    canBroadcast?: boolean
  /**
   * Owner of the avatar, so the fullscreen viewer can lazy-load the photo
   * history. Both stay optional on purpose: the header is rendered by
   * ChatWorkspace, which does not pass them yet, so the viewer keeps showing
   * the single photo until that wiring lands.
   */
  ownerId?: string
  ownerKind?: 'user' | 'chat'
  /**
   * Saved Messages self-chat (backend chat kind 'saved'). When true the header
   * renders the bookmark badge instead of the "S" letter, shows an empty
   * subtitle (never "1 participants") and the peer block is not clickable
   * (no info panel for saved). Wire as
   * `:is-saved="selectedChat?.kind === 'saved'"`.
   */
  isSaved?: boolean
  }>(),
  { loading: false, canBroadcast: true, isSaved: false },
)

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

/** Saved Messages has no info panel: the header peer block is inert. */
function onPeerClick() {
  if (props.isSaved) return
  emit('openInfo')
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
          :class="{ noInfo: isSaved }"
          :role="isSaved ? undefined : 'button'"
          :tabindex="isSaved ? undefined : 0"
          @click="onPeerClick"
          @keydown.enter.prevent="onPeerClick"
          @keydown.space.prevent="onPeerClick"
        >
          <button
            v-if="avatarSrc && !isSaved"
            type="button"
            class="convAvatarWrap convAvatarBtn"
            :data-src="avatarSrc"
            :aria-label="t('chat.preview_avatar', undefined, 'View avatar')"
            @click="previewAvatar"
          >
            <img class="convAvatarImg" :src="avatarSrc" alt="" />
          </button>
          <div v-else-if="isSaved" class="convAvatarFallback convAvatarSaved" aria-hidden="true">
            <svg class="convSavedGlyph" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" /></svg>
          </div>
          <div v-else class="convAvatarFallback" :style="{ background: avatarColorFor(title) }">{{ avatarText }}</div>
          <div class="convMeta">
            <div class="convTitle">{{ title }}</div>
            <div v-if="!loading && typingLabel && !isSaved" class="convSubtitle convTyping">
              <TypingIndicator />
              <span>{{ typingLabel }}</span>
            </div>
            <div v-else-if="loading" class="convSubtitle convSubtitleSkeleton" aria-hidden="true">
              <span class="convSkeletonBar" />
            </div>
            <div v-else-if="isSaved" class="convSubtitle" aria-hidden="true" />
            <div v-else class="convSubtitle">{{ subtitle }}</div>
          </div>
        </div>
      </template>

      <div class="convActions">
        <button
          v-if="canBroadcast"
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

.convPeer.noInfo {
  cursor: default;
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

.convSubtitleSkeleton {
  display: flex;
  align-items: center;
  min-height: 16px;
}

.convSkeletonBar {
  display: inline-block;
  width: 120px;
  max-width: 40vw;
  height: 10px;
  border-radius: 999px;
  background: var(--surface-soft-hover, var(--surface-soft));
  opacity: 0.7;
  animation: convSkeletonPulse 1.2s ease-in-out infinite;
}

@keyframes convSkeletonPulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 0.9;
  }
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

/* Saved Messages badge: same gradient/glyph as the chat list row
 * (ChatSidebarChatsPane .cpAvatarSaved). Inline SVG on purpose —
 * mdi-bookmark-outline is NOT in the MDI subset font, a v-icon would
 * render blank. Shown even when an avatar url exists, like in the list. */
.convAvatarSaved {
  background: linear-gradient(135deg, #4a90d9 0%, #2f6cb3 100%);
  color: #fff;
}

.convSavedGlyph {
  display: block;
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
