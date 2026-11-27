import { t } from '../../i18n/index.ts'
import { element, icon } from '../../ui/element.ts'
import { windowBar } from '../../ui/windowBar.ts'

export const skipTitleId = 'skip-title'

export interface SkipWindowHandlers {
  /** × and Escape: back to the pause. */
  onClose(): void
  /** Home: saves the run and goes to the title. */
  onHome(): void
  /** "Back to the answer": the question runs again from its paused time. */
  onBack(): void
}

function backButton(className: string, onBack: () => void): HTMLButtonElement {
  const back = element('button', { class: className, type: 'button', 'data-focus-id': 'skip-back' }, t('skip.back'))
  back.addEventListener('click', onBack)
  return back
}

/** Brief §10: the sentence about the result and two equal amber buttons, "Back to the answer" first. */
export function skipConfirmWindow({ onClose, onHome, onBack, onPlay }: SkipWindowHandlers & { onPlay(): void }): HTMLElement[] {
  const back = backButton('primary', onBack)
  back.autofocus = true
  const play = element('button', { class: 'primary skip-play', type: 'button', 'data-focus-id': 'skip-play' }, icon('video', { class: 'skip-play-icon' }), t('skip.play'))
  play.addEventListener('click', onPlay)
  return [
    windowBar({ titleId: skipTitleId, title: t('skip.title'), onClose, onHome }),
    element('div', { class: 'window-body' }, element('div', { class: 'skip-body' }, element('p', { class: 'skip-text' }, t('skip.confirm')), element('div', { class: 'skip-actions' }, back, play))),
  ]
}

/**
 * Input is blocked while the spot is requested and plays, so the window has no × or Home. It looks like the scene
 * loading state. Only a spot that never answers gets the quiet way back (decision in LOG.md); its row is kept empty
 * until then, so the window does not jump when it appears.
 */
export function skipWaitWindow({ hung, onBack }: { hung: boolean; onBack(): void }): HTMLElement[] {
  const status = element('p', { class: 'skip-text skip-wait-text', role: 'status', tabindex: '-1', 'data-focus-id': 'skip-wait' }, t('skip.loading'))
  return [
    element('header', { class: 'window-bar skip-wait-bar' }, element('h2', { id: skipTitleId, class: 'window-title' }, t('skip.title'))),
    element(
      'div',
      { class: 'window-body' },
      element(
        'div',
        { class: 'skip-body skip-wait' },
        element('span', { class: 'scene-loading-bar', 'aria-hidden': 'true' }),
        status,
        element('div', { class: 'skip-actions skip-wait-actions' }, ...(hung ? [backButton('secondary', onBack)] : [])),
      ),
    ),
  ]
}

/** A spot that was cancelled or not available: the question and the lifeline stay. */
export function skipOutcomeWindow({ outcome, onClose, onHome, onBack }: SkipWindowHandlers & { outcome: 'cancelled' | 'unavailable' }): HTMLElement[] {
  return [
    windowBar({ titleId: skipTitleId, title: t('skip.title'), onClose, onHome }),
    element(
      'div',
      { class: 'window-body' },
      element('div', { class: 'skip-body' }, element('p', { class: 'skip-text', role: 'status' }, t(`skip.${outcome}`)), element('div', { class: 'skip-actions' }, backButton('primary', onBack))),
    ),
  ]
}
