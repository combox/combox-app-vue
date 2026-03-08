function readHashValue(): string {
  const raw = window.location.hash.replace(/^#/, '').trim()
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export type HashChatSelection = {
  chatID: string
  channelTopicNumber: number | null
}

export function readChatSelectionFromHash(pendingPrefix: string): HashChatSelection {
  const raw = readHashValue()
  if (!raw || raw.startsWith(pendingPrefix) || raw.startsWith('invite:') || raw.startsWith('link:')) {
    return { chatID: '', channelTopicNumber: null }
  }

  const [chatPart, queryPart = ''] = raw.split('?')
  const chatID = (chatPart || '').trim()
  if (!chatID) return { chatID: '', channelTopicNumber: null }

  const params = new URLSearchParams(queryPart)
  const rawChannel = params.get('channel') || ''
  const parsedChannel = Number(rawChannel)
  const channelTopicNumber = Number.isInteger(parsedChannel) && parsedChannel > 0 ? parsedChannel : null

  return { chatID, channelTopicNumber }
}

export function readChatIdFromHash(pendingPrefix: string): string {
  return readChatSelectionFromHash(pendingPrefix).chatID
}

export function readInviteTokenFromHash(): string {
  const raw = readHashValue()
  if (!raw.startsWith('invite:')) return ''
  return raw.slice('invite:'.length).trim()
}

export function readInviteLinkTokenFromHash(): string {
  const raw = readHashValue()
  if (!raw.startsWith('link:')) return ''
  return raw.slice('link:'.length).trim()
}

export function readPublicSlugFromHash(): string {
  const raw = readHashValue()
  if (!raw.startsWith('@')) return ''
  return raw.slice(1).trim().replace(/^@+/, '')
}

export function setHashToChatSelection(chatID: string, channelTopicNumber?: number | null): void {
  const safe = encodeURIComponent(chatID)
  const suffix = Number.isInteger(channelTopicNumber) && Number(channelTopicNumber) > 0 ? `?channel=${Number(channelTopicNumber)}` : ''
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${safe}${suffix}`)
}

export function setHashToChatId(chatID: string): void {
  setHashToChatSelection(chatID, null)
}

export function clearHash(): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
}
