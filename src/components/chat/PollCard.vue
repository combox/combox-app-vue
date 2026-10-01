<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { closePoll, votePoll, type MessageItem } from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import {
  formatPollMoment,
  isPollClosed,
  pollErrorText,
  pollResultsVisible,
  pollTotalVotes,
  pollVotesLabel,
  type Poll,
} from '../../utils/pollFormat'

const props = defineProps<{
  poll: Poll
  message: MessageItem
  currentUserId: string
  senderNameByUserId?: Record<string, string>
}>()

const emit = defineEmits<{
  voted: [payload: { messageID: string; poll: Poll }]
  stopped: [payload: { messageID: string; poll: Poll }]
}>()

const { t, locale } = useI18n()

type OptionRow = {
  id: string
  text: string
  kind: 'ok' | 'bad' | 'mine' | 'empty'
  icon: string
  checked: boolean
  mine: boolean
  percent: number
  votes: number
  voters: string
}

const localPoll = ref<Poll>(props.poll)
const votingBusy = ref(false)
const stoppingBusy = ref(false)
const actionError = ref('')
const pending = ref<string[]>()

watch(
  () => props.poll,
  (next) => {
    if (next && next !== localPoll.value) localPoll.value = next
  },
)

watch(
  () => localPoll.value.my_option_ids,
  (ids) => {
    pending.value = [...(ids || [])]
  },
  { immediate: true },
)

const busy = computed(() => votingBusy.value || stoppingBusy.value)
const closed = computed(() => isPollClosed(localPoll.value))
const myIds = computed(() => localPoll.value.my_option_ids || [])
const hasVoted = computed(() => myIds.value.length > 0)
const multiple = computed(() => Boolean(localPoll.value.multiple))
const quiz = computed(() => (localPoll.value.correct_option_ids || []).length > 0)
const correctIds = computed(() => localPoll.value.correct_option_ids || [])
const totalVotes = computed(() => pollTotalVotes(localPoll.value))
/** Tallies only exist once the server is willing to show them to this viewer. */
const showBars = computed(() => pollResultsVisible(localPoll.value))
const canVote = computed(() => !closed.value && (!hasVoted.value || Boolean(localPoll.value.allow_revoting)))

const resultsById = computed(() => {
  const map = new Map<string, { votes: number; percent: number }>()
  for (const result of localPoll.value.results || []) map.set(result.id, result)
  return map
})

const pendingDirty = computed(() => {
  if (!multiple.value) return false
  const current = myIds.value
  const next = pending.value || []
  if (current.length !== next.length) return true
  const seen = new Set(current)
  return next.some((id) => !seen.has(id))
})

function sameChoice(id: string): boolean {
  return multiple.value ? (pending.value || []).includes(id) : myIds.value.includes(id)
}

function controlKind(id: string): OptionRow['kind'] {
  const selected = sameChoice(id)
  if (showBars.value && quiz.value) {
    if (correctIds.value.includes(id)) return 'ok'
    if (selected) return 'bad'
    return 'empty'
  }
  return selected ? 'mine' : 'empty'
}

function votersLine(id: string): string {
  if (!localPoll.value.show_who_voted || !showBars.value) return ''
  const ids = localPoll.value.voters?.[id] || []
  if (!ids.length) return ''
  const names: string[] = []
  for (const userID of ids) {
    const name = (props.senderNameByUserId?.[userID] || '').trim()
    if (name && !names.includes(name)) names.push(name)
  }
  if (!names.length) return ''
  const shown = names.slice(0, 2).join(', ')
  const rest = ids.length - Math.min(names.length, 2)
  return rest > 0 ? `${shown} +${rest}` : shown
}

const rows = computed<OptionRow[]>(() =>
  (localPoll.value.options || []).map((option) => {
    const kind = controlKind(option.id)
    const result = resultsById.value.get(option.id)
    const percent = result && Number.isFinite(result.percent) ? Math.min(100, Math.max(0, Math.round(result.percent))) : 0
    return {
      id: option.id,
      text: option.text,
      kind,
      icon: kind === 'bad' ? 'mdi-close' : 'mdi-check',
      checked: sameChoice(option.id),
      mine: myIds.value.includes(option.id),
      percent,
      votes: result && Number.isFinite(result.votes) ? result.votes : 0,
      voters: votersLine(option.id),
    }
  }),
)

