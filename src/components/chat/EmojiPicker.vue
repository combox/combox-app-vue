<script setup lang="ts">
import { addRecentGif, listRecentGifs, searchGifs, type GIFItem } from 'combox-api'
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'

type PickerTab = 'emoji' | 'gif' | 'stickers'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  select: [emoji: string]
  selectGif: [item: GIFItem]
}>()
const { t } = useI18n()

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tab = ref<PickerTab>('emoji')

// ── Emoji data ────────────────────────────────────────────────────────────────
const EMOJI_SECTIONS = [
  {
    label: 'Recently used',
    emojis: ['😀', '😘', '🎄', '🧠', '🏆', '🦆', '🍒', '🔥', '❤️', '👍'],
  },
  {
    label: 'Smileys & People',
    emojis: ['😀','😄','😁','😂','🤣','😊','😍','😘','😎','🤔','😴','🙃','😅','😜','🥹','😌','🥳','😇','🥰','😉','🤩','😮','😢','😴','🤗','🤭','🫠','🫡','😤','😡','🥺','😭','😱','🫶','🙌','👏','🤝','👌','✌️','🤞','☝️','👍','👎','✅','❌'],
  },
  {
    label: 'Animals & Nature',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐙','🦋','🌸','🌺','🍀','🌿','🌊','🔥','⚡','🌈','⭐','🌙'],
  },
  {
    label: 'Food & Drink',
    emojis: ['🍕','🍔','🌮','🍜','🍱','🍣','🍩','🎂','🍰','🍦','🍫','🍬','☕','🧃','🍺','🥂','🍒','🍓','🍑','🥝','🫐','🍇'],
  },
  {
    label: 'Activities',
    emojis: ['⚽','🏀','🏈','🎾','🏐','🎮','🎯','🎲','🎸','🎹','🎤','🎬','🏆','🥇','🎉','🎊','💪','🏋️','🤸','🧘'],
  },
  {
    label: 'Objects',
    emojis: ['💡','🔑','🔒','📱','💻','⌨️','🖥️','📷','📚','📝','✏️','🖊️','📌','📎','🔧','🔨','💰','💳','🎁','📦','📮','🗺️'],
  },
]

const emojiQuery = ref('')
const filteredSections = computed(() => {
  const q = emojiQuery.value.trim().toLowerCase()
  if (!q) return EMOJI_SECTIONS
  const allEmojis = EMOJI_SECTIONS.flatMap((s) => s.emojis).filter((e) => e.includes(q))
  return allEmojis.length ? [{ label: t('chat.emoji_search_results'), emojis: allEmojis }] : []
})

// ── GIF state ─────────────────────────────────────────────────────────────────
const gifQuery = ref('')
const gifQueryDebounced = ref('')
const gifRecent = ref<GIFItem[]>([])
const gifPopular = ref<GIFItem[]>([])
const gifPopularNextPos = ref('')
const gifSearchItems = ref<GIFItem[]>([])
const gifSearchNextPos = ref('')
const gifLoading = ref(false)
const gifLoadingMore = ref(false)
const gifPopularLoadingMore = ref(false)
const gifApiUnavailable = ref(false)

const emptyStateCache = ref<{ recent: GIFItem[]; popular: GIFItem[]; popularNextPos: string } | null>(null)
const searchCache = new Map<string, { items: GIFItem[]; nextPos: string }>()

let debounceTimer: number | undefined
watch(gifQuery, (val) => {
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => { gifQueryDebounced.value = val.trim() }, 260)
})

watch([() => props.open, tab, gifQueryDebounced], async ([open, currentTab, q]) => {
  if (!open || currentTab !== 'gif' || gifApiUnavailable.value) return
  const query = (q as string).trim()

  if (!query && emptyStateCache.value) {
    gifRecent.value = emptyStateCache.value.recent
    gifPopular.value = emptyStateCache.value.popular
    gifPopularNextPos.value = emptyStateCache.value.popularNextPos
    gifSearchItems.value = []
    return
  }
  if (query && searchCache.has(query)) {
    const cached = searchCache.get(query)!
    gifSearchItems.value = cached.items
    gifSearchNextPos.value = cached.nextPos
    return
  }

  gifLoading.value = true
  try {
    if (query) {
      const found = await searchGifs({ q: query, limit: 30 })
      gifSearchItems.value = found.items
      gifSearchNextPos.value = found.nextPos
      searchCache.set(query, { items: found.items, nextPos: found.nextPos })
    } else {
      const [recent, popular] = await Promise.all([listRecentGifs(400), searchGifs({ limit: 30 })])
      gifRecent.value = recent
      gifPopular.value = popular.items
      gifPopularNextPos.value = popular.nextPos
      gifSearchItems.value = []
      emptyStateCache.value = { recent, popular: popular.items, popularNextPos: popular.nextPos }
    }
  } catch {
    gifApiUnavailable.value = true
  } finally {
    gifLoading.value = false
  }
}, { immediate: true })

