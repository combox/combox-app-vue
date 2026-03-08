<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ select: [emoji: string] }>()

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
  <div v-if="open" class="rpRoot">
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
</template>

<style scoped>
.rpRoot {
  width: 320px;
  max-width: min(320px, calc(100vw - 16px));
  padding: 10px;
  background: #fff;
}

.rpGrid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 4px;
}

.rpEmoji {
  width: 100%;
  aspect-ratio: 1;
  border: 0;
  border-radius: 10px;
  background: transparent;
  font-size: 23px;
  line-height: 1;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.rpEmoji:hover {
  background: rgba(59, 130, 246, 0.1);
}
</style>
