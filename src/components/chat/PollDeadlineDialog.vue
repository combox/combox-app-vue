<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/i18n'

const props = defineProps<{ open: boolean; value: string }>()
const emit = defineEmits<{ cancel: []; set: [iso: string] }>()

const { t, locale } = useI18n()

type DayCell = { day: number; today: boolean; selected: boolean; past: boolean }

const dialogRef = ref<HTMLElement | null>(null)
const viewYear = ref(0)
const viewMonth = ref(0)
const selectedDay = ref(0)
const timeValue = ref('12:00')
const hint = ref('')

let previousOverflow = ''

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function lockScroll() {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockScroll() {
  document.body.style.overflow = previousOverflow
}

function resetFromValue() {
  const parsed = Date.parse(props.value)
  const base = Number.isFinite(parsed) && parsed > 0 ? new Date(parsed) : new Date(Date.now() + 60 * 60 * 1000)
  viewYear.value = base.getFullYear()
  viewMonth.value = base.getMonth()
  selectedDay.value = base.getDate()
  const hh = String(base.getHours()).padStart(2, '0')
  const mm = String(base.getMinutes()).padStart(2, '0')
  timeValue.value = `${hh}:${mm}`
  hint.value = ''
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.open) return
  event.stopPropagation()
  emit('cancel')
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      resetFromValue()
      lockScroll()
      document.addEventListener('keydown', onDocumentKeydown)
      void nextTick(() => dialogRef.value?.focus())
    } else {
      unlockScroll()
      document.removeEventListener('keydown', onDocumentKeydown)
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (props.open) void nextTick(() => dialogRef.value?.focus())
})

onBeforeUnmount(() => {
  if (props.open) unlockScroll()
  document.removeEventListener('keydown', onDocumentKeydown)
})

const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(new Date(viewYear.value, viewMonth.value, 1)),
)

/** Week starts on Sunday, matching `Date#getDay()` used by the grid. */
const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  return Array.from({ length: 7 }, (_, index) => fmt.format(new Date(2024, 0, 7 + index)))
})

const days = computed<DayCell[]>(() => {
  const lead = new Date(viewYear.value, viewMonth.value, 1).getDay()
  const count = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()
  const today = startOfDay(new Date())
  const cells: DayCell[] = []
  for (let i = 0; i < lead; i += 1) {
    cells.push({ day: 0, today: false, selected: false, past: false })
  }
  for (let day = 1; day <= count; day += 1) {
    const ts = new Date(viewYear.value, viewMonth.value, day).getTime()
    cells.push({ day, today: ts === today, selected: day === selectedDay.value, past: ts < today })
  }
  return cells
})

function shiftMonth(delta: number) {
  const next = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth()
}

function pickDay(cell: DayCell) {
  if (!cell.day || cell.past) return
  selectedDay.value = cell.day
  hint.value = ''
}

