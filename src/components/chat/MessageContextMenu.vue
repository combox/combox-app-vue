<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { avatarColorFor } from '../../utils/avatarColor'

const QUICK_REACTIONS_KEY = 'combox_quick_reactions'
const QUICK_REACTIONS_LIMIT = 7
const QUICK_REACTIONS_FALLBACK = ['👍', '❤️', '🔥', '😂', '😭', '🎉']

type MenuReactionActor = { user_id: string; at: string }
type MenuReaction = { emoji: string; count?: number; user_ids?: string[]; actors?: MenuReactionActor[] }

const props = defineProps<{
  open: boolean
  x: number
  y: number
  showDelete?: boolean
  showEdit?: boolean
  showReact?: boolean
  showSave?: boolean
  showTranslate?: boolean
  viewsCount?: number
  mode?: 'message' | 'call'
  showPin?: boolean
  pinned?: boolean
  reactions?: MenuReaction[]
  reactionNames?: Record<string, string>
  reactionAvatars?: Record<string, string>
}>()

const emit = defineEmits<{
  close: []
  copy: [text?: string]
  copyLink: []
  react: [emoji: string]
  reply: []
  forward: []
  edit: []
  delete: []
  save: []
  pin: []
  report: []
  select: []
  translate: []
  openPicker: []
}>()

const { t } = useI18n()
const menuRef = ref<HTMLElement | null>(null)
const resolvedX = ref(props.x)
const resolvedY = ref(props.y)

function readQuickReactions(): string[] {
  try {
    const raw = localStorage.getItem(QUICK_REACTIONS_KEY)
    if (!raw) return [...QUICK_REACTIONS_FALLBACK]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...QUICK_REACTIONS_FALLBACK]
    const emojis = parsed.filter((item) => typeof item === 'string' && item.trim().length > 0)
    return emojis.slice(0, QUICK_REACTIONS_LIMIT)
  } catch {
    return [...QUICK_REACTIONS_FALLBACK]
  }
}

function writeQuickReactions(emojis: string[]) {
  try {
    localStorage.setItem(QUICK_REACTIONS_KEY, JSON.stringify(emojis.slice(0, QUICK_REACTIONS_LIMIT)))
  } catch {
    // storage unavailable
  }
}

const quickReactions = ref<string[]>(readQuickReactions())
const selectionText = ref('')
const contextHasText = ref(true)
const reactorsOpen = ref(false)
const menuBoxWidth = ref(0)

type ReactorRow = { id: string; name: string; avatar: string; emoji: string; at: string }

const reactorRows = computed<ReactorRow[]>(() => {
  const atById = new Map<string, string>()
  for (const reaction of props.reactions || []) {
    for (const actor of reaction.actors || []) {
      const id = String(actor?.user_id || '').trim()
      const at = String(actor?.at || '').trim()
      if (id && at) atById.set(id, at)
    }
  }
  const seen = new Map<string, ReactorRow>()
  for (const reaction of props.reactions || []) {
    const emoji = String(reaction.emoji || '').trim()
    const ids = Array.isArray(reaction.user_ids) ? reaction.user_ids : []
    for (const rawID of ids) {
      const id = String(rawID || '').trim()
      if (!id || seen.has(id)) continue
      seen.set(id, {
        id,
        name: String((props.reactionNames || {})[id] || '').trim() || id.slice(0, 8),
        avatar: String((props.reactionAvatars || {})[id] || '').trim(),
        emoji,
        at: atById.get(id) || '',
      })
    }
  }
  return [...seen.values()]
})

const reactorCount = computed(() => reactorRows.value.length)

function formatReactionTime(value: string): string {
  const iso = String(value || '').trim()
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const stamp = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfToday - stamp) / 86400000)
  if (dayDiff <= 0) return `${t('chat.date.today', undefined, 'Today')} ${time}`
  if (dayDiff === 1) return `${t('chat.date.yesterday', undefined, 'Yesterday')} ${time}`
  return `${date.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${time}`
}

function toggleReactors() {
  reactorsOpen.value = !reactorsOpen.value
  void syncMenuPosition()
}

function recordReaction(emoji: string) {
  const next = [emoji, ...quickReactions.value.filter((item) => item !== emoji)]
  quickReactions.value = next.slice(0, QUICK_REACTIONS_LIMIT)
  writeQuickReactions(quickReactions.value)
}

function onQuickReact(emoji: string) {
  recordReaction(emoji)
  emit('react', emoji)
}

