<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createPoll, maxPollOptions, POLL_MIN_OPTIONS, type CreatePollInput } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { formatPollMoment, pollErrorText } from '../../utils/pollFormat'
import ComposerEmojiGifPicker from './ComposerEmojiGifPicker.vue'
import PollDeadlineDialog from './PollDeadlineDialog.vue'
import PollSettingsRow from './PollSettingsRow.vue'

const props = defineProps<{ chatId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()
const toast = useToast()

/** Server bounds (chatsvc): 300 for the question, 100 per option, 600 for long text. */
const MAX_QUESTION = 300
const MAX_OPTION = 100
const MAX_LONG_TEXT = 600
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

type Preset = { id: string; ms: number }

const PRESETS: Preset[] = [
  { id: 'h1', ms: HOUR_MS },
  { id: 'h3', ms: 3 * HOUR_MS },
  { id: 'h8', ms: 8 * HOUR_MS },
  { id: 'd1', ms: DAY_MS },
  { id: 'd3', ms: 3 * DAY_MS },
  { id: 'custom', ms: 0 },
]

const question = ref('')
const description = ref('')
const options = ref<string[]>([''])
const showWhoVoted = ref(true)
const multiple = ref(false)
const allowAddOptions = ref(false)
const allowRevoting = ref(false)
const shuffleOptions = ref(false)
const quizMode = ref(false)
const correctIndexes = ref<number[]>([])
const explanation = ref('')
const durationOn = ref(false)
const closesAt = ref('')
const hideResults = ref(false)

const busy = ref(false)
const errorText = ref('')

const questionRef = ref<HTMLInputElement | null>(null)
const questionWrapRef = ref<HTMLElement | null>(null)
const descriptionRef = ref<HTMLTextAreaElement | null>(null)
const descriptionWrapRef = ref<HTMLElement | null>(null)
const explanationRef = ref<HTMLInputElement | null>(null)
const explanationWrapRef = ref<HTMLElement | null>(null)
const durationWrapRef = ref<HTMLElement | null>(null)
const optionRefs = ref<HTMLInputElement[]>([])
const optionWrapRefs = ref<HTMLElement[]>([])
type EmojiTarget = 'question' | 'description' | 'explanation' | number
const openEmojiFor = ref<EmojiTarget | null>(null)
const durationMenuOpen = ref(false)
const deadlineOpen = ref(false)

type EmojiSel = { start: number; end: number; known: boolean }
const emojiSelByKey = new Map<string, EmojiSel>()
let previousOverflow = ''

const open = computed(() => Boolean(props.chatId.trim()))

function optionLimit(): number {
  return Math.max(maxPollOptions(), POLL_MIN_OPTIONS)
}

function remainingCount(): number {
  return Math.max(0, optionLimit() - options.value.length)
}

function canAddOption(): boolean {
  return options.value.length < optionLimit()
}

function resetForm() {
  question.value = ''
  description.value = ''
  options.value = ['']
  showWhoVoted.value = true
  multiple.value = false
  allowAddOptions.value = false
  allowRevoting.value = false
  shuffleOptions.value = false
  quizMode.value = false
  correctIndexes.value = []
  explanation.value = ''
  durationOn.value = false
  closesAt.value = ''
  hideResults.value = false
  busy.value = false
  errorText.value = ''
  openEmojiFor.value = null
  durationMenuOpen.value = false
  deadlineOpen.value = false
  emojiSelByKey.clear()
  optionWrapRefs.value = []
}

watch(
  () => props.chatId,
  (next, previous) => {
    if (next.trim() && !previous.trim()) resetForm()
  },
)

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      void nextTick(() => questionRef.value?.focus())
    } else {
      document.body.style.overflow = previousOverflow
      openEmojiFor.value = null
      durationMenuOpen.value = false
      deadlineOpen.value = false
    }
  },
  { immediate: true },
)

onMounted(() => {
  if (open.value) void nextTick(() => questionRef.value?.focus())
})

onBeforeUnmount(() => {
  if (open.value) document.body.style.overflow = previousOverflow
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})

// ── popovers ────────────────────────────────────────────────────────────────