function composeIso(): string {
  if (!selectedDay.value) return ''
  const [rawHour, rawMinute] = timeValue.value.split(':')
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  const date = new Date(
    viewYear.value,
    viewMonth.value,
    selectedDay.value,
    Number.isFinite(hour) ? hour : 0,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
  )
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

function confirm() {
  const iso = composeIso()
  if (!iso) {
    hint.value = t('poll.deadline_pick_day', undefined, 'Pick a day')
    return
  }
  if (Date.parse(iso) <= Date.now()) {
    hint.value = t('poll.deadline_future', undefined, 'Pick a time in the future')
    return
  }
  emit('set', iso)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="pdOverlay" @click="emit('cancel')" />
    <div
      v-if="open"
      ref="dialogRef"
      class="pdDialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="t('poll.deadline_title', undefined, 'Deadline')"
      @click.stop
      @keydown.esc.stop.prevent="emit('cancel')"
    >
      <div class="pdHead">
        <div class="pdTitle">{{ t('poll.deadline_title', undefined, 'Deadline') }}</div>
        <button
          type="button"
          class="pdClose"
          :aria-label="t('common.close', undefined, 'Close')"
          @click="emit('cancel')"
        >
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="pdCalHead">
        <button
          type="button"
          class="pdNav"
          :aria-label="t('poll.deadline_prev_month', undefined, 'Previous month')"
          :title="t('poll.deadline_prev_month', undefined, 'Previous month')"
          @click="shiftMonth(-1)"
        >
          <v-icon icon="mdi-chevron-left" size="18" />
        </button>
        <div class="pdMonth" aria-live="polite">{{ monthLabel }}</div>
        <button
          type="button"
          class="pdNav"
          :aria-label="t('poll.deadline_next_month', undefined, 'Next month')"
          :title="t('poll.deadline_next_month', undefined, 'Next month')"
          @click="shiftMonth(1)"
        >
          <v-icon icon="mdi-chevron-right" size="18" />
        </button>
      </div>

      <div class="pdWeek" aria-hidden="true">
        <span v-for="label in weekdayLabels" :key="label" class="pdWeekDay">{{ label }}</span>
      </div>

      <div class="pdGrid">
        <template v-for="(cell, index) in days" :key="index">
          <span v-if="!cell.day" class="pdCell pdCellPad" aria-hidden="true" />
          <button
            v-else
            type="button"
            class="pdCell"
            :class="{ pdToday: cell.today, pdSelected: cell.selected, pdPast: cell.past }"
            :disabled="cell.past"
            :aria-pressed="cell.selected"
            @click="pickDay(cell)"
          >
            {{ cell.day }}
          </button>
        </template>
      </div>

      <div class="pdTimeRow">
        <span class="pdTimeLabel">{{ t('poll.deadline_at', undefined, 'at') }}</span>
        <input
          v-model="timeValue"
          type="time"
          class="pdTime"
          :aria-label="t('poll.deadline_time', undefined, 'Time')"
        />
      </div>

      <div v-if="hint" class="pdHint" role="alert">{{ hint }}</div>

      <div class="pdActions">
        <button type="button" class="pdBtn" @click="emit('cancel')">
          {{ t('common.cancel', undefined, 'Cancel') }}
        </button>
        <button type="button" class="pdBtn primary" @click="confirm">
          {{ t('poll.deadline_set', undefined, 'Set Deadline') }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pdOverlay {
  position: fixed;
  inset: 0;
  z-index: 140;
  background: rgba(15, 23, 42, 0.46);
}

.pdDialog {
  position: fixed;
  z-index: 141;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(340px, calc(100vw - 24px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-strong);
  color: var(--text);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.34);
}

.pdDialog:focus {
  outline: none;
}

.pdHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pdTitle {
  font-size: 15px;
  font-weight: 800;
}

.pdClose {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pdClose:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.pdCalHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pdNav {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pdNav:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.pdMonth {
  font-size: 13.5px;
  font-weight: 700;
  text-transform: capitalize;
}

.pdWeek {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.pdWeekDay {
  text-align: center;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
}

.pdGrid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.pdCell {
  aspect-ratio: 1;
  min-width: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}

.pdCell:hover:not(:disabled):not(.pdSelected) {
  background: var(--surface-soft-hover);
}

.pdCell:disabled {
  color: var(--text-muted);
  opacity: 0.45;
  cursor: default;
}

.pdCellPad {
  cursor: default;
}

.pdToday {
  box-shadow: inset 0 0 0 2px var(--accent);
}

.pdSelected {
  background: var(--accent);
  color: #fff;
}

.pdSelected.pdToday {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent-strong) 70%, #ffffff);
}

.pdTimeRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}

.pdTimeLabel {
  font-size: 13px;
  color: var(--text-soft);
}

.pdTime {
  flex: 1 1 auto;
  min-width: 0;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13.5px;
  font-family: inherit;
}

.pdTime:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.pdHint {
  font-size: 12px;
  font-weight: 700;
  color: var(--danger);
}

.pdActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 2px;
}

.pdBtn {
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.pdBtn:hover {
  background: var(--surface-soft-hover);
}

.pdBtn.primary {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}
</style>
