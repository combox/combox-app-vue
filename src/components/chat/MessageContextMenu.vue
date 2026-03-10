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
}>()

const emit = defineEmits<{
  close: []
  copy: []
  react: [emoji: string]
  reply: []
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
        <div v-if="showReact !== false" class="cmQuickWrap">
          <button v-for="emoji in quick" :key="emoji" type="button" class="cmQuick" @click="emit('react', emoji)">
            <span class="cmEmoji emoji">{{ emoji }}</span>
          </button>
          <button type="button" class="cmQuick cmMore" :title="t('chat.add_reaction', undefined, 'Add reaction')" @click="emit('openPicker')">▾</button>
        </div>

        <div v-if="showReact !== false" class="cmDivider" />

        <button type="button" class="cmItem" @click="emit('reply')">{{ t('chat.reply', undefined, 'Reply') }}</button>
        <button v-if="showEdit" type="button" class="cmItem" @click="emit('edit')">{{ t('chat.edit', undefined, 'Edit') }}</button>
        <button type="button" class="cmItem" @click="emit('copy')">{{ t('chat.copy', undefined, 'Copy') }}</button>
        <button v-if="showDelete" type="button" class="cmItem danger" @click="emit('delete')">{{ t('chat.delete', undefined, 'Delete') }}</button>
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
  background: var(--surface);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.cmQuickWrap {
  padding: 8px;
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
  background: var(--border);
}

.cmItem {
  width: 100%;
  min-height: 40px;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 8px 14px;
  font-size: 14px;
  color: var(--text);
  cursor: pointer;
}

.cmItem.danger {
  color: #ef4444;
}
</style>
