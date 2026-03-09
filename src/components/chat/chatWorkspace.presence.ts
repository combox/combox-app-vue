import type { Ref } from 'vue'
import type { WsResponseEnvelope } from './chatWorkspace.types'
import { asRecord, unwrapWsPayload } from './chatWorkspace.helpers'

type SetupWorkspacePresenceInput = {
  wsConnected: Ref<boolean>
  windowActive: Ref<boolean>
  syncWindowActivity: () => void
  sendRequest: (type: string, payload: unknown) => Promise<unknown>
  sendEvent: (type: string, payload: unknown) => boolean
}

export function setupWorkspacePresence(input: SetupWorkspacePresenceInput) {
  let presencePingTimer: number | null = null
  let lastPresencePingAt = 0

  async function requestViaWs<T>(type: string, payload: unknown): Promise<T> {
    const raw = (await input.sendRequest(type, payload)) as WsResponseEnvelope<T> | T
    const unwrapped = unwrapWsPayload<T>(raw)
    const asObj = asRecord(unwrapped as unknown)
    if (typeof asObj.error === 'string' && asObj.error) throw new Error(asObj.error)
    return unwrapped
  }

  function sendPresencePing(force = false) {
    if (!input.wsConnected.value) return
    const now = Date.now()
    if (!force && now - lastPresencePingAt < 3000) return
    if (!input.sendEvent('presence.ping', {})) return
    lastPresencePingAt = now
  }

  function startPresenceHeartbeat() {
    if (presencePingTimer) window.clearInterval(presencePingTimer)
    presencePingTimer = window.setInterval(() => {
      if (!input.windowActive.value) return
      sendPresencePing(false)
    }, 5000)
  }

  function stopPresenceHeartbeat() {
    if (!presencePingTimer) return
    window.clearInterval(presencePingTimer)
    presencePingTimer = null
  }

  function handlePresenceActivity() {
    input.syncWindowActivity()
    if (input.windowActive.value) sendPresencePing(true)
  }

  return {
    requestViaWs,
    sendPresencePing,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    handlePresenceActivity,
  }
}
