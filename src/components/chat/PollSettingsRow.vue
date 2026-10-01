<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  icon: string
  color: string
  title: string
  subtitle: string
  modelValue: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const iconStyle = computed(() => ({
  color: props.color,
  background: `color-mix(in srgb, ${props.color} 16%, transparent)`,
}))
</script>

<template>
  <div class="psRow" :class="{ psRowOff: !modelValue }">
    <span class="psIcon" :style="iconStyle" aria-hidden="true">
      <v-icon :icon="icon" size="18" />
    </span>
    <span class="psText">
      <span class="psTitle">{{ title }}</span>
      <span class="psSub">{{ subtitle }}</span>
    </span>
    <button
      type="button"
      class="psSwitch"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="title"
      :disabled="disabled"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="psKnob" />
    </button>
  </div>
</template>

<style scoped>
.psRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}

.psIcon {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
}

.psText {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.psTitle {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.25;
}

.psSub {
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--text-muted);
}

.psSwitch {
  flex: 0 0 auto;
  width: 40px;
  height: 22px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft-hover);
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: background 140ms ease;
}

.psSwitch[aria-checked='true'] {
  background: var(--accent);
}

.psSwitch:disabled {
  opacity: 0.55;
  cursor: default;
}

.psSwitch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.psKnob {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.35);
  transition: transform 140ms ease;
}

.psSwitch[aria-checked='true'] .psKnob {
  transform: translateX(18px);
}

@media (prefers-reduced-motion: reduce) {
  .psSwitch,
  .psKnob {
    transition: none;
  }
}
</style>