function toCleanGifUrl(raw: string, id?: string): string {
  const fallback = (raw || '').trim()
  if (!fallback) return ''
  if (id?.trim()) return `https://giphy.com/gifs/${id.trim()}`
  try { const u = new URL(fallback); u.hash = ''; u.search = ''; return u.toString() } catch { return fallback }
}

function handleSelectGif(item: GIFItem) {
  const clean = toCleanGifUrl(item.url, item.id)
  const normalized = { ...item, url: clean || item.url }
  emit('selectGif', normalized)
  void addRecentGif(normalized).catch(() => {})
}

async function loadMoreGifs() {
  if (!gifSearchNextPos.value || !gifQueryDebounced.value || gifLoadingMore.value) return
  gifLoadingMore.value = true
  try {
    const next = await searchGifs({ q: gifQueryDebounced.value, pos: gifSearchNextPos.value, limit: 30 })
    gifSearchItems.value = [...gifSearchItems.value, ...next.items]
    gifSearchNextPos.value = next.nextPos
  } catch { gifApiUnavailable.value = true } finally { gifLoadingMore.value = false }
}

async function loadMorePopular() {
  if (!gifPopularNextPos.value || gifPopularLoadingMore.value || gifQueryDebounced.value) return
  gifPopularLoadingMore.value = true
  try {
    const next = await searchGifs({ pos: gifPopularNextPos.value, limit: 30 })
    gifPopular.value = [...gifPopular.value, ...next.items]
    gifPopularNextPos.value = next.nextPos
    if (emptyStateCache.value) emptyStateCache.value = { ...emptyStateCache.value, popular: gifPopular.value, popularNextPos: next.nextPos }
  } catch { gifApiUnavailable.value = true } finally { gifPopularLoadingMore.value = false }
}

// ── GIF tile loaded state ─────────────────────────────────────────────────────
const loadedGifs = ref(new Set<string>())
function onGifLoad(id: string) { loadedGifs.value = new Set([...loadedGifs.value, id]) }
</script>

