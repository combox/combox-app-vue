type PreloadState = 'pending' | 'fulfilled' | 'rejected'

const loaded = new Map<string, PreloadState>()
const inFlight = new Map<string, Promise<void>>()

function waitForLoad(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('image load failed'))
    }
    const cleanup = () => {
      img.removeEventListener('load', onLoad)
      img.removeEventListener('error', onError)
    }

    img.addEventListener('load', onLoad, { once: true })
    img.addEventListener('error', onError, { once: true })
  })
}

/**
 * Preloads an image off-DOM and dedupes by URL.
 *
 * Note: We intentionally resolve on `load`, not on `decode()` completion.
 * `decode()` can significantly delay first paint (LCP), especially for large images.
 * If the browser supports decode, we still trigger it best-effort in the background.
 */
export function preloadAndDecodeImage(url: string): Promise<void> {
  const normalized = (url || '').trim()
  if (!normalized) return Promise.resolve()

  const prev = loaded.get(normalized)
  if (prev === 'fulfilled') return Promise.resolve()

  const existing = inFlight.get(normalized)
  if (existing) return existing

  const promise = (async () => {
    loaded.set(normalized, 'pending')

    const img = new Image()
    img.decoding = 'async'
    img.src = normalized

    try {
      // Best-effort decode in background (do not await).
      if (typeof img.decode === 'function') {
        img.decode().catch(() => undefined)
      }

      // Always await `load` so callers can safely swap placeholders.
      await waitForLoad(img)
      loaded.set(normalized, 'fulfilled')
    } catch {
      loaded.set(normalized, 'rejected')
    } finally {
      inFlight.delete(normalized)
    }
  })()

  inFlight.set(normalized, promise)
  return promise
}
