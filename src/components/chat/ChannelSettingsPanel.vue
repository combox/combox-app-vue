<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  createChatInviteLink,
  getChat,
  listChatEvents,
  listChatInviteLinks,
  listChatMembers,
  listChats,
  removeChatMember,
  updateChat,
  updateChatMemberRole,
  updateStandaloneChannel,
  type AuthUser,
  type ChatEvent,
  type ChatInviteLink,
  type ChatItem,
  type ChatMember,
} from 'combox-api'
import { useI18n } from '../../i18n/i18n'
import { useToast } from '../../composables/useToast'
import { AVATAR_PALETTE, avatarColorFor } from '../../utils/avatarColor'
import { normalizeAvatarSrc } from './chatUtils'
import ComposerEmojiGifPicker from './ComposerEmojiGifPicker.vue'
import {
  SLOW_MODE_OPTIONS,
  copyText,
  eventIcon,
  eventLabel,
  formatEventTime,
  inviteLinkUrl,
  loadUsers,
  roleFromPayload,
  roleLabel,
  slowModeLabel,
  type UserBrief,
} from './channelSettingsMeta'

type Screen = 'main' | 'discussion' | 'appearance' | 'slowmode' | 'links' | 'members' | 'removed' | 'events'

type BoolField = 'comments_enabled' | 'reactions_enabled' | 'sign_messages' | 'show_authors_profiles' | 'auto_translate'

type ChatPatch = {
  title?: string
  avatar_data_url?: string | null
  avatar_gradient?: string | null
  description?: string | null
  icon_emoji?: string | null
  channel_type?: 'text' | 'voice' | null
  comments_enabled?: boolean
  reactions_enabled?: boolean
  sign_messages?: boolean
  show_authors_profiles?: boolean
  auto_translate?: boolean
  slow_mode_seconds?: number
  discussion_chat_id?: string
  send_permission?: 'all' | 'admins'
}

type MemberRow = {
  id: string
  role: string
  displayName: string
  avatarSrc: string
  isSelf: boolean
}

type EventRow = {
  id: string
  time: string
  icon: string
  text: string
  detail: string
}

type ScreenData = {
  loading: boolean
  error: string
}

const props = defineProps<{
  open: boolean
  chat: ChatItem | null
  currentUser: AuthUser | null
}>()

const emit = defineEmits<{
  close: []
  chatUpdated: [chat: ChatItem]
  deleteChat: [chat: ChatItem]
}>()

const { t, locale } = useI18n()
const toast = useToast()

const rootEl = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)

const localChat = ref<ChatItem | null>(null)
const screen = ref<Screen>('main')
const titleDraft = ref('')
const descriptionDraft = ref('')
const iconDraft = ref('')
const avatarPreview = ref('')
const pending = reactive<Record<string, boolean>>({})

const iconInputRef = ref<HTMLInputElement | null>(null)
const appearanceIconInputRef = ref<HTMLInputElement | null>(null)
const descriptionTextareaRef = ref<HTMLTextAreaElement | null>(null)
const iconWrapRef = ref<HTMLElement | null>(null)
const appearanceIconWrapRef = ref<HTMLElement | null>(null)
const descriptionWrapRef = ref<HTMLElement | null>(null)
const iconPickerOpen = ref(false)
const appearanceIconPickerOpen = ref(false)
const descriptionPickerOpen = ref(false)

const screenState = reactive<Record<Screen, ScreenData>>({
  main: { loading: false, error: '' },
  discussion: { loading: false, error: '' },
  appearance: { loading: false, error: '' },
  slowmode: { loading: false, error: '' },
  links: { loading: false, error: '' },
  members: { loading: false, error: '' },
  removed: { loading: false, error: '' },
  events: { loading: false, error: '' },
})

const discussionChats = ref<ChatItem[]>([])
const memberRows = ref<MemberRow[]>([])
const removedRows = ref<MemberRow[]>([])
const inviteLinks = ref<ChatInviteLink[]>([])
const eventRows = ref<EventRow[]>([])
const userBriefs = ref<Record<string, UserBrief>>({})

const loaded = reactive({
  chats: false,
  members: false,
  links: false,
  events: false,
})

const chatID = computed(() => (localChat.value?.id || '').trim())
const isStandalone = computed(() => (localChat.value?.kind || '').trim() === 'standalone_channel')
const chatKind = computed(() => (localChat.value?.kind || '').trim())
const isTopic = computed(() => chatKind.value === 'channel')
const viewerRole = computed(() => (localChat.value?.viewer_role || '').trim().toLowerCase())
const canManageRoles = computed(() => !viewerRole.value || viewerRole.value === 'owner' || viewerRole.value === 'admin')
const canManageMembers = computed(() => !viewerRole.value || ['owner', 'admin', 'moderator'].includes(viewerRole.value))
const canPostOnly = computed(() => isTopic.value)
const currentMemberID = computed(() => (props.currentUser?.id || '').trim())

const discussionID = computed(() => (localChat.value?.discussion_chat_id || '').trim())
const discussionLinkedTitle = ref('')
const discussionTitle = computed(() => {
  const id = discussionID.value
  if (!id) return ''
  const found = discussionChats.value.find((item) => item.id === id)
  if (found) return found.title || ''
  return discussionLinkedTitle.value
})
const discussionLinkedLabel = computed(() => t('chat.chanset_linked_chat', undefined, 'Linked chat'))
const discussionMeta = computed(() => discussionTitle.value || (discussionID.value ? discussionLinkedLabel.value : ''))
const discussionExtra = computed(() => {
  const id = discussionID.value
  if (!id) return null
  if (discussionChats.value.some((item) => item.id === id)) return null
  return { id, title: discussionTitle.value || discussionLinkedLabel.value }
})

const avatarSrc = computed(() => avatarPreview.value)
const avatarLetter = computed(() => ((localChat.value?.title || '').trim() || '?').slice(0, 1).toUpperCase())
const avatarFill = computed(() => (localChat.value?.avatar_gradient || '').trim() || avatarColorFor(chatID.value || localChat.value?.title || 'c'))
const channelType = computed(() => (localChat.value?.channel_type || 'text') === 'voice' ? 'voice' : 'text')
const slowModeSeconds = computed(() => Number(localChat.value?.slow_mode_seconds || 0))
const sendPermission = computed(() => (localChat.value?.send_permission || '').trim() === 'admins' ? 'admins' : 'all')
const descriptionLength = computed(() => [...descriptionDraft.value].length)
const descriptionTooLong = computed(() => descriptionLength.value > 255)

const screenTitle = computed(() => {
  switch (screen.value) {
    case 'discussion':
      return t('chat.chanset_discussion', undefined, 'Discussion')
    case 'appearance':
      return t('chat.chanset_appearance', undefined, 'Appearance')
    case 'slowmode':
      return t('chat.chanset_slow_mode', undefined, 'Slow mode')
    case 'links':
      return t('chat.chanset_invite_links', undefined, 'Invite links')
    case 'members':
      return t('chat.chanset_members', undefined, 'Subscribers')
    case 'removed':
      return t('chat.chanset_removed_users', undefined, 'Removed users')
    case 'events':
      return t('chat.chanset_recent_actions', undefined, 'Recent actions')
    default:
      return t('chat.chanset_title', undefined, 'Channel settings')
  }
})

const deleteRowLabel = computed(() => {
  if (chatKind.value === 'group') return t('chat.chanset_delete_group', undefined, 'Delete group')
  if (isTopic.value) return t('chat.chanset_delete_topic', undefined, 'Delete topic')
  return t('chat.chanset_delete_channel', undefined, 'Delete channel')
})

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

