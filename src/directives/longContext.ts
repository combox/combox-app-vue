import type { Directive } from 'vue'

/**
 * Touch long-press opens the same context menu a right-click would.
 *
 * Desktop context menus never fire on touch devices, so the row is watched
 * instead: holding still for LONG_PRESS_MS synthesises a `contextmenu` event at
 * the touch point. Any movement cancels the timer so scrolling keeps working,
 * and a short tap is left alone so a normal selection still happens.
 */
const LONG_PRESS_MS = 450
const MOVE_TOLERANCE_PX = 16
/** Lets us tell a touch-originated context menu from a real right-click. */
let lastTouchAt = 0
/** The click the browser still fires right after our synthetic menu opened. */
let suppressClickUntil = 0

function swallowNextClick() {
  suppressClickUntil = Date.now() + 500
}

type LongPressState = {
  timer: number | null
  startX: number
  startY: number
  active: boolean
}

function install(el: HTMLElement) {
  const state: LongPressState = { timer: null, startX: 0, startY: 0, active: false }

  const clear = () => {
    if (state.timer !== null) {
      window.clearTimeout(state.timer)
      state.timer = null
    }
    state.active = false
  }

  const onSyntheticClickCapture = (event: Event) => {
    if (Date.now() >= suppressClickUntil) return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    if (!touch) return
    lastTouchAt = Date.now()
    clear()
    state.startX = touch.clientX
    state.startY = touch.clientY
    state.active = true
    state.timer = window.setTimeout(() => {
      state.timer = null
      state.active = false
      const rect = el.getBoundingClientRect()
      const clientX = Math.min(Math.max(state.startX, rect.left + 1), rect.right - 1)
      const clientY = Math.min(Math.max(state.startY, rect.top + 1), rect.bottom - 1)
      swallowNextClick()
      el.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          button: 2,
          buttons: 2,
        }),
      )
    }, LONG_PRESS_MS)
  }

  const onTouchMove = (event: TouchEvent) => {
    if (state.timer === null) return
    const touch = event.touches[0]
    if (!touch) {
      clear()
      return
    }
    if (Math.hypot(touch.clientX - state.startX, touch.clientY - state.startY) > MOVE_TOLERANCE_PX) clear()
  }

  const onTouchEnd = () => clear()
  const onContextMenuTouch = (event: Event) => {
    // Suppress the browser's own long-press menu right after our synthetic one.
    if (Date.now() - lastTouchAt < 900) event.preventDefault()
  }

  document.addEventListener('click', onSyntheticClickCapture, true)
  el.addEventListener('touchstart', onTouchStart, { passive: true })
  el.addEventListener('touchmove', onTouchMove, { passive: true })
  el.addEventListener('touchend', onTouchEnd, { passive: true })
  el.addEventListener('touchcancel', onTouchEnd, { passive: true })
  el.addEventListener('contextmenu', onContextMenuTouch)

  return () => {
    clear()
    document.removeEventListener('click', onSyntheticClickCapture, true)
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
    el.removeEventListener('touchcancel', onTouchEnd)
    el.removeEventListener('contextmenu', onContextMenuTouch)
  }
}

export const vLongContext: Directive<HTMLElement> = {
  mounted(el) {
    ;(el as HTMLElement & { __longContextDispose?: () => void }).__longContextDispose = install(el)
  },
  unmounted(el) {
    const dispose = (el as HTMLElement & { __longContextDispose?: () => void }).__longContextDispose
    dispose?.()
    ;(el as HTMLElement & { __longContextDispose?: () => void }).__longContextDispose = undefined
  },
}
