import { reactive } from 'vue'
import type { Poll } from './pollFormat'

/**
 * Vote / close responses are authoritative for one poll, but the chat feed is
 * rebuilt from `rawMessages` (and some messages are copied while normalising
 * `sender_user_id`), so writing the fresh payload straight into the message can
 * be lost on the next recompute. Keeping the newest payload here - together with
 * the message payload it replaced - lets `resolvePoll` serve the update for as
 * long as the message still carries that same payload, while a genuine reload
 * (which mints a new `poll` object) wins again.
 */
type PollOverride = { source: Poll; poll: Poll }

const overrides = reactive<Record<string, PollOverride>>({})

/** Stores the newest server payload for a poll. */
export function applyPollUpdate(source: Poll | undefined, updated: Poll): void {
  if (!updated || !updated.id) return
  overrides[updated.id] = { source: source ?? updated, poll: updated }
}

/** Resolves the payload a message should render. */
export function resolvePoll(poll: Poll | undefined): Poll | null {
  if (!poll) return null
  const hit = overrides[poll.id]
  if (hit && hit.source === poll) return hit.poll
  return poll
}
