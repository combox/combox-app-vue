import type { Ref } from 'vue'
import type { WsResponseEnvelope } from './chatWorkspace.types'
import { asRecord, unwrapWsPayload } from './chatWorkspace.helpers'

type SetupWorkspacePresenceInput = {
  wsConnected: Ref<boolean>
  syncWindowActivity: () => void
  sendRequest: (type: string, payload: unknown) => Promise<unknown>
  sendEvent: (type: string, payload: unknown) => boolean
  /** Re-opens the socket when it died without a `close` event (bfcache/frozen tab). */
  ensureConnected?: () => void
}

const PRESENCE_PING_INTERVAL_MS = 5000
const PRESENCE_PING_MIN_GAP_MS = 3000
const RECONNECT_PROBE_GAP_MS = 4000

export function setupWorkspacePresence(input: SetupWorkspacePresenceInput) {
  let presencePingTimer: number | null = null
  let lastPresencePingAt = 0
  let lastReconnectProbeAt = 0
  let pageHooksInstalled = false

  async function requestViaWs<T>(type: string, payload: unknown): Promise<T> {
    const raw = (await input.sendRequest(type, payload)) as WsResponseEnvelope<T> | T
    const unwrapped = unwrapWsPayload<T>(raw)
    const asObj = asRecord(unwrapped as unknown)
    if (typeof asObj.error === 'string' && asObj.error) throw new Error(asObj.error)
    return unwrapped
  }

  function probeConnection() {
    const now = Date.now()
    if (now - lastReconnectProbeAt < RECONNECT_PROBE_GAP_MS) return
    lastReconnectProbeAt = now
    input.ensureConnected?.()
  }

  /**
   * A tab only claims to be online while it is actually visible: a hidden or
   * collapsed tab reports `active:false` so the server drops us from its
   * active set instead of keeping the user "online" for another TTL window.
   */
  function isTabActive() {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden'
  }

  function sendPresencePing(force = false) {
    if (!input.wsConnected.value) return
    const now = Date.now()
    if (!force && now - lastPresencePingAt < PRESENCE_PING_MIN_GAP_MS) return
    // active is always derived from visibility: a hidden tab can never claim
    // active:true here, including the 5s interval and handlePresenceActivity
    // (focus/pointerdown/keydown never fire while hidden).
    if (!input.sendEvent('presence.ping', { active: isTabActive() })) {
      probeConnection()
      return
    }
    lastPresencePingAt = now
  }

  // Best-effort last word before the page is hidden/discarded (bfcache,
  // tab close, swipe away): at pagehide visibilityState may still read
  // "visible", so force active:false instead of deriving it.
  function sendPresenceOffline() {
    if (!input.wsConnected.value) return
    if (input.sendEvent('presence.ping', { active: false })) {
      lastPresencePingAt = Date.now()
    }
  }

  function handlePageShow() {
    input.syncWindowActivity()
    probeConnection()
    sendPresencePing(true)
  }

  function handleVisibilityChange() {
    input.syncWindowActivity()
    // sendPresencePing derives active from visibility: hidden -> active:false
    // immediately, visible -> active:true on return.
    sendPresencePing(true)
  }

  function handlePageHide() {
    input.syncWindowActivity()
    sendPresenceOffline()
  }

  function handleOnline() {
    probeConnection()
    sendPresencePing(true)
  }

  function handleOffline() {
    sendPresencePing(true)
  }

  function installPageHooks() {
    if (pageHooksInstalled) return
    pageHooksInstalled = true
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  function removePageHooks() {
    if (!pageHooksInstalled) return
    pageHooksInstalled = false
    window.removeEventListener('pageshow', handlePageShow)
    window.removeEventListener('pagehide', handlePageHide)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }

  function startPresenceHeartbeat() {
    if (presencePingTimer) window.clearInterval(presencePingTimer)
    // Presence means "this tab is still open": it must not depend on focus,
    // otherwise a backgrounded/minimized window stops reporting itself online.
    presencePingTimer = window.setInterval(() => sendPresencePing(false), PRESENCE_PING_INTERVAL_MS)
    installPageHooks()
    sendPresencePing(true)
  }

  function stopPresenceHeartbeat() {
    if (presencePingTimer) {
      window.clearInterval(presencePingTimer)
      presencePingTimer = null
    }
    removePageHooks()
  }

  function handlePresenceActivity() {
    input.syncWindowActivity()
    sendPresencePing(true)
  }

  return {
    requestViaWs,
    sendPresencePing,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    handlePresenceActivity,
  }
}
