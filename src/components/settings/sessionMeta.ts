import { ComboxClient, revokeAuthSession } from 'combox-api'

/** Storage key `combox-api` uses for the browser auth snapshot. */
const AUTH_STORAGE_KEY = 'combox.auth.v1'

function readRefreshToken(): string {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as { tokens?: { refresh_token?: string } }
    return parsed.tokens?.refresh_token || ''
  } catch {
    return ''
  }
}

/**
 * Ends the signed-in session on the server (when the refresh token is still
 * readable), drops the local snapshot and leaves the caller to reload the
 * page — the router then sends the user to the auth screen.
 */
export async function logoutNow(): Promise<void> {
  const client = new ComboxClient()
  const refreshToken = readRefreshToken()
  if (refreshToken) {
    try {
      await client.logout(refreshToken)
    } catch {
      // The session may already be revoked server side; local logout still matters.
    }
  }
  client.clearAuth()
}

/** Kills one session; the current one may be revoked as well. */
export async function terminateSession(sessionID: string): Promise<void> {
  await revokeAuthSession(sessionID)
}

/** Localised "12 Feb 2026, 14:05" for a session timestamp. */
export function formatSessionDate(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return ''
}

function osName(ua: string): string {
  if (/Windows NT/.test(ua)) return 'Windows'
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}

/** "Chrome · Windows" for a user agent, or the raw string when unknown. */
export function sessionDeviceLabel(userAgent: string): string {
  const ua = (userAgent || '').trim()
  if (!ua) return ''
  const browser = browserName(ua)
  const os = osName(ua)
  if (browser && os) return `${browser} · ${os}`
  if (browser || os) return browser || os
  return ua.length > 64 ? `${ua.slice(0, 63)}…` : ua
}
