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
const isImage = props.item.file.type.startsWith('image/')

function fileExt(name: string): string {
  const base = (name || '').trim()
  const idx = base.lastIndexOf('.')
  if (idx < 0) return ''
  const ext = base.slice(idx + 1).trim().toLowerCase()
  return ext && ext.length <= 8 ? ext : ''
}

const extLabel = fileExt(props.item.file.name)

onMounted(() => {
  // Only create blob previews for media that we can actually render.
  if (isVideo || isImage) {
    previewUrl.value = URL.createObjectURL(props.item.file)
  }
})

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div class="tile">
    <div class="tileMedia">
      <video v-if="previewUrl && isVideo" :src="previewUrl" muted playsinline preload="metadata" />
      <img v-else-if="previewUrl && isImage" :src="previewUrl" :alt="item.file.name" />
      <div v-else class="tileFile">
        <v-icon icon="mdi-file-outline" size="28" />
        <div v-if="extLabel" class="tileExt">{{ extLabel }}</div>
      </div>
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

.tileFile {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: rgba(0, 0, 0, 0.7);
  background: rgba(0, 0, 0, 0.03);
  position: relative;
}

.tileExt {
  position: absolute;
  bottom: 6px;
  left: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(0, 0, 0, 0.7);
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(0, 0, 0, 0.08);
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