function clampMenuPosition() {
  const menu = menuRef.value
  if (!menu) {
    resolvedX.value = props.x
    resolvedY.value = props.y
    return
  }

  const menuWidth = menu.offsetWidth
  const menuHeight = menu.offsetHeight
  const padding = 10

  let posX = props.x
  let posY = props.y

  if (posY + menuHeight > window.innerHeight - padding) {
    posY = Math.max(padding, posY - menuHeight)
  }
  if (posX + menuWidth > window.innerWidth - padding) {
    posX = Math.max(padding, window.innerWidth - menuWidth - padding)
  }

  resolvedX.value = Math.round(posX)
  resolvedY.value = Math.round(posY)
  menuBoxWidth.value = menu.offsetWidth
}

async function syncMenuPosition() {
  if (!props.open) return
  await nextTick()
  clampMenuPosition()
}

watch(
  () => [props.open, props.x, props.y],
  () => {
    if (props.open) {
      quickReactions.value = readQuickReactions()
      selectionText.value = isCallMode.value ? '' : readSelectionAt(props.x, props.y)
      contextHasText.value = isCallMode.value ? false : readLastContextHasText()
    } else {
      selectionText.value = ''
      reactorsOpen.value = false
    }
    void syncMenuPosition()
  },
  { immediate: true },
)

const menuStyle = computed(() => ({ left: `${resolvedX.value}px`, top: `${resolvedY.value}px` }))

const reactorsStyle = computed(() => {
  if (typeof window === 'undefined') return { left: '0px', top: '0px' }
  const width = 272
  const maxHeight = Math.min(360, Math.max(160, window.innerHeight - 24))
  const padding = 10
  let left = resolvedX.value + (menuBoxWidth.value || 256) + 8
  if (left + width > window.innerWidth - padding) {
    left = resolvedX.value - width - 8
  }
  left = Math.min(Math.max(padding, left), Math.max(padding, window.innerWidth - width - padding))
  const top = Math.max(padding, Math.min(resolvedY.value, window.innerHeight - maxHeight - padding))
  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  }
})

const isCallMode = computed(() => props.mode === 'call')

function readSelectionAt(x: number, y: number): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return ''
  try {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return ''
    const text = selection.toString()
    if (!text.trim()) return ''
    const hit = document.elementFromPoint(x, y)
    if (hit && !(hit.contains(selection.anchorNode) || hit.contains(selection.focusNode))) return ''
    return text
  } catch {
    return ''
  }
}

function onCopyClick() {
  emit('copy', selectionText.value || undefined)
}

/** R19 translate: the menu never receives the message itself (parent chain is frozen),
 * so MessageBubble stashes { id, text } on contextmenu and the bubble picks it up
 * through the window event below. `translate` is still emitted for future wiring. */
function readLastContextHasText(): boolean {
  try {
    const stash = (window as unknown as { __comboxLastContextMessage?: { text?: unknown } })
      .__comboxLastContextMessage
    if (!stash) return true
    return String(stash.text || '').trim().length > 0
  } catch {
    return true
  }
}

function onTranslateClick() {
  try {
    const stash = (window as unknown as { __comboxLastContextMessage?: { id?: unknown } })
      .__comboxLastContextMessage
    const id = String(stash?.id || '').trim()
    if (id) {
      window.dispatchEvent(new CustomEvent('combox:translate-message', { detail: { messageID: id } }))
    }
  } catch {
    // Window bridge unavailable; the parent may still handle `translate`.
  }
  emit('translate')
  emit('close')
}

