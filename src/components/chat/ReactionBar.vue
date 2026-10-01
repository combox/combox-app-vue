<script setup lang="ts">
import { computed } from 'vue'

import { canonicalEmojiKey } from './reactionEmoji'
import { avatarColorFor } from '../../utils/avatarColor'

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
  /** Channels keep the numeric tally; DMs/groups show only who reacted. */
  showCount?: boolean
}>()

const emit = defineEmits<{
  react: [emoji: string]
}>()

const normalized = computed(() => {
  const me = (props.currentUserId || '').trim()
  const avatars = props.avatarByUserId || {}
  const myAvatar = (props.currentUserAvatarSrc || '').trim()

  const groups = new Map<string, { emoji: string; userIds: Set<string>; count: number; mine: boolean }>()

  props.reactions.forEach((item) => {
    const key = canonicalEmojiKey(item.emoji)
    if (!key) return
    const userIds = Array.isArray(item.user_ids)
      ? item.user_ids
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter(Boolean)
      : []
    const rawCount = typeof item.count === 'number' && item.count > 0 ? item.count : userIds.length
    const group = groups.get(key)
    if (!group) {
      groups.set(key, {
        emoji: item.emoji,
        userIds: new Set(userIds),
        count: rawCount,
        mine: Boolean(me && userIds.includes(me)),
      })
      return
    }
    for (const id of userIds) group.userIds.add(id)
    group.count += rawCount
    if (me && userIds.includes(me)) group.mine = true
  })

  return [...groups.values()].map((group) => {
    const userIds = [...group.userIds]
    const count = Math.max(group.count, userIds.length)
    const mine = group.mine || Boolean(me && userIds.includes(me))
    const showAvatars = !props.showCount && userIds.length > 0
    const avatarItems = showAvatars
      ? userIds.slice(0, 4).map((id) => ({
          id,
          src: (id === me ? myAvatar : '') || avatars[id] || '',
        }))
      : []
    const showBadge = Boolean(props.showCount) || userIds.length === 0
    return { emoji: group.emoji, count, mine, showAvatars, showBadge, avatarItems }
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
      <span class="emoji rbEmoji">{{ item.emoji }}</span>
      <span v-if="item.showBadge && item.count > 0" class="rbCount">{{ item.count }}</span>
      <template v-if="item.showAvatars">
        <v-avatar
          v-for="avatar in item.avatarItems"
          :key="avatar.id"
          size="20"
          class="rbAvatar"
          :style="{ background: avatarColorFor(avatar.id) }"
        >
          <img v-if="avatar.src" class="rbAvatarImg" :src="avatar.src" alt="" />
          <span v-else class="rbAvatarFallback">{{ (avatar.id || '?').slice(0, 1).toUpperCase() }}</span>
        </v-avatar>
      </template>
    </button>

  </div>
</template>

<style scoped>
.rbWrap {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  justify-content: flex-start;
  text-align: left;
}

.rbBtn,
.rbAdd {
  border: 1px solid color-mix(in srgb, var(--text-muted) 45%, transparent);
  background: var(--surface-strong);
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
  border: 1px solid var(--surface-strong);
  border-radius: 50%;
  background: var(--avatar-fallback);
  overflow: hidden;
  flex: 0 0 auto;
}

.rbAvatar + .rbAvatar {
  margin-left: -9px;
}

.rbAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.rbAvatarFallback {
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.rbBtn.mine {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 26%, var(--surface-strong));
}

.rbCount {
  font-size: 12px;
  color: var(--text-muted);
}

.rbEmoji {
  line-height: 1;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', 'NotoColorEmoji',
    sans-serif;
}
</style>
