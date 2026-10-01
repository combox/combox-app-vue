<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    text?: string
    okLabel?: string
    cancelLabel?: string
    danger?: boolean
  }>(),
  { text: '', okLabel: '', cancelLabel: '', danger: false },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()
const cancelBtn = ref<HTMLButtonElement | null>(null)

const resolvedOk = computed(
  () =>
    props.okLabel ||
    (props.danger ? t('common.delete', undefined, 'Delete') : t('common.confirm', undefined, 'Confirm')),
)
const resolvedCancel = computed(() => props.cancelLabel || t('common.cancel', undefined, 'Cancel'))

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel')
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKeydown)
      // Destructive dialogs start on the safe action.
      void nextTick(() => cancelBtn.value?.focus())
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="cfdOverlay" @click.self="emit('cancel')">
      <div class="cfdDialog" :class="{ danger }" role="alertdialog" aria-modal="true" :aria-label="title">
        <div class="cfdTitle">{{ title }}</div>
        <div v-if="text" class="cfdText">{{ text }}</div>
        <div class="cfdActions">
          <button ref="cancelBtn" type="button" class="cfdBtn cfdCancel" @click="emit('cancel')">
            {{ resolvedCancel }}
          </button>
          <button type="button" class="cfdBtn" :class="danger ? 'cfdDanger' : 'cfdPrimary'" @click="emit('confirm')">
            {{ resolvedOk }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cfdOverlay {
  position: fixed;
  inset: 0;
  z-index: 9600;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(6, 8, 13, 0.55);
}

.cfdDialog {
  width: min(380px, 100%);
  padding: 18px;
  border-radius: 16px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
  color: var(--text);
  animation: cfdPop 140ms ease-out;
}

@keyframes cfdPop {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.cfdTitle {
  font-size: 15px;
  font-weight: 800;
}

.cfdText {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.cfdActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.cfdBtn {
  min-height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}

.cfdBtn:focus-visible {
  outline: 2px solid var(--accent-strong);
  outline-offset: 2px;
}

.cfdCancel {
  background: var(--surface-soft);
  color: var(--text);
}

.cfdCancel:hover {
  background: var(--border);
}

.cfdPrimary {
  background: var(--accent);
  color: #fff;
}

.cfdDanger {
  background: #ef4444;
  color: #fff;
}

.cfdDanger:hover {
  background: #dc2626;
}

@media (prefers-reduced-motion: reduce) {
  .cfdDialog {
    animation: none;
  }
}
</style>
