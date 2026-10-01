<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getAccessToken, getCurrentUser, listChatPhotos, listUserPhotos, updateProfile } from 'combox-api'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../i18n/i18n'
import { avatarColorFor } from '../../utils/avatarColor'
import { avatarPreviewTarget, closeAvatarPreview, type AvatarPhoto, type AvatarPreviewTarget } from '../../utils/avatarViewer'
import ConfirmDialog from './ConfirmDialog.vue'
import { useConfirm } from './useConfirm'

const { t, locale } = useI18n()
const toast = useToast()

type OpenTarget = Exclude<AvatarPreviewTarget, null>

// Clamp so the popup menu never leaves the viewport (fixed positioning).
// Four rows (set-as-main / copy / save-as / delete) fit in ~200px padding in.
const MENU_WIDTH = 220
const MENU_HEIGHT = 208

// One gallery photo. `migrated` marks rows the boxchat ETL backfilled: their
// `createdAt` is the migration moment, not the original install moment, so
// the caption must label them instead of stating a false install date. The
// backend sends `migrated` explicitly; older backends are detected by the
// boxchat-legacy object-key prefix inside the (presigned) URL.
type GalleryPhoto = AvatarPhoto & { migrated?: boolean }

const photos = ref<GalleryPhoto[]>([])
const activeIndex = ref(0)
const historyLoading = ref(false)
// Telegram-Desktop viewer state: rotation is per photo, one popup menu is
// shared by the "…" button and right-click on the photo.
const rotateDeg = ref(0)
const menuOpen = ref(false)
const menuPos = ref({ x: 0, y: 0 })
const copyBusy = ref(false)
const setMainBusy = ref(false)
const deleteBusy = ref(false)
// Delete confirmation (shared ConfirmDialog/useConfirm pair, same wiring as
// ChatFoldersBar): the dialog teleports to body above this overlay.
const deleteConfirm = useConfirm()

// Every lazy load carries a token: a newer open (or a close) invalidates the
// previous request instead of letting it repaint a stale gallery.
let loadToken = 0

const target = computed(() => avatarPreviewTarget.value)
const current = computed<GalleryPhoto | null>(() => photos.value[activeIndex.value] ?? null)
const currentSrc = computed(() => (current.value ? current.value.url : ''))
const hasMultiple = computed(() => photos.value.length > 1)
const isEmpty = computed(() => !currentSrc.value)
// 90°/270° rotation swaps the bounding box: after the transform a wide photo
// is tall, so layout-time max-width/max-height no longer bound it. The class
// `is-rotated` swaps the viewport caps (see CSS) to keep it on screen.
const isSideways = computed(() => rotateDeg.value % 180 !== 0)
const counterText = computed(() =>
  t('avatar_history.counter', { n: activeIndex.value + 1, m: photos.value.length }, 'Photo {n} of {m}'),
)
const fallbackColor = computed(() => avatarColorFor((target.value?.ownerId || target.value?.title || '').trim()))
const initialsText = computed(() => (target.value?.title || target.value?.ownerId || '?').slice(0, 1).toUpperCase())
const captionText = computed(() => formatCaption(current.value))
const downloadName = computed(() => fileNameFor(currentSrc.value))
const menuStyle = computed(() => ({ left: `${menuPos.value.x}px`, top: `${menuPos.value.y}px` }))
const photoStyle = computed(() => (rotateDeg.value ? { transform: `rotate(${rotateDeg.value}deg)` } : {}))
// "Set as main" (Telegram-style): only for the owner's own user gallery,
// only for a history photo that is not already the current one. Re-uploads
// the bytes through the standard updateProfile flow, so the backend appends
// a new history row instead of rewriting anything.
const canSetAsMain = computed(() => {
  if (setMainBusy.value || photos.value.length < 2 || activeIndex.value === 0) return false
  if (!currentSrc.value || target.value?.ownerKind !== 'user') return false
  return isSelfOwner()
})
// The gallery belongs to the signed-in user themselves (user kind only).
function isSelfOwner(): boolean {
  if (target.value?.ownerKind !== 'user') return false
  try {
    const me = (getCurrentUser()?.id || '').trim()
    const owner = (target.value?.ownerId || '').trim()
    return !!me && !!owner && me === owner
  } catch {
    return false
  }
}
const isOwnUserGallery = computed(() => isSelfOwner())
// "Delete" (danger row of the same popup menu): removes the CURRENTLY viewed
// history photo. Seed rows opened without history ('preview' id, unsaved
// drafts) have no server row and are never deletable. Own user galleries are
// deletable by the owner; chat galleries are offered too (the server keeps
// the owner/admin/moderator gate and answers 403 otherwise).
const canDelete = computed(() => {
  if (deleteBusy.value || !current.value) return false
  const id = (current.value.id || '').trim()
  if (!id || id === 'preview') return false
  if (!target.value?.ownerId || !target.value?.ownerKind) return false
  if (target.value.ownerKind === 'user') return isOwnUserGallery.value
  return true
})
const setAsMainLabel = computed(() =>
  t('avatar_history.set_as_main', undefined, locale.value === 'ru' ? 'Сделать главной' : 'Set as main'),
)