function handleViewportChange() {
  void syncMenuPosition()
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  if (typeof window === 'undefined') return
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cmOverlay" @click="emit('close')">
      <div ref="menuRef" class="cmMenu" :class="{ call: isCallMode }" :style="menuStyle" @click.stop>
        <template v-if="isCallMode">
          <div class="cmSection">
            <button type="button" class="cmItem danger" @click="emit('delete')">
              <v-icon icon="mdi-delete-outline" size="18" class="cmItemIcon" />
              <span class="cmItemText">{{ t('chat.delete', undefined, 'Delete') }}</span>
            </button>
          </div>
        </template>

        <template v-else>
        <div v-if="showReact !== false" class="cmReactions">
          <button
            v-for="emoji in quickReactions"
            :key="emoji"
            type="button"
            class="cmQuick"
            @click="onQuickReact(emoji)"
          >
            <span class="cmEmoji emoji">{{ emoji }}</span>
          </button>
          <button
            type="button"
            class="cmQuick cmMore"
            :title="t('chat.add_reaction', undefined, 'Add reaction')"
            aria-label="More reactions"
            @click="emit('openPicker')"
          >
            <svg class="cmMoreIcon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div class="cmDivider" />

        <div class="cmSection">
          <button type="button" class="cmItem" @click="emit('reply')">
            <v-icon icon="mdi-reply" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.reply', undefined, 'Reply') }}</span>
          </button>
          <button v-if="showPin" type="button" class="cmItem" @click="emit('pin')">
            <v-icon :icon="pinned ? 'mdi-pin-off-outline' : 'mdi-pin-outline'" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ pinned ? t('chat.unpin', undefined, 'Unpin') : t('chat.pin', undefined, 'Pin') }}</span>
          </button>
          <button type="button" class="cmItem" @click="onCopyClick">
            <v-icon icon="mdi-content-copy" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{
              selectionText ? t('chat.copy_selection', undefined, 'Copy selection') : t('chat.copy_text', undefined, 'Copy text')
            }}</span>
          </button>
          <button type="button" class="cmItem" @click="emit('copyLink')">
            <v-icon icon="mdi-link-variant" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.copy_link', undefined, 'Copy message link') }}</span>
          </button>
          <button type="button" class="cmItem" @click="emit('forward')">
            <v-icon icon="mdi-forward" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.forward', undefined, 'Forward') }}</span>
          </button>
          <button v-if="showTranslate !== false && contextHasText" type="button" class="cmItem" @click="onTranslateClick">
            <v-icon icon="mdi-translate" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.translate', undefined, 'Translate') }}</span>
          </button>
          <button v-if="showEdit" type="button" class="cmItem" @click="emit('edit')">
            <v-icon icon="mdi-pencil" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.edit', undefined, 'Edit') }}</span>
          </button>
          <button type="button" class="cmItem danger" @click="emit('delete')">
            <v-icon icon="mdi-delete-outline" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.delete', undefined, 'Delete') }}</span>
          </button>
          <button type="button" class="cmItem" @click="emit('report')">
            <v-icon icon="mdi-flag-outline" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.report', undefined, 'Report') }}</span>
          </button>
          <button type="button" class="cmItem" @click="emit('select')">
            <v-icon icon="mdi-checkbox-multiple-marked-outline" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.select', undefined, 'Select') }}</span>
          </button>
          <button v-if="showSave" type="button" class="cmItem" @click="emit('save')">
            <v-icon icon="mdi-playlist-plus" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.save_to_playlist', undefined, 'Save to profile') }}</span>
          </button>
        </div>

        <template v-if="reactorCount > 0">
          <div class="cmDivider" />
          <div class="cmSection">
            <button type="button" class="cmItem" :class="{ active: reactorsOpen }" @click.stop="toggleReactors">
              <v-icon icon="mdi-heart-outline" size="18" class="cmItemIcon" />
              <span class="cmItemText">{{
                t('chat.reactions_count', { count: reactorCount }, `${reactorCount} Reactions`)
              }}</span>
              <v-icon :icon="reactorsOpen ? 'mdi-chevron-up' : 'mdi-chevron-right'" size="16" class="cmItemChevron" />
            </button>
          </div>
        </template>

        <div v-if="(viewsCount || 0) > 0" class="cmDivider" />
        <div v-if="(viewsCount || 0) > 0" class="cmSection">
          <div class="cmItem readonly" role="presentation">
            <v-icon icon="mdi-eye-outline" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ viewsCount }} Seen</span>
          </div>
        </div>
        </template>
      </div>

      <div
        v-if="reactorCount > 0 && reactorsOpen"
        class="cmReactors"
        :style="reactorsStyle"
        @click.stop
      >
        <div class="cmReactorsHead">
          <span class="cmReactorsTitle">{{ t('chat.reactions_title', undefined, 'Reactions') }}</span>
          <button
            type="button"
            class="cmReactorsClose"
            :aria-label="t('common.close', undefined, 'Close')"
            @click="reactorsOpen = false"
          >
            <v-icon icon="mdi-close" size="16" />
          </button>
        </div>
        <div class="cmReactorsList">
          <div v-for="row in reactorRows" :key="row.id" class="cmReactor">
            <v-avatar size="30" class="cmReactorAvatar" :style="{ background: avatarColorFor(row.id) }">
              <img v-if="row.avatar" class="cmReactorAvatarImg" :src="row.avatar" alt="" />
              <span v-else class="cmReactorAvatarFallback">{{ (row.name || '?').slice(0, 1).toUpperCase() }}</span>
            </v-avatar>
            <span class="cmReactorMeta">
              <span class="cmReactorName">{{ row.name }}</span>
              <span v-if="row.at" class="cmReactorAt">{{ formatReactionTime(row.at) }}</span>
            </span>
            <span class="emoji cmReactorEmoji">{{ row.emoji }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmOverlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}

.cmMenu {
  position: fixed;
  min-width: 256px;
  max-width: min(256px, calc(100vw - 16px));
  padding: 6px 8px 8px;
  background: var(--surface-strong, rgba(30, 31, 38, 0.96));
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-soft, 0 4px 20px rgba(0, 0, 0, 0.25));
  color: var(--text, #e1e1e6);
  animation: cmPop 100ms ease-out;
  transform-origin: top left;
}

