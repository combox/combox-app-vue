<script setup lang="ts">
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../i18n/i18n'

const { items, dismiss } = useToast()
const { t } = useI18n()

const KIND_LABEL: Record<string, string> = {
  neutral: t('toast.info', undefined, 'Info'),
  info: t('toast.info', undefined, 'Info'),
  success: t('toast.success', undefined, 'Done'),
  error: t('toast.error', undefined, 'Error'),
}

function kindIcon(kind: string): string {
  if (kind === 'success') return 'mdi-check-circle-outline'
  if (kind === 'error') return 'mdi-alert-circle-outline'
  return 'mdi-information-outline'
}
</script>

<template>
  <Teleport to="body">
    <div class="toastHost" aria-live="polite">
      <TransitionGroup name="toast">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="toast"
          :class="`toast--${item.kind}`"
          @click="dismiss(item.id)"
        >
          <v-icon :icon="kindIcon(item.kind)" size="18" class="toastIcon" />
          <span class="toastText">
            <span v-if="KIND_LABEL[item.kind]" class="toastLabel">{{ KIND_LABEL[item.kind] }}</span>
            <span>{{ item.message }}</span>
          </span>
          <span class="toastClose"><v-icon icon="mdi-close" size="14" /></span>
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toastHost {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: grid;
  gap: 10px;
  width: min(380px, calc(100vw - 24px));
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-strong) 92%, #000);
  color: var(--text);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(14px);
  cursor: pointer;
}

.toast--success {
  border-color: rgba(34, 197, 94, 0.4);
}

.toast--error {
  border-color: rgba(239, 68, 68, 0.4);
}

.toastIcon {
  color: var(--text-soft);
  flex: 0 0 auto;
}

.toast--success .toastIcon {
  color: #22c55e;
}

.toast--error .toastIcon {
  color: #ef4444;
}

.toastText {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;
}

.toastLabel {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.toastClose {
  color: var(--text-muted);
  flex: 0 0 auto;
  display: grid;
  place-items: center;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>