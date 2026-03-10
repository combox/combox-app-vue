export type LazyLoadTask = {
  target: HTMLElement
  load: () => Promise<void> | void
}

type TaskInternal = LazyLoadTask & {
  visible: boolean
  wasSeen: boolean
}

type VisibilityCallback = (visible: boolean, entry: IntersectionObserverEntry) => void

/**
 * A minimal, tweb-inspired lazy load queue:
 * - 1 IntersectionObserver (per rootMargin) shared across the app
 * - visibility-driven queue
 * - parallel limit + lock (to avoid fighting resize/open animations)
 */
export class MediaLazyQueue {
  private readonly tasks = new Map<HTMLElement, TaskInternal>()
  private readonly callbacks = new Map<HTMLElement, Set<VisibilityCallback>>()
  private readonly queue: TaskInternal[] = []
  private readonly inProcess = new Set<HTMLElement>()

  private io: IntersectionObserver | null = null
  private scheduled = false
  private locked = false

  private parallelLimit: number
  private rootMargin: string

  constructor(parallelLimit = 4, rootMargin: string = '600px 0px') {
    this.parallelLimit = parallelLimit
    this.rootMargin = rootMargin
  }

  public lock() {
    this.locked = true
  }

  public unlock() {
    this.locked = false
    this.scheduleProcess()
  }

  public lockFor(ms: number) {
    this.lock()
    window.setTimeout(() => this.unlock(), Math.max(0, ms || 0))
  }

  public observe(task: LazyLoadTask, onVisibilityChange?: VisibilityCallback): () => void {
    this.ensureIO()

    // Fallback for environments without IntersectionObserver.
    if (!this.io) {
      try {
        const res = task.load()
        void Promise.resolve(res)
      } catch {
        // ignore
      }
      return () => {
        /* noop */
      }
    }

    const internal: TaskInternal = {
      ...task,
      visible: false,
      wasSeen: false,
    }
    this.tasks.set(task.target, internal)

    if (onVisibilityChange) {
      const set = this.callbacks.get(task.target) || new Set<VisibilityCallback>()
      set.add(onVisibilityChange)
      this.callbacks.set(task.target, set)
    }

    this.io.observe(task.target)

    return () => {
      this.unobserve(task.target, onVisibilityChange)
    }
  }

  public unobserve(target: HTMLElement, onVisibilityChange?: VisibilityCallback) {
    if (onVisibilityChange) {
      const set = this.callbacks.get(target)
      if (set) {
        set.delete(onVisibilityChange)
        if (!set.size) this.callbacks.delete(target)
      }
    }

    // Keep observing if there are still listeners.
    const stillHasListeners = this.callbacks.has(target)
    if (!stillHasListeners) {
      this.callbacks.delete(target)
      this.tasks.delete(target)
      this.inProcess.delete(target)
      this.removeFromQueue(target)
      this.io?.unobserve(target)
    }
  }

  private ensureIO() {
    if (this.io) return
    if (typeof IntersectionObserver === 'undefined') return

    this.io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement
          const internal = this.tasks.get(target)
          if (!internal) continue

          const visible = Boolean(entry.isIntersecting)
          if (internal.visible === visible) {
            this.fireCallbacks(target, visible, entry)
            continue
          }

          internal.visible = visible
          if (visible) {
            internal.wasSeen = true
            if (!this.queue.includes(internal)) {
              this.queue.push(internal)
            }
            this.scheduleProcess()
          } else {
            this.removeFromQueue(target)
          }

          this.fireCallbacks(target, visible, entry)
        }
      },
      { root: null, rootMargin: this.rootMargin, threshold: 0.01 },
    )
  }

  private fireCallbacks(target: HTMLElement, visible: boolean, entry: IntersectionObserverEntry) {
    const set = this.callbacks.get(target)
    if (!set) return
    for (const cb of set) {
      try {
        cb(visible, entry)
      } catch {
        // ignore callback errors
      }
    }
  }

  private removeFromQueue(target: HTMLElement) {
    const idx = this.queue.findIndex((t) => t.target === target)
    if (idx >= 0) this.queue.splice(idx, 1)
  }

  private scheduleProcess() {
    if (this.scheduled) return
    this.scheduled = true
    window.setTimeout(() => {
      this.scheduled = false
      this.process()
    }, 0)
  }

  private async process() {
    if (this.locked) return
    if (!this.queue.length) return

    while (this.inProcess.size < this.parallelLimit && this.queue.length) {
      const item = this.queue.shift()
      if (!item) break
      if (!item.wasSeen || !item.visible) continue
      if (this.inProcess.has(item.target)) continue

      this.inProcess.add(item.target)
      Promise.resolve()
        .then(() => item.load())
        .catch(() => undefined)
        .finally(() => {
          this.inProcess.delete(item.target)
          // Load-once: after success/failure we stop observing this target (unless there are callbacks).
          // This keeps IO bookkeeping small in long chats.
          const hasCallbacks = this.callbacks.has(item.target)
          if (!hasCallbacks) {
            this.tasks.delete(item.target)
            this.io?.unobserve(item.target)
          }
          this.scheduleProcess()
        })
    }
  }
}

let sharedQueue: MediaLazyQueue | null = null

export function getSharedMediaLazyQueue() {
  if (!sharedQueue) sharedQueue = new MediaLazyQueue(4, '600px 0px')
  return sharedQueue
}