<template>
  <div v-if="open" class="ep">

    <!-- ── Body ── -->
    <div class="ep-body">

      <!-- EMOJI TAB -->
      <template v-if="tab === 'emoji'">
        <div class="ep-search-wrap">
          <svg class="ep-search-icon" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/><path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <input v-model="emojiQuery" class="ep-search" :placeholder="t('chat.emoji_search')" />
        </div>
        <div class="ep-scroll">
          <template v-for="section in filteredSections" :key="section.label">
            <div class="ep-section-label">{{ section.label }}</div>
            <div class="ep-grid">
              <button
                v-for="emoji in section.emojis"
                :key="emoji"
                type="button"
                class="ep-item"
                :aria-label="emoji"
                @click="emit('select', emoji)"
              >{{ emoji }}</button>
            </div>
          </template>
          <div v-if="filteredSections.length === 0" class="ep-empty">{{ t('chat.emoji_not_found') }}</div>
        </div>
      </template>

      <!-- GIF TAB -->
      <template v-else-if="tab === 'gif'">
        <div class="ep-search-wrap">
          <svg class="ep-search-icon" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.6"/><path d="M13 13l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <input v-model="gifQuery" class="ep-search" :placeholder="t('chat.gif_search')" />
        </div>

        <div class="ep-scroll">
          <div v-if="gifApiUnavailable" class="ep-empty">{{ t('chat.gif_unavailable') }}</div>

          <!-- Loading skeleton -->
          <div v-else-if="gifLoading" class="ep-gif-grid">
            <div v-for="i in 12" :key="i" class="ep-gif-skeleton" />
          </div>

          <!-- Empty state: recent + popular -->
          <template v-else-if="!gifQueryDebounced">
            <template v-if="gifRecent.length">
              <div class="ep-section-label">{{ t('chat.emoji_recent') }}</div>
              <div class="ep-gif-grid">
                <button
                  v-for="item in gifRecent"
                  :key="`r:${item.id}`"
                  type="button"
                  class="ep-gif-tile"
                  @click="handleSelectGif(item)"
                >
                  <div v-if="!loadedGifs.has(item.id)" class="ep-gif-skeleton-inner" />
                  <img
                    :src="item.preview_url || item.url"
                    :alt="item.title || 'gif'"
                    loading="lazy"
                    :style="{ opacity: loadedGifs.has(item.id) ? 1 : 0 }"
                    @load="onGifLoad(item.id)"
                    @error="onGifLoad(item.id)"
                  />
                </button>
              </div>
            </template>

            <template v-if="gifPopular.length">
              <div class="ep-section-label">{{ t('chat.gif_popular') }}</div>
              <div class="ep-gif-grid">
                <button
                  v-for="item in gifPopular"
                  :key="`p:${item.id}`"
                  type="button"
                  class="ep-gif-tile"
                  @click="handleSelectGif(item)"
                >
                  <div v-if="!loadedGifs.has(item.id)" class="ep-gif-skeleton-inner" />
                  <img
                    :src="item.preview_url || item.url"
                    :alt="item.title || 'gif'"
                    loading="lazy"
                    :style="{ opacity: loadedGifs.has(item.id) ? 1 : 0 }"
                    @load="onGifLoad(item.id)"
                    @error="onGifLoad(item.id)"
                  />
                </button>
              </div>
              <button v-if="gifPopularNextPos" type="button" class="ep-load-more" :disabled="gifPopularLoadingMore" @click="loadMorePopular">
                {{ gifPopularLoadingMore ? t('common.loading') : t('common.load_more') }}
              </button>
            </template>
          </template>

          <!-- Search results -->
          <template v-else-if="gifQueryDebounced && !gifLoading">
            <div class="ep-gif-grid">
              <button
                v-for="item in gifSearchItems"
                :key="`s:${item.id}`"
                type="button"
                class="ep-gif-tile"
                @click="handleSelectGif(item)"
              >
                <div v-if="!loadedGifs.has(item.id)" class="ep-gif-skeleton-inner" />
                <img
                  :src="item.preview_url || item.url"
                  :alt="item.title || 'gif'"
                  loading="lazy"
                  :style="{ opacity: loadedGifs.has(item.id) ? 1 : 0 }"
                  @load="onGifLoad(item.id)"
                  @error="onGifLoad(item.id)"
                />
              </button>
            </div>
            <div v-if="!gifSearchItems.length" class="ep-empty">{{ t('chat.gif_not_found') }}</div>
            <button v-if="gifSearchNextPos" type="button" class="ep-load-more" :disabled="gifLoadingMore" @click="loadMoreGifs">
              {{ gifLoadingMore ? t('common.loading') : t('common.load_more') }}
            </button>
          </template>
        </div>
      </template>

      <!-- STICKERS TAB -->
      <template v-else-if="tab === 'stickers'">
        <div class="ep-scroll ep-stickers-placeholder">
          <div class="ep-sticker-icon">🗂️</div>
          <div class="ep-sticker-text">{{ t('chat.stickers_coming_soon') }}</div>
        </div>
      </template>
    </div>

    <!-- ── Tab bar ── -->
    <div class="ep-tabs">
      <button type="button" class="ep-tab" :class="{ active: tab === 'emoji' }" :title="t('chat.emoji')" @click="tab = 'emoji'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2" stroke-linecap="round"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1" fill="currentColor" stroke="none"/></svg>
      </button>
      <button type="button" class="ep-tab" :class="{ active: tab === 'stickers' }" :title="t('chat.stickers')" @click="tab = 'stickers'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 9h18M9 3v18" stroke-linecap="round"/></svg>
      </button>
      <button type="button" class="ep-tab" :class="{ active: tab === 'gif' }" :title="t('chat.gifs')" @click="tab = 'gif'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M8 12h-2v-2m0 2v2m5-4v4m4-4h-2v4h2m0-2h-2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Root ───────────────────────────────────────────────────────────────────── */
.ep {
  width: 340px;
  height: 380px;
  background: #fff;
  border: 1px solid rgba(0,0,0,.1);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: inherit;
}

