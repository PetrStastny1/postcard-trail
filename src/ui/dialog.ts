import { element } from './element.ts'

export interface DialogOptions {
  labelledBy: string
  content: HTMLElement[]
  /** `data-focus-id` of the opener. Looked up on close, so it still works after the opener was re-rendered. */
  returnFocusId: string
  onClosed(): void
}

export interface OpenDialog {
  readonly element: HTMLDialogElement
  replaceContent(content: HTMLElement[]): void
  close(): void
}

const focusableSelector = 'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** A modal window. Escape closes it like ×, Tab and Shift+Tab stay inside, focus returns to the opener. */
export function openDialog({ labelledBy, content, returnFocusId, onClosed }: DialogOptions): OpenDialog {
  const dialog = element('dialog', { class: 'window', 'aria-labelledby': labelledBy }, ...content)

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
    document.querySelector<HTMLElement>(`[data-focus-id="${returnFocusId}"]`)?.focus()
    onClosed()
  })

  document.body.append(dialog)
  dialog.showModal()
  return {
    element: dialog,
    replaceContent(next) {
      dialog.replaceChildren(...next)
    },
    close: () => dialog.close(),
  }
}
