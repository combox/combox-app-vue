/**
 * Per-entity avatar fallback colours.
 *
 * Every chat / user / group / channel that has no uploaded picture gets its
 * own stable colour, the way Telegram does it, instead of one global
 * `--avatar-fallback` shared by the whole app.
 *
 * The palette is intentionally made of solid fills that keep white initials
 * readable: every entry has a contrast ratio of at least 3:1 against #fff
 * (WCAG "large text", which is what avatar letters are).
 */
export const AVATAR_PALETTE: readonly string[] = [
  '#d85b60', // red
  '#cf7f3f', // orange
  '#8575d8', // violet
  '#48a63f', // green
  '#2f9ea0', // teal
  '#3f86c4', // blue
  '#d9568f', // pink
  '#3f8fd6', // sky
]

/**
 * djb2 over the seed string. Deterministic, so the same id always resolves to
 * the same colour, on every render and in every session.
 */
function hashSeed(seed: string): number {
  let hash = 5381
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0
  }
  return hash >>> 0
}

/** Stable avatar fill for an identity seed (chat id, user id, title, …). */
export function avatarColorFor(seed: string): string {
  const key = String(seed ?? '').trim()
  const index = hashSeed(key) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[index]
}

/** Same as {@link avatarColorFor} but shaped for an inline `:style` binding. */
export function avatarColorStyleFor(seed: string): { background: string } {
  return { background: avatarColorFor(seed) }
}
