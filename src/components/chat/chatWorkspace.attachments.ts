import { type MessageItem } from 'combox-api'
import type { Ref } from 'vue'
import type { AttachmentView } from './chatWorkspace.types'

type AttachmentPayload = {
  url: string
  preview_url?: string
  attachment: {
    filename?: string
    mime_type?: string
    width?: number
    height?: number
    duration_ms?: number
    size_bytes?: number
    user_meta?: Record<string, unknown>
  }
}

// Playback URLs are presigned and expire (2h), previews even sooner (15m), so a
// hydrated entry must be refreshed instead of trusted for the whole session.
const URL_TTL_MS = 30 * 60 * 1000
// A failed lookup is retried after a short cool-down rather than being cached
// as an empty entry forever (that was the "media never loads again until F5").
const FAILURE_RETRY_MS = 10 * 1000
const REQUEST_TIMEOUT_MS = 12 * 1000
// A lookup that failed right after a send used to stay dead until F5: nothing
// re-invoked hydration for that message. Failures now schedule one retry.
const FAILURE_RETRY_MS_AUTO = 8 * 1000
const MAX_AUTO_RETRIES = 3
const autoRetryCount = new Map<string, number>()
const autoRetryTimers = new Map<string, number>()

function cancelAutoRetry(id: string) {
  autoRetryCount.delete(id)
  const timer = autoRetryTimers.get(id)
  if (timer !== undefined) window.clearTimeout(timer)
  autoRetryTimers.delete(id)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('attachment_lookup_timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function isUsable(entry: AttachmentView | undefined, now: number): boolean {
  if (!entry) return false
  if (!entry.url) {
    // Failed marker: only usable once its cool-down elapsed, so we retry.
    return false
  }
  return now - (entry.fetchedAt || 0) < URL_TTL_MS
}

function needsRefresh(entry: AttachmentView | undefined, now: number): boolean {
  if (!entry) return true
  if (!entry.url) return now - (entry.failedAt || 0) >= FAILURE_RETRY_MS
  return now - (entry.fetchedAt || 0) >= URL_TTL_MS
}

function scheduleAutoRetry(id: string, retry: () => void) {
  const count = autoRetryCount.get(id) || 0
  if (count >= MAX_AUTO_RETRIES) return
  if (autoRetryTimers.has(id)) return
  autoRetryCount.set(id, count + 1)
  const timer = window.setTimeout(() => {
    autoRetryTimers.delete(id)
    retry()
  }, FAILURE_RETRY_MS_AUTO)
  autoRetryTimers.set(id, timer)
}

export async function hydrateAttachmentURLs(
  items: MessageItem[],
  urlsByAttachment: Ref<Record<string, AttachmentView>>,
  attachmentRequests: Map<string, Promise<void>>,
  parseMessageContent: (content: string) => { attachments: Array<{ id?: string | null }> },
  getAttachment: (id: string) => Promise<AttachmentPayload>,
) {
  const now = Date.now()
  const tokens = new Set<string>()
  for (const item of items) {
    const parsed = parseMessageContent(item.content || '')
    for (const attachment of parsed.attachments) {
      const id = (attachment.id || '').trim()
      if (id && needsRefresh(urlsByAttachment.value[id], now)) tokens.add(id)
    }
  }
  if (!tokens.size) return
  await Promise.all(
    Array.from(tokens).map(async (id) => {
      if (attachmentRequests.has(id)) {
        await attachmentRequests.get(id)
        return
      }
      const request = (async () => {
        try {
          const payload = await withTimeout(getAttachment(id), REQUEST_TIMEOUT_MS)
          urlsByAttachment.value = {
            ...urlsByAttachment.value,
            [id]: {
              url: payload.url,
              previewUrl: payload.preview_url || '',
              width: payload.attachment.width || 0,
              height: payload.attachment.height || 0,
              durationMs:
                payload.attachment.duration_ms || Number(payload.attachment.user_meta?.duration_ms) || 0,
              sizeBytes: payload.attachment.size_bytes || 0,
              mimeType: payload.attachment.mime_type || '',
              filename: payload.attachment.filename || '',
              userMeta: payload.attachment.user_meta,
              fetchedAt: Date.now(),
              failedAt: 0,
            },
          }
          cancelAutoRetry(id)
        } catch {
          const previous = urlsByAttachment.value[id]
          urlsByAttachment.value = {
            ...urlsByAttachment.value,
            // Keep whatever used to work; only record the failure when we have
            // nothing usable, and never as a permanent "hydrated" marker.
            [id]: previous?.url
              ? { ...previous, failedAt: Date.now() }
              : {
                  url: '',
                  previewUrl: '',
                  width: 0,
                  height: 0,
                  durationMs: 0,
                  sizeBytes: 0,
                  fetchedAt: 0,
                  failedAt: Date.now(),
                },
          }
          scheduleAutoRetry(id, () => {
            void hydrateAttachmentURLs(items, urlsByAttachment, attachmentRequests, parseMessageContent, getAttachment)
          })
        } finally {
          attachmentRequests.delete(id)
        }
      })()
      attachmentRequests.set(id, request)
      await request
    }),
  )
}

/** Drop an entry so the next render re-fetches a fresh (unexpired) URL. */
export function invalidateAttachment(
  urlsByAttachment: Ref<Record<string, AttachmentView>>,
  id: string,
) {
  const key = (id || '').trim()
  if (!key) return
  const next = { ...urlsByAttachment.value }
  delete next[key]
  urlsByAttachment.value = next
}

export function isAttachmentFresh(entry: AttachmentView | undefined): boolean {
  return isUsable(entry, Date.now())
}
