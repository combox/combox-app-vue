import { shallowRef } from 'vue'

/**
 * Shared overlay store for the "New poll" dialog.
 *
 * The dialog itself (`PollCreateDialog.vue`) is mounted once from `App.vue`;
 * the three-dot chat menu opens it by calling `openPollCreateDialog`. Keeping
 * the state here means the menu never has to import the dialog component.
 */
export type PollCreateTarget = { chatID: string } | null

export const pollCreateTarget = shallowRef<PollCreateTarget>(null)

export function openPollCreateDialog(chatID: string): boolean {
  const id = String(chatID || '').trim()
  if (!id) return false
  pollCreateTarget.value = { chatID: id }
  return true
}

export function closePollCreateDialog(): void {
  pollCreateTarget.value = null
}
