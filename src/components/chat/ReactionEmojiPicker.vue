<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ open: boolean; x?: number; y?: number }>()
const emit = defineEmits<{ select: [emoji: string] }>()

type PickerRect = { left: number; top: number; right: number; bottom: number }

const POP_MARGIN = 8
const POP_GAP = 8
const POP_EST_W = 336
const POP_EST_H = 320

function readStashedRect(): PickerRect | null {
  try {
    const stash = (window as unknown as { __comboxPickerAnchor?: Partial<PickerRect> }).__comboxPickerAnchor
    if (!stash) return null
    const left = Number(stash.left)
    const top = Number(stash.top)
    const right = Number(stash.right)
    const bottom = Number(stash.bottom)
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
      return null
    }
    return { left, top, right, bottom }
  } catch {
    return null
  }
}

/** Anchor in viewport (client) coords — scroll-safe for `position: fixed`. */
function resolveRect(): PickerRect {
  const stashed = readStashedRect()
  if (stashed) return stashed
  const px = Number(props.x)
  const py = Number(props.y)
  if (Number.isFinite(px) && Number.isFinite(py)) return { left: px, top: py, right: px, bottom: py }
  const cx = Math.round(window.innerWidth / 2)
  const cy = Math.round(window.innerHeight / 2)
  return { left: cx, top: cy, right: cx, bottom: cy }
}

const popRef = ref<HTMLElement | null>(null)
const slotRef = ref<HTMLElement | null>(null)
const posX = ref(0)
const posY = ref(0)
let hiddenHost: HTMLElement | null = null
let prevHostDisplay = ''

const posStyle = computed(() => ({ left: `${Math.round(posX.value)}px`, top: `${Math.round(posY.value)}px` }))

function clampIntoViewport(value: number, size: number, viewport: number): number {
  if (size + POP_MARGIN * 2 >= viewport) return POP_MARGIN
  return Math.min(Math.max(POP_MARGIN, value), Math.max(POP_MARGIN, viewport - size - POP_MARGIN))
}

function placePopover(estW = 0, estH = 0) {
  if (typeof window === 'undefined' || !props.open) return
  const anchor = resolveRect()
  const el = popRef.value
  const w = el?.offsetWidth || estW || POP_EST_W
  const h = el?.offsetHeight || estH || POP_EST_H
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Vertical: prefer below the anchor, flip above when there is no room.
  const below = anchor.bottom + POP_GAP
  const above = anchor.top - POP_GAP - h
  let top: number
  if (below + h <= vh - POP_MARGIN) top = below
  else if (above >= POP_MARGIN) top = above
  else top = below

  // Horizontal: prefer left-aligned with the anchor, shift to right edge on overflow.
  const alignLeft = anchor.left
  const alignRight = anchor.right - w
  let left: number
  if (alignLeft + w <= vw - POP_MARGIN) left = alignLeft
  else if (alignRight >= POP_MARGIN) left = alignRight
  else left = alignLeft

  posX.value = clampIntoViewport(left, w, vw)
  posY.value = clampIntoViewport(top, h, vh)
}

/**
 * ChatMessageList wraps this picker in `.reactionPickerPopover` (position: fixed
 * with a stale top/left). The picker teleports itself to <body>, so the orphaned
 * host box would linger as an empty bordered sliver — hide it while open.
 */
function hideOrphanHost() {
  const host = slotRef.value?.parentElement
  if (!host || !(host instanceof HTMLElement)) return
  if (!host.classList.contains('reactionPickerPopover')) return
  if (hiddenHost === host) return
  hiddenHost = host
  prevHostDisplay = host.style.display
  host.style.display = 'none'
}

function restoreOrphanHost() {
  if (!hiddenHost) return
  try {
    hiddenHost.style.display = prevHostDisplay
  } catch {
    // host already detached — nothing to restore
  }
  hiddenHost = null
}

function handleViewportChange() {
  placePopover()
}

async function syncOnOpen() {
  if (!props.open) {
    restoreOrphanHost()
    return
  }
  // Pre-position from the anchor with estimated size to avoid a flash at 0,0,
  // then correct with real measurements once rendered.
  placePopover(POP_EST_W, POP_EST_H)
  hideOrphanHost()
  await nextTick()
  hideOrphanHost()
  placePopover()
}

watch(
  () => [props.open, props.x, props.y],
  () => {
    void syncOnOpen()
  },
)

onMounted(() => {
  if (typeof window === 'undefined') return
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
  window.visualViewport?.addEventListener('resize', handleViewportChange)
  if (props.open) void syncOnOpen()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleViewportChange)
    window.removeEventListener('scroll', handleViewportChange, true)
    window.visualViewport?.removeEventListener('resize', handleViewportChange)
  }
  restoreOrphanHost()
})

const REACTION_EMOJIS = [
  '❤',
  '👍',
  '👎',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🙏',
  '👌',
  '🕊',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '❤‍🔥',
  '🌚',
  '🌭',
  '💯',
  '🤣',
  '⚡',
  '🍌',
  '🏆',
  '💔',
  '🤨',
  '🍾',
  '💋',
  '😈',
  '😴',
  '😭',
  '🤓',
  '👻',
  '👨‍💻',
  '👀',
  '🎃',
  '😨',
  '🤝',
  '✍',
  '🤗',
  '🫡',
  '☃',
  '💅',
  '🗿',
  '💘',
] as const
</script>

<template>
  <span ref="slotRef" class="rpSlot" aria-hidden="true" />
  <Teleport to="body">
    <div v-if="open" ref="popRef" class="rpPopover" :style="posStyle" @click.stop>
      <div class="rpGrid">
        <button
          v-for="emoji in REACTION_EMOJIS"
          :key="emoji"
          type="button"
          class="rpEmoji emoji"
          :aria-label="emoji"
          @click="emit('select', emoji)"
        >{{ emoji }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rpSlot {
  display: none;
}

.rpPopover {
  position: fixed;
  z-index: 10002;
  width: min(336px, calc(100vw - 16px));
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow: hidden;
  padding: 10px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--text-muted) 35%, transparent);
  background: var(--surface-strong);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  backdrop-filter: blur(18px) saturate(160%);
  border-radius: 14px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.32);
  animation: rpPopIn 140ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

@keyframes rpPopIn {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .rpPopover { animation: none; }
}

.rpGrid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
  justify-content: center;
  justify-items: center;
  align-items: center;
  width: 100%;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
}

.rpEmoji {
  width: 100%;
  aspect-ratio: 1;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  justify-self: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', 'NotoColorEmoji',
    sans-serif;
  font-size: 23px;
  line-height: 1;
  display: grid;
  place-items: center;
  cursor: pointer;
  outline: none;
  box-shadow: none;
}

.rpEmoji:hover {
  background: color-mix(in srgb, var(--accent) 30%, var(--surface-strong));
}

.rpEmoji:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 65%, transparent);
  outline-offset: 1px;
}
</style>