function clampIndex(value: number, length: number): number {
  if (length <= 0 || !Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.trunc(value), 0), length - 1)
}

function localeTag(): string {
  return locale.value === 'ru' ? 'ru-RU' : 'en-US'
}

// Exact install moment of the photo, e.g. "9/17/26 at 8:41 PM" (en) or
// "17.09.2026, 20:41" (ru). The backend history always carries `created_at`
// (RFC3339); a seed photo opened without history simply shows no date.
function formatPhotoDateTime(value: string): string {
  const raw = (value || '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  try {
    const tag = localeTag()
    const datePart = parsed.toLocaleDateString(tag, { dateStyle: 'short' })
    const timePart = parsed.toLocaleTimeString(tag, { timeStyle: 'short' })
    return `${datePart}${locale.value === 'ru' ? ', ' : ' at '}${timePart}`
  } catch {
    return parsed.toISOString()
  }
}

// Migrated boxchat avatars have no honest install moment (legacy stores no
// avatar timestamp): their history row carries the migration time. Showing
// that bare date as the install moment would be a lie, so migrated rows are
// always labelled "from boxchat" / "из boxchat".
function isMigratedPhoto(photo: GalleryPhoto | null | undefined): boolean {
  if (!photo) return false
  if (photo.migrated === true) return true
  return /boxchat-legacy\//.test(photo.url || '')
}

function migratedLabel(): string {
  return t('avatar_history.from_boxchat', undefined, locale.value === 'ru' ? 'из boxchat' : 'from boxchat')
}

function formatCaption(photo: GalleryPhoto | null): string {
  if (!photo) return ''
  const date = formatPhotoDateTime(photo.createdAt || '')
  if (isMigratedPhoto(photo)) {
    const tag = migratedLabel()
    return date ? `${date} · ${tag}` : tag
  }
  return date
}

// The last path segment of a presigned URL is the immutable object file name
// (a uuid), which lets us recognise the very photo the caller opened even
// though its signature differs from the one the history list returns.
function photoFingerprint(url: string): string {
  const raw = (url || '').trim()
  if (!raw || raw.startsWith('data:')) return ''
  const withoutQuery = raw.split('?')[0] || ''
  const segments = withoutQuery.split('/').filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : ''
}

function fileNameFor(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'photo')
  } catch {
    return 'photo'
  }
}

function seedFrom(next: OpenTarget): void {
  const seed: GalleryPhoto[] = []
  if (next.items && next.items.length > 0) {
    seed.push(...next.items.map((item) => ({ ...item, migrated: isMigratedPhoto(item) })))
  } else if (next.src) {
    seed.push({ id: 'preview', url: next.src, createdAt: '', migrated: isMigratedPhoto({ id: 'preview', url: next.src, createdAt: '' }) })
  }
  photos.value = seed
  activeIndex.value = clampIndex(next.startIndex ?? 0, seed.length)
  rotateDeg.value = 0
  closeMenu()
}