function isOn(field: BoolField): boolean {
  return Boolean(localChat.value?.[field])
}

function applyPatch(chatIDValue: string, patch: ChatPatch): Promise<ChatItem> {
  if (isStandalone.value) {
    const payload = { ...patch }
    delete payload.send_permission
    return updateStandaloneChannel(chatIDValue, payload).then((result) => result.chat)
  }
  return updateChat(chatIDValue, patch).then((result) => result.chat)
}

async function persist(
  field: string,
  patch: ChatPatch,
  options: { revert?: () => void; silent?: boolean } = {},
): Promise<boolean> {
  const id = chatID.value
  if (!id || !localChat.value || pending[field]) return false
  pending[field] = true
  try {
    const updated = await applyPatch(id, patch)
    const merged = localChat.value ? Object.assign(localChat.value, updated) : updated
    emit('chatUpdated', { ...merged })
    if (!options.silent) toast.success(t('chat.chanset_saved', undefined, 'Saved'))
    return true
  } catch (error) {
    options.revert?.()
    toast.error(errorText(error, t('chat.chanset_save_failed', undefined, 'Could not save the setting')))
    return false
  } finally {
    pending[field] = false
  }
}

function toggleBool(field: BoolField) {
  const previous = isOn(field)
  const next = !previous
  if (localChat.value) localChat.value[field] = next
  const patch: ChatPatch = {}
  patch[field] = next
  void persist(field, patch, {
    silent: true,
    revert: () => {
      if (localChat.value) localChat.value[field] = previous
    },
  })
}

function saveTitle() {
  const chat = localChat.value
  if (!chat) return
  const next = titleDraft.value.trim()
  const previous = (chat.title || '').trim()
  if (!next) {
    titleDraft.value = previous
    toast.error(t('chat.chanset_title_required', undefined, 'Title is required'))
    return
  }
  if (next === previous) {
    titleDraft.value = previous
    return
  }
  void persist('title', { title: next }, { revert: () => { titleDraft.value = previous } })
}

function saveDescription() {
  const chat = localChat.value
  if (!chat) return
  const next = descriptionDraft.value
  if (descriptionTooLong.value) {
    toast.error(t('chat.chanset_description_too_long', undefined, 'Description must be 255 characters or fewer'))
    return
  }
  const previous = chat.description || ''
  if (next === previous) return
  void persist('description', { description: next }, { revert: () => { descriptionDraft.value = previous } })
}

function graphemeSegments(value: string): string[] {
  const text = value || ''
  try {
    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (locales?: string | string[], options?: { granularity?: string }) => {
        segment(input: string): Iterable<{ segment: string }>
      }
    }
    const SegmenterCtor = intlWithSegmenter.Segmenter
    if (typeof SegmenterCtor === 'function') {
      const segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' })
      return Array.from(segmenter.segment(text), (part) => part.segment)
    }
  } catch {
    // Intl.Segmenter is unavailable; fall back to code points below.
  }
  return Array.from(text)
}

function graphemeCount(value: string): number {
  return graphemeSegments(value).length
}

function firstGrapheme(value: string): string {
  return graphemeSegments(value)[0] ?? ''
}

function saveIcon() {
  const chat = localChat.value
  if (!chat) return
  const next = iconDraft.value.trim()
  const previous = (chat.icon_emoji || '').trim()
  if (next && graphemeCount(next) !== 1) {
    iconDraft.value = previous
    toast.error(t('chat.chanset_emoji_too_long', undefined, 'Icon emoji must be a single emoji'))
    return
  }
  if (next === previous) {
    iconDraft.value = previous
    return
  }
  void persist('icon_emoji', { icon_emoji: next }, { revert: () => { iconDraft.value = previous } })
}

function clearIcon() {
  const previous = (localChat.value?.icon_emoji || '').trim()
  if (!previous) return
  iconDraft.value = ''
  void persist('icon_emoji', { icon_emoji: '' }, { revert: () => { iconDraft.value = previous } })
}

function truncateRunes(value: string, max: number): string {
  const runes = Array.from(value || '')
  if (runes.length <= max) return value || ''
  return runes.slice(0, max).join('')
}

function readSelection(element: HTMLInputElement | HTMLTextAreaElement | null, value: string): { start: number; end: number } {
  const fallback = { start: value.length, end: value.length }
  if (!element) return fallback
  try {
    const start = element.selectionStart
    const end = element.selectionEnd
    if (typeof start !== 'number' || typeof end !== 'number') return fallback
    const cleanStart = Math.max(0, Math.min(start, value.length))
    const cleanEnd = Math.max(cleanStart, Math.min(end, value.length))
    return { start: cleanStart, end: cleanEnd }
  } catch {
    return fallback
  }
}

function insertEmojiAtCursor(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  current: string,
  emoji: string,
  maxRunes: number,
): { value: string; caret: number } {
  const text = emoji || ''
  if (!text) return { value: current, caret: current.length }
  const { start, end } = readSelection(element, current)
  const raw = `${current.slice(0, start)}${text}${current.slice(end)}`
  const truncated = truncateRunes(raw, maxRunes)
  const rawRunes = Array.from(raw).length
  const caret = rawRunes <= maxRunes ? Math.min(start + text.length, truncated.length) : truncated.length
  return { value: truncated, caret }
}

function focusWithCaret(element: HTMLInputElement | HTMLTextAreaElement | null, caret: number) {
  if (!element) return
  void nextTick(() => {
    try {
      element.focus()
      element.setSelectionRange(caret, caret)
    } catch {
      // Some input modes do not expose a selection; the caret stays at the end.
    }
  })
}

function toggleIconPicker() {
  appearanceIconPickerOpen.value = false
  descriptionPickerOpen.value = false
  iconPickerOpen.value = !iconPickerOpen.value
}

function toggleAppearanceIconPicker() {
  iconPickerOpen.value = false
  descriptionPickerOpen.value = false
  appearanceIconPickerOpen.value = !appearanceIconPickerOpen.value
}

function toggleDescriptionPicker() {
  iconPickerOpen.value = false
  appearanceIconPickerOpen.value = false
  descriptionPickerOpen.value = !descriptionPickerOpen.value
}

function closeEmojiPickers() {
  iconPickerOpen.value = false
  appearanceIconPickerOpen.value = false
  descriptionPickerOpen.value = false
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (iconPickerOpen.value && !iconWrapRef.value?.contains(target)) iconPickerOpen.value = false
  if (appearanceIconPickerOpen.value && !appearanceIconWrapRef.value?.contains(target)) appearanceIconPickerOpen.value = false
  if (descriptionPickerOpen.value && !descriptionWrapRef.value?.contains(target)) descriptionPickerOpen.value = false
}

function onIconEmojiPick(emoji: string) {
  const single = firstGrapheme(emoji || '')
  if (!single) return
  iconDraft.value = single
  focusWithCaret(iconInputRef.value, single.length)
}

function onAppearanceIconEmojiPick(emoji: string) {
  const single = firstGrapheme(emoji || '')
  if (!single) return
  iconDraft.value = single
  focusWithCaret(appearanceIconInputRef.value, single.length)
}

function onDescriptionEmojiPick(emoji: string) {
  const next = insertEmojiAtCursor(descriptionTextareaRef.value, descriptionDraft.value, emoji, 255)
  descriptionDraft.value = next.value
  focusWithCaret(descriptionTextareaRef.value, next.caret)
}

