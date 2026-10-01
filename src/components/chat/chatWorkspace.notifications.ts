import { computed, ref } from 'vue'
import { useI18n } from '../../i18n/i18n'

type NotifyArgs = {
  title: string
  body: string
  chatID?: string
  /** Receives the created notification so the caller can close it later. */
  onShown?: (notification: Notification) => void
}

export type NotificationShowResult = 'shown' | 'disabled' | 'prompt' | 'denied' | 'unsupported'
export type NotificationPermissionState = 'unsupported' | NotificationPermission
export type NotificationNoticeCode = '' | 'blocked' | 'unsupported'
export type OpenChatHandler = (chatID: string) => void

const NOTIFICATIONS_ENABLED_KEY = 'combox.notifications.enabled'

const { t } = useI18n()

function readPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

export const notificationsEnabled = ref<boolean>(readEnabled())
export const notificationPermission = ref<NotificationPermissionState>(readPermission())
export const notificationNoticeCode = ref<NotificationNoticeCode>(readPermission() === 'unsupported' ? 'unsupported' : '')

export const notificationNotice = computed<string>(() => {
  if (notificationNoticeCode.value === 'blocked') {
    return t('chat.notifications_blocked', undefined, 'Desktop notifications are blocked. Allow them for this site in your browser settings.')
  }
  if (notificationNoticeCode.value === 'unsupported') {
    return t('chat.notifications_unsupported', undefined, 'This browser does not support desktop notifications.')
  }
  return ''
})

function applyPermission(next: NotificationPermissionState): NotificationPermissionState {
  notificationPermission.value = next
  if (next === 'granted') notificationNoticeCode.value = ''
  else if (next === 'denied') notificationNoticeCode.value = 'blocked'
  else if (next === 'unsupported') notificationNoticeCode.value = 'unsupported'
  return next
}

export function syncNotificationPermission(): NotificationPermissionState {
  return applyPermission(readPermission())
}

export function setNotificationsEnabled(enabled: boolean): void {
  notificationsEnabled.value = enabled
  try {
    window.localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    // Storage may be unavailable (private mode); the ref still works.
  }
}

export function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return Promise.resolve(applyPermission('unsupported'))
  }
  try {
    return Promise.resolve(Notification.requestPermission())
      .then((permission) => applyPermission(permission))
      .catch(() => applyPermission(readPermission()))
  } catch {
    return Promise.resolve(applyPermission(readPermission()))
  }
}

let audioCtx: AudioContext | null = null

function unlockAudio(): boolean {
  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return false
      audioCtx = new Ctx()
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {})
      return false
    }
    return audioCtx.state === 'running'
  } catch {
    audioCtx = null
    return false
  }
}

function playMessageTone(ctx: AudioContext): void {
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.value = 0.05
    osc.type = 'sine'
    osc.frequency.value = 880
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    window.setTimeout(() => {
      try {
        osc.stop()
        osc.disconnect()
        gain.disconnect()
      } catch {
        // ignore
      }
    }, 140)
  } catch {
    // ignore
  }
}

export function tryPlayMessageSound(): void {
  try {
    unlockAudio()
    const ctx = audioCtx
    if (!ctx || ctx.state === 'closed') return
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => playMessageTone(ctx)).catch(() => {})
      return
    }
    playMessageTone(ctx)
  } catch {
    // Autoplay restrictions or missing audio support.
  }
}

let gestureHooksInstalled = false

function removeGestureHooks(): void {
  if (!gestureHooksInstalled) return
  gestureHooksInstalled = false
  window.removeEventListener('pointerdown', handleUserGesture, { capture: true })
  window.removeEventListener('keydown', handleUserGesture, { capture: true })
}

function handleUserGesture(): void {
  const audioReady = unlockAudio()
  const permission = readPermission()
  if (permission === 'default' && notificationsEnabled.value) {
    try {
      void Notification.requestPermission().then(applyPermission).catch(() => {})
    } catch {
      // ignore
    }
  }
  if (permission !== 'default' && audioReady) removeGestureHooks()
}

let openChatHandler: OpenChatHandler | null = null
let serviceWorkerListenerInstalled = false

function focusAndOpen(chatID: string): void {
  try {
    window.focus()
  } catch {
    // ignore
  }
  const id = (chatID || '').trim()
  if (id) openChatHandler?.(id)
}

function handleServiceWorkerMessage(event: MessageEvent): void {
  const data = event.data as { type?: unknown; chatID?: unknown } | null | undefined
  if (!data || typeof data !== 'object') return
  if (data.type !== 'combox:notificationclick') return
  focusAndOpen(typeof data.chatID === 'string' ? data.chatID : '')
}

/**
 * Wires the two hooks the notification chain needs: a real user gesture to ask
 * for permission (plus an AudioContext unlock) and the service worker click
 * that focuses an already open window.
 */
export function installNotificationHooks(onOpenChat: OpenChatHandler): void {
  openChatHandler = onOpenChat
  if (typeof window === 'undefined') return
  if (!gestureHooksInstalled) {
    gestureHooksInstalled = true
    window.addEventListener('pointerdown', handleUserGesture, { capture: true, passive: true })
    window.addEventListener('keydown', handleUserGesture, { capture: true, passive: true })
    syncNotificationPermission()
  }
  if (!serviceWorkerListenerInstalled && 'serviceWorker' in navigator) {
    serviceWorkerListenerInstalled = true
    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage)
  }
}

function buildNotificationOptions(body: string, chatID: string): NotificationOptions {
  const options: NotificationOptions = { body }
  const lang = (document.documentElement.lang || '').trim()
  if (lang) options.lang = lang
  if (chatID) {
    options.tag = `combox-message-${chatID}`
    options.data = { chatID }
  }
  return options
}

async function waitForServiceWorker(timeoutMs = 2000): Promise<ServiceWorkerRegistration | null> {
  const ready = navigator.serviceWorker.ready.then((registration) => registration).catch(() => null)
  let timer = 0
  const timeout = new Promise<null>((resolve) => {
    timer = window.setTimeout(() => resolve(null), timeoutMs)
  })
  try {
    return await Promise.race([ready, timeout])
  } finally {
    window.clearTimeout(timer)
  }
}

async function showViaServiceWorker(title: string, options: NotificationOptions, chatID: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false
  try {
    const registration = await waitForServiceWorker()
    if (!registration) return false
    const swOptions: NotificationOptions & { actions?: Array<{ action: string; title: string }> } = { ...options }
    if (chatID) swOptions.actions = [{ action: 'open', title: t('chat.notifications_open_chat', undefined, 'Open chat') }]
    await registration.showNotification(title, swOptions)
    return true
  } catch {
    return false
  }
}

export async function tryShowDesktopNotification(args: NotifyArgs): Promise<NotificationShowResult> {
  if (!notificationsEnabled.value) return 'disabled'
  const permission = syncNotificationPermission()
  if (permission === 'unsupported') return 'unsupported'
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'prompt'

  const chatID = (args.chatID || '').trim()
  const options = buildNotificationOptions(args.body, chatID)
  const openOnClick = () => focusAndOpen(chatID)

  if (args.onShown) {
    try {
      const notification = new Notification(args.title, options)
      notification.onclick = openOnClick
      args.onShown(notification)
      return 'shown'
    } catch {
      applyPermission(readPermission())
      return 'unsupported'
    }
  }

  if (await showViaServiceWorker(args.title, options, chatID)) return 'shown'

  try {
    const notification = new Notification(args.title, options)
    notification.onclick = openOnClick
    return 'shown'
  } catch {
    applyPermission(readPermission())
    return 'unsupported'
  }
}