async function loadHistory(next: OpenTarget): Promise<void> {
  const ownerId = (next.ownerId || '').trim()
  const ownerKind = next.ownerKind
  if (!ownerId || !ownerKind) return
  if (next.items && next.items.length > 0) return

  const token = ++loadToken
  historyLoading.value = true
  try {
    const payload = ownerKind === 'chat' ? await listChatPhotos(ownerId) : await listUserPhotos(ownerId)
    if (token !== loadToken || !avatarPreviewTarget.value) return
    const fetched: GalleryPhoto[] = payload
      .filter((item) => Boolean(item && item.id && item.url))
      .map((item) => ({
        id: item.id,
        url: item.url,
        createdAt: item.created_at || '',
        migrated: (item as { migrated?: boolean }).migrated === true || /boxchat-legacy\//.test(item.url || ''),
      }))
    if (fetched.length === 0) return

    const opened = photos.value[0]
    const fingerprint = opened ? photoFingerprint(opened.url) : ''
    const match = fingerprint ? fetched.findIndex((item) => photoFingerprint(item.url) === fingerprint) : -1
    if (match >= 0) {
      photos.value = fetched
      activeIndex.value = match
    } else if (opened) {
      // The caller opened something the archive does not know yet (an unsaved
      // draft, or a photo uploaded before the history existed): keep it first.
      photos.value = [opened, ...fetched]
      activeIndex.value = 0
    } else {
      photos.value = fetched
      activeIndex.value = 0
    }
  } catch {
    // History is a bonus: the single photo the caller opened stays visible.
  } finally {
    if (token === loadToken) historyLoading.value = false
  }
}

function closeMenu(): void {
  menuOpen.value = false
}

function openMenuAt(x: number, y: number): void {
  menuPos.value = {
    x: Math.max(8, Math.min(Math.round(x), window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(Math.round(y), window.innerHeight - MENU_HEIGHT - 8)),
  }
  menuOpen.value = true
}

function toggleMenu(event: MouseEvent): void {
  if (menuOpen.value) {
    closeMenu()
    return
  }
  const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  if (rect) {
    openMenuAt(rect.right - MENU_WIDTH, rect.top - MENU_HEIGHT - 8)
  } else {
    openMenuAt(window.innerWidth - MENU_WIDTH - 16, window.innerHeight - MENU_HEIGHT - 16)
  }
}

function onPhotoContextMenu(event: MouseEvent): void {
  event.preventDefault()
  openMenuAt(event.clientX, event.clientY)
}

function goTo(offset: number): void {
  closeMenu()
  activeIndex.value = clampIndex(activeIndex.value + offset, photos.value.length)
}

function selectPhoto(index: number): void {
  closeMenu()
  activeIndex.value = clampIndex(index, photos.value.length)
}

function rotateCurrent(): void {
  if (!currentSrc.value) return
  rotateDeg.value = (rotateDeg.value + 90) % 360
}

function downloadCurrent(): void {
  const url = currentSrc.value
  if (!url) return

  const trigger = (href: string) => {
    const link = document.createElement('a')
    link.href = href
    link.download = downloadName.value
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  if (url.startsWith('data:')) {
    trigger(url)
    return
  }

  void fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error('download_failed')
      return response.blob()
    })
    .then((blob) => {
      const objectURL = URL.createObjectURL(blob)
      trigger(objectURL)
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000)
    })
    .catch(() => trigger(url))
}

function saveAsCurrent(): void {
  closeMenu()
  downloadCurrent()
}

async function copyCurrent(): Promise<void> {
  const url = currentSrc.value
  if (!url || copyBusy.value) return
  copyBusy.value = true
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('copy_failed')
    const blob = await response.blob()
    const clipboard = navigator.clipboard
    if (clipboard && typeof ClipboardItem !== 'undefined') {
      await clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
    } else if (clipboard) {
      await clipboard.writeText(url)
    } else {
      throw new Error('copy_failed')
    }
    toast.success(t('avatar_history.copied', undefined, 'Image copied'))
  } catch {
    // Remote presigned URLs may reject fetch (CORS): fall back to the URL text.
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('avatar_history.copied', undefined, 'Image copied'))
    } catch {
      toast.error(t('avatar_history.copy_failed', undefined, 'Could not copy the image'))
    }
  } finally {
    copyBusy.value = false
    closeMenu()
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(blob)
  })
}

