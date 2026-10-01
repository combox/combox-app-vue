<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  getMyPrivacy,
  getUserByID,
  searchDirectory,
  updatePrivacySetting,
  type AuthUser,
  type PrivacyResponse,
  type PrivacyRule,
  type PrivacySetting,
  type SearchUserResult,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { normalizeAvatarSrc } from '../../utils/avatar'
import { avatarColorFor } from '../../utils/avatarColor'
import {
  PRIVACY_RULE_ROWS,
  privacyCaption,
  privacyEditorTitle,
  privacyExceptionSuffix,
  privacyHeading,
  privacyListTitle,
  privacyParamIcon,
  privacyParamTitle,
  privacyRuleLabel,
  privacyRuleSummary,
  readPrivacyCache,
  updatePrivacyCache,
  writePrivacyCache,
} from './privacyMeta'

const props = defineProps<{ setting: PrivacySetting | null }>()
const emit = defineEmits<{
  select: [setting: PrivacySetting]
  saved: [setting: PrivacySetting]
  cancel: []
}>()

const { t } = useI18n()
const toast = useToast()

type Person = { id: string; name: string; username: string; avatar: string }

// ---- list state --------------------------------------------------------
const loading = ref(false)
const loadError = ref('')
const rows = ref<PrivacySetting[]>([])

// ---- editor state ------------------------------------------------------
const draftRule = ref<PrivacyRule>('everybody')
const allowIds = ref<string[]>([])
const denyIds = ref<string[]>([])
const saving = ref(false)
const people = ref<Record<string, Person>>({})

// ---- picker state ------------------------------------------------------
const pickerOpen = ref(false)
const pickerKind = ref<'allow' | 'deny'>('allow')
const pickerQuery = ref('')
const pickerBusy = ref(false)
const pickerResults = ref<SearchUserResult[]>([])
let searchTimer: number | null = null

const isEditing = computed(() => Boolean(props.setting))

const listTitle = computed(() => privacyListTitle(t))
const editorTitle = computed(() => (props.setting ? privacyEditorTitle(props.setting.param, t) : ''))

const draftHeading = computed(() => (props.setting ? privacyHeading(props.setting.param, t) : ''))
const draftCaption = computed(() => privacyCaption(draftRule.value, t))
const showsAllow = computed(() => draftRule.value !== 'everybody')
const showsDeny = computed(() => draftRule.value !== 'nobody')

function personName(user: AuthUser | SearchUserResult): string {
  const full = `${user.first_name || ''} ${user.last_name || ''}`.trim()
  return full || user.username || user.id
}

function toPerson(user: AuthUser): Person {
  return {
    id: user.id,
    name: personName(user),
    username: (user.username || '').trim().replace(/^@+/, ''),
    avatar: normalizeAvatarSrc(user.avatar_data_url),
  }
}

