<script setup lang="ts">
const props = defineProps<{
  title: string
  subtitle: string
  avatarText: string
  avatarSrc?: string
  searchOpen: boolean
  searchValue: string
}>()

const emit = defineEmits<{
  openInfo: []
  openSearch: []
  closeSearch: []
  updateSearch: [value: string]
  openMenu: [anchor: { top: number; left: number; width: number; height: number }]
}>()

function openMenu(event: MouseEvent) {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  emit('openMenu', { top: rect.bottom, left: rect.left, width: rect.width, height: rect.height })
}
</script>

<template>
  <header class="convHeader">
    <div class="convInner">
      <template v-if="searchOpen">
        <div class="convSearch">
          <v-icon icon="mdi-magnify" size="18" class="convSearchIcon" />
          <input
            class="convSearchInput"
            :value="searchValue"
            autofocus
            placeholder="Search"
            @input="emit('updateSearch', ($event.target as HTMLInputElement).value)"
          />
          <button type="button" class="convActionBtn" aria-label="Close search" @click="emit('closeSearch')">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
      </template>

      <template v-else>
        <div
          class="convPeer"
          role="button"
          tabindex="0"
          @click="emit('openInfo')"
          @keydown.enter.prevent="emit('openInfo')"
          @keydown.space.prevent="emit('openInfo')"
        >
          <div v-if="avatarSrc" class="convAvatarWrap">
            <img class="convAvatarImg" :src="avatarSrc" alt="" />
          </div>
          <div v-else class="convAvatarFallback">{{ avatarText }}</div>
          <div class="convMeta">
            <div class="convTitle">{{ title }}</div>
            <div class="convSubtitle">{{ subtitle }}</div>
          </div>
        </div>
      </template>

      <div class="convActions">
        <button type="button" class="convActionBtn" aria-label="Search" @click="emit('openSearch')">
          <v-icon icon="mdi-magnify" size="18" />
        </button>
        <button type="button" class="convActionBtn" aria-label="Menu" @click="openMenu">
          <v-icon icon="mdi-dots-vertical" size="18" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.convHeader {
  position: sticky;
  top: 0;
  z-index: 3;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}

.convInner {
  width: 100%;
  min-height: 63px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.convPeer {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  cursor: pointer;
}

.convMeta {
  min-width: 0;
}

.convAvatarWrap,
.convAvatarFallback {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 auto;
}

.convTitle {
  font-size: 18px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--text);
}

.convSubtitle {
  font-size: 12px;
  color: var(--text-muted);
}

.convAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.convAvatarFallback {
  display: grid;
  place-items: center;
  background: var(--avatar-fallback);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -.02em;
}

.convActions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.convActionBtn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.convActionBtn:hover {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.convSearch {
  min-width: 0;
  flex: 1;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-soft);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
}

.convSearchIcon {
  color: var(--text-muted);
}

.convSearchInput {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 16px;
  color: var(--text);
}
</style>