@keyframes cmPop {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.cmReactions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 2px;
  padding: 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-muted) 18%, var(--surface-strong));
  flex-wrap: nowrap;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.cmQuick {
  flex: 1 1 0;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  outline: none;
  box-shadow: none;
  border-radius: 8px;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  user-select: none;
  transition: transform 100ms ease, background 100ms ease;
}

.cmQuick:hover {
  background: color-mix(in srgb, var(--accent) 30%, var(--surface-strong));
  border: 0;
  outline: none;
  box-shadow: none;
  transform: scale(1.12);
}

.cmQuick:active {
  transform: scale(0.94);
}

.cmQuick:focus,
.cmQuick:focus-visible {
  border: 0;
  outline: none;
  box-shadow: none;
}

.cmEmoji {
  font-size: 17px;
  line-height: 1;
}

.cmMore {
  margin-left: 0;
  flex: 0 0 auto;
  width: 28px;
  min-width: 28px;
  height: 28px;
  aspect-ratio: 1 / 1;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-soft, #e1e1e6);
  cursor: pointer;
  transition: background 100ms ease, transform 100ms ease, border-color 100ms ease;
}

.cmMore:hover {
  background: color-mix(in srgb, var(--accent) 30%, var(--surface-strong));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  outline: none;
  box-shadow: none;
  transform: scale(1.12);
}

.cmMore:active {
  transform: scale(0.94);
}

.cmMore:focus,
.cmMore:focus-visible {
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  outline: none;
  box-shadow: none;
}

.cmMore.selected,
.cmMore.is-open,
.cmMore[aria-expanded='true'] {
  width: 28px;
  min-width: 28px;
  height: 28px;
  aspect-ratio: 1 / 1;
  padding: 0;
  box-sizing: border-box;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 30%, var(--surface-strong));
}

.cmMoreIcon {
  width: 16px;
  height: 16px;
  display: block;
}

.cmDivider {
  height: 1px;
  margin: 6px 2px;
  background: var(--border, rgba(255, 255, 255, 0.07));
}

.cmSection {
  display: grid;
  gap: 2px;
}

.cmItem {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text, #e1e1e6);
  cursor: pointer;
  display: flex;
  align-items: center;
  border-radius: 6px;
  transition: background 100ms ease;
}

.cmItem:hover {
  background: var(--surface-soft-hover, rgba(255, 255, 255, 0.08));
}

.cmItem.readonly {
  cursor: default;
  opacity: 0.9;
}

.cmItemIcon {
  color: var(--text-muted, #9a9bb0);
  flex: 0 0 auto;
  margin-right: 12px;
  font-size: 18px;
}

.cmItemText {
  flex: 1 1 auto;
  min-width: 0;
  line-height: 1;
}

.cmItem.danger {
  color: #ef4444;
}

.cmItem.danger .cmItemIcon {
  color: #ef4444;
}

.cmItem.danger:hover {
  background: rgba(239, 68, 68, 0.14);
}

.cmItem.active {
  background: var(--surface-soft-hover, rgba(255, 255, 255, 0.08));
}

.cmItemChevron {
  color: var(--text-muted, #9a9bb0);
  flex: 0 0 auto;
  margin-left: 8px;
}

.cmReactors {
  position: fixed;
  width: 272px;
  min-width: 272px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-strong, rgba(30, 31, 38, 0.96));
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-soft, 0 4px 20px rgba(0, 0, 0, 0.25));
  color: var(--text, #e1e1e6);
  animation: cmPop 100ms ease-out;
}

.cmReactorsHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--border);
}

.cmReactorsTitle {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-soft, #9a9bb0);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cmReactorsClose {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: transparent;
  color: var(--text-muted, #9a9bb0);
  cursor: pointer;
}

.cmReactorsClose:hover {
  background: var(--surface-soft-hover, rgba(255, 255, 255, 0.08));
}

.cmReactorsList {
  overflow-y: auto;
  padding: 6px;
  display: grid;
  gap: 2px;
}

.cmReactor {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
}

.cmReactor:hover {
  background: var(--surface-soft-hover, rgba(255, 255, 255, 0.08));
}

.cmReactorAvatar {
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  background: var(--avatar-fallback);
}

.cmReactorAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cmReactorAvatarFallback {
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.cmReactorMeta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cmReactorName {
  font-size: 14px;
  color: var(--text, #e1e1e6);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmReactorAt {
  font-size: 12px;
  color: var(--text-muted, #9a9bb0);
}

.cmReactorEmoji {
  flex: 0 0 auto;
  font-size: 17px;
  line-height: 1;
}
</style>