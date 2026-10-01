import { readonly, ref } from 'vue'

export type ToastKind = 'neutral' | 'success' | 'error' | 'info'

export type ToastItem = {
  id: number
  kind: ToastKind
  message: string
}

const items = ref<ToastItem[]>([])
let nextID = 1

function push(kind: ToastKind, message: string, durationMs = 3400): void {
  const id = nextID
  nextID += 1
  const item: ToastItem = { id, kind, message }
  items.value.push(item)
  window.setTimeout(() => {
    dismiss(id)
  }, durationMs)
}

function dismiss(id: number): void {
  const index = items.value.findIndex((item) => item.id === id)
  if (index >= 0) items.value.splice(index, 1)
}

export function useToast() {
  return {
    items: readonly(items),
    show: (message: string) => push('neutral', message),
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
    info: (message: string) => push('info', message),
    dismiss,
  }
}