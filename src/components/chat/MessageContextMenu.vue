<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'

const props = defineProps<{
  open: boolean
  x: number
  y: number
  showDelete?: boolean
  showEdit?: boolean
  showReact?: boolean
  viewsCount?: number
}>()

const emit = defineEmits<{
  close: []
  copy: []
  react: [emoji: string]
  reply: []
  forward: []
  edit: []
  delete: []
  openPicker: []
}>()

const { t } = useI18n()
const quick = ['❤', '👍', '👎', '🔥', '🥰', '👏', '😁', '🤔']
const menuRef = ref<HTMLElement | null>(null)
const resolvedX = ref(props.x)
const resolvedY = ref(props.y)

function clampMenuPosition() {
  const menu = menuRef.value
  if (!menu) {
    resolvedX.value = props.x
    resolvedY.value = props.y
    return
  }

  const margin = 8
  const menuRect = menu.getBoundingClientRect()
  const maxX = Math.max(margin, window.innerWidth - menuRect.width - margin)
  const maxY = Math.max(margin, window.innerHeight - menuRect.height - margin)

  resolvedX.value = Math.min(Math.max(props.x, margin), maxX)
  resolvedY.value = Math.min(Math.max(props.y, margin), maxY)
}

async function syncMenuPosition() {
  if (!props.open) return
  await nextTick()
  clampMenuPosition()
}

watch(() => [props.open, props.x, props.y], () => {
  void syncMenuPosition()
}, { immediate: true })

const menuStyle = computed(() => ({ left: `${resolvedX.value}px`, top: `${resolvedY.value}px` }))

function handleViewportChange() {
  void syncMenuPosition()
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
}

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cmOverlay" @click="emit('close')">
      <div ref="menuRef" class="cmMenu" :style="menuStyle" @click.stop>
        <div v-if="showReact !== false" class="cmSection cmSectionTight">
          <div class="cmQuickWrap">
            <button v-for="emoji in quick" :key="emoji" type="button" class="cmQuick" @click="emit('react', emoji)">
              <span class="cmEmoji emoji">{{ emoji }}</span>
            </button>
            <button type="button" class="cmQuick cmMore" :title="t('chat.add_reaction', undefined, 'Add reaction')" @click="emit('openPicker')">▾</button>
          </div>
        </div>

        <div v-if="showReact !== false" class="cmDivider" />

        <div class="cmSection">
          <button type="button" class="cmItem" @click="emit('reply')">
            <v-icon icon="mdi-reply" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.reply', undefined, 'Reply') }}</span>
          </button>
          <button type="button" class="cmItem" @click="emit('forward')">
            <v-icon icon="mdi-forward" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.forward', undefined, 'Forward') }}</span>
          </button>
          <button v-if="showEdit" type="button" class="cmItem" @click="emit('edit')">
            <v-icon icon="mdi-pencil" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.edit', undefined, 'Edit') }}</span>
          </button>
          <button type="button" class="cmItem" @click="emit('copy')">
            <v-icon icon="mdi-content-copy" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.copy', undefined, 'Copy') }}</span>
          </button>
        </div>

        <div v-if="(viewsCount || 0) > 0" class="cmDivider" />
        <div v-if="(viewsCount || 0) > 0" class="cmSection">
          <div class="cmItem readonly" role="presentation">
            <v-icon icon="mdi-eye-outline" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ viewsCount }} Seen</span>
          </div>
        </div>

        <div class="cmDivider" />
        <div class="cmSection">
          <button v-if="showDelete" type="button" class="cmItem danger" @click="emit('delete')">
            <v-icon icon="mdi-delete-outline" size="18" class="cmItemIcon" />
            <span class="cmItemText">{{ t('chat.delete', undefined, 'Delete') }}</span>
          </button>
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
  min-width: 240px;
  max-width: min(240px, calc(100vw - 16px));
  background: color-mix(in srgb, var(--surface-strong) 88%, #000);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.34);
  overflow: hidden;
  animation: cmPop 120ms ease-out;
  transform-origin: top left;
}

@keyframes cmPop {
  from {
    opacity: 0;
    transform: translate3d(0, 4px, 0) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

.cmSection {
  padding: 6px;
}

.cmSectionTight {
  padding: 8px 8px 6px;
}

.cmQuickWrap {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}

.cmQuick {
  width: 34px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--surface-soft);
  cursor: pointer;
  user-select: none;
}

.cmQuick:hover,
.cmItem:hover {
  background: var(--surface-soft-hover);
}

.cmQuick:active,
.cmItem:active {
  transform: translate3d(0, 1px, 0);
}

.cmEmoji {
  font-size: 16px;
  line-height: 1;
}

.cmMore {
  font-size: 14px;
  color: var(--text-muted);
}

.cmDivider {
  height: 1px;
  background: color-mix(in srgb, var(--border) 70%, transparent);
}

.cmItem {
  width: 100%;
  min-height: 40px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 12px;
  transition: background 120ms ease, transform 80ms ease;
}

.cmItem.readonly {
  cursor: default;
  opacity: 0.9;
}

.cmItemIcon {
  color: var(--text-soft);
  flex: 0 0 auto;
}

.cmItemText {
  flex: 1 1 auto;
  min-width: 0;
}

.cmItem.danger {
  color: #ef4444;
}

.cmItem.danger .cmItemIcon {
  color: #ef4444;
}
</style>
