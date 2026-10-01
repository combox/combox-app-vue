import { reactive } from 'vue'

export type ConfirmOptions = {
  title: string
  text?: string
  okLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export type ConfirmDialogState = {
  open: boolean
  title: string
  text: string
  okLabel: string
  cancelLabel: string
  danger: boolean
}

/**
 * Promise-based replacement for the native blocking confirm dialog.
 *
 * Pairs with `src/components/core/ConfirmDialog.vue`: mount the dialog once
 * in the component and drive it through the returned `dialog` state.
 *
 *   const folderConfirm = useConfirm()
 *   const ok = await folderConfirm.openConfirm({ title, text, okLabel, danger: true })
 *   if (!ok) return
 */
export function useConfirm() {
  const dialog = reactive<ConfirmDialogState>({
    open: false,
    title: '',
    text: '',
    okLabel: '',
    cancelLabel: '',
    danger: false,
  })

  let settle: ((value: boolean) => void) | null = null

  function openConfirm(options: ConfirmOptions): Promise<boolean> {
    // A stale pending confirm must never hang: resolve it as dismissed.
    if (settle) settle(false)
    dialog.title = options.title
    dialog.text = options.text ?? ''
    dialog.okLabel = options.okLabel ?? ''
    dialog.cancelLabel = options.cancelLabel ?? ''
    dialog.danger = options.danger ?? false
    dialog.open = true
    return new Promise<boolean>((resolve) => {
      settle = resolve
    })
  }

  function settleDialog(value: boolean): void {
    if (!dialog.open && !settle) return
    dialog.open = false
    const run = settle
    settle = null
    run?.(value)
  }

  function acceptConfirm(): void {
    settleDialog(true)
  }

  function dismissConfirm(): void {
    settleDialog(false)
  }

  return { dialog, openConfirm, acceptConfirm, dismissConfirm }
}