const totalLabel = computed(() => {
  const total = totalVotes.value
  if (closed.value) return pollVotesLabel(total, locale.value, t)
  if (!showBars.value) return total > 0 ? '' : t('poll.no_votes', undefined, 'No votes')
  return pollVotesLabel(total, locale.value, t)
})

const endsLabel = computed(() => {
  if (closed.value) return ''
  const raw = String(localPoll.value.closes_at || '').trim()
  if (!raw) return ''
  const { date, time } = formatPollMoment(raw, locale.value)
  if (!date) return ''
  return t('poll.ends_line', { date, time }, 'Poll ends {date} at {time}')
})

const explanationText = computed(() => String(localPoll.value.explanation || '').trim())
const showExplanation = computed(() => quiz.value && hasVoted.value && Boolean(explanationText.value))

const canStop = computed(
  () =>
    !closed.value &&
    Boolean(localPoll.value.created_by) &&
    localPoll.value.created_by === props.currentUserId,
)

function onOptionClick(id: string) {
  if (!canVote.value || busy.value) return
  if (multiple.value) {
    const current = pending.value || []
    pending.value = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    actionError.value = ''
    return
  }
  if (myIds.value.includes(id)) return
  void castVote([id])
}

function cancelPending() {
  pending.value = [...myIds.value]
  actionError.value = ''
}

async function castVote(optionIDs: string[]) {
  if (busy.value || optionIDs.length === 0) return
  const pollID = localPoll.value.id
  const previous = [...myIds.value]
  votingBusy.value = true
  actionError.value = ''
  // Optimistic choice so the row reacts instantly; the response is authoritative.
  localPoll.value = { ...localPoll.value, my_option_ids: [...optionIDs] }
  try {
    const updated = await votePoll(pollID, optionIDs)
    localPoll.value = updated
    pending.value = [...(updated.my_option_ids || [])]
    emit('voted', { messageID: props.message.id, poll: updated })
  } catch (error) {
    localPoll.value = { ...localPoll.value, my_option_ids: previous }
    pending.value = [...previous]
    actionError.value = pollErrorText(error, t, t('poll.vote_failed', undefined, 'Could not send your vote'))
  } finally {
    votingBusy.value = false
  }
}

async function stopPoll() {
  if (busy.value || closed.value) return
  stoppingBusy.value = true
  actionError.value = ''
  try {
    const updated = await closePoll(localPoll.value.id)
    localPoll.value = updated
    pending.value = [...(updated.my_option_ids || [])]
    emit('stopped', { messageID: props.message.id, poll: updated })
  } catch (error) {
    actionError.value = pollErrorText(error, t, t('poll.stop_failed', undefined, 'Could not stop the poll'))
  } finally {
    stoppingBusy.value = false
  }
}
</script>

