import type { ChatFolder, ChatItem } from 'combox-api'

/** The virtual "All chats" tab: no folder behind it, never sent to the backend. */
export const ALL_FOLDERS_ID = ''

/**
 * Virtual default folders (Telegram-style quick filters): computed from chat
 * kinds on the client, never stored on the backend. Custom folders keep real
 * UUIDs, so these short ids can never collide with them.
 */
export const DEFAULT_FOLDER_DIRECT_ID = 'direct'
export const DEFAULT_FOLDER_CHANNEL_ID = 'channel'
export const DEFAULT_FOLDER_GROUP_ID = 'group'

export type DefaultFolderKind = 'all' | 'direct' | 'channel' | 'group'

/**
 * MDI glyphs for the default folders. Every name below is already used
 * elsewhere in the project, so the subset font is guaranteed to have them:
 * All — list, Direct — person, Channels — megaphone, Groups — group.
 */
export const DEFAULT_FOLDER_ICONS: Record<DefaultFolderKind, string> = {
  all: 'mdi-view-list',
  direct: 'mdi-account-outline',
  channel: 'mdi-bullhorn-outline',
  group: 'mdi-account-group-outline',
}

export function isDefaultFolderId(folderID: string): boolean {
  return (
    folderID === ALL_FOLDERS_ID ||
    folderID === DEFAULT_FOLDER_DIRECT_ID ||
    folderID === DEFAULT_FOLDER_CHANNEL_ID ||
    folderID === DEFAULT_FOLDER_GROUP_ID
  )
}

export function defaultFolderKindOf(folderID: string): DefaultFolderKind | null {
  if (folderID === ALL_FOLDERS_ID) return 'all'
  if (folderID === DEFAULT_FOLDER_DIRECT_ID) return 'direct'
  if (folderID === DEFAULT_FOLDER_CHANNEL_ID) return 'channel'
  if (folderID === DEFAULT_FOLDER_GROUP_ID) return 'group'
  return null
}

/** Tab index in the legacy All/Direct/Channels/Groups order for a default kind. */
export function tabIndexForDefaultKind(kind: DefaultFolderKind): number {
  if (kind === 'direct') return 1
  if (kind === 'channel') return 2
  if (kind === 'group') return 3
  return 0
}

/**
 * Kind predicates mirror chatWorkspace.computed so the folder bar and the
 * chat filter agree on what "Direct / Channels / Groups" means. Topics
 * (kind `channel` with a parent group) never match: they live inside groups.
 */
export function isDirectChatItem(chat: ChatItem): boolean {
  const kind = (chat.kind || '').trim()
  if (kind === 'standalone_channel') return false
  return Boolean(chat.is_direct) || kind === 'bot'
}

export function isChannelChatItem(chat: ChatItem): boolean {
  return (chat.kind || '').trim() === 'standalone_channel'
}

export function isGroupChatItem(chat: ChatItem): boolean {
  return (chat.kind || '').trim() === 'group'
}

export function chatMatchesDefaultKind(chat: ChatItem, kind: DefaultFolderKind): boolean {
  if (kind === 'all') return true
  if (kind === 'direct') return isDirectChatItem(chat)
  if (kind === 'channel') return isChannelChatItem(chat)
  return isGroupChatItem(chat)
}

/** Sidebar only state: which folder tab was last active on this device. */
export const ACTIVE_FOLDER_STORAGE_KEY = 'combox_active_folder'

/** Folders render in the order the backend assigns, names break ties only. */
export function sortFoldersForBar(folders: ChatFolder[]): ChatFolder[] {
  return [...(folders || [])].sort((a, b) => {
    const posA = Number(a?.position) || 0
    const posB = Number(b?.position) || 0
    if (posA !== posB) return posA - posB
    return String(a?.name || '').localeCompare(String(b?.name || ''))
  })
}

/**
 * The folder the sidebar is currently filtered by, or null for "All chats".
 * A stored id that no longer exists resolves to null instead of an error, so
 * a deleted folder degrades to the unfiltered list until state is reset.
 * Virtual default ids are NOT resolved here — see currentFolderIdOf.
 */
export function activeFolderOf(folders: ChatFolder[], activeFolderId: string): ChatFolder | null {
  if (!activeFolderId) return null
  return (folders || []).find((folder) => folder.id === activeFolderId) || null
}

/**
 * The tab id the folder bar should light up. Default ids pass through even
 * though no folder stands behind them; unknown custom ids fall back to All.
 */
export function currentFolderIdOf(folders: ChatFolder[], activeFolderId: string): string {
  if (isDefaultFolderId(activeFolderId)) return activeFolderId
  return activeFolderOf(folders, activeFolderId)?.id ?? ALL_FOLDERS_ID
}

export function readActiveFolder(): string {
  try {
    return window.localStorage.getItem(ACTIVE_FOLDER_STORAGE_KEY) || ALL_FOLDERS_ID
  } catch {
    return ALL_FOLDERS_ID
  }
}

export function writeActiveFolder(folderID: string): void {
  try {
    window.localStorage.setItem(ACTIVE_FOLDER_STORAGE_KEY, folderID || ALL_FOLDERS_ID)
  } catch {
    // Private mode / disabled storage: the filter still works for this session.
  }
}

/** Unread messages summed over the chats of one folder (same unit as row badges). */
export function folderUnreadSum(folder: ChatFolder | null, unreadByChatId: Record<string, number>): number {
  if (!folder) return 0
  const counts = unreadByChatId || {}
  let sum = 0
  for (const chatID of folder.chat_ids || []) {
    const value = Number(counts[chatID] || 0)
    if (value > 0) sum += value
  }
  return sum
}

/** Unread messages over every chat the backend reports, for the "All chats" tab. */
export function totalUnreadSum(unreadByChatId: Record<string, number>): number {
  const counts = unreadByChatId || {}
  let sum = 0
  for (const value of Object.values(counts)) {
    const numeric = Number(value || 0)
    if (numeric > 0) sum += numeric
  }
  return sum
}

/**
 * Unread sum for a virtual default folder. Kind-filtered chat ids are wrapped
 * into a synthetic folder so the counting stays identical to folderUnreadSum
 * (same unit as the row badges and the custom folder tabs).
 */
export function defaultFolderUnreadSum(
  kind: DefaultFolderKind,
  chats: ChatItem[],
  unreadByChatId: Record<string, number>,
): number {
  if (kind === 'all') return totalUnreadSum(unreadByChatId)
  const ids: string[] = []
  for (const chat of chats || []) {
    if (!chatMatchesDefaultKind(chat, kind)) continue
    const id = String(chat.id || '').trim()
    if (id) ids.push(id)
  }
  return folderUnreadSum({ chat_ids: ids } as ChatFolder, unreadByChatId)
}

export function unreadBadgeLabel(sum: number): string {
  return sum > 99 ? '99+' : String(sum)
}
