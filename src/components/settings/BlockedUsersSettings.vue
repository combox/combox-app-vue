<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  blockUser,
  getUserByID,
  listBlocked,
  searchDirectory,
  unblockUser,
  type SearchUserResult,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { normalizeAvatarSrc } from '../../utils/avatar'
import { avatarColorFor } from '../../utils/avatarColor'
import './settingsShared.css'

type Person = { id: string; name: string; username: string; avatar: string }

const { t } = useI18n()
const toast = useToast()

const loading = ref(false)
const loadError = ref('')
const blockedIds = ref<string[]>([])
const people = ref<Record<string, Person>>({})
const busyId = ref('')
const query = ref('')
const searching = ref(false)
const results = ref<SearchUserResult[]>([])
let searchTimer: number | null = null

function personName(first: string, last: string, username: string, id: string): string {
  const full = `${first || ''} ${last || ''}`.trim()
  return full || username || id
}

function personOf(id: string): Person {
  return people.value[id] || { id, name: id, username: '', avatar: '' }
}

async function ensurePeople(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => Boolean(id) && !people.value[id]).slice(0, 40)
  if (missing.length === 0) return
  await Promise.all(
    missing.map(async (id) => {
      try {
        const user = await getUserByID(id)
        people.value[id] = {
          id,
          name: personName(user.first_name || '', user.last_name || '', user.username || '', id),
          username: (user.username || '').trim().replace(/^@+/, ''),
          avatar: normalizeAvatarSrc(user.avatar_data_url),
        }
      } catch {
        people.value[id] = { id, name: id, username: '', avatar: '' }
      }
    }),
  )
}

function initialsOf(name: string): string {
  const parts = String(name || '').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] || '?').slice(0, 2).toUpperCase()
  return `${(parts[0] || '').slice(0, 1)}${(parts[1] || '').slice(0, 1)}`.toUpperCase()
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const entries = await listBlocked()
    blockedIds.value = entries.map((entry) => entry.user_id).filter(Boolean)
    await ensurePeople(blockedIds.value)
  } catch (caught) {
    loadError.value = caught instanceof Error ? caught.message : t('settings.tg.security.blocked_load_failed', undefined, 'Could not load the blocked list')
  } finally {
    loading.value = false
  }
}

async function runSearch(text: string): Promise<void> {
  searching.value = true
  try {
    const response = await searchDirectory({ q: text, scope: 'users', limit: 20 })
    results.value = (response.users || []).filter((user) => !blockedIds.value.includes(user.id))
  } catch {
    results.value = []
  } finally {
    searching.value = false
  }
}

watch(query, (value) => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  results.value = []
  const text = value.trim()
  if (text.length < 2) {
    searching.value = false
    return
  }
  searchTimer = window.setTimeout(() => {
    void runSearch(text)
  }, 260)
})

async function block(id: string): Promise<void> {
  if (!id || busyId.value) return
  busyId.value = id
  try {
    await blockUser(id)
    await ensurePeople([id])
    if (!blockedIds.value.includes(id)) blockedIds.value = [...blockedIds.value, id]
    results.value = results.value.filter((user) => user.id !== id)
    toast.success(t('settings.tg.security.blocked_added', undefined, 'User blocked'))
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : t('settings.tg.security.block_failed', undefined, 'Could not block the user'))
  } finally {
    busyId.value = ''
  }
}

