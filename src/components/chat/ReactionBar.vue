<script setup lang="ts">
import { computed } from 'vue'

type Reaction = {
  emoji: string
  user_ids: string[]
}

const props = defineProps<{
  reactions: Reaction[]
  currentUserId: string
  currentUserAvatarSrc?: string
  avatarByUserId?: Record<string, string>
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
    const count = userIds.length
    const mine = Boolean(me && userIds.includes(me))
    const showAvatars = count > 0 && count <= 2
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
      @click="emit('react', item.emoji)"
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
      <span>{{ item.emoji }}</span>
      <span v-if="item.count > 1" class="rbCount">{{ item.count }}</span>
    </button>

    <button type="button" class="rbAdd" @click="emit('react', '❤️')">
      <v-icon icon="mdi-emoticon-happy-outline" size="16" />
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
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  border-radius: 4px;
  height: 26px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
}

.rbAvatar {
  margin-left: -4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
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
  border-color: #1e88e5;
  background: rgba(30, 136, 229, 0.08);
}

.rbAdd {
  width: 28px;
  padding: 0;
  justify-content: center;
  opacity: 0.72;
}

.rbCount {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
}
</style>
