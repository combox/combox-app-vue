import { shallowRef } from 'vue'

/** One photo of an avatar history, already resolved to a displayable URL. */
export type AvatarPhoto = { id: string; url: string; createdAt: string }

/**
 * Optional gallery context. When `ownerId` + `ownerKind` are given and no
 * `items` are supplied, `AvatarViewer` lazy-loads the history itself.
 */
export type AvatarGalleryOwner = {
  ownerId?: string
  ownerKind?: 'user' | 'chat'
  subtitle?: string
  items?: AvatarPhoto[]
  startIndex?: number
}

export type AvatarPreviewTarget = ({ src: string; title?: string } & AvatarGalleryOwner) | null

export const avatarPreviewTarget = shallowRef<AvatarPreviewTarget>(null)

/**
 * Opens the fullscreen avatar viewer. The first two parameters keep the
 * original single-photo contract; the optional third one turns the call into
 * a full gallery.
 */
export function openAvatarPreview(src: string, title = '', owner: AvatarGalleryOwner = {}) {
  avatarPreviewTarget.value = { src: src || '', title, ...owner }
}

/** Opens the viewer from a fully shaped target (gallery variant). */
export function openAvatarGallery(target: Exclude<AvatarPreviewTarget, null>) {
  avatarPreviewTarget.value = { ...target, src: target.src || '' }
}

export function closeAvatarPreview() {
  avatarPreviewTarget.value = null
}