watch([iconPickerOpen, appearanceIconPickerOpen, descriptionPickerOpen], ([icon, appearance, description]) => {
  if (icon || appearance || description) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})

function onPhotoPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : ''
    if (!result) return
    const previous = avatarPreview.value
    avatarPreview.value = result
    void persist('avatar_data_url', { avatar_data_url: result }, {
      revert: () => { avatarPreview.value = previous },
    })
  }
  reader.onerror = () => {
    toast.error(t('chat.chanset_photo_failed', undefined, 'Could not read the image'))
  }
  reader.readAsDataURL(file)
}

function clearPhoto() {
  if (!avatarPreview.value) return
  const previous = avatarPreview.value
  avatarPreview.value = ''
  void persist('avatar_data_url', { avatar_data_url: '' }, {
    revert: () => { avatarPreview.value = previous },
  })
}

function setGradient(color: string) {
  const previous = (localChat.value?.avatar_gradient || '').trim()
  if (previous === color) return
  if (localChat.value) localChat.value.avatar_gradient = color
  void persist('avatar_gradient', { avatar_gradient: color }, {
    revert: () => { if (localChat.value) localChat.value.avatar_gradient = previous },
  })
}

function setChannelType(next: 'text' | 'voice') {
  if (channelType.value === next) return
  const previous = channelType.value
  if (localChat.value) localChat.value.channel_type = next
  void persist('channel_type', { channel_type: next }, {
    revert: () => { if (localChat.value) localChat.value.channel_type = previous },
  })
}

function setSendPermission(next: 'all' | 'admins') {
  if (sendPermission.value === next) return
  const previous = sendPermission.value
  if (localChat.value) localChat.value.send_permission = next
  void persist('send_permission', { send_permission: next }, {
    revert: () => { if (localChat.value) localChat.value.send_permission = previous },
  })
}

function setSlowMode(seconds: number) {
  if (slowModeSeconds.value === seconds) return
  const previous = slowModeSeconds.value
  if (localChat.value) localChat.value.slow_mode_seconds = seconds
  void persist('slow_mode_seconds', { slow_mode_seconds: seconds }, {
    revert: () => { if (localChat.value) localChat.value.slow_mode_seconds = previous },
  })
}

function setDiscussion(nextID: string) {
  const previous = discussionID.value
  if (previous === nextID) return
  if (localChat.value) localChat.value.discussion_chat_id = nextID
  void persist('discussion_chat_id', { discussion_chat_id: nextID }, {
    revert: () => { if (localChat.value) localChat.value.discussion_chat_id = previous },
  })
}

function goBack() {
  if (iconPickerOpen.value || appearanceIconPickerOpen.value || descriptionPickerOpen.value) {
    closeEmojiPickers()
    return
  }
  if (screen.value !== 'main') {
    screen.value = 'main'
    return
  }
  requestClose()
}

function requestClose() {
  closeEmojiPickers()
  emit('close')
}

function onEscape() {
  goBack()
}

function confirmDeleteNow() {
  const chat = localChat.value
  if (!chat) return
  emit('deleteChat', { ...chat })
  emit('close')
}

function go(next: Screen) {
  screen.value = next
  void loadScreen(next)
}

async function loadScreen(target: Screen) {
  if (target === 'discussion') await loadDiscussion()
  else if (target === 'members' || target === 'removed') await loadMemberData()
  else if (target === 'links') await loadLinks()
  else if (target === 'events') await loadEvents()
}

function beginLoad(target: Screen): boolean {
  const state = screenState[target]
  if (state.loading) return false
  state.loading = true
  state.error = ''
  return true
}

function endLoad(target: Screen, error?: unknown, fallback?: string) {
  const state = screenState[target]
  state.loading = false
  if (error) state.error = errorText(error, fallback || t('chat.chanset_load_failed', undefined, 'Could not load data'))
}

async function loadDiscussion() {
  const id = chatID.value
  if (!id || loaded.chats) return
  if (!beginLoad('discussion')) return
  try {
    const items = await listChats()
    discussionChats.value = items.filter((item) => {
      const kind = (item.kind || '').trim()
      if (kind !== 'group' && kind !== 'standalone_channel') return false
      return item.id !== id
    })
    const current = discussionID.value
    if (current && !discussionChats.value.some((item) => item.id === current)) {
      try {
        const linked = await getChat(current)
        discussionLinkedTitle.value = linked.title || ''
        discussionChats.value = [{ ...linked }, ...discussionChats.value]
      } catch {
        // the link stays valid even when the target chat is not readable here
      }
    }
    loaded.chats = true
    endLoad('discussion')
  } catch (error) {
    endLoad('discussion', error, t('chat.chanset_load_failed', undefined, 'Could not load data'))
  }
}

async function resolveDiscussionTitle() {
  const current = discussionID.value
  if (!current) {
    discussionLinkedTitle.value = ''
    return
  }
  try {
    const linked = await getChat(current)
    discussionLinkedTitle.value = linked.title || ''
  } catch {
    discussionLinkedTitle.value = ''
  }
}

function toMemberRow(member: ChatMember): MemberRow {
  const id = (member.user_id || '').trim()
  const role = (member.role || '').trim().toLowerCase() || 'member'
  const brief = userBriefs.value[id]
  return {
    id,
    role,
    displayName: brief?.name || id,
    avatarSrc: normalizeAvatarSrc(brief?.avatar || ''),
    isSelf: id === currentMemberID.value,
  }
}

async function loadMemberData(force = false) {
  const id = chatID.value
  if (!id) return
  if (loaded.members && !force) return
  if (!beginLoad('members')) return
  try {
    const items = await listChatMembers(id, { include_banned: true })
    const ids = items.map((member) => member.user_id)
    const briefs = await loadUsers(ids)
    userBriefs.value = { ...userBriefs.value, ...briefs }
    const active: MemberRow[] = []
    const removed: MemberRow[] = []
    for (const member of items) {
      const row = toMemberRow(member)
      if (row.role === 'banned') removed.push(row)
      else active.push(row)
    }
    memberRows.value = active
    removedRows.value = removed
    loaded.members = true
    endLoad('members')
  } catch (error) {
    endLoad('members', error, t('chat.chanset_load_failed', undefined, 'Could not load data'))
  }
}

async function loadLinks(force = false) {
  const id = chatID.value
  if (!id) return
  if (loaded.links && !force) return
  if (!beginLoad('links')) return
  try {
    inviteLinks.value = await listChatInviteLinks(id)
    loaded.links = true
    endLoad('links')
  } catch (error) {
    endLoad('links', error, t('chat.chanset_load_failed', undefined, 'Could not load data'))
  }
}

async function loadEvents() {
  const id = chatID.value
  if (!id) return
  if (loaded.events) return
  if (!beginLoad('events')) return
  try {
    const items = await listChatEvents(id, { limit: 50 })
    const actorIDs = items.map((item) => item.actor_user_id || '').filter(Boolean)
    const targetIDs = items.map((item) => item.target_user_id || '').filter(Boolean)
    const briefs = await loadUsers([...actorIDs, ...targetIDs])
    userBriefs.value = { ...userBriefs.value, ...briefs }
    const unknown = t('chat.chanset_unknown_user', undefined, 'Unknown user')
    eventRows.value = items.map((item) => {
      const actorID = (item.actor_user_id || '').trim()
      const targetID = (item.target_user_id || '').trim()
      const actor = userBriefs.value[actorID]?.name || ''
      const target = userBriefs.value[targetID]?.name || ''
      const label = eventLabel(item.event_type)
      const params: Record<string, string> = {
        actor: actor || unknown,
        target: target || unknown,
      }
      return {
        id: item.id,
        time: formatEventTime(item.created_at, localeForDate()),
        icon: eventIcon(item.event_type),
        text: t(label.key, params, label.fallback),
        detail: eventDetail(item),
      }
    })
    loaded.events = true
    endLoad('events')
  } catch (error) {
    endLoad('events', error, t('chat.chanset_load_failed', undefined, 'Could not load data'))
  }
}

