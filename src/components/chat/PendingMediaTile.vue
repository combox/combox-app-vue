<script setup lang="ts">
import type { PendingFile } from '../../models/chat'
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  item: PendingFile
}>()

const emit = defineEmits<{
  remove: [id: string]
}>()

const previewUrl = ref('')
const isVideo = props.item.file.type.startsWith('video/')

onMounted(() => {
  previewUrl.value = URL.createObjectURL(props.item.file)
})

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div class="tile">
    <div class="tileMedia">
      <video v-if="previewUrl && isVideo" :src="previewUrl" muted playsinline preload="metadata" />
      <img v-else-if="previewUrl" :src="previewUrl" :alt="item.file.name" />
      <button type="button" class="tileRemove" @click="emit('remove', item.id)">
        <v-icon icon="mdi-close" size="16" />
      </button>
    </div>
    <div class="tileName" :title="item.file.name">{{ item.file.name }}</div>
    <div v-if="item.progress > 0" class="tileProgress">{{ item.progress }}%</div>
  </div>
</template>

<style scoped>
.tile {
  width: 86px;
  display: grid;
  gap: 4px;
}

.tileMedia {
  position: relative;
  width: 86px;
  height: 86px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.05);
}

.tileMedia img,
.tileMedia video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tileRemove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 22px;
  height: 22px;
  border: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.tileName,
.tileProgress {
  font-size: 11px;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tileProgress {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.6);
}
</style>
