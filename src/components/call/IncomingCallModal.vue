<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/i18n'
import { avatarColorFor } from '../../utils/avatarColor'

const props = defineProps<{
  title: string
  subtitle?: string
  avatarText?: string
  avatarSrc?: string
  kind?: string
}>()

const emit = defineEmits<{
  accept: []
  decline: []
}>()

const { t } = useI18n()

const isBroadcast = computed(() => (props.kind || '').trim() === 'broadcast')
</script>

<template>
  <Teleport to="body">
    <div class="incomingRoot" role="dialog" aria-modal="true" :aria-label="t('call.incoming', undefined, 'Incoming call')">
      <div class="incomingCard">
        <div class="incomingBadge">
          <span class="incomingPulse" />
          <span class="incomingBadgeText">{{ isBroadcast ? t('call.live_stream', undefined, 'Live stream') : t('call.incoming', undefined, 'Incoming call') }}</span>
        </div>

        <div class="incomingAvatar">
          <img v-if="avatarSrc" class="incomingAvatarImg" :src="avatarSrc" alt="" />
          <div v-else class="incomingAvatarFallback" :style="{ background: avatarColorFor(title) }">{{ avatarText || '?' }}</div>
        </div>

        <div class="incomingTitle">{{ title }}</div>
        <div v-if="subtitle" class="incomingSubtitle">{{ subtitle }}</div>

        <div class="incomingActions">
          <button type="button" class="incomingBtn decline" :aria-label="t('call.decline', undefined, 'Decline')" @click="emit('decline')">
            <v-icon icon="mdi-phone-hangup" size="22" />
          </button>
          <button
            type="button"
            class="incomingBtn accept"
            :aria-label="isBroadcast ? t('call.watch', undefined, 'Watch') : t('call.accept', undefined, 'Accept')"
            :title="isBroadcast ? t('call.watch', undefined, 'Watch') : t('call.accept', undefined, 'Accept')"
            @click="emit('accept')"
          >
            <v-icon :icon="isBroadcast ? 'mdi-play' : 'mdi-phone'" size="22" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.incomingRoot {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  background: rgba(6, 8, 13, 0.62);
  backdrop-filter: blur(6px);
}

.incomingCard {
  width: min(340px, calc(100vw - 32px));
  padding: 26px 22px 22px;
  border-radius: 22px;
  background: var(--surface, #12151d);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.incomingBadge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--surface-soft, rgba(255, 255, 255, 0.06));
  color: var(--text-soft, #9aa4b8);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.incomingPulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2ecc71;
  box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.6);
  animation: callPulse 1.6s ease-out infinite;
}

@keyframes callPulse {
  0% {
    box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.55);
  }
  100% {
    box-shadow: 0 0 0 12px rgba(46, 204, 113, 0);
  }
}

.incomingAvatar {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  overflow: hidden;
  margin-top: 6px;
}

.incomingAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.incomingAvatarFallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: var(--avatar-fallback, #3b4252);
  color: #fff;
  font-size: 34px;
  font-weight: 800;
}

.incomingTitle {
  font-size: 20px;
  font-weight: 800;
  color: var(--text, #e8ecf5);
}

.incomingSubtitle {
  font-size: 13px;
  color: var(--text-muted, #8b93a7);
}

.incomingActions {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 14px;
}

.incomingBtn {
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: #fff;
  transition: transform 0.12s ease, filter 0.12s ease;
}

.incomingBtn:hover {
  transform: translateY(-2px);
  filter: brightness(1.08);
}

.incomingBtn.decline {
  background: #e0465a;
}

.incomingBtn.accept {
  background: #2ecc71;
}
</style>
