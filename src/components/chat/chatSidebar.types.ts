export type AttachmentThumb = { url: string; preview_url?: string }
export type { GroupChannelItem } from '../../models/chat'

export type ChatScopeKey = 'all' | 'direct' | 'channel' | 'group'

// Sidebar tab index (0 all, 1 direct, 2 channels, 3 groups) doubles as the
// scope a chat is pinned into, so pins stay inside the tab they were set from.
export function chatScopeFromTab(tab: number): ChatScopeKey {
  if (tab === 1) return 'direct'
  if (tab === 2) return 'channel'
  if (tab === 3) return 'group'
  return 'all'
}
