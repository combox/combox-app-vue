import { shallowRef } from 'vue'

/** Extra behaviour a caller can attach to an opened profile. */
export type ProfileModalOptions = {
  /** `@username`-free handle of the same user, when known. */
  username?: string
  /** Display name known by the caller, shown until the profile loads. */
  name?: string
  /**
   * "Message" action. The workspace wires this to its own username-based chat
   * opener, which is the only path that both resolves and selects a chat.
   */
  openChat?: (username: string) => void
}

export type ProfileModalTarget = {
  userID: string
  username: string
  name: string
  openChat?: (username: string) => void
}

export const profileModalTarget = shallowRef<ProfileModalTarget | null>(null)

export function openProfileModal(userID: string, options: ProfileModalOptions = {}): void {
  profileModalTarget.value = {
    userID: String(userID || '').trim(),
    username: String(options.username || '').trim().replace(/^@+/, ''),
    name: String(options.name || '').trim(),
    openChat: options.openChat,
  }
}

export function closeProfileModal(): void {
  profileModalTarget.value = null
}
