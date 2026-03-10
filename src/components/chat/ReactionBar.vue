<script setup lang="ts">
import { computed } from 'vue'

type Reaction = {
  emoji: string
  count?: number
  user_ids: string[]
}

const props = defineProps<{
  reactions: Reaction[]
  currentUserId: string
  currentUserAvatarSrc?: string
  avatarByUserId?: Record<string, string>
  canReact?: boolean
}>()

const emit = defineEmits<{
  react: [emoji: string]
}>()

const normalized = computed(() => {
  const me = (props.currentUserId || '').trim()
  const avatars = props.avatarByUserId || {}
  const myAvatar = (props.currentUserAvatarSrc || '').trim()
  return props.reactions.map((item) => {
    const userIds = Array.isArray(item.user_ids)
      ? item.user_ids
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter(Boolean)
      : []
    const count = typeof item.count === 'number' && item.count > 0 ? item.count : userIds.length
    const mine = Boolean(me && userIds.includes(me))
    const showAvatars = userIds.length > 0 && count > 0 && count <= 2
    const avatarItems = showAvatars
      ? userIds.slice(0, 2).map((id) => ({
          id,
          src: (id === me ? myAvatar : '') || avatars[id] || '',
        }))
      : []
    return { emoji: item.emoji, count, mine, showAvatars, avatarItems }
  })
})

</script>

<template>
  <div class="rbWrap">
    <button
      v-for="item in normalized"
      :key="item.emoji"
      type="button"
      class="rbBtn"
      :class="{ mine: item.mine }"
      :disabled="canReact === false"
      @click="canReact !== false && emit('react', item.emoji)"
    >
      <template v-if="item.showAvatars">
        <v-avatar
          v-for="avatar in item.avatarItems"
          :key="avatar.id"
          size="18"
          rounded="0"
          color="grey-lighten-2"
          class="rbAvatar"
        >
          <img v-if="avatar.src" class="rbAvatarImg" :src="avatar.src" alt="" />
          <span v-else>{{ (avatar.id || '?').slice(0, 1).toUpperCase() }}</span>
        </v-avatar>
      </template>
      <span class="emoji rbEmoji">{{ item.emoji }}</span>
      <span v-if="item.count > 1" class="rbCount">{{ item.count }}</span>
    </button>

  </div>
</template>

<style scoped>
.rbWrap {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.rbBtn,
.rbAdd {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 999px;
  height: 26px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
}

.rbBtn:disabled {
  opacity: 0.72;
  cursor: default;
}

.rbAvatar {
  margin-left: -4px;
  border: 1px solid var(--border);
}

.rbBtn .rbAvatar:first-child {
  margin-left: 0;
}

.rbAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.rbBtn.mine {
  border-color: rgba(74, 144, 217, 0.42);
  background: var(--accent-soft);
}

.rbCount {
  font-size: 12px;
  color: var(--text-muted);
}

.rbEmoji {
  line-height: 1;
}
</style>