async function setAsMain(): Promise<void> {
  const url = currentSrc.value
  if (!url || setMainBusy.value || !canSetAsMain.value) return
  setMainBusy.value = true
  try {
    // History rows store finished objects, not data URLs, so the only way
    // to promote one through the existing profile API is to re-upload its
    // bytes (fetch blob -> data URL -> updateProfile). The backend then
    // stores a new object and APPENDS a new history row; nothing is
    // overwritten or deleted.
    let dataUrl = ''
    if (url.startsWith('data:')) {
      dataUrl = url
    } else {
      const response = await fetch(url)
      if (!response.ok) throw new Error('fetch_failed')
      dataUrl = await blobToDataUrl(await response.blob())
    }
    if (!dataUrl) throw new Error('read_failed')
    const updated = await updateProfile({ avatar_data_url: dataUrl })
    const freshUrl = (updated?.avatar_data_url || '').trim()
    const entry: GalleryPhoto = {
      id: `main-${Date.now()}`,
      url: freshUrl || url,
      createdAt: new Date().toISOString(),
      migrated: false,
    }
    photos.value = [entry, ...photos.value]
    activeIndex.value = 0
    toast.success(t('avatar_history.set_as_main_done', undefined, locale.value === 'ru' ? 'Аватарка обновлена' : 'Avatar updated'))
  } catch {
    toast.error(t('avatar_history.set_as_main_failed', undefined, locale.value === 'ru' ? 'Не удалось установить аватарку' : 'Could not set as main'))
  } finally {
    setMainBusy.value = false
    closeMenu()
  }
}

// API base for the photo-history DELETE calls. The combox-api package owns
// this inference (authUrl) but does not export it and exposes no photo
// delete yet, so the viewer carries a local minimal copy instead of forking
// the frozen package: env override first, the app.combox.local split second,
// same-origin fallback otherwise.
function photosApiBase(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    const fromEnv = (env?.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '')
    if (fromEnv) return fromEnv
  } catch {
    // import.meta.env is build-time: fall through to the location default.
  }
  if (typeof window !== 'undefined' && window.location.host.toLowerCase() === 'app.combox.local') {
    return `${window.location.protocol}//api.combox.local/api/private/v1`
  }
  return '/api/private/v1'
}