function eventDetail(item: ChatEvent): string {
  const payload = (item.payload || '').trim()
  if (!payload) return ''
  if (item.event_type === 'role_changed') {
    const role = roleFromPayload(payload)
    const pair = roleLabel(role)
    return t(pair.key, undefined, pair.fallback)
  }
  if (item.event_type === 'title_changed' || item.event_type === 'description_changed' || item.event_type === 'icon_changed') {
    return payload
  }
  if (item.event_type === 'settings_changed') {
    return payload.replace(/,/g, ' · ')
  }
  return ''
}

function localeForDate(): string {
  return locale.value === 'ru' ? 'ru-RU' : 'en-US'
}

async function createLink() {
  const id = chatID.value
  if (!id || pending.link) return
  pending.link = true
  try {
    await createChatInviteLink(id, { title: '' })
    loaded.links = false
    await loadLinks(true)
    toast.success(t('chat.chanset_link_created', undefined, 'Link created'))
  } catch (error) {
    toast.error(errorText(error, t('chat.chanset_link_create_failed', undefined, 'Could not create the link')))
  } finally {
    pending.link = false
  }
}

async function copyInviteLink(link: ChatInviteLink) {
  const url = inviteLinkUrl(link)
  const ok = await copyText(url)
  if (ok) toast.success(t('chat.chanset_link_copied', undefined, 'Link copied'))
  else toast.error(t('chat.chanset_link_copy_failed', undefined, 'Could not copy the link'))
}

function roleButtons(row: MemberRow): { key: string; label: string; run: () => void }[] {
  const buttons: { key: string; label: string; run: () => void }[] = []
  if (!canManageRoles.value || row.isSelf) return buttons
  if (row.role === 'admin') {
    buttons.push({
      key: 'demote',
      label: t('chat.chanset_remove_admin', undefined, 'Remove admin'),
      run: () => void setMemberRole(row.id, isStandalone.value ? 'subscriber' : 'member'),
    })
  } else {
    buttons.push({
      key: 'promote',
      label: t('chat.chanset_make_admin', undefined, 'Make admin'),
      run: () => void setMemberRole(row.id, 'admin'),
    })
  }
  return buttons
}

function canRemove(row: MemberRow): boolean {
  return canManageMembers.value && !row.isSelf
}

async function setMemberRole(memberID: string, role: 'admin' | 'member' | 'subscriber') {
  const id = chatID.value
  if (!id) return
  if (pending[`role:${memberID}`]) return
  pending[`role:${memberID}`] = true
  try {
    await updateChatMemberRole(id, memberID, role)
    await loadMemberData(true)
  } catch (error) {
    toast.error(errorText(error, t('chat.chanset_member_failed', undefined, 'Could not update the member')))
  } finally {
    pending[`role:${memberID}`] = false
  }
}

async function removeMember(memberID: string) {
  const id = chatID.value
  if (!id) return
  if (pending[`remove:${memberID}`]) return
  pending[`remove:${memberID}`] = true
  try {
    await removeChatMember(id, memberID)
    await loadMemberData(true)
  } catch (error) {
    toast.error(errorText(error, t('chat.chanset_member_failed', undefined, 'Could not update the member')))
  } finally {
    pending[`remove:${memberID}`] = false
  }
}

async function restoreMember(memberID: string) {
  const id = chatID.value
  if (!id) return
  if (pending[`restore:${memberID}`]) return
  pending[`restore:${memberID}`] = true
  try {
    await updateChatMemberRole(id, memberID, isStandalone.value ? 'subscriber' : 'member')
    await loadMemberData(true)
    toast.success(t('chat.chanset_saved', undefined, 'Saved'))
  } catch (error) {
    toast.error(errorText(error, t('chat.chanset_restore_failed', undefined, 'Could not restore the user')))
  } finally {
    pending[`restore:${memberID}`] = false
  }
}

function roleText(row: MemberRow): string {
  const pair = roleLabel(row.role)
  return t(pair.key, undefined, pair.fallback)
}

function slowText(): string {
  const pair = slowModeLabel(slowModeSeconds.value)
  return t(pair.key, { seconds: slowModeSeconds.value }, pair.fallback)
}

function openPanel() {
  const chat = props.chat
  if (!chat) return
  closeEmojiPickers()
  localChat.value = { ...chat }
  avatarPreview.value = normalizeAvatarSrc(chat.avatar_data_url || '')
  titleDraft.value = (chat.title || '').trim()
  descriptionDraft.value = chat.description || ''
  iconDraft.value = (chat.icon_emoji || '').trim()
  screen.value = 'main'
  discussionChats.value = []
  memberRows.value = []
  removedRows.value = []
  inviteLinks.value = []
  eventRows.value = []
  userBriefs.value = {}
  discussionLinkedTitle.value = ''
  loaded.chats = false
  loaded.members = false
  loaded.links = false
  loaded.events = false
  for (const key of Object.keys(screenState) as Screen[]) {
    screenState[key].loading = false
    screenState[key].error = ''
  }
  void resolveDiscussionTitle()
}

function resetPanel() {
  closeEmojiPickers()
  localChat.value = null
  screen.value = 'main'
  titleDraft.value = ''
  descriptionDraft.value = ''
  iconDraft.value = ''
  avatarPreview.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      openPanel()
      void nextTick(() => rootEl.value?.focus())
    } else {
      resetPanel()
    }
  },
  { immediate: true },
)

watch(
  () => props.chat?.id,
  () => {
    if (props.open) openPanel()
  },
)