function toSearchPerson(user: SearchUserResult): Person {
  return {
    id: user.id,
    name: personName(user),
    username: (user.username || '').trim().replace(/^@+/, ''),
    avatar: normalizeAvatarSrc(user.avatar_data_url),
  }
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
        people.value[id] = toPerson(user)
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

// ---- list loading ------------------------------------------------------
async function load(): Promise<void> {
  const cached = readPrivacyCache()
  if (cached && rows.value.length === 0) rows.value = cached.settings
  if (rows.value.length === 0) loading.value = true
  loadError.value = ''
  try {
    const response: PrivacyResponse = await getMyPrivacy()
    rows.value = response.settings
    writePrivacyCache(response)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : t('settings.privacy.load_failed', undefined, 'Could not load privacy settings')
  } finally {
    loading.value = false
  }
}

function selectRow(row: PrivacySetting): void {
  emit('select', row)
}

// ---- editor draft ------------------------------------------------------
watch(
  () => props.setting,
  (next) => {
    if (!next) {
      pickerOpen.value = false
      pickerQuery.value = ''
      pickerResults.value = []
      return
    }
    draftRule.value = next.rule
    allowIds.value = [...next.allow_ids]
    denyIds.value = [...next.deny_ids]
    pickerOpen.value = false
    pickerQuery.value = ''
    pickerResults.value = []
    void ensurePeople([...next.allow_ids, ...next.deny_ids])
  },
  { immediate: true },
)

function currentList(): string[] {
  return pickerKind.value === 'allow' ? allowIds.value : denyIds.value
}

function setList(kind: 'allow' | 'deny', value: string[]): void {
  if (kind === 'allow') allowIds.value = value
  else denyIds.value = value
}

function removePerson(kind: 'allow' | 'deny', id: string): void {
  setList(
    kind,
    currentListFor(kind).filter((item) => item !== id),
  )
}

function currentListFor(kind: 'allow' | 'deny'): string[] {
  return kind === 'allow' ? allowIds.value : denyIds.value
}

function togglePerson(id: string): void {
  const kind = pickerKind.value
  const list = currentListFor(kind)
  const has = list.includes(id)
  const next = has ? list.filter((item) => item !== id) : [...list, id]
  setList(kind, next)
  // The two exception lists are mutually exclusive.
  const other: 'allow' | 'deny' = kind === 'allow' ? 'deny' : 'allow'
  const otherList = currentListFor(other)
  if (otherList.includes(id)) setList(other, otherList.filter((item) => item !== id))
}

const pickerList = computed(() => currentList())
const pickerListPeople = computed(() => pickerList.value.map((id) => personOf(id)))
const pickerResultsPeople = computed(() => pickerResults.value.map((user) => toSearchPerson(user)))
const pickerTitle = computed(() =>
  pickerKind.value === 'allow'
    ? t('settings.privacy.always_share', undefined, 'Always share with')
    : t('settings.privacy.never_share', undefined, 'Never share with'),
)

function openPicker(kind: 'allow' | 'deny'): void {
  pickerKind.value = kind
  pickerQuery.value = ''
  pickerResults.value = []
  pickerOpen.value = true
  void ensurePeople(currentListFor(kind))
}

function closePicker(): void {
  pickerOpen.value = false
}

async function runSearch(query: string): Promise<void> {
  pickerBusy.value = true
  try {
    const results = await searchDirectory({ q: query, scope: 'users', limit: 20 })
    pickerResults.value = results.users || []
    void ensurePeople(pickerResults.value.map((item) => item.id))
  } catch {
    pickerResults.value = []
  } finally {
    pickerBusy.value = false
  }
}

watch(pickerQuery, (value) => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  pickerResults.value = []
  const query = value.trim()
  if (query.length < 2) {
    pickerBusy.value = false
    return
  }
  searchTimer = window.setTimeout(() => {
    void runSearch(query)
  }, 260)
})

function onPickerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && pickerOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    closePicker()
  }
}

// ---- save / cancel -----------------------------------------------------
async function save(): Promise<void> {
  const current = props.setting
  if (!current || saving.value) return
  saving.value = true
  try {
    const updated = await updatePrivacySetting(current.param, {
      rule: draftRule.value,
      allow_ids: allowIds.value,
      deny_ids: denyIds.value,
    })
    const saved: PrivacySetting = {
      ...updated,
      allow_count: updated.allow_count || updated.allow_ids.length,
      deny_count: updated.deny_count || updated.deny_ids.length,
    }
    updatePrivacyCache(saved)
    const index = rows.value.findIndex((item) => item.param === saved.param)
    if (index >= 0) rows.value[index] = saved
    else rows.value.push(saved)
    toast.success(t('settings.privacy.saved', undefined, 'Privacy setting saved'))
    emit('saved', saved)
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : t('settings.privacy.save_failed', undefined, 'Could not save the setting'),
    )
  } finally {
    saving.value = false
  }
}

function cancel(): void {
  emit('cancel')
}

onMounted(() => {
  const cached = readPrivacyCache()
  if (cached) rows.value = cached.settings
  void load()
  document.addEventListener('keydown', onPickerKeydown, true)
})