watch([openEmojiFor, durationMenuOpen], ([emojiFor, menu]) => {
  if (emojiFor !== null || menu) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (openEmojiFor.value !== null) {
    const insideQuestion = Boolean(target && questionWrapRef.value?.contains(target))
    const insideDescription = Boolean(target && descriptionWrapRef.value?.contains(target))
    const insideExplanation = Boolean(target && explanationWrapRef.value?.contains(target))
    const insideOption = Boolean(target && optionWrapRefs.value.some((node) => node?.contains(target)))
    if (!(insideQuestion || insideDescription || insideExplanation || insideOption)) openEmojiFor.value = null
  }
  if (durationMenuOpen.value && !(target && durationWrapRef.value?.contains(target))) durationMenuOpen.value = false
}

function emojiSelKey(target: EmojiTarget): string {
  return typeof target === 'number' ? `option:${target}` : target
}

function getEmojiSel(target: EmojiTarget): EmojiSel {
  const key = emojiSelKey(target)
  const existing = emojiSelByKey.get(key)
  if (existing) return existing
  const fresh: EmojiSel = { start: 0, end: 0, known: false }
  emojiSelByKey.set(key, fresh)
  return fresh
}

function emojiFieldElement(target: EmojiTarget): HTMLInputElement | HTMLTextAreaElement | null {
  if (target === 'question') return questionRef.value
  if (target === 'description') return descriptionRef.value
  if (target === 'explanation') return explanationRef.value
  return optionRefs.value[target] ?? null
}

function emojiFieldValue(target: EmojiTarget): string {
  if (target === 'question') return question.value
  if (target === 'description') return description.value
  if (target === 'explanation') return explanation.value
  return options.value[target] ?? ''
}

function emojiFieldMax(target: EmojiTarget): number {
  if (target === 'question') return MAX_QUESTION
  if (typeof target === 'number') return MAX_OPTION
  return MAX_LONG_TEXT
}

function setEmojiFieldValue(target: EmojiTarget, next: string): void {
  if (target === 'question') question.value = next
  else if (target === 'description') description.value = next
  else if (target === 'explanation') explanation.value = next
  else options.value[target] = next
}

function rememberSelectionFor(target: EmojiTarget): void {
  const element = emojiFieldElement(target)
  if (!element) return
  const value = emojiFieldValue(target)
  const sel = getEmojiSel(target)
  sel.start = element.selectionStart ?? value.length
  sel.end = element.selectionEnd ?? sel.start
  sel.known = true
}

function insertAtCursorFor(target: EmojiTarget, text: string): void {
  if (!text) return
  const value = emojiFieldValue(target)
  const max = emojiFieldMax(target)
  const sel = getEmojiSel(target)
  const start = sel.known ? Math.max(0, Math.min(sel.start, value.length)) : value.length
  const end = sel.known ? Math.max(start, Math.min(sel.end, value.length)) : start
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`.slice(0, max)
  setEmojiFieldValue(target, next)
  const caret = Math.min(start + text.length, max, next.length)
  sel.start = caret
  sel.end = caret
  sel.known = true
  void nextTick(() => {
    const element = emojiFieldElement(target)
    element?.focus()
    try {
      element?.setSelectionRange(caret, caret)
    } catch {
      // Some input modes do not expose a selection; the caret stays at the end.
    }
  })
}

function toggleEmojiFor(target: EmojiTarget): void {
  if (openEmojiFor.value === target) {
    openEmojiFor.value = null
    return
  }
  openEmojiFor.value = target
  const sel = getEmojiSel(target)
  if (sel.known) rememberSelectionFor(target)
  else {
    const length = emojiFieldValue(target).length
    sel.start = length
    sel.end = length
  }
}

function onEmojiPickFor(target: EmojiTarget, emoji: string): void {
  insertAtCursorFor(target, emoji)
  errorText.value = ''
}

function toggleEmoji() {
  toggleEmojiFor('question')
}

function onEscape() {
  if (deadlineOpen.value) return
  if (openEmojiFor.value !== null) {
    openEmojiFor.value = null
    return
  }
  if (durationMenuOpen.value) {
    durationMenuOpen.value = false
    return
  }
  requestClose()
}

function requestClose() {
  if (busy.value) return
  emit('close')
}

// ── question / description ──────────────────────────────────────────────────

function rememberQuestionSelection() {
  rememberSelectionFor('question')
}

function onEmojiPick(emoji: string) {
  onEmojiPickFor('question', emoji)
}

// ── options ─────────────────────────────────────────────────────────────────

function setOptionRef(index: number, element: unknown) {
  const input = (element as HTMLInputElement | null) || null
  if (input) optionRefs.value[index] = input
}

function setOptionWrapRef(index: number, element: unknown) {
  const node = (element as HTMLElement | null) || null
  if (node) optionWrapRefs.value[index] = node
}

function focusOption(index: number) {
  void nextTick(() => optionRefs.value[index]?.focus())
}

function addOption() {
  if (!canAddOption()) return
  openEmojiFor.value = null
  options.value.push('')
  focusOption(options.value.length - 1)
  errorText.value = ''
}

function onOptionInput(index: number, event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  options.value[index] = target.value
  errorText.value = ''
}

function removeOption(index: number) {
  if (options.value.length <= 1) return
  openEmojiFor.value = null
  options.value.splice(index, 1)
  optionRefs.value.splice(index, 1)
  optionWrapRefs.value.splice(index, 1)
  correctIndexes.value = correctIndexes.value
    .filter((entry) => entry !== index)
    .map((entry) => (entry > index ? entry - 1 : entry))
  errorText.value = ''
}

function toggleCorrect(index: number) {
  if (!quizMode.value) return
  const current = correctIndexes.value
  if (!multiple.value) {
    correctIndexes.value = current.length === 1 && current[0] === index ? [] : [index]
    return
  }
  correctIndexes.value = current.includes(index)
    ? current.filter((entry) => entry !== index)
    : [...current, index].sort((a, b) => a - b)
}

function onOptionRowClick(event: MouseEvent, index: number) {
  if (!quizMode.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, button')) return
  toggleCorrect(index)
}

// ── settings ────────────────────────────────────────────────────────────────

function onQuizChange(value: boolean) {
  quizMode.value = value
  if (!value) {
    correctIndexes.value = []
    if (openEmojiFor.value === 'explanation') openEmojiFor.value = null
  }
}

function onMultipleChange(value: boolean) {
  multiple.value = value
  // The server rejects more than one correct answer on a single-answer poll.
  if (!value && correctIndexes.value.length > 1) correctIndexes.value = correctIndexes.value.slice(0, 1)
}

function defaultDeadline(): string {
  return new Date(Date.now() + DAY_MS).toISOString()
}

function onDurationChange(value: boolean) {
  durationOn.value = value
  durationMenuOpen.value = false
  if (value) {
    if (!closesAt.value || Date.parse(closesAt.value) <= Date.now()) closesAt.value = defaultDeadline()
  } else {
    closesAt.value = ''
  }
}

function presetLabel(id: string): string {
  if (id === 'h1') return t('poll.preset_1h', undefined, '1 hour')
  if (id === 'h3') return t('poll.preset_3h', undefined, '3 hours')
  if (id === 'h8') return t('poll.preset_8h', undefined, '8 hours')
  if (id === 'd1') return t('poll.preset_1d', undefined, '1 day')
  if (id === 'd3') return t('poll.preset_3d', undefined, '3 days')
  return t('poll.preset_custom', undefined, 'Custom')
}

function pickPreset(preset: Preset) {
  durationMenuOpen.value = false
  errorText.value = ''
  if (preset.id === 'custom') {
    deadlineOpen.value = true
    return
  }
  closesAt.value = new Date(Date.now() + preset.ms).toISOString()
}

function onDeadlineSet(iso: string) {
  closesAt.value = iso
  deadlineOpen.value = false
}

const endsLabel = computed(() => {
  const raw = closesAt.value.trim()
  if (!raw) return t('poll.ends_placeholder', undefined, 'Choose time')
  const { date, time } = formatPollMoment(raw, locale.value)
  if (!date) return t('poll.ends_placeholder', undefined, 'Choose time')
  return t('poll.ends_at', { date, time }, '{date} at {time}')
})

// ── validation ──────────────────────────────────────────────────────────────

const optionTexts = computed(() => options.value.map((entry) => entry.trim()))

const questionIssue = computed(() => {
  const value = question.value.trim()
  if (!value) return t('poll.need_question', undefined, 'Enter a question')
  if (value.length > MAX_QUESTION) {
    return t('poll.question_too_long', undefined, 'Questions must be 300 characters or less')
  }
  return ''
})

const optionIssue = computed(() => {
  const texts = optionTexts.value
  if (texts.length < POLL_MIN_OPTIONS) {
    return t('poll.need_options', undefined, 'Add at least 2 options')
  }
  if (texts.some((entry) => !entry)) return t('poll.option_empty', undefined, 'Every option needs text')
  if (texts.some((entry) => entry.length > MAX_OPTION)) {
    return t('poll.option_too_long', undefined, 'Options must be 100 characters or less')
  }
  return ''
})

const quizIssue = computed(() => {
  if (!quizMode.value || correctIndexes.value.length > 0) return ''
  return t('poll.need_correct', undefined, 'Choose the correct answer')
})

const durationIssue = computed(() => {
  if (!durationOn.value) return ''
  const ts = Date.parse(closesAt.value)
  if (!closesAt.value || !Number.isFinite(ts) || ts <= Date.now()) {
    return t('poll.deadline_future', undefined, 'Pick a time in the future')
  }
  return ''
})

const blockReason = computed(() => questionIssue.value || optionIssue.value || quizIssue.value || durationIssue.value)

const showBlockReason = computed(
  () =>
    Boolean(blockReason.value) &&
    (Boolean(question.value.trim()) || optionTexts.value.some(Boolean) || quizMode.value || durationOn.value),
)

const canCreate = computed(
  () => !busy.value && !questionIssue.value && !optionIssue.value && !quizIssue.value && !durationIssue.value,
)

// ── submit ──────────────────────────────────────────────────────────────────

function buildInput(): CreatePollInput {
  const input: CreatePollInput = {
    question: question.value.trim(),
    options: optionTexts.value,
    show_who_voted: showWhoVoted.value,
    multiple: multiple.value,
    allow_add_options: allowAddOptions.value,
    allow_revoting: allowRevoting.value,
    shuffle_options: shuffleOptions.value,
    hide_results: hideResults.value,
  }
  const descriptionText = description.value.trim()
  if (descriptionText) input.description = descriptionText
  if (quizMode.value) {
    input.correct_option_ids = correctIndexes.value.map(String)
    const explanationText = explanation.value.trim()
    if (explanationText) input.explanation = explanationText
  }
  if (durationOn.value && closesAt.value) input.closes_at = closesAt.value
  return input
}

async function submitCreate() {
  if (!canCreate.value) return
  const chatID = props.chatId.trim()
  if (!chatID) {
    errorText.value = t('poll.create_failed', undefined, 'Could not create the poll')
    return
  }
  busy.value = true
  errorText.value = ''
  try {
    await createPoll(chatID, buildInput())
    toast.success(t('poll.created', undefined, 'Poll created'))
    emit('close')
  } catch (error) {
    errorText.value = pollErrorText(error, t, t('poll.create_failed', undefined, 'Could not create the poll'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <template v-if="open">
      <div class="pcOverlay" @click="requestClose" @contextmenu.prevent="requestClose" />
      <div
        class="pcDialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('poll.create_title', undefined, 'New poll')"
        @keydown.esc="onEscape"
        @click.stop
      >
        <header class="pcHead">
          <h2 class="pcTitle">{{ t('poll.create_title', undefined, 'New poll') }}</h2>
          <button
            type="button"
            class="pcClose"
            :disabled="busy"
            :aria-label="t('common.close', undefined, 'Close')"
            :title="t('common.close', undefined, 'Close')"
            @click="requestClose"
          >
            <v-icon icon="mdi-close" size="18" />
          </button>
        </header>

        <div class="pcBody">
          <section class="pcSection">
            <div class="pcSectionTitle">{{ t('poll.section_question', undefined, 'Question') }}</div>
            <div ref="questionWrapRef" class="pcQuestionWrap">
              <input
                ref="questionRef"
                v-model="question"
                type="text"
                class="pcInput pcQuestionInput"
                :maxlength="MAX_QUESTION"
                :placeholder="t('poll.question_placeholder', undefined, 'Ask a question')"
                :aria-label="t('poll.question_placeholder', undefined, 'Ask a question')"
                @focus="rememberQuestionSelection"
                @click="rememberQuestionSelection"
                @keyup="rememberQuestionSelection"
                @blur="rememberQuestionSelection"
                @input="errorText = ''"
              />
              <button
                type="button"
                class="pcEmojiBtn"
                :class="{ pcEmojiBtnOn: openEmojiFor === 'question' }"
                :aria-expanded="openEmojiFor === 'question'"
                :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                @click.stop="toggleEmoji"
              >
                <v-icon icon="mdi-emoticon-happy-outline" size="20" />
              </button>
              <div v-if="openEmojiFor === 'question'" class="pcEmojiPopover">
                <ComposerEmojiGifPicker :open="openEmojiFor === 'question'" @select="onEmojiPick" />
              </div>
            </div>
            <div ref="descriptionWrapRef" class="pcFieldWrap">
              <textarea
                ref="descriptionRef"
                v-model="description"
                class="pcInput pcTextarea pcTextareaWithEmoji"
                rows="2"
                :maxlength="MAX_LONG_TEXT"
                :placeholder="t('poll.add_description', undefined, 'Add Description (optional)')"
                :aria-label="t('poll.add_description', undefined, 'Add Description (optional)')"
                @focus="rememberSelectionFor('description')"
                @click="rememberSelectionFor('description')"
                @keyup="rememberSelectionFor('description')"
                @blur="rememberSelectionFor('description')"
                @input="errorText = ''"
              />
              <button
                type="button"
                class="pcEmojiBtn pcEmojiBtnCorner"
                :class="{ pcEmojiBtnOn: openEmojiFor === 'description' }"
                :aria-expanded="openEmojiFor === 'description'"
                :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                @click.stop="toggleEmojiFor('description')"
              >
                <v-icon icon="mdi-emoticon-happy-outline" size="20" />
              </button>
              <div v-if="openEmojiFor === 'description'" class="pcEmojiPopover">
                <ComposerEmojiGifPicker
                  :open="openEmojiFor === 'description'"
                  @select="onEmojiPickFor('description', $event)"
                />
              </div>
            </div>
          </section>

          <section class="pcSection">
            <div class="pcSectionTitle">{{ t('poll.section_options', undefined, 'Poll options') }}</div>
            <div class="pcOptions">
              <div
                v-for="(option, index) in options"
                :key="index"
                :ref="(element) => setOptionWrapRef(index, element)"
                class="pcOptionRow"
                :class="{ pcOptionRowQuiz: quizMode }"
                @click="onOptionRowClick($event, index)"
              >
                <button
                  v-if="quizMode"
                  type="button"
                  class="pcCorrectBtn"
                  :class="{ pcCorrectBtnOn: correctIndexes.includes(index) }"
                  role="checkbox"
                  :aria-checked="correctIndexes.includes(index)"
                  :aria-label="t('poll.mark_correct', undefined, 'Mark as the correct answer')"
                  :title="t('poll.mark_correct', undefined, 'Mark as the correct answer')"
                  @click.stop="toggleCorrect(index)"
                >
                  <v-icon icon="mdi-check" size="15" />
                </button>
                <input
                  :ref="(element) => setOptionRef(index, element)"
                  :value="option"
                  type="text"
                  class="pcInput pcOptionInput"
                  :maxlength="MAX_OPTION"
                  :placeholder="t('poll.option_placeholder', { n: index + 1 }, 'Option {n}')"
                  :aria-label="t('poll.option_placeholder', { n: index + 1 }, 'Option {n}')"
                  @keydown.enter.prevent="addOption"
                  @focus="rememberSelectionFor(index)"
                  @click="rememberSelectionFor(index)"
                  @keyup="rememberSelectionFor(index)"
                  @blur="rememberSelectionFor(index)"
                  @input="onOptionInput(index, $event)"
                />
                <button
                  type="button"
                  class="pcOptionEmojiBtn"
                  :class="{ pcEmojiBtnOn: openEmojiFor === index }"
                  :aria-expanded="openEmojiFor === index"
                  :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                  :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                  @click.stop="toggleEmojiFor(index)"
                >
                  <v-icon icon="mdi-emoticon-happy-outline" size="18" />
                </button>
                <div v-if="openEmojiFor === index" class="pcEmojiPopover pcEmojiPopoverOption">
                  <ComposerEmojiGifPicker
                    :open="openEmojiFor === index"
                    @select="onEmojiPickFor(index, $event)"
                  />
                </div>
                <button
                  v-if="options.length > 1"
                  type="button"
                  class="pcRemoveBtn"
                  :aria-label="t('poll.remove_option', undefined, 'Remove option')"
                  :title="t('poll.remove_option', undefined, 'Remove option')"
                  @click.stop="removeOption(index)"
                >
                  <v-icon icon="mdi-delete-outline" size="16" />
                </button>
              </div>
            </div>

            <button type="button" class="pcAddOption" :disabled="!canAddOption()" @click="addOption">
              <v-icon icon="mdi-plus" size="16" />
              <span>{{ t('poll.add_option', undefined, 'Add an option...') }}</span>
            </button>

            <div class="pcHint">
              <template v-if="remainingCount() > 0">
                {{ t('poll.more_options', { n: remainingCount() }, 'You can add {n} more options.') }}
              </template>
              <template v-else>
                {{ t('poll.max_options', { n: optionLimit() }, 'Maximum of {n} options reached.') }}
              </template>
            </div>
          </section>

          <section class="pcSection">
            <div class="pcSectionTitle">{{ t('poll.section_settings', undefined, 'Settings') }}</div>
            <div class="pcSettings">
              <PollSettingsRow
                v-model="showWhoVoted"
                icon="mdi-account-multiple-outline"
                color="#4a90d9"
                :title="t('poll.opt_show_who_voted', undefined, 'Show Who Voted')"
                :subtitle="t('poll.opt_show_who_voted_sub', undefined, 'Display voter name on each option.')"
              />
              <PollSettingsRow
                :model-value="multiple"
                icon="mdi-format-list-checks"
                color="#22a06b"
                :title="t('poll.opt_multiple', undefined, 'Allow Multiple Answers')"
                :subtitle="t('poll.opt_multiple_sub', undefined, 'Voters can select more than one answer.')"
                @update:model-value="onMultipleChange"
              />
              <PollSettingsRow
                v-model="allowAddOptions"
                icon="mdi-plus-box-outline"
                color="#f59e0b"
                :title="t('poll.opt_add_options', undefined, 'Allow Adding Options')"
                :subtitle="t('poll.opt_add_options_sub', undefined, 'Participants can suggest new options.')"
              />
              <PollSettingsRow
                v-model="allowRevoting"
                icon="mdi-rotate-right"
                color="#8b5cf6"
                :title="t('poll.opt_revoting', undefined, 'Allow Revoting')"
                :subtitle="t('poll.opt_revoting_sub', undefined, 'Voters can change their vote.')"
              />
              <PollSettingsRow
                v-model="shuffleOptions"
                icon="mdi-shuffle-variant"
                color="#14b8a6"
                :title="t('poll.opt_shuffle', undefined, 'Shuffle Options')"
                :subtitle="t('poll.opt_shuffle_sub', undefined, 'Answers appear in random order for each voter.')"
              />
              <PollSettingsRow
                :model-value="quizMode"
                icon="mdi-help-circle-outline"
                color="#eab308"
                :title="t('poll.opt_quiz', undefined, 'Set Correct Answer')"
                :subtitle="t('poll.opt_quiz_sub', undefined, 'Mark one or more options as the right answer.')"
                @update:model-value="onQuizChange"
              />

              <div v-if="quizMode" class="pcSubBlock">
                <div ref="explanationWrapRef" class="pcFieldWrap">
                  <input
                    ref="explanationRef"
                    v-model="explanation"
                    type="text"
                    class="pcInput pcInputWithEmoji"
                    :maxlength="MAX_LONG_TEXT"
                    :placeholder="t('poll.explanation_placeholder', undefined, 'Add an explanation (optional)')"
                    :aria-label="t('poll.explanation_placeholder', undefined, 'Add an explanation (optional)')"
                    @focus="rememberSelectionFor('explanation')"
                    @click="rememberSelectionFor('explanation')"
                    @keyup="rememberSelectionFor('explanation')"
                    @blur="rememberSelectionFor('explanation')"
                    @input="errorText = ''"
                  />
                  <button
                    type="button"
                    class="pcEmojiBtn"
                    :class="{ pcEmojiBtnOn: openEmojiFor === 'explanation' }"
                    :aria-expanded="openEmojiFor === 'explanation'"
                    :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                    :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                    @click.stop="toggleEmojiFor('explanation')"
                  >
                    <v-icon icon="mdi-emoticon-happy-outline" size="20" />
                  </button>
                  <div v-if="openEmojiFor === 'explanation'" class="pcEmojiPopover">
                    <ComposerEmojiGifPicker
                      :open="openEmojiFor === 'explanation'"
                      @select="onEmojiPickFor('explanation', $event)"
                    />
                  </div>
                </div>
                <div class="pcCaption">
                  {{
                    t(
                      'poll.explanation_caption',
                      undefined,
                      'Users will see this comment after choosing a wrong answer, good for educational purposes.',
                    )
                  }}
                </div>
              </div>

              <PollSettingsRow
                :model-value="durationOn"
                icon="mdi-clock-outline"
                color="#ef4444"
                :title="t('poll.opt_duration', undefined, 'Limit Duration')"
                :subtitle="t('poll.opt_duration_sub', undefined, 'Automatically close the poll at a set time.')"
                @update:model-value="onDurationChange"
              />

              <div v-if="durationOn" ref="durationWrapRef" class="pcDurationWrap">
                <button
                  type="button"
                  class="pcValueRow"
                  :aria-expanded="durationMenuOpen"
                  :aria-label="t('poll.poll_ends', undefined, 'Poll ends')"
                  @click.stop="durationMenuOpen = !durationMenuOpen"
                >
                  <span class="pcValueLabel">
                    <v-icon icon="mdi-calendar-clock-outline" size="16" />
                    <span>{{ t('poll.poll_ends', undefined, 'Poll ends') }}</span>
                  </span>
                  <span class="pcValue">{{ endsLabel }}</span>
                  <v-icon icon="mdi-chevron-down" size="16" />
                </button>
                <div v-if="durationMenuOpen" class="pcPopover" role="menu">
                  <button
                    v-for="preset in PRESETS"
                    :key="preset.id"
                    type="button"
                    class="pcMenuItem"
                    role="menuitem"
                    @click.stop="pickPreset(preset)"
                  >
                    {{ presetLabel(preset.id) }}
                  </button>
                </div>
              </div>

              <PollSettingsRow
                v-model="hideResults"
                icon="mdi-eye-off-outline"
                color="#64748b"
                :title="t('poll.hide_results', undefined, 'Hide results')"
                :subtitle="
                  t('poll.hide_results_sub', undefined, 'Voters won’t see results until the poll is closed')
                "
              />
            </div>
          </section>
        </div>

        <div class="pcFoot">
          <div v-if="errorText" class="pcError" role="alert">{{ errorText }}</div>
          <div v-else-if="showBlockReason" class="pcReason">{{ blockReason }}</div>
          <div class="pcActions">
            <button type="button" class="pcBtn" :disabled="busy" @click="requestClose">
              {{ t('common.cancel', undefined, 'Cancel') }}
            </button>
            <button
              type="button"
              class="pcBtn primary"
              :disabled="!canCreate || busy"
              @click="submitCreate"
            >
              {{ busy ? t('common.loading', undefined, 'Loading…') : t('poll.create', undefined, 'Create') }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <PollDeadlineDialog
      :open="deadlineOpen"
      :value="closesAt"
      @cancel="deadlineOpen = false"
      @set="onDeadlineSet"
    />
  </Teleport>
</template>

<style scoped>
.pcOverlay {
  position: fixed;
  inset: 0;
  z-index: 130;
  background: rgba(15, 23, 42, 0.46);
}

.pcDialog {
  position: fixed;
  z-index: 131;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(520px, calc(100vw - 20px));
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.34);
  overflow: hidden;
}

.pcHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 10px;
}

.pcTitle {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.2;
}

.pcClose {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pcClose:hover:not(:disabled) {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.pcClose:disabled {
  opacity: 0.5;
  cursor: default;
}

.pcBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 16px;
  padding: 2px 16px 14px;
}

.pcSection {
  display: grid;
  gap: 8px;
}

.pcSectionTitle {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.pcInput {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-soft);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  padding: 9px 11px;
}

.pcInput::placeholder {
  color: var(--text-muted);
}

.pcInput:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface-strong);
}

.pcQuestionWrap {
  position: relative;
  display: block;
}

.pcFieldWrap {
  position: relative;
  display: block;
}

.pcQuestionInput {
  padding-right: 40px;
  font-size: 15px;
  font-weight: 600;
}

.pcInputWithEmoji {
  padding-right: 40px;
}

.pcEmojiBtn {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pcEmojiBtn:hover,
.pcEmojiBtnOn {
  background: var(--surface-soft-hover);
  color: var(--accent);
}

.pcEmojiBtnCorner {
  top: 8px;
  transform: none;
}

.pcOptionEmojiBtn {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pcOptionEmojiBtn:hover,
.pcOptionEmojiBtn.pcEmojiBtnOn {
  background: var(--surface-soft-hover);
  color: var(--accent);
}

.pcEmojiPopover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 8;
  width: min(388px, calc(100vw - 44px));
}

/* The GIF/sticker tabs do not apply to a plain-text poll question. */
.pcEmojiPopover :deep(.ep-tabs) {
  display: none;
}

.pcTextarea {
  resize: vertical;
  min-height: 54px;
}

.pcTextareaWithEmoji {
  padding-right: 40px;
}

.pcOptions {
  display: grid;
  gap: 6px;
}

.pcOptionRow {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
}

.pcOptionRow:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
}

.pcOptionInput {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 6px 6px;
}

.pcOptionInput:focus {
  border: 0;
  background: transparent;
}

.pcCorrectBtn {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface-strong);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pcCorrectBtnOn {
  border-color: transparent;
  background: #22a06b;
  color: #fff;
}

.pcRemoveBtn {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}

.pcOptionRow:hover .pcRemoveBtn,
.pcOptionRow:focus-within .pcRemoveBtn {
  opacity: 1;
}

.pcRemoveBtn:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.pcRemoveBtn:focus-visible {
  opacity: 1;
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.pcAddOption {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 11px;
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  color: var(--accent);
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}

.pcAddOption:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 13%, transparent);
}

.pcAddOption:disabled {
  opacity: 0.45;
  cursor: default;
}

.pcHint {
  font-size: 11.5px;
  color: var(--text-muted);
}

.pcSettings {
  display: grid;
  gap: 2px;
}

.pcSubBlock {
  display: grid;
  gap: 6px;
  padding: 2px 0 6px 42px;
}

.pcCaption {
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--text-muted);
}

.pcDurationWrap {
  position: relative;
  padding: 2px 0 6px 42px;
}

.pcValueRow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

.pcValueRow:hover {
  background: var(--surface-soft-hover);
}

.pcValueLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: var(--text-soft);
}

.pcValue {
  margin-left: auto;
  font-weight: 700;
  color: var(--accent);
}

.pcPopover {
  position: absolute;
  top: calc(100% + 4px);
  left: 42px;
  right: 0;
  z-index: 8;
  display: grid;
  gap: 1px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-strong);
  box-shadow: var(--shadow-card);
}

.pcMenuItem {
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.pcMenuItem:hover {
  background: var(--surface-soft-hover);
}

.pcFoot {
  flex: 0 0 auto;
  display: grid;
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
}

.pcError {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--danger);
}

.pcReason {
  font-size: 12px;
  color: var(--text-muted);
}

.pcActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.pcBtn {
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  color: var(--text);
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
}

.pcBtn:hover:not(:disabled) {
  background: var(--surface-soft-hover);
}

.pcBtn.primary {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}

.pcBtn.primary:hover:not(:disabled) {
  background: var(--accent-strong);
}

.pcBtn:disabled {
  opacity: 0.55;
  cursor: default;
}

@media (max-width: 560px) {
  .pcEmojiPopover {
    right: auto;
    left: 0;
  }

  .pcSubBlock,
  .pcDurationWrap {
    padding-left: 0;
  }

  .pcPopover {
    left: 0;
  }
}
</style>
