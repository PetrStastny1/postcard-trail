import { t } from '../i18n/index.ts'
import { element } from './element.ts'
import { windowBar } from './windowBar.ts'

/** The question in the body names the dialog; the bar keeps a short name that fits a narrow phone. */
export const routeChangeTitleId = 'route-change-title'

/** Brief §3: one active run per device. Keep and × return to the window the choice came from, Home keeps the run too. */
export function routeChangeWindow({ onKeep, onDiscard, onHome }: { onKeep(): void; onDiscard(): void; onHome(): void }): HTMLElement[] {
  const keep = element('button', { class: 'primary', type: 'button', autofocus: true, 'data-focus-id': 'change-keep' }, t('change.keep'))
  keep.addEventListener('click', onKeep)
  const discard = element('button', { class: 'secondary', type: 'button', 'data-focus-id': 'change-discard' }, t('change.discard'))
  discard.addEventListener('click', onDiscard)
  return [
    windowBar({ titleId: 'route-change-bar', title: t('change.bar'), onClose: onKeep, onHome }),
    element(
      'div',
      { class: 'window-body' },
      element(
        'div',
        { class: 'route-change' },
        element('h3', { id: routeChangeTitleId, class: 'route-change-title' }, t('change.title')),
        element('p', { class: 'route-change-text' }, t('change.text')),
        element('div', { class: 'window-actions' }, keep, discard),
      ),
    ),
  ]
}