onBeforeUnmount(() => {
  if (searchTimer !== null) window.clearTimeout(searchTimer)
  document.removeEventListener('keydown', onPickerKeydown, true)
})
</script>

<template>
  <!-- list -->
  <section v-if="!isEditing" class="pvCard">
    <div class="pvCardHead">
      <div class="pvCardTitle">{{ listTitle }}</div>
      <div class="pvCardSub">
        {{ t('settings.privacy_list_hint', undefined, 'Choose who can see your personal details and who can reach you.') }}
      </div>
    </div>

    <v-alert v-if="loadError && rows.length === 0" type="error" class="pvAlert">
      {{ loadError }}
    </v-alert>

    <div v-if="loading && rows.length === 0" class="pvRows">
      <div v-for="n in 5" :key="n" class="pvRowSkeleton">
        <span class="pvRowIconSkeleton" />
        <span class="pvRowTextSkeleton" />
      </div>
    </div>

    <div v-else-if="rows.length > 0" class="pvRows">
      <button
        v-for="row in rows"
        :key="row.param"
        type="button"
        class="pvRow"
        @click="selectRow(row)"
      >
        <span class="pvRowIcon"><v-icon :icon="privacyParamIcon(row.param)" size="18" /></span>
        <span class="pvRowMain">
          <span class="pvRowTitle">{{ privacyParamTitle(row.param, t) }}</span>
          <span class="pvRowSummary">
            {{ privacyRuleSummary(row.rule, t) }}
            <span v-if="privacyExceptionSuffix(row)" class="pvRowSuffix">{{ privacyExceptionSuffix(row) }}</span>
          </span>
        </span>
        <v-icon icon="mdi-chevron-right" size="18" class="pvRowChevron" />
      </button>
    </div>

    <div v-else-if="!loading" class="pvEmpty">
      {{ t('settings.privacy.empty', undefined, 'No privacy options are available yet.') }}
    </div>
  </section>

  <!-- editor -->
  <section v-else class="pvCard">
    <div class="pvCardHead">
      <div class="pvCardTitle">{{ editorTitle }}</div>
      <div class="pvCardSub">{{ t('settings.privacy.editor_hint', undefined, 'Pick who is allowed to see this.') }}</div>
    </div>

    <div class="pvHeading">{{ draftHeading }}</div>

    <div class="pvRules" role="radiogroup" :aria-label="draftHeading">
      <button
        v-for="row in PRIVACY_RULE_ROWS"
        :key="row.value"
        type="button"
        class="pvRule"
        :class="{ pvRuleActive: draftRule === row.value }"
        role="radio"
        :aria-checked="draftRule === row.value"
        @click="draftRule = row.value"
      >
        <span class="pvRuleIcon"><v-icon :icon="row.icon" size="18" /></span>
        <span class="pvRuleLabel">{{ privacyRuleLabel(row.value, t) }}</span>
        <span class="pvRuleMark" aria-hidden="true">
          <v-icon v-if="draftRule === row.value" icon="mdi-check" size="16" />
        </span>
      </button>
    </div>

    <div class="pvCaption">{{ draftCaption }}</div>

    <div v-if="showsAllow || showsDeny" class="pvExceptions">
      <div v-if="showsAllow" class="pvExceptionBlock">
        <div class="pvExceptionHead">
          <span class="pvExceptionTitle">{{ t('settings.privacy.always_share', undefined, 'Always share with') }}</span>
          <span v-if="allowIds.length" class="pvExceptionCount">(+{{ allowIds.length }})</span>
          <button type="button" class="pvExceptionAdd" @click="openPicker('allow')">
            <v-icon icon="mdi-plus" size="15" />
            <span>{{ t('settings.privacy.add_people', undefined, 'Add people') }}</span>
          </button>
        </div>
        <div v-if="allowIds.length" class="pvPeople">
          <div v-for="id in allowIds" :key="id" class="pvPerson">
            <span class="pvPersonAvatar" :style="{ background: avatarColorFor(id) }">
              <img v-if="personOf(id).avatar" :src="personOf(id).avatar" alt="" class="pvPersonAvatarImg" />
              <span v-else>{{ initialsOf(personOf(id).name) }}</span>
            </span>
            <span class="pvPersonMain">
              <span class="pvPersonName">{{ personOf(id).name }}</span>
              <span v-if="personOf(id).username" class="pvPersonUsername">@{{ personOf(id).username }}</span>
            </span>
            <button
              type="button"
              class="pvPersonRemove"
              :aria-label="t('settings.privacy.remove_person', undefined, 'Remove')"
              @click="removePerson('allow', id)"
            >
              <v-icon icon="mdi-close" size="15" />
            </button>
          </div>
        </div>
        <button v-else type="button" class="pvAddRow" @click="openPicker('allow')">
          <v-icon icon="mdi-account-plus-outline" size="16" />
          <span>{{ t('settings.privacy.add_people', undefined, 'Add people') }}</span>
        </button>
      </div>

      <div v-if="showsDeny" class="pvExceptionBlock">
        <div class="pvExceptionHead">
          <span class="pvExceptionTitle">{{ t('settings.privacy.never_share', undefined, 'Never share with') }}</span>
          <span v-if="denyIds.length" class="pvExceptionCount">(-{{ denyIds.length }})</span>
          <button type="button" class="pvExceptionAdd" @click="openPicker('deny')">
            <v-icon icon="mdi-plus" size="15" />
            <span>{{ t('settings.privacy.add_people', undefined, 'Add people') }}</span>
          </button>
        </div>
        <div v-if="denyIds.length" class="pvPeople">
          <div v-for="id in denyIds" :key="id" class="pvPerson">
            <span class="pvPersonAvatar" :style="{ background: avatarColorFor(id) }">
              <img v-if="personOf(id).avatar" :src="personOf(id).avatar" alt="" class="pvPersonAvatarImg" />
              <span v-else>{{ initialsOf(personOf(id).name) }}</span>
            </span>
            <span class="pvPersonMain">
              <span class="pvPersonName">{{ personOf(id).name }}</span>
              <span v-if="personOf(id).username" class="pvPersonUsername">@{{ personOf(id).username }}</span>
            </span>
            <button
              type="button"
              class="pvPersonRemove"
              :aria-label="t('settings.privacy.remove_person', undefined, 'Remove')"
              @click="removePerson('deny', id)"
            >
              <v-icon icon="mdi-close" size="15" />
            </button>
          </div>
        </div>
        <button v-else type="button" class="pvAddRow" @click="openPicker('deny')">
          <v-icon icon="mdi-account-plus-outline" size="16" />
          <span>{{ t('settings.privacy.add_people', undefined, 'Add people') }}</span>
        </button>
      </div>
    </div>

    <div class="pvActions">
      <button type="button" class="pvBtn pvBtnGhost" :disabled="saving" @click="cancel">
        {{ t('common.cancel', undefined, 'Cancel') }}
      </button>
      <button type="button" class="pvBtn pvBtnPrimary" :disabled="saving" @click="save">
        <v-progress-circular v-if="saving" indeterminate :size="14" :width="2" />
        <v-icon v-else icon="mdi-check" size="16" />
        <span>{{ t('common.save', undefined, 'Save') }}</span>
      </button>
    </div>
  </section>

  <!-- exceptions picker -->
  <Teleport to="body">
    <transition name="pvFade">
      <div v-if="pickerOpen" class="pvPickerOverlay" @click.self="closePicker">
        <div class="pvPicker" role="dialog" :aria-label="pickerTitle">
          <div class="pvPickerHead">
            <div class="pvPickerTitle">{{ pickerTitle }}</div>
            <button
              type="button"
              class="pvPickerClose"
              :aria-label="t('common.close', undefined, 'Close')"
              @click="closePicker"
            >
              <v-icon icon="mdi-close" size="17" />
            </button>
          </div>

          <div class="pvSearchWrap">
            <v-icon icon="mdi-magnify" size="16" class="pvSearchIcon" />
            <input
              v-model="pickerQuery"
              type="text"
              class="pvSearch"
              :placeholder="t('settings.privacy.search_people', undefined, 'Search users')"
              autocomplete="off"
            />
            <v-progress-circular v-if="pickerBusy" indeterminate :size="14" :width="2" class="pvSearchBusy" />
          </div>

          <div class="pvPickerList">
            <div v-if="pickerListPeople.length > 0" class="pvPickerSection">
              <div class="pvPickerSectionTitle">
                {{ t('settings.privacy.picker_selected', undefined, 'Selected') }}
              </div>
              <label
                v-for="person in pickerListPeople"
                :key="`sel-${person.id}`"
                class="pvPick"
              >
                <span class="pvPickAvatar" :style="{ background: avatarColorFor(person.id) }">
                  <img v-if="person.avatar" :src="person.avatar" alt="" class="pvPickAvatarImg" />
                  <span v-else>{{ initialsOf(person.name) }}</span>
                </span>
                <span class="pvPickMain">
                  <span class="pvPickName">{{ person.name }}</span>
                  <span v-if="person.username" class="pvPickUsername">@{{ person.username }}</span>
                </span>
                <input type="checkbox" class="pvPickBox" :checked="true" @change="togglePerson(person.id)" />
              </label>
            </div>

            <div v-if="pickerQuery.trim().length >= 2 && pickerResultsPeople.length > 0" class="pvPickerSection">
              <div class="pvPickerSectionTitle">{{ t('settings.privacy.picker_results', undefined, 'Results') }}</div>
              <label v-for="person in pickerResultsPeople" :key="`res-${person.id}`" class="pvPick">
                <span class="pvPickAvatar" :style="{ background: avatarColorFor(person.id) }">
                  <img v-if="person.avatar" :src="person.avatar" alt="" class="pvPickAvatarImg" />
                  <span v-else>{{ initialsOf(person.name) }}</span>
                </span>
                <span class="pvPickMain">
                  <span class="pvPickName">{{ person.name }}</span>
                  <span v-if="person.username" class="pvPickUsername">@{{ person.username }}</span>
                </span>
                <input
                  type="checkbox"
                  class="pvPickBox"
                  :checked="pickerList.includes(person.id)"
                  @change="togglePerson(person.id)"
                />
              </label>
            </div>

            <div
              v-if="pickerQuery.trim().length >= 2 && pickerResultsPeople.length === 0 && !pickerBusy"
              class="pvPickerEmpty"
            >
              {{ t('settings.privacy.picker_empty', undefined, 'No users found') }}
            </div>
            <div
              v-if="pickerQuery.trim().length < 2 && pickerListPeople.length === 0"
              class="pvPickerEmpty"
            >
              {{ t('settings.privacy.picker_hint', undefined, 'Type at least 2 characters to search') }}
            </div>
          </div>

          <div class="pvPickerFoot">
            <button type="button" class="pvBtn pvBtnPrimary" @click="closePicker">
              {{ t('settings.privacy.done', undefined, 'Done') }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.pvCard {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
}

.pvCardHead {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pvCardTitle {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.pvCardSub {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted);
}

.pvAlert {
  margin: 0;
}

.pvRows {
  display: flex;
  flex-direction: column;
}

.pvRow {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 6px;
  border: 0;
  border-top: 1px solid var(--border);
  background: transparent;
  text-align: left;
  cursor: pointer;
  border-radius: 10px;
}
.pvRows .pvRow:first-child {
  border-top: 0;
}
.pvRow:hover {
  background: var(--surface-soft);
}

.pvRowIcon {
  flex: none;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}

.pvRowMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pvRowTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.pvRowSummary {
  font-size: 12.5px;
  color: var(--text-muted);
}

.pvRowSuffix {
  color: var(--accent);
  font-weight: 600;
}

.pvRowChevron {
  flex: none;
  color: var(--text-muted);
}

.pvRowSkeleton {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 6px;
}
.pvRowIconSkeleton,
.pvRowTextSkeleton {
  display: block;
  border-radius: 10px;
  background: var(--surface-soft);
  animation: pvPulse 1.2s ease-in-out infinite;
}
.pvRowIconSkeleton {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
}
.pvRowTextSkeleton {
  height: 14px;
  width: 60%;
}

@keyframes pvPulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.pvEmpty {
  padding: 14px 6px;
  font-size: 13px;
  color: var(--text-muted);
}

.pvHeading {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-soft);
}

.pvRules {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pvRule {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    background 120ms ease;
}
.pvRuleActive {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.pvRuleIcon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}
.pvRuleActive .pvRuleIcon {
  color: var(--accent);
}

.pvRuleLabel {
  flex: 1;
  min-width: 0;
  font-weight: 600;
}

.pvRuleMark {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.pvCaption {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-muted);
}

.pvExceptions {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pvExceptionBlock {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pvExceptionHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pvExceptionTitle {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-soft);
}

.pvExceptionCount {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--accent);
}

.pvExceptionAdd {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 0;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.pvPeople {
  display: flex;
  flex-direction: column;
}

.pvPerson {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-top: 1px solid var(--border);
}
.pvPeople .pvPerson:first-child {
  border-top: 0;
}

.pvPersonAvatar {
  flex: none;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.pvPersonAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pvPersonMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pvPersonName {
  font-size: 13.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pvPersonUsername {
  font-size: 12px;
  color: var(--text-muted);
}

.pvPersonRemove {
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.pvPersonRemove:hover {
  background: var(--surface-soft);
  color: #ef4444;
}

.pvAddRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px dashed var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.pvAddRow:hover {
  background: var(--surface-soft);
}

.pvActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 6px;
}

.pvBtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.pvBtn:disabled {
  opacity: 0.55;
  cursor: default;
}
.pvBtnGhost {
  background: var(--surface-soft);
  color: var(--text);
}
.pvBtnGhost:hover:not(:disabled) {
  background: var(--border);
}
.pvBtnPrimary {
  background: var(--accent);
  color: var(--link-on-accent);
}
.pvBtnPrimary:hover:not(:disabled) {
  background: var(--accent-strong);
}

.pvPickerOverlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(9, 11, 15, 0.46);
}

.pvPicker {
  width: min(360px, 100%);
  max-height: min(560px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
}

.pvPickerHead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 8px;
}
.pvPickerTitle {
  flex: 1;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text);
}
.pvPickerClose {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.pvPickerClose:hover {
  background: var(--surface-soft);
  color: var(--text);
}

.pvSearchWrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 14px 8px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
}
.pvSearchIcon {
  color: var(--text-muted);
  flex: none;
}
.pvSearch {
  flex: 1;
  min-width: 0;
  height: 38px;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  outline: none;
}
.pvSearch::placeholder {
  color: var(--text-muted);
}
.pvSearchBusy {
  flex: none;
}

.pvPickerList {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.pvPickerSection {
  display: flex;
  flex-direction: column;
}
.pvPickerSectionTitle {
  padding: 8px 6px 4px;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.pvPick {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 6px;
  border-radius: 12px;
  cursor: pointer;
}
.pvPick:hover {
  background: var(--surface-soft);
}

.pvPickAvatar {
  flex: none;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-size: 11.5px;
  font-weight: 700;
}
.pvPickAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pvPickMain {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pvPickName {
  font-size: 13.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pvPickUsername {
  font-size: 12px;
  color: var(--text-muted);
}

.pvPickBox {
  flex: none;
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}

.pvPickerEmpty {
  padding: 22px 6px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.pvPickerFoot {
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--border);
}

.pvFade-enter-active,
.pvFade-leave-active {
  transition: opacity 140ms ease;
}
.pvFade-enter-from,
.pvFade-leave-to {
  opacity: 0;
}
</style>
