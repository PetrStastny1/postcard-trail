import { element } from './element.ts'

export interface DialogOptions {
  labelledBy: string
  content: HTMLElement[]
  /** `data-focus-id` of the opener. Looked up on close, so it still works after the opener was re-rendered. */
  returnFocusId: string
  /** Extra class next to `window`, e.g. for a window that fills the whole viewport. */
  className?: string
  onClosed(): void
}

export interface OpenDialog {
  replaceContent(content: HTMLElement[]): void
  close(): void
}

const focusableSelector = 'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** The modal window on top. Dialogs are appended to the body in the order they open, so it is the last open one. */
export function topDialog(): HTMLDialogElement | null {
  return [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1) ?? null
}

/** A modal window. Escape closes it like ×, Tab and Shift+Tab stay inside, focus returns to the opener. */
export function openDialog({ labelledBy, content, returnFocusId, className, onClosed }: DialogOptions): OpenDialog {
  const dialog = element('dialog', { class: className ? `window ${className}` : 'window', 'aria-labelledby': labelledBy }, ...content)

  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  // Escape fires `cancel` and then `close`; × calls `close()`. Both end here.
  dialog.addEventListener('close', () => {
    dialog.remove()
    // The opener lives in the window below: the next open dialog, or the screen when none is left.
    const parent: ParentNode = topDialog() ?? document
    parent.querySelector<HTMLElement>(`[data-focus-id="${returnFocusId}"]`)?.focus()
    onClosed()
  })

  document.body.append(dialog)
  dialog.showModal()
  return {
    replaceContent(next) {
      dialog.replaceChildren(...next)
    },
    close: () => dialog.close(),
  }
}
