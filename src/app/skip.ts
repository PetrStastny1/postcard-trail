import { skipConfirmWindow, skipOutcomeWindow, skipTitleId, skipWaitWindow } from '../game/render/skipDialogs.ts'
import { openDialog, topDialog, type OpenDialog } from '../ui/dialog.ts'
import type { RunController } from './runController.ts'

/** A spot without a result for this long offers the way back to the question (decision in LOG.md, confirmed by Petr). */
export const hungSpotMs = 90_000

type SkipStep = { name: 'confirm' } | { name: 'wait'; hung: boolean } | { name: 'outcome'; outcome: 'cancelled' | 'unavailable' }

export interface SkipOptions {
  controller: RunController
  /** A new ID for each attempt. */
  createAttemptId(): string
  /** × and Escape: the pause opens again; this window is already closed. */
  backToPause(): void
  /** Home: the app saves the run and shows the title. */
  goHome(): void
  /** The window closed for any reason, before `backToPause`. */
  closed(): void
}

export interface SkipWindow {
  /** Draws the window again in the current language. */
  redraw(): void
  /** Closes the window without going back to the pause, e.g. when the game screen is left. */
  close(): void
}

/**
 * Skip for a video in place of the pause: the confirmation, the blocked wait for the spot and the cancelled or
 * unavailable outcome. The question stays paused throughout; only "Back to the answer" or a completed spot ends it.
 */
export function openSkip({ controller, createAttemptId, backToPause, goHome, closed }: SkipOptions): SkipWindow {
  const listeners = new AbortController()
  let step: SkipStep = { name: 'confirm' }
  let hungTimer: ReturnType<typeof setTimeout> | undefined
  let dialog: OpenDialog | null = null
  let skipped = false

  const handlers = {
    onClose: () => {
      close()
      backToPause()
    },
    onHome: goHome,
    onBack: () => {
      const abandoning = step.name === 'wait'
      close()
      if (abandoning) controller.abandonSkip()
      else controller.resume()
    },
  }

  function content(): HTMLElement[] {
    if (step.name === 'confirm') return skipConfirmWindow({ ...handlers, onPlay: play })
    if (step.name === 'wait') return skipWaitWindow({ hung: step.hung, onBack: handlers.onBack })
    return skipOutcomeWindow({ ...handlers, outcome: step.outcome })
  }

  function show(next: SkipStep, focusId: string): void {
    step = next
    dialog?.replaceContent(content())
    topDialog()?.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`)?.focus()
  }

  function waitForSpot(): void {
    clearTimeout(hungTimer)
    hungTimer = setTimeout(() => show({ name: 'wait', hung: true }, 'skip-back'), hungSpotMs)
  }

  function play(): void {
    show({ name: 'wait', hung: false }, 'skip-wait')
    const requested = controller.requestSkip(createAttemptId(), {
      // The limit counts from the start of the spot; until then from the request.
      started: waitForSpot,
      finished(outcome) {
        clearTimeout(hungTimer)
        if (outcome === 'completed') {
          skipped = true
          close()
        } else show({ name: 'outcome', outcome }, 'skip-back')
      },
    })
    if (requested) waitForSpot()
    else handlers.onClose()
  }

  function close(): void {
    clearTimeout(hungTimer)
    listeners.abort()
    const closing = dialog
    if (!closing) return
    dialog = null
    closing.close()
    closed()
  }

  // Until the spot has a result nothing on the keyboard acts: Escape would close the window and Tab has nowhere to go.
  // A hung spot keeps Escape blocked too, so the only way out gives the attempt up.
  window.addEventListener(
    'keydown',
    (event) => {
      if (step.name !== 'wait') return
      if (event.key === 'Escape' || (event.key === 'Tab' && !step.hung)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    { capture: true, signal: listeners.signal },
  )

  const opened: OpenDialog = openDialog({
    labelledBy: skipTitleId,
    content: content(),
    returnFocusId: 'play-pause',
    onClosed: () => {
      // The window hands focus back to the pause button, but a skipped question has its result with Next by then.
      if (skipped) document.querySelector<HTMLElement>('[data-focus-id="play-next"]')?.focus()
      // Escape: the window closed itself, which acts like ×.
      if (dialog !== opened) return
      handlers.onClose()
    },
  })
  dialog = opened

  return {
    redraw() {
      dialog?.replaceContent(content())
    },
    close,
  }
}