watch(screen, () => {
  closeEmojiPickers()
  scrollEl.value?.scrollTo({ top: 0 })
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && localChat"
      ref="rootEl"
      class="csRoot"
      role="dialog"
      aria-modal="true"
      :aria-label="screenTitle"
      tabindex="-1"
      @keydown.esc.prevent="onEscape"
      @click.self="requestClose"
    >
      <div class="csPanel">
        <header class="csHeader">
          <button type="button" class="csIconBtn" :aria-label="t('chat.chanset_back', undefined, 'Back')" @click="goBack">
            <v-icon icon="mdi-arrow-left" size="20" />
          </button>
          <div class="csHeaderText">
            <div class="csHeaderTitle">{{ screenTitle }}</div>
            <div v-if="screen === 'main'" class="csHeaderSub">{{ localChat.title }}</div>
          </div>
          <button type="button" class="csIconBtn" :aria-label="t('chat.chanset_close', undefined, 'Close')" @click="requestClose">
            <v-icon icon="mdi-close" size="18" />
          </button>
        </header>

        <div ref="scrollEl" class="csScroll">
          <template v-if="screen === 'main'">
            <section class="csHero">
              <div v-if="isStandalone" class="csAvatarWrap">
                <img v-if="avatarSrc" :src="avatarSrc" alt="" class="csAvatarImg" />
                <div v-else-if="iconDraft || localChat.icon_emoji" class="csAvatarEmoji">{{ iconDraft || localChat.icon_emoji }}</div>
                <div v-else class="csAvatarLetter" :style="{ background: avatarFill }">{{ avatarLetter }}</div>
                <label class="csAvatarEdit" :title="t('chat.chanset_change_photo', undefined, 'Change photo')">
                  <input type="file" accept="image/*" class="csFileInput" @change="onPhotoPick" />
                  <v-icon icon="mdi-pencil-outline" size="16" />
                </label>
              </div>
              <div ref="iconWrapRef" class="csEmojiRow csEmojiWrap">
                <input
                  ref="iconInputRef"
                  v-model="iconDraft"
                  class="csInput csEmojiInput"
                  type="text"
                  :placeholder="t('chat.chanset_icon_placeholder', undefined, 'Emoji icon (single emoji)')"
                  :aria-label="t('chat.chanset_icon_emoji', undefined, 'Icon emoji')"
                  @blur="saveIcon"
                  @keydown.enter.prevent="saveIcon"
                />
                <button
                  type="button"
                  class="csIconBtn"
                  :class="{ csIconBtnOn: iconPickerOpen }"
                  :aria-expanded="iconPickerOpen ? 'true' : 'false'"
                  :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                  :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                  @click.stop="toggleIconPicker"
                >
                  <v-icon icon="mdi-emoticon-happy-outline" size="18" />
                </button>
                <button
                  v-if="iconDraft"
                  type="button"
                  class="csIconBtn"
                  :aria-label="t('chat.chanset_clear_emoji', undefined, 'Clear emoji')"
                  @click="clearIcon"
                >
                  <v-icon icon="mdi-close-circle-outline" size="18" />
                </button>
                <div v-if="iconPickerOpen" class="csEmojiPopover" @click.stop>
                  <ComposerEmojiGifPicker :open="iconPickerOpen" @select="onIconEmojiPick" />
                </div>
              </div>
            </section>

            <section class="csCard">
              <label class="csField">
                <span class="csFieldLabel">{{ t('chat.chanset_name', undefined, 'Name') }}</span>
                <input
                  v-model="titleDraft"
                  class="csInput"
                  type="text"
                  maxlength="128"
                  :placeholder="t('chat.chanset_name_placeholder', undefined, 'Channel name')"
                  @blur="saveTitle"
                  @keydown.enter.prevent="saveTitle"
                />
              </label>
              <div class="csField">
                <span class="csFieldLabel">{{ t('chat.chanset_description', undefined, 'Description') }}</span>
                <div ref="descriptionWrapRef" class="csTextareaWrap">
                  <textarea
                    ref="descriptionTextareaRef"
                    v-model="descriptionDraft"
                    class="csTextarea csTextareaWithEmoji"
                    rows="3"
                    :placeholder="t('chat.chanset_description_placeholder', undefined, 'Tell people what this channel is about')"
                    @blur="saveDescription"
                  />
                  <button
                    type="button"
                    class="csEmojiBtn"
                    :class="{ csEmojiBtnOn: descriptionPickerOpen }"
                    :aria-expanded="descriptionPickerOpen ? 'true' : 'false'"
                    :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                    :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                    @click.stop="toggleDescriptionPicker"
                  >
                    <v-icon icon="mdi-emoticon-happy-outline" size="18" />
                  </button>
                  <div v-if="descriptionPickerOpen" class="csEmojiPopover" @click.stop>
                    <ComposerEmojiGifPicker :open="descriptionPickerOpen" @select="onDescriptionEmojiPick" />
                  </div>
                </div>
                <span class="csCounter" :class="{ csCounterOver: descriptionTooLong }">{{ descriptionLength }}/255</span>
              </div>
            </section>

            <section class="csCard">
              <div class="csField">
                <span class="csFieldLabel">{{ t('chat.chanset_channel_type', undefined, 'Channel type') }}</span>
                <div class="csSegment">
                  <button
                    type="button"
                    class="csSegmentBtn"
                    :class="{ csSegmentBtnOn: channelType === 'text' }"
                    :aria-pressed="channelType === 'text' ? 'true' : 'false'"
                    @click="setChannelType('text')"
                  >
                    {{ t('chat.chanset_type_text', undefined, 'Text') }}
                  </button>
                  <button
                    type="button"
                    class="csSegmentBtn"
                    :class="{ csSegmentBtnOn: channelType === 'voice' }"
                    :aria-pressed="channelType === 'voice' ? 'true' : 'false'"
                    @click="setChannelType('voice')"
                  >
                    {{ t('chat.chanset_type_voice', undefined, 'Voice') }}
                  </button>
                </div>
              </div>

              <button type="button" class="csRow" @click="go('discussion')">
                <span class="csRowIcon"><v-icon icon="mdi-comment-text-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_discussion', undefined, 'Discussion') }}</span>
                  <span class="csRowMeta">{{ discussionMeta || t('chat.chanset_no_discussion', undefined, 'No discussion') }}</span>
                </span>
                <v-icon icon="mdi-chevron-right" size="18" class="csChevron" />
              </button>

              <button type="button" class="csRow" @click="go('appearance')">
                <span class="csRowIcon"><v-icon icon="mdi-palette-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_appearance', undefined, 'Appearance') }}</span>
                </span>
                <v-icon icon="mdi-chevron-right" size="18" class="csChevron" />
              </button>
            </section>

            <section class="csCard">
              <div class="csRow">
                <span class="csRowIcon"><v-icon icon="mdi-emoticon-happy-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_reactions', undefined, 'Reactions') }}</span>
                </span>
                <button
                  type="button"
                  class="csSwitch"
                  :class="{ csSwitchOn: isOn('reactions_enabled') }"
                  role="switch"
                  :aria-checked="isOn('reactions_enabled') ? 'true' : 'false'"
                  :aria-label="t('chat.chanset_reactions', undefined, 'Reactions')"
                  @click="toggleBool('reactions_enabled')"
                >
                  <span class="csSwitchKnob" />
                </button>
              </div>

              <div v-if="isStandalone" class="csRow">
                <span class="csRowIcon"><v-icon icon="mdi-draw-pen" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_sign_messages', undefined, 'Sign messages') }}</span>
                </span>
                <button
                  type="button"
                  class="csSwitch"
                  :class="{ csSwitchOn: isOn('sign_messages') }"
                  role="switch"
                  :aria-checked="isOn('sign_messages') ? 'true' : 'false'"
                  :aria-label="t('chat.chanset_sign_messages', undefined, 'Sign messages')"
                  @click="toggleBool('sign_messages')"
                >
                  <span class="csSwitchKnob" />
                </button>
              </div>

              <div v-if="isStandalone" class="csRow">
                <span class="csRowIcon"><v-icon icon="mdi-account-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_show_authors_profiles', undefined, 'Show authors profiles') }}</span>
                </span>
                <button
                  type="button"
                  class="csSwitch"
                  :class="{ csSwitchOn: isOn('show_authors_profiles') }"
                  role="switch"
                  :aria-checked="isOn('show_authors_profiles') ? 'true' : 'false'"
                  :aria-label="t('chat.chanset_show_authors_profiles', undefined, 'Show authors profiles')"
                  @click="toggleBool('show_authors_profiles')"
                >
                  <span class="csSwitchKnob" />
                </button>
              </div>

              <div class="csRow">
                <span class="csRowIcon"><v-icon icon="mdi-translate" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_auto_translate', undefined, 'Auto translate') }}</span>
                </span>
                <button
                  type="button"
                  class="csSwitch"
                  :class="{ csSwitchOn: isOn('auto_translate') }"
                  role="switch"
                  :aria-checked="isOn('auto_translate') ? 'true' : 'false'"
                  :aria-label="t('chat.chanset_auto_translate', undefined, 'Auto translate')"
                  @click="toggleBool('auto_translate')"
                >
                  <span class="csSwitchKnob" />
                </button>
              </div>

              <div class="csRow">
                <span class="csRowIcon"><v-icon icon="mdi-comment-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_comments', undefined, 'Comments') }}</span>
                </span>
                <button
                  type="button"
                  class="csSwitch"
                  :class="{ csSwitchOn: isOn('comments_enabled') }"
                  role="switch"
                  :aria-checked="isOn('comments_enabled') ? 'true' : 'false'"
                  :aria-label="t('chat.chanset_comments', undefined, 'Comments')"
                  @click="toggleBool('comments_enabled')"
                >
                  <span class="csSwitchKnob" />
                </button>
              </div>
            </section>

            <section class="csCard">
              <button type="button" class="csRow" @click="go('slowmode')">
                <span class="csRowIcon"><v-icon icon="mdi-timer-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_slow_mode', undefined, 'Slow mode') }}</span>
                  <span class="csRowMeta">{{ slowText() }}</span>
                </span>
                <v-icon icon="mdi-chevron-right" size="18" class="csChevron" />
              </button>

              <div v-if="canPostOnly" class="csField csFieldRow">
                <span class="csFieldLabel">{{ t('chat.chanset_who_can_post', undefined, 'Who can post') }}</span>
                <div class="csSegment">
                  <button
                    type="button"
                    class="csSegmentBtn"
                    :class="{ csSegmentBtnOn: sendPermission === 'all' }"
                    :aria-pressed="sendPermission === 'all' ? 'true' : 'false'"
                    @click="setSendPermission('all')"
                  >
                    {{ t('chat.chanset_permission_everyone', undefined, 'Everyone') }}
                  </button>
                  <button
                    type="button"
                    class="csSegmentBtn"
                    :class="{ csSegmentBtnOn: sendPermission === 'admins' }"
                    :aria-pressed="sendPermission === 'admins' ? 'true' : 'false'"
                    @click="setSendPermission('admins')"
                  >
                    {{ t('chat.chanset_permission_admins', undefined, 'Admins only') }}
                  </button>
                </div>
              </div>
            </section>

            <section class="csCard">
              <button type="button" class="csRow" @click="go('links')">
                <span class="csRowIcon"><v-icon icon="mdi-link-variant" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_invite_links', undefined, 'Invite links') }}</span>
                  <span v-if="loaded.links" class="csRowMeta">{{ inviteLinks.length }}</span>
                </span>
                <v-icon icon="mdi-chevron-right" size="18" class="csChevron" />
              </button>

              <button type="button" class="csRow" @click="go('members')">
                <span class="csRowIcon"><v-icon icon="mdi-account-group-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_members', undefined, 'Subscribers') }}</span>
                  <span v-if="loaded.members" class="csRowMeta">{{ memberRows.length }}</span>
                </span>
                <v-icon icon="mdi-chevron-right" size="18" class="csChevron" />
              </button>

              <button v-if="isStandalone" type="button" class="csRow" @click="go('removed')">
                <span class="csRowIcon"><v-icon icon="mdi-account-cancel-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_removed_users', undefined, 'Removed users') }}</span>
                  <span v-if="loaded.members" class="csRowMeta">{{ removedRows.length }}</span>
                </span>
                <v-icon icon="mdi-chevron-right" size="18" class="csChevron" />
              </button>

              <button type="button" class="csRow" @click="go('events')">
                <span class="csRowIcon"><v-icon icon="mdi-history" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ t('chat.chanset_recent_actions', undefined, 'Recent actions') }}</span>
                </span>
                <v-icon icon="mdi-chevron-right" size="18" class="csChevron" />
              </button>
            </section>

            <section class="csCard">
              <button type="button" class="csRow csRowDanger" @click="confirmDeleteNow">
                <span class="csRowIcon csRowIconDanger"><v-icon icon="mdi-delete-outline" size="18" /></span>
                <span class="csRowBody">
                  <span class="csRowTitle">{{ deleteRowLabel }}</span>
                </span>
              </button>
            </section>
          </template>

          <template v-else-if="screen === 'discussion'">
            <div v-if="screenState.discussion.loading" class="csHint">
              {{ t('chat.chanset_loading', undefined, 'Loading…') }}
            </div>
            <div v-else-if="screenState.discussion.error" class="csError">{{ screenState.discussion.error }}</div>
            <section class="csCard">
              <button type="button" class="csListRow" :class="{ csListRowOn: !discussionID }" :disabled="pending.discussion_chat_id" @click="setDiscussion('')">
                <span class="csListBody">
                  <span class="csListTitle">{{ t('chat.chanset_no_discussion', undefined, 'No discussion') }}</span>
                  <span class="csListMeta">{{ t('chat.chanset_no_discussion_hint', undefined, 'Turn off linked comments') }}</span>
                </span>
                <v-icon v-if="!discussionID" icon="mdi-check" size="18" class="csCheck" />
              </button>
              <div v-if="discussionExtra" class="csListRow csListRowStatic">
                <span class="csListBody">
                  <span class="csListTitle">{{ discussionExtra.title }}</span>
                  <span class="csListMeta">{{ t('chat.chanset_linked_chat', undefined, 'Linked chat') }}</span>
                </span>
                <v-icon v-if="discussionID === discussionExtra.id" icon="mdi-check" size="18" class="csCheck" />
              </div>
              <button
                v-for="item in discussionChats"
                :key="item.id"
                type="button"
                class="csListRow"
                :class="{ csListRowOn: discussionID === item.id }"
                :disabled="pending.discussion_chat_id"
                @click="setDiscussion(item.id)"
              >
                <span class="csAvatarMini" :style="{ background: avatarColorFor(item.id) }">{{ (item.title || '?').slice(0, 1).toUpperCase() }}</span>
                <span class="csListBody">
                  <span class="csListTitle">{{ item.title }}</span>
                </span>
                <v-icon v-if="discussionID === item.id" icon="mdi-check" size="18" class="csCheck" />
              </button>
              <div v-if="!discussionChats.length && !screenState.discussion.loading" class="csHint">
                {{ t('chat.chanset_discussion_empty', undefined, 'No groups to link yet') }}
              </div>
            </section>
          </template>

          <template v-else-if="screen === 'appearance'">
            <section v-if="isStandalone" class="csHero csHeroSmall">
              <div class="csAvatarWrap">
                <img v-if="avatarSrc" :src="avatarSrc" alt="" class="csAvatarImg" />
                <div v-else-if="iconDraft || localChat.icon_emoji" class="csAvatarEmoji">{{ iconDraft || localChat.icon_emoji }}</div>
                <div v-else class="csAvatarLetter" :style="{ background: avatarFill }">{{ avatarLetter }}</div>
              </div>
            </section>

            <section class="csCard">
              <label v-if="isStandalone" class="csButton csButtonPrimary">
                <input type="file" accept="image/*" class="csFileInput" @change="onPhotoPick" />
                <v-icon icon="mdi-camera-outline" size="16" />
                {{ t('chat.chanset_upload_photo', undefined, 'Upload photo') }}
              </label>
              <button v-if="isStandalone && avatarSrc" type="button" class="csButton csButtonDanger" @click="clearPhoto">
                <v-icon icon="mdi-trash-can-outline" size="16" />
                {{ t('chat.chanset_remove_photo', undefined, 'Remove photo') }}
              </button>

              <label class="csField">
                <span class="csFieldLabel">{{ t('chat.chanset_icon_emoji', undefined, 'Icon emoji') }}</span>
                <span ref="appearanceIconWrapRef" class="csEmojiRow csEmojiWrap">
                  <input
                    ref="appearanceIconInputRef"
                    v-model="iconDraft"
                    class="csInput csEmojiInput"
                    type="text"
                    :placeholder="t('chat.chanset_icon_placeholder', undefined, 'Emoji icon (single emoji)')"
                    @blur="saveIcon"
                    @keydown.enter.prevent="saveIcon"
                  />
                  <button
                    type="button"
                    class="csIconBtn"
                    :class="{ csIconBtnOn: appearanceIconPickerOpen }"
                    :aria-expanded="appearanceIconPickerOpen ? 'true' : 'false'"
                    :aria-label="t('poll.insert_emoji', undefined, 'Insert emoji')"
                    :title="t('poll.insert_emoji', undefined, 'Insert emoji')"
                    @click.stop="toggleAppearanceIconPicker"
                  >
                    <v-icon icon="mdi-emoticon-happy-outline" size="18" />
                  </button>
                  <button
                    v-if="iconDraft"
                    type="button"
                    class="csIconBtn"
                    :aria-label="t('chat.chanset_clear_emoji', undefined, 'Clear emoji')"
                    @click="clearIcon"
                  >
                    <v-icon icon="mdi-close-circle-outline" size="18" />
                  </button>
                  <div v-if="appearanceIconPickerOpen" class="csEmojiPopover" @click.stop>
                    <ComposerEmojiGifPicker :open="appearanceIconPickerOpen" @select="onAppearanceIconEmojiPick" />
                  </div>
                </span>
              </label>

              <div class="csField">
                <span class="csFieldLabel">{{ t('chat.chanset_avatar_color', undefined, 'Avatar color') }}</span>
                <div class="csSwatches">
                  <button
                    v-for="color in AVATAR_PALETTE"
                    :key="color"
                    type="button"
                    class="csSwatch"
                    :class="{ csSwatchOn: (localChat.avatar_gradient || '') === color }"
                    :style="{ background: color }"
                    :disabled="pending.avatar_gradient"
                    :aria-label="color"
                    @click="setGradient(color)"
                  >
                    <v-icon v-if="(localChat.avatar_gradient || '') === color" icon="mdi-check" size="14" />
                  </button>
                </div>
              </div>
            </section>
          </template>

          <template v-else-if="screen === 'slowmode'">
            <section class="csCard">
              <button
                v-for="option in SLOW_MODE_OPTIONS"
                :key="option.seconds"
                type="button"
                class="csListRow"
                :class="{ csListRowOn: slowModeSeconds === option.seconds }"
                :disabled="pending.slow_mode_seconds"
                @click="setSlowMode(option.seconds)"
              >
                <span class="csListBody">
                  <span class="csListTitle">{{ t(option.label.key, { seconds: option.seconds }, option.label.fallback) }}</span>
                </span>
                <v-icon v-if="slowModeSeconds === option.seconds" icon="mdi-check" size="18" class="csCheck" />
              </button>
            </section>
          </template>

          <template v-else-if="screen === 'links'">
            <div v-if="screenState.links.loading" class="csHint">{{ t('chat.chanset_loading', undefined, 'Loading…') }}</div>
            <div v-else-if="screenState.links.error" class="csError">{{ screenState.links.error }}</div>
            <section class="csCard">
              <button type="button" class="csButton csButtonPrimary" :disabled="pending.link" @click="createLink">
                <v-icon icon="mdi-plus" size="16" />
                {{ t('chat.chanset_create_link', undefined, 'Create new link') }}
              </button>
              <div v-if="!inviteLinks.length && !screenState.links.loading" class="csHint">
                {{ t('chat.chanset_no_links', undefined, 'No invite links yet') }}
              </div>
              <div v-for="link in inviteLinks" :key="link.id" class="csLinkRow">
                <span class="csListBody">
                  <span class="csListTitle">{{ link.title || t('chat.chanset_link_title', undefined, 'Invite link') }}</span>
                  <span class="csListMeta">{{ inviteLinkUrl(link) }}</span>
                </span>
                <button type="button" class="csMiniBtn" @click="copyInviteLink(link)">
                  <v-icon icon="mdi-content-copy" size="14" />
                  {{ t('chat.chanset_copy_link', undefined, 'Copy link') }}
                </button>
              </div>
            </section>
          </template>

          <template v-else-if="screen === 'members'">
            <div v-if="screenState.members.loading" class="csHint">{{ t('chat.chanset_loading', undefined, 'Loading…') }}</div>
            <div v-else-if="screenState.members.error" class="csError">{{ screenState.members.error }}</div>
            <section class="csCard">
              <div v-if="!memberRows.length && !screenState.members.loading" class="csHint">
                {{ t('chat.chanset_no_members', undefined, 'No subscribers yet') }}
              </div>
              <div v-for="row in memberRows" :key="row.id" class="csMemberRow">
                <span class="csAvatarMini" :style="{ background: avatarColorFor(row.id) }">{{ row.displayName.slice(0, 1).toUpperCase() }}</span>
                <span class="csListBody">
                  <span class="csListTitle">{{ row.displayName }}</span>
                  <span class="csListMeta">{{ roleText(row) }}</span>
                </span>
                <span class="csMemberActions">
                  <button
                    v-for="action in roleButtons(row)"
                    :key="action.key"
                    type="button"
                    class="csMiniBtn"
                    :disabled="pending[`role:${row.id}`]"
                    @click="action.run"
                  >
                    {{ action.label }}
                  </button>
                  <button
                    v-if="canRemove(row)"
                    type="button"
                    class="csMiniBtn csMiniBtnDanger"
                    :disabled="pending[`remove:${row.id}`]"
                    @click="removeMember(row.id)"
                  >
                    {{ t('chat.chanset_remove_member', undefined, 'Remove') }}
                  </button>
                </span>
              </div>
            </section>
          </template>

          <template v-else-if="screen === 'removed'">
            <div v-if="screenState.members.loading" class="csHint">{{ t('chat.chanset_loading', undefined, 'Loading…') }}</div>
            <div v-else-if="screenState.members.error" class="csError">{{ screenState.members.error }}</div>
            <section class="csCard">
              <div v-if="!removedRows.length && !screenState.members.loading" class="csHint">
                {{ t('chat.chanset_no_removed', undefined, 'No removed users') }}
              </div>
              <div v-for="row in removedRows" :key="row.id" class="csMemberRow">
                <span class="csAvatarMini" :style="{ background: avatarColorFor(row.id) }">{{ row.displayName.slice(0, 1).toUpperCase() }}</span>
                <span class="csListBody">
                  <span class="csListTitle">{{ row.displayName }}</span>
                  <span class="csListMeta">{{ roleText(row) }}</span>
                </span>
                <span class="csMemberActions">
                  <button
                    type="button"
                    class="csMiniBtn"
                    :disabled="pending[`restore:${row.id}`]"
                    @click="restoreMember(row.id)"
                  >
                    {{ t('chat.chanset_restore', undefined, 'Restore') }}
                  </button>
                </span>
              </div>
            </section>
          </template>

          <template v-else-if="screen === 'events'">
            <div v-if="screenState.events.loading" class="csHint">{{ t('chat.chanset_loading', undefined, 'Loading…') }}</div>
            <div v-else-if="screenState.events.error" class="csError">{{ screenState.events.error }}</div>
            <section class="csCard">
              <div v-if="!eventRows.length && !screenState.events.loading" class="csHint">
                {{ t('chat.chanset_no_events', undefined, 'No recent actions') }}
              </div>
              <div v-for="row in eventRows" :key="row.id" class="csEventRow">
                <span class="csRowIcon"><v-icon :icon="row.icon" size="16" /></span>
                <span class="csListBody">
                  <span class="csListTitle">{{ row.text }}</span>
                  <span class="csListMeta">
                    <span v-if="row.detail" class="csEventDetail">{{ row.detail }}</span>
                    <span>{{ row.time }}</span>
                  </span>
                </span>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.csRoot {
  position: fixed;
  inset: 0;
  z-index: 150;
  display: flex;
  justify-content: center;
  background: var(--scrim);
}