async function unblock(id: string): Promise<void> {
  if (!id || busyId.value) return
  busyId.value = id
  try {
    await unblockUser(id)
    blockedIds.value = blockedIds.value.filter((item) => item !== id)
    toast.success(t('settings.tg.security.unblocked', undefined, 'User unblocked'))
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : t('settings.tg.security.unblock_failed', undefined, 'Could not unblock the user'))
  } finally {
    busyId.value = ''
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="tgPage">
    <section class="tgCard tgCardPad">
      <div class="settingsCard__title">{{ t('settings.tg.security.blocked', undefined, 'Blocked users') }}</div>
      <div class="settingsSectionText">
        {{ t('settings.tg.security.blocked_hint', undefined, 'Blocked people cannot reach you. Search below to block someone new.') }}
      </div>
      <v-alert v-if="loadError" type="error" class="mb-4">{{ loadError }}</v-alert>

      <div class="blSearchWrap">
        <v-icon icon="mdi-magnify" size="16" class="blSearchIcon" />
        <input
          v-model="query"
          type="text"
          class="blSearch"
          :placeholder="t('settings.privacy.search_people', undefined, 'Search users')"
          autocomplete="off"
        />
        <v-progress-circular v-if="searching" indeterminate :size="14" :width="2" />
      </div>

      <div v-if="results.length > 0" class="blResults">
        <div v-for="user in results" :key="user.id" class="blRow">
          <span class="blAvatar" :style="{ background: avatarColorFor(user.id) }">
            <img v-if="user.avatar_data_url" :src="normalizeAvatarSrc(user.avatar_data_url)" alt="" class="blAvatarImg" />
            <span v-else>{{ initialsOf(personName(user.first_name || '', user.last_name || '', '', user.id)) }}</span>
          </span>
          <span class="blMain">
            <span class="blName">{{ personName(user.first_name || '', user.last_name || '', user.username || '', user.id) }}</span>
            <span v-if="user.username" class="blSub">@{{ (user.username || '').replace(/^@+/, '') }}</span>
          </span>
          <button type="button" class="tgBtn tgBtnGhost blBtn" :disabled="Boolean(busyId)" @click="block(user.id)">
            {{ t('settings.tg.security.block', undefined, 'Block') }}
          </button>
        </div>
      </div>
      <div v-else-if="query.trim().length >= 2 && !searching" class="blEmpty">
        {{ t('settings.privacy.picker_empty', undefined, 'No users found') }}
      </div>

      <div class="tgDivider blDivider" />

      <div v-if="loading && blockedIds.length === 0" class="blEmpty">
        {{ t('settings.checking', undefined, 'Loading…') }}
      </div>
      <div v-else-if="blockedIds.length > 0" class="blResults">
        <div v-for="id in blockedIds" :key="id" class="blRow">
          <span class="blAvatar" :style="{ background: avatarColorFor(id) }">
            <img v-if="personOf(id).avatar" :src="personOf(id).avatar" alt="" class="blAvatarImg" />
            <span v-else>{{ initialsOf(personOf(id).name) }}</span>
          </span>
          <span class="blMain">
            <span class="blName">{{ personOf(id).name }}</span>
            <span v-if="personOf(id).username" class="blSub">@{{ personOf(id).username }}</span>
          </span>
          <button type="button" class="settingsBtn settingsBtn--danger blBtn" :disabled="Boolean(busyId)" @click="unblock(id)">
            {{ t('settings.tg.security.unblock', undefined, 'Unblock') }}
          </button>
        </div>
      </div>
      <div v-else class="blEmpty">
        {{ t('settings.tg.security.blocked_empty', undefined, 'Nobody is blocked.') }}
      </div>
    </section>
  </div>
</template>

<style scoped>
.blSearchWrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  margin-bottom: 10px;
}

.blSearchIcon {
  color: var(--text-muted);
  flex: none;
}

.blSearch {
  flex: 1;
  min-width: 0;
  height: 40px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  outline: none;
}

.blResults {
  display: grid;
}

.blRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 2px;
  border-top: 1px solid var(--border);
}

.blRow:first-child {
  border-top: 0;
}

.blAvatar {
  flex: none;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.blAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.blMain {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 1px;
}

.blName {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.blSub {
  font-size: 12.5px;
  color: var(--text-muted);
}

.blBtn {
  flex: 0 0 auto;
  min-height: 32px;
  padding: 0 14px;
  font-size: 13px;
}

.blDivider {
  margin: 12px 0;
}

.blEmpty {
  padding: 10px 2px;
  font-size: 13.5px;
  color: var(--text-muted);
}
</style>
