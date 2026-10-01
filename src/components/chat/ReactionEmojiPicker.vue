<script setup lang="ts">
defineProps<{ open: boolean }>()
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
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  padding: 10px;
  box-sizing: border-box;
  background: transparent;
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