.csPanel {
  position: relative;
  width: min(560px, 100%);
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--bg-elevated);
  color: var(--text);
}

.csHeader {
  min-height: 62px;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}

.csIconBtn {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex: 0 0 auto;
}

.csIconBtn:hover {
  background: var(--surface-soft-hover);
  color: var(--text);
}

.csHeaderText {
  min-width: 0;
}

.csHeaderTitle {
  font-size: 1.05rem;
  font-weight: 800;
  letter-spacing: -.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csHeaderSub {
  font-size: .78rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csScroll {
  min-height: 0;
  overflow-y: auto;
  padding: 14px 12px 24px;
  display: grid;
  align-content: start;
  gap: 12px;
}

.csHero {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 4px 0 2px;
}

.csHeroSmall {
  padding-top: 0;
}

.csAvatarWrap {
  position: relative;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-soft);
  display: grid;
  place-items: center;
}

.csHeroSmall .csAvatarWrap {
  width: 88px;
  height: 88px;
}

.csAvatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csAvatarEmoji {
  font-size: 48px;
  line-height: 1;
}

.csHeroSmall .csAvatarEmoji {
  font-size: 38px;
}

.csAvatarLetter {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 42px;
  font-weight: 800;
}

.csHeroSmall .csAvatarLetter {
  font-size: 34px;
}

.csAvatarEdit {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-items: center;
  cursor: pointer;
  border: 2px solid var(--bg-elevated);
}

.csFileInput {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.csEmojiRow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: min(320px, 100%);
}

.csEmojiInput {
  min-width: 0;
  flex: 1 1 auto;
}

.csEmojiWrap {
  position: relative;
}

.csTextareaWrap {
  position: relative;
}

.csTextareaWithEmoji {
  padding-right: 40px;
}

.csEmojiBtn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.csEmojiBtn:hover,
.csEmojiBtnOn,
.csIconBtnOn {
  background: var(--surface-soft-hover);
  color: var(--accent);
}

.csEmojiPopover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  width: min(388px, calc(100vw - 44px));
}