// DELETE /users|chats/{ownerID}/photos/{photoID}. A 404 means the row is
// already gone server-side: the local gallery still syncs to it. Anything
// else non-OK throws for the failure toast.
async function deletePhotoRow(ownerKind: 'user' | 'chat', ownerID: string, photoID: string): Promise<void> {
  const token = getAccessToken()
  if (!token) throw new Error('unauthorized')
  const prefix = ownerKind === 'chat' ? 'chats' : 'users'
  const url = `${photosApiBase()}/${prefix}/${encodeURIComponent(ownerID)}/photos/${encodeURIComponent(photoID)}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    cache: 'default',
  })
  if (response.ok) return
  let code = ''
  try {
    const payload = (await response.json()) as { code?: string }
    code = (payload?.code || '').trim()
  } catch {
    // Non-JSON error body: the status below is the signal.
  }
  if (response.status === 404) return
  throw new Error(code || `delete_failed_${response.status}`)
}

async function askDeleteCurrent(): Promise<void> {
  const photo = current.value
  const owner = target.value
  if (!photo || deleteBusy.value || !canDelete.value || !owner?.ownerId || !owner?.ownerKind) return
  closeMenu()
  const ok = await deleteConfirm.openConfirm({
    title: t('avatar_history.delete_title', undefined, locale.value === 'ru' ? 'Удалить фото?' : 'Delete this photo?'),
    text: t(
      'avatar_history.delete_text',
      undefined,
      locale.value === 'ru'
        ? 'Фото будет удалено из истории. Это действие нельзя отменить.'
        : 'The photo will be removed from the history. This cannot be undone.',
    ),
    okLabel: t('common.delete', undefined, 'Delete'),
    danger: true,
  })
  if (!ok) return
  deleteBusy.value = true
  try {
    await deletePhotoRow(owner.ownerKind, owner.ownerId, photo.id)
    const removedIndex = activeIndex.value
    // Index 0 is the current main (same convention as canSetAsMain):
    // deleting it must also clear the owner's avatar reference
    // (removeAvatar flow: updateProfile with an empty string resets the
    // column to NULL), otherwise the profile would keep pointing at a
    // history-less object.
    const wasMain = removedIndex === 0 && owner.ownerKind === 'user' && isOwnUserGallery.value
    photos.value = photos.value.filter((item) => item.id !== photo.id)
    if (wasMain) {
      try {
        await updateProfile({ avatar_data_url: '' })
      } catch {
        toast.error(
          t(
            'avatar_history.delete_main_failed',
            undefined,
            locale.value === 'ru'
              ? 'Фото удалено из истории, но главную аватарку сбросить не удалось'
              : 'Photo deleted, but the main avatar could not be reset',
          ),
        )
      }
    }
    if (photos.value.length === 0) {
      closeAvatarPreview()
    } else {
      activeIndex.value = clampIndex(Math.min(removedIndex, photos.value.length - 1), photos.value.length)
    }
    toast.success(t('avatar_history.deleted', undefined, locale.value === 'ru' ? 'Фото удалено' : 'Photo deleted'))
  } catch {
    toast.error(
      t('avatar_history.delete_failed', undefined, locale.value === 'ru' ? 'Не удалось удалить фото' : 'Could not delete the photo'),
    )
  } finally {
    deleteBusy.value = false
  }
}

function onContentClick(): void {
  // Clicks on the photo zone / caption bar / thumbs / status bubble up here
  // with propagation stopped (the viewer itself must stay open). The only
  // thing such a click does is dismiss the open popup menu, so the next
  // background click closes the viewer instead of being eaten by the menu.
  if (menuOpen.value) closeMenu()
}

function onOverlayClick(): void {
  // The open menu eats the first background click; the next one closes.
  if (menuOpen.value) {
    closeMenu()
    return
  }
  closeAvatarPreview()
}

function isEditableTarget(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
}

function onKey(event: KeyboardEvent) {
  if (!avatarPreviewTarget.value) return
  if (event.key === 'Escape') {
    if (menuOpen.value) closeMenu()
    else closeAvatarPreview()
    return
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (isEditableTarget(event)) return
    event.preventDefault()
    goTo(event.key === 'ArrowLeft' ? -1 : 1)
  }
}

watch(
  () => avatarPreviewTarget.value,
  (next) => {
    loadToken += 1
    historyLoading.value = false
    rotateDeg.value = 0
    closeMenu()
    if (!next) {
      photos.value = []
      activeIndex.value = 0
      return
    }
    seedFrom(next)
    void loadHistory(next)
  },
  { immediate: true },
)

// Rotation never leaks into the next photo, even when history lazy-load
// swaps presigned URLs under the same picture.
watch(currentSrc, () => {
  rotateDeg.value = 0
})

onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <transition name="avFade">
      <div v-if="avatarPreviewTarget" class="avOverlay" @click="onOverlayClick">
        <button
          type="button"
          class="avClose"
          :aria-label="t('avatar_history.close', undefined, 'Close')"
          :title="t('avatar_history.close', undefined, 'Close')"
          @click.stop="closeAvatarPreview"
        >
          <v-icon icon="mdi-close" size="20" />
        </button>

        <button
          v-if="hasMultiple"
          type="button"
          class="avNav avNavPrev"
          :aria-label="t('avatar_history.prev', undefined, 'Previous photo')"
          :title="t('avatar_history.prev', undefined, 'Previous photo')"
          @click.stop="goTo(-1)"
        >
          <v-icon icon="mdi-chevron-left" size="30" />
        </button>
        <button
          v-if="hasMultiple"
          type="button"
          class="avNav avNavNext"
          :aria-label="t('avatar_history.next', undefined, 'Next photo')"
          :title="t('avatar_history.next', undefined, 'Next photo')"
          @click.stop="goTo(1)"
        >
          <v-icon icon="mdi-chevron-right" size="30" />
        </button>

        <figure class="avFigure" @click.stop="onContentClick" @contextmenu.prevent="onPhotoContextMenu">
          <div v-if="currentSrc" class="avPhotoZone">
            <img
              :key="currentSrc"
              :src="currentSrc"
              alt=""
              class="avPhoto"
              :class="{ 'is-rotated': isSideways }"
              :style="photoStyle"
              draggable="false"
            />
          </div>
          <div v-else class="avInitials" :style="{ background: fallbackColor }">{{ initialsText }}</div>
        </figure>

        <div class="avBottomBar" @click.stop="onContentClick">
          <div class="avCaption">
            <div v-if="target?.title" class="avTitle">{{ target.title }}</div>
            <div v-if="target?.subtitle" class="avSubtitle">{{ target.subtitle }}</div>
            <div v-if="captionText" class="avDate">{{ captionText }}</div>
            <div v-if="hasMultiple" class="avCounter">{{ counterText }}</div>
          </div>

          <div class="avActions">
            <a
              v-if="currentSrc"
              class="avAction"
              :href="currentSrc"
              :download="downloadName"
              :aria-label="t('avatar_history.download', undefined, 'Download')"
              :title="t('avatar_history.download', undefined, 'Download')"
              @click.prevent="downloadCurrent"
            >
              <v-icon icon="mdi-download" size="18" />
            </a>
            <button
              v-if="currentSrc"
              type="button"
              class="avAction"
              :aria-label="t('avatar_history.rotate', undefined, 'Rotate')"
              :title="t('avatar_history.rotate', undefined, 'Rotate')"
              @click="rotateCurrent"
            >
              <v-icon icon="mdi-rotate-right" size="18" />
            </button>
            <button
              v-if="currentSrc"
              type="button"
              class="avAction"
              :aria-label="t('avatar_history.more', undefined, 'More actions')"
              :title="t('avatar_history.more', undefined, 'More actions')"
              @click.stop="toggleMenu"
            >
              <v-icon icon="mdi-dots-vertical" size="18" />
            </button>
          </div>
        </div>

        <div v-if="historyLoading" class="avStatus" @click.stop="onContentClick">
          <v-icon icon="mdi-loading" size="14" class="avLoadingIcon" />
          <span>{{ t('avatar_history.loading', undefined, 'Loading photos…') }}</span>
        </div>
        <div v-else-if="isEmpty" class="avStatus" @click.stop="onContentClick">
          {{ t('avatar_history.empty', undefined, 'No photos yet') }}
        </div>

        <div v-if="hasMultiple" class="avThumbs" @click.stop="onContentClick">
          <button
            v-for="(photo, index) in photos"
            :key="photo.id"
            type="button"
            class="avThumb"
            :class="{ active: index === activeIndex }"
            :aria-label="t('avatar_history.photo', { n: index + 1 }, 'Photo {n}')"
            :aria-current="index === activeIndex ? 'true' : undefined"
            @click="selectPhoto(index)"
          >
            <img :src="photo.url" alt="" class="avThumbImg" loading="lazy" />
          </button>
        </div>

        <!-- No Report item on purpose: the project has no real report flow for
             photos (only "coming soon" toast placeholders), so a menu entry
             would be dead. -->
        <div v-if="menuOpen" class="avMenu" :style="menuStyle" role="menu" @click.stop>
          <button
            v-if="canSetAsMain"
            type="button"
            class="avMenuItem"
            role="menuitem"
            :disabled="setMainBusy || !currentSrc"
            @click="setAsMain"
          >
            <v-icon icon="mdi-account-check-outline" size="16" />
            <span>{{ setAsMainLabel }}</span>
          </button>
          <button
            type="button"
            class="avMenuItem"
            role="menuitem"
            :disabled="copyBusy || !currentSrc"
            @click="copyCurrent"
          >
            <v-icon icon="mdi-content-copy" size="16" />
            <span>{{ t('avatar_history.copy', undefined, 'Copy') }}</span>
          </button>
          <button type="button" class="avMenuItem" role="menuitem" :disabled="!currentSrc" @click="saveAsCurrent">
            <v-icon icon="mdi-download" size="16" />
            <span>{{ t('avatar_history.save_as', undefined, 'Save as…') }}</span>
          </button>
          <button
            v-if="canDelete"
            type="button"
            class="avMenuItem avMenuItemDanger"
            role="menuitem"
            :disabled="deleteBusy || !currentSrc"
            @click="askDeleteCurrent"
          >
            <v-icon icon="mdi-delete-outline" size="16" />
            <span>{{ t('avatar_history.delete', undefined, locale === 'ru' ? 'Удалить' : 'Delete') }}</span>
          </button>
        </div>

        <ConfirmDialog
          :open="deleteConfirm.dialog.open"
          :title="deleteConfirm.dialog.title"
          :text="deleteConfirm.dialog.text"
          :ok-label="deleteConfirm.dialog.okLabel"
          :danger="deleteConfirm.dialog.danger"
          @confirm="deleteConfirm.acceptConfirm"
          @cancel="deleteConfirm.dismissConfirm"
        />
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.avOverlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  background: #000;
  cursor: default;
}

.avFigure {
  flex: 1 1 auto;
  min-height: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 56px 72px 8px;
  overflow: hidden;
}

/* Contain audit: the zone IS the photo area. It fills the figure (which the
   flex column already sized to viewport minus close/nav padding, caption
   bar, actions, status and thumbs), so the photo's 100% caps resolve against
   the real box — no JS measuring, no ResizeObserver, no magic viewport
   subtractions that drift per aspect ratio. object-fit:contain then keeps
   the WHOLE photo visible, letterboxing instead of cropping. */
.avPhotoZone {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.avPhoto {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 0;
  display: block;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.18s ease;
}

/* 90°/270° rotation swaps the bounding box, so the width cap must come from
   the viewport height and vice versa — otherwise a rotated panorama escapes
   the screen. min() keeps the zone (100%) binding on the axis where it is
   tighter, so the photo can NEVER leave the viewport whatever its size or
   rotation. overflow hidden above clips nothing when the math holds; it only
   guards sub-pixel rounding during the rotate transition. */
.avPhoto.is-rotated {
  max-width: min(100%, calc(100dvh - 270px));
  max-height: min(100%, calc(100vw - 48px));
}

.avInitials {
  width: min(320px, 88vw, 62vh);
  height: auto;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  font-size: 7rem;
  font-weight: 800;
}

.avBottomBar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 20px 4px;
}

.avCaption {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.avTitle {
  color: #fff;
  font-size: 1.1rem;
  font-weight: 800;
  max-width: 60vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avSubtitle,
.avDate {
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.9rem;
  max-width: 60vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.avCounter {
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

.avStatus {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.8rem;
  min-height: 18px;
  padding: 0 20px;
}

.avLoadingIcon {
  animation: avSpin 0.9s linear infinite;
}

@keyframes avSpin {
  to {
    transform: rotate(360deg);
  }
}

.avActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.avAction {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  text-decoration: none;
  font: inherit;
  cursor: pointer;
}

.avAction:hover {
  background: rgba(255, 255, 255, 0.18);
}

.avClose,
.avNav {
  position: absolute;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  z-index: 2;
}

.avClose:hover,
.avNav:hover {
  background: rgba(255, 255, 255, 0.2);
}

.avClose {
  top: 16px;
  right: 16px;
  width: 38px;
  height: 38px;
}

.avNav {
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
}

.avNavPrev {
  left: 16px;
}

.avNavNext {
  right: 16px;
}

.avThumbs {
  display: flex;
  gap: 8px;
  max-width: min(720px, 92vw);
  overflow-x: auto;
  padding: 8px 4px 14px;
  margin: 0 auto;
  justify-content: center;
  justify-content: safe center;
}

.avThumb {
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  overflow: hidden;
  background: #1c1c1e;
  cursor: pointer;
  opacity: 0.55;
}

.avThumb:hover {
  opacity: 0.85;
}

.avThumb.active {
  opacity: 1;
  outline: 2px solid #fff;
  outline-offset: 1px;
}

.avThumbImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avMenu {
  position: fixed;
  z-index: 3;
  width: 220px;
  padding: 6px;
  border-radius: 12px;
  background: #1c1c1e;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  display: grid;
  gap: 2px;
}

.avMenuItem {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 0.9rem;
  text-align: left;
  cursor: pointer;
}

.avMenuItem:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.avMenuItem:disabled {
  opacity: 0.45;
  cursor: default;
}

.avMenuItemDanger {
  color: #ff9d9d;
}

.avMenuItemDanger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.14);
}

.avFade-enter-active,
.avFade-leave-active {
  transition: opacity 0.16s ease;
}

.avFade-enter-from,
.avFade-leave-to {
  opacity: 0;
}

@media (max-width: 720px) {
  .avFigure {
    padding: 48px 8px 4px;
  }
  .avNavPrev {
    left: 6px;
  }
  .avNavNext {
    right: 6px;
  }
  .avTitle,
  .avSubtitle,
  .avDate {
    max-width: 52vw;
  }
}
</style>
