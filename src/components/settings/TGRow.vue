<script setup lang="ts">
defineProps<{
  icon: string
  title: string
  sub?: string
  value?: string
  danger?: boolean
}>()

defineEmits<{ click: [] }>()
</script>

<template>
  <button type="button" class="tgRow" :class="{ 'tgRow--danger': danger }" @click="$emit('click')">
    <span class="tgRowIcon" aria-hidden="true"><v-icon :icon="icon" size="20" /></span>
    <span class="tgRowMain">
      <span class="tgRowTitle">{{ title }}</span>
      <span v-if="sub" class="tgRowSub">{{ sub }}</span>
    </span>
    <span v-if="value" class="tgRowValue">{{ value }}</span>
    <v-icon icon="mdi-chevron-right" size="20" class="tgRowChevron" />
  </button>
</template>
