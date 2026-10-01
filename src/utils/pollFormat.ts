import { ApiError, type MessageItem } from 'combox-api'

export type TranslateFn = (key: string, params?: Record<string, string | number>, fallback?: string) => string

/**
 * The poll payload. `combox-api` re-exports `MessageItem` (and every read path
 * attaches `MessageItem.poll`), so the shape is derived from there instead of a
 * named export the SDK entry point does not provide.
 */
export type Poll = NonNullable<MessageItem['poll']>

/**
 * Effective close state. The server already folds the deadline into
 * `closed`, but a payload cached before the deadline elapsed would claim the
 * poll is still open, so the timestamp is re-checked against `now`.
 */
export function isPollClosed(poll: Poll, now: number = Date.now()): boolean {
  if (poll.is_closed) return true
  const closesAt = String(poll.closes_at || '').trim()
  if (closesAt) {
    const ts = Date.parse(closesAt)
    if (Number.isFinite(ts) && ts <= now) return true
  }
  return Boolean(poll.closed)
}

export function pollTotalVotes(poll: Poll): number {
  const total = Number(poll.total_votes ?? 0)
  return Number.isFinite(total) && total > 0 ? total : 0
}

/** Tallies are omitted from the payload whenever the viewer may not see them. */
export function pollResultsVisible(poll: Poll): boolean {
  if (poll.results_hidden) return false
  return Array.isArray(poll.results) && typeof poll.total_votes === 'number'
}

/** `Sep 30` / `12:01 PM` pieces so callers can compose a localized sentence. */
export function formatPollMoment(value: string, locale: string): { date: string; time: string } {
  const raw = String(value || '').trim()
  if (!raw) return { date: '', time: '' }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const dateFmt = new Intl.DateTimeFormat(
    locale,
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  )
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  return { date: dateFmt.format(date), time: timeFmt.format(date) }
}

/** `1 vote` / `2 votes` with proper Russian plural categories. */
export function pollVotesLabel(total: number, locale: string, t: TranslateFn): string {
  const params = { n: total }
  const category = new Intl.PluralRules(locale).select(total)
  if (category === 'one') return t('poll.votes.one', params, '{n} vote')
  if (category === 'few') return t('poll.votes.few', params, '{n} votes')
  if (category === 'many') return t('poll.votes.many', params, '{n} votes')
  return t('poll.votes.other', params, '{n} votes')
}

/** Turns an API failure into a sentence the user can act on. */
export function pollErrorText(error: unknown, t: TranslateFn, fallback: string): string {
  const code = error instanceof ApiError ? error.code : ''
  const message = error instanceof Error ? error.message : ''

  if (message === 'error.poll.already_voted') return t('poll.err_already_voted', undefined, 'You have already voted')
  if (message === 'error.poll.closed') return t('poll.err_poll_closed', undefined, 'This poll is closed')
  if (code === 'invalid_argument' || message.startsWith('error.poll.invalid')) {
    return t('poll.err_invalid_input', undefined, 'Check the poll details and try again')
  }
  if (code === 'forbidden' || message.startsWith('error.chat.forbidden')) {
    return t('poll.err_forbidden', undefined, 'You are not allowed to do that')
  }
  if (code === 'conflict') return t('poll.err_conflict', undefined, 'That does not match the current poll state')
  if (code === 'network_error' || code === 'request_failed' || /fetch|network/i.test(message)) {
    return t('poll.err_network', undefined, 'Could not reach the server. Try again.')
  }
  return fallback
}