/* ── Body (grows, holds scroll) ─────────────────────────────────────────────── */
.ep-body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 10px 0;
  gap: 8px;
}

/* ── Search bar ─────────────────────────────────────────────────────────────── */
.ep-search-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f1f3f7;
  border-radius: 10px;
  padding: 0 10px;
  height: 36px;
}
.ep-search-icon {
  width: 16px; height: 16px;
  color: rgba(0,0,0,.4);
  flex-shrink: 0;
}
.ep-search {
  width: 100%; border: 0; outline: 0;
  background: transparent;
  font-size: 14px; color: #000;
}
.ep-search::placeholder { color: rgba(0,0,0,.38); }

/* ── Scrollable area ─────────────────────────────────────────────────────────── */
.ep-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 6px;
  /* Custom thin scrollbar */
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,.2) transparent;
}
.ep-scroll::-webkit-scrollbar { width: 4px; }
.ep-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,.18); border-radius: 4px; }

/* ── Section labels ─────────────────────────────────────────────────────────── */
.ep-section-label {
  font-size: 11px;
  font-weight: 700;
  color: rgba(0,0,0,.4);
  text-transform: uppercase;
  letter-spacing: .06em;
  padding: 8px 2px 4px;
}

/* ── Emoji grid ─────────────────────────────────────────────────────────────── */
.ep-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}
.ep-item {
  aspect-ratio: 1;
  border: 0;
  background: transparent;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 22px;
  cursor: pointer;
  transition: background 100ms;
  line-height: 1;
}
.ep-item:hover { background: rgba(0,0,0,.07); }
.ep-item:active { background: rgba(0,0,0,.12); transform: scale(.9); }

/* ── GIF grid ───────────────────────────────────────────────────────────────── */
.ep-gif-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.ep-gif-tile {
  position: relative;
  aspect-ratio: 1;
  border: 0;
  border-radius: 8px;
  overflow: hidden;
  padding: 0;
  cursor: pointer;
  background: rgba(0,0,0,.06);
}
.ep-gif-tile img {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
  transition: opacity 180ms ease;
}
.ep-gif-tile:hover img { filter: brightness(1.08); }

/* ── GIF skeleton ───────────────────────────────────────────────────────────── */
.ep-gif-skeleton {
  aspect-ratio: 1;
  border-radius: 8px;
  background: rgba(0,0,0,.07);
  animation: skelPulse 1.4s ease-in-out infinite;
}
.ep-gif-skeleton-inner {
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, rgba(0,0,0,.06) 8%, rgba(0,0,0,.12) 18%, rgba(0,0,0,.06) 33%);
  background-size: 220% 100%;
  animation: skelPulse 1.4s ease-in-out infinite;
}
@keyframes skelPulse {
  0%   { background-position: 220% 0; opacity: 1; }
  50%  { opacity: .6; }
  100% { background-position: -220% 0; opacity: 1; }
}

/* ── Load more button ───────────────────────────────────────────────────────── */
.ep-load-more {
  width: 100%;
  margin-top: 8px;
  height: 32px;
  border: 1px solid rgba(0,0,0,.1);
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  color: rgba(0,0,0,.55);
  cursor: pointer;
  transition: background 100ms;
}
.ep-load-more:hover:not(:disabled) { background: rgba(0,0,0,.05); }
.ep-load-more:disabled { opacity: .5; cursor: default; }

/* ── Empty / error ──────────────────────────────────────────────────────────── */
.ep-empty {
  padding: 24px 0;
  text-align: center;
  color: rgba(0,0,0,.38);
  font-size: 13px;
}

/* ── Stickers placeholder ───────────────────────────────────────────────────── */
.ep-stickers-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.ep-sticker-icon { font-size: 40px; }
.ep-sticker-text { font-size: 13px; color: rgba(0,0,0,.4); }

/* ── Tab bar ────────────────────────────────────────────────────────────────── */
.ep-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  border-top: 1px solid rgba(0,0,0,.08);
  padding: 4px 6px;
  gap: 2px;
}
.ep-tab {
  width: 36px; height: 36px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: rgba(0,0,0,.45);
  transition: background 100ms, color 100ms;
}
.ep-tab svg { width: 20px; height: 20px; }
.ep-tab:hover { background: rgba(0,0,0,.06); color: rgba(0,0,0,.7); }
.ep-tab.active {
  background: rgba(74,144,217,.12);
  color: #4a90d9;
}
</style>
