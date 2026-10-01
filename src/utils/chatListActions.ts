/**
 * Tiny module-level bridge between the three-dot chat menu
 * (`ChatWorkspaceOverlays`) and the message list (`ChatMessageList`).
 *
 * The menu is rendered through a Teleport from a sibling overlay component, so
 * it cannot reach the list's DOM (or its loaders) through props/refs without
 * editing `ChatWorkspace.vue`. Both sides already live in the same workspace
 * tree, so they meet here instead: the list registers what it can do on mount,
 * the menu calls it by name.
 */
export type Actions = {
  /** Jump the message list to the oldest visible message (scrollTop = 0). */
  scrollToTop?: () => void
  /** Re-read the active chat's history and refresh the surrounding list. */
  reload?: () => void
}

let actions: Actions = {}

/** Merge the given actions into the registry. Call from `onMounted`. */
export function registerChatListActions(next: Actions): void {
  actions = { ...actions, ...next }
}

/**
 * Drop registered actions. Pass the keys to remove only those (what a
 * component does on unmount), or omit them to reset the whole registry.
 */
export function unregisterChatListActions(keys?: (keyof Actions)[]): void {
  if (!keys) {
    actions = {}
    return
  }
  const next: Actions = { ...actions }
  for (const key of keys) delete next[key]
  actions = next
}

/** "To Beginning": scroll the message list back to the oldest message. */
export function scrollToChatTop(): void {
  actions.scrollToTop?.()
}

/** Ask the message list to re-read the chat it is currently rendering. */
export function reloadChatList(): void {
  actions.reload?.()
}