<template>
  <div class="pollCard">
    <div class="pollQuestion">{{ localPoll.question }}</div>
    <div v-if="localPoll.description" class="pollDesc">{{ localPoll.description }}</div>
    <div class="pollKind">{{ t('poll.kind_label', undefined, 'Poll') }}</div>

    <div v-if="closed" class="pollFinal">{{ t('poll.final_results', undefined, 'Final results') }}</div>

    <div
      class="pollOptions"
      :role="multiple ? 'group' : 'radiogroup'"
      :aria-label="localPoll.question"
    >
      <button
        v-for="row in rows"
        :key="row.id"
        type="button"
        class="pollOption"
        :class="{ pollOptionMine: row.mine, pollOptionOn: row.checked }"
        :role="multiple ? 'checkbox' : 'radio'"
        :aria-checked="row.checked"
        :disabled="!canVote || busy"
        @click="onOptionClick(row.id)"
      >
        <span
          v-if="showBars"
          class="pollBar"
          :style="{ width: `${row.percent}%` }"
          aria-hidden="true"
        />
        <span class="pollControl" :class="[`pollControl--${row.kind}`, { square: multiple }]" aria-hidden="true">
          <v-icon v-if="row.kind !== 'empty'" :icon="row.icon" size="13" />
        </span>
        <span class="pollBody">
          <span class="pollOptionText">{{ row.text }}</span>
          <span v-if="row.voters" class="pollVoters">{{ row.voters }}</span>
        </span>
        <span v-if="showBars" class="pollStats">
          <span class="pollPct">{{ row.percent }}%</span>
          <span class="pollCount">{{ row.votes }}</span>
        </span>
      </button>
    </div>

    <div v-if="endsLabel" class="pollEnds">
      <v-icon icon="mdi-clock-outline" size="13" />
      <span>{{ endsLabel }}</span>
    </div>

    <div v-if="showExplanation" class="pollExplanation">
      <v-icon icon="mdi-information-outline" size="15" />
      <span>{{ explanationText }}</span>
    </div>

    <div v-if="multiple && canVote && pendingDirty" class="pollVoteActions">
      <button type="button" class="pollLinkBtn" :disabled="votingBusy" @click="cancelPending">
        {{ t('common.cancel', undefined, 'Cancel') }}
      </button>
      <button
        type="button"
        class="pollSubmit"
        :disabled="votingBusy || (pending || []).length === 0"
        @click="castVote([...(pending || [])])"
      >
        {{ hasVoted ? t('poll.update_vote', undefined, 'Update vote') : t('poll.vote', undefined, 'Vote') }}
      </button>
    </div>

    <div v-if="actionError" class="pollError" role="alert">{{ actionError }}</div>

    <footer class="pollFooter">
      <span v-if="totalLabel" class="pollTotal">{{ totalLabel }}</span>
      <button v-if="canStop" type="button" class="pollStop" :disabled="stoppingBusy" @click="stopPoll">
        {{
          stoppingBusy
            ? t('common.loading', undefined, 'Loading…')
            : t('poll.stop_poll', undefined, 'Stop poll')
        }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.pollCard {
  display: grid;
  gap: 4px;
  min-width: min(260px, 100%);
  padding-top: 1px;
}

.pollQuestion {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.pollDesc {
  font-size: 13.5px;
  line-height: 1.4;
  color: var(--text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.pollKind {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
  opacity: 0.85;
}

.pollFinal {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-soft);
}

.pollOptions {
  display: grid;
  gap: 2px;
  margin-top: 4px;
}

.pollOption {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 34px;
  padding: 5px 7px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}

.pollOption:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text) 5%, transparent);
}

.pollOption:disabled {
  cursor: default;
}

.pollOption:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.pollBar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  z-index: 0;
  background: color-mix(in srgb, var(--text) 10%, transparent);
  transition: width 240ms ease;
}

.pollOptionMine .pollBar {
  background: color-mix(in srgb, #34c759 34%, transparent);
}

.pollControl {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  width: 19px;
  height: 19px;
  border: 2px solid color-mix(in srgb, var(--text) 34%, transparent);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
}

.pollControl.square {
  border-radius: 6px;
}

.pollControl--mine {
  border-color: var(--accent);
  background: var(--accent);
}

.pollControl--ok {
  border-color: #22a06b;
  background: #22a06b;
}

.pollControl--bad {
  border-color: var(--danger);
  background: var(--danger);
}

.pollBody {
  position: relative;
  z-index: 1;
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 1px;
}

.pollOptionText {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.pollVoters {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pollStats {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding-left: 4px;
  font-variant-numeric: tabular-nums;
}

.pollPct {
  font-size: 13px;
  font-weight: 700;
}

.pollCount {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 1ch;
  text-align: right;
}

.pollEnds {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.pollExplanation {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 4px;
  padding: 7px 9px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text-soft);
}

.pollVoteActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 6px;
}

.pollLinkBtn {
  min-height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.pollLinkBtn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text) 6%, transparent);
  color: var(--text);
}

.pollSubmit {
  min-height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.pollSubmit:hover:not(:disabled) {
  background: var(--accent-strong);
}

.pollSubmit:disabled {
  opacity: 0.55;
  cursor: default;
}

.pollError {
  margin-top: 4px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--danger);
}

.pollFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 5px;
}

.pollTotal {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-muted);
}

.pollStop {
  margin-left: auto;
  min-height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--danger);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}

.pollStop:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.pollStop:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
