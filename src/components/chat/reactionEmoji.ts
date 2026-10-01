const VARIATION_SELECTORS = /[\uFE0E\uFE0F]/g

/**
 * Canonical key used to compare emojis: the same grapheme typed with or
 * without a text/emoji variation selector must map to one reaction chip.
 */
export function canonicalEmojiKey(emoji: string): string {
  const value = (emoji || '').normalize('NFC').replace(VARIATION_SELECTORS, '')
  return value.trim()
}

export function isSameEmoji(a: string, b: string): boolean {
  const keyA = canonicalEmojiKey(a)
  if (!keyA) return false
  return keyA === canonicalEmojiKey(b)
}

type ReactionLike = {
  emoji?: string
  user_ids?: string[]
}

/**
 * Returns the exact emoji string already stored for this message so toggling
 * never creates a second variant of the same reaction.
 */
export function resolveReactionEmoji(reactions: ReactionLike[] | undefined, emoji: string, myUserId: string): string {
  const key = canonicalEmojiKey(emoji)
  if (!key || !Array.isArray(reactions)) return emoji

  const matching = reactions.filter((item) => item && canonicalEmojiKey(item.emoji || '') === key)
  if (matching.length === 0) return emoji

  const me = (myUserId || '').trim()
  if (me) {
    const mine = matching.find((item) => Array.isArray(item.user_ids) && item.user_ids.includes(me))
    if (mine?.emoji) return mine.emoji
  }

  return matching.find((item) => item.emoji)?.emoji || emoji
}