.csEmojiPopover :deep(.ep-tabs) {
  display: none;
}

.csCard {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
}

.csField {
  display: grid;
  gap: 6px;
  position: relative;
}

.csFieldRow {
  padding-top: 4px;
}

.csFieldLabel {
  font-size: .78rem;
  font-weight: 700;
  color: var(--text-muted);
}

.csInput,
.csTextarea {
  width: 100%;
  min-height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--surface-soft);
  padding: 8px 12px;
  color: var(--text);
  font-size: .92rem;
  font-family: inherit;
  outline: 0;
}

.csTextarea {
  resize: vertical;
  min-height: 76px;
  line-height: 1.4;
}

.csInput:focus,
.csTextarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.csCounter {
  justify-self: end;
  margin-top: 2px;
  margin-right: 4px;
  font-size: .7rem;
  color: var(--text-muted);
}

.csCounterOver {
  color: var(--danger);
  font-weight: 700;
}

.csSegment {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--surface-soft);
}

.csSegmentBtn {
  min-height: 34px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-soft);
  font-size: .85rem;
  font-weight: 700;
  cursor: pointer;
}

.csSegmentBtnOn {
  background: var(--surface-strong);
  color: var(--accent-strong);
  box-shadow: var(--shadow-soft);
}

.csRow {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

button.csRow {
  cursor: pointer;
}

.csRow + .csRow,
.csCard > .csField + .csRow {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.csCard > .csField + .csField {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.csCard > .csRow + .csField {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.csRowIcon {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--surface-soft);
  color: var(--accent-strong);
}

.csRowIconDanger {
  color: var(--danger);
}

.csRowBody {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.csRowTitle {
  font-size: .92rem;
  font-weight: 700;
}

.csRowMeta {
  font-size: .78rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csChevron {
  color: var(--text-muted);
}

.csRowDanger .csRowTitle {
  color: var(--danger);
}

.csSwitch {
  width: 44px;
  height: 26px;
  border: 0;
  border-radius: 999px;
  background: var(--surface-soft-hover);
  position: relative;
  cursor: pointer;
  padding: 0;
  transition: background .15s ease;
}

.csSwitchOn {
  background: var(--accent);
}

.csSwitchKnob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, .3);
  transition: transform .15s ease;
}

.csSwitchOn .csSwitchKnob {
  transform: translateX(18px);
}

.csListRow {
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

button.csListRow {
  cursor: pointer;
}

.csListRow + .csListRow {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.csListRowStatic {
  cursor: default;
}

.csListRowOn .csListTitle {
  color: var(--accent-strong);
}

.csListBody {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.csListTitle {
  font-size: .92rem;
  font-weight: 700;
}

.csListMeta {
  font-size: .76rem;
  color: var(--text-muted);
  word-break: break-word;
}

.csCheck {
  color: var(--accent-strong);
}

.csAvatarMini {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: .9rem;
  font-weight: 800;
  flex: 0 0 auto;
}

.csMemberRow,
.csEventRow,
.csLinkRow {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.csEventRow,
.csLinkRow {
  grid-template-columns: auto minmax(0, 1fr);
}

.csLinkRow {
  grid-template-columns: minmax(0, 1fr) auto;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.csMemberRow + .csMemberRow,
.csEventRow + .csEventRow {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.csEventDetail {
  display: block;
  color: var(--text-soft);
}

.csMemberActions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.csButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface-soft);
  color: var(--text);
  font-size: .84rem;
  font-weight: 700;
  cursor: pointer;
  position: relative;
}

.csButtonPrimary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  justify-self: start;
}

.csButtonDanger {
  color: var(--danger);
  justify-self: start;
}

.csButtonDangerSolid {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.csMiniBtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: .74rem;
  font-weight: 700;
  cursor: pointer;
}

.csMiniBtnDanger {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.csMiniBtn:disabled,
.csListRow:disabled,
.csButton:disabled,
.csSwatch:disabled {
  opacity: .6;
  cursor: default;
}

.csSwatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.csSwatch {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid transparent;
  display: grid;
  place-items: center;
  color: #fff;
  cursor: pointer;
  padding: 0;
}

.csSwatchOn {
  border-color: var(--text);
}

.csHint {
  font-size: .85rem;
  color: var(--text-muted);
}

.csError {
  font-size: .85rem;
  color: var(--danger);
}

@media (min-width: 600px) {
  .csRoot {
    align-items: center;
    padding: 16px;
  }

  .csPanel {
    height: min(100%, 920px);
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid var(--border);
    box-shadow: var(--shadow-card);
  }
}

@media (max-width: 420px) {
  .csCard {
    padding: 12px 10px;
  }

  .csMemberRow {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .csMemberActions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}
</style>
