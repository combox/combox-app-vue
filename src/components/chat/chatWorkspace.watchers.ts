import type { ChatItem, ChatMemberProfile, SearchResults } from 'combox-api'
import { ref, watch, type ComputedRef, type Ref } from 'vue'
import type { PeerProfile, PresenceItem } from './chatWorkspace.types'

type PresenceClientLike = {
  getPresence: (userIds: string[]) => Promise<Array<Record<string, unknown>>>
}

type PresenceSnapshot = {
  online: boolean
  last_seen?: string
  last_seen_visible?: boolean
}

type SetupWorkspaceWatchersInput = {
  directoryQuery: ComputedRef<string>
  runDirectorySearch: (q: string) => Promise<void>
  selectedChat: ComputedRef<ChatItem | null>
  chatMembers: Ref<ChatMemberProfile[]>
  refreshChatMembers: (chatID: string) => Promise<void>
  directPeerId: ComputedRef<string>
  peerProfile: Ref<PeerProfile | null>
  getUserByIDFn: (id: string) => Promise<unknown>
  searchDirectoryFn: (input: { q: string; scope: 'users'; limit: number }) => Promise<SearchResults>
  normalizePeerProfileFn: (input: unknown) => PeerProfile | null
  wsConnected: Ref<boolean>
  sendEvent: (type: string, payload: unknown) => boolean
  startPresenceHeartbeat: () => void
  stopPresenceHeartbeat: () => void
  sendPresencePing: (force?: boolean) => void
  presenceClient: PresenceClientLike
  presenceByUserId: Ref<Record<string, PresenceItem>>
}

export function setupWorkspaceWatchers(input: SetupWorkspaceWatchersInput) {
  watch(input.directoryQuery, (query, _prev, onCleanup) => {
    const timer = window.setTimeout(() => {
      void input.runDirectorySearch(query)
    }, 250)
    onCleanup(() => window.clearTimeout(timer))
  })

  watch(
    () => [input.selectedChat.value?.id, input.selectedChat.value?.is_direct] as const,
    async ([chatID, isDirect]) => {
      const cleanChatID = (chatID || '').trim()
      if (!cleanChatID || isDirect) {
        input.chatMembers.value = []
        return
      }
      try {
        await input.refreshChatMembers(cleanChatID)
      } catch {
        input.chatMembers.value = []
      }
    },
    { immediate: true },
  )

  watch(
    () => [input.selectedChat.value?.id, input.selectedChat.value?.is_direct, input.directPeerId.value] as const,
    async () => {
      const chat = input.selectedChat.value
      if (!chat?.is_direct) {
        input.peerProfile.value = null
        return
      }
      const peerID = (input.directPeerId.value || '').trim()
      if (!peerID) {
        input.peerProfile.value = null
        return
      }
      try {
        const profile = await input.getUserByIDFn(peerID)
        input.peerProfile.value = input.normalizePeerProfileFn(profile)
      } catch {
        try {
          const fallback = await input.searchDirectoryFn({ q: peerID, scope: 'users', limit: 20 })
          const byId = (fallback.users || []).find((u) => (u.id || '').trim() === peerID)
          input.peerProfile.value = input.normalizePeerProfileFn(byId || (fallback.users || [])[0] || null)
        } catch {
          input.peerProfile.value = null
        }
      }
    },
    { immediate: true },
  )

  const subscribedPresencePeerID = ref('')
  watch(
    () => [input.wsConnected.value, input.directPeerId.value] as const,
    ([connected, peerID]) => {
      const nextPeerID = (peerID || '').trim()
      const prevPeerID = subscribedPresencePeerID.value
      if (!connected) return
      if (prevPeerID && prevPeerID !== nextPeerID) {
        void input.sendEvent('presence.unsubscribe', { user_ids: [prevPeerID] })
        subscribedPresencePeerID.value = ''
      }
      if (nextPeerID && prevPeerID !== nextPeerID) {
        void input.sendEvent('presence.subscribe', { user_ids: [nextPeerID] })
        subscribedPresencePeerID.value = nextPeerID
      }
    },
    { immediate: true },
  )

  watch(
    () => input.wsConnected.value,
    (connected) => {
      if (!connected) {
        input.stopPresenceHeartbeat()
        return
      }
      input.startPresenceHeartbeat()
      input.sendPresencePing(true)
    },
    { immediate: true },
  )

  watch(
    () => input.directPeerId.value,
    async (peerID) => {
      const id = (peerID || '').trim()
      if (!id) return
      try {
        const items = await input.presenceClient.getPresence([id])
        if (!Array.isArray(items) || items.length === 0) return
        const item = items[0] as PresenceSnapshot
        input.presenceByUserId.value = {
          ...input.presenceByUserId.value,
          [id]: {
            user_id: id,
            online: Boolean(item.online),
            last_seen: typeof item.last_seen === 'string' ? item.last_seen : undefined,
            last_seen_visible: typeof item.last_seen_visible === 'boolean' ? item.last_seen_visible : true,
          },
        }
      } catch {
        // keep existing presence
      }
    },
    { immediate: true },
  )
}
