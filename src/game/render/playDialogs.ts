import { t } from '../../i18n/index.ts'
import { element, iconButton } from '../../ui/element.ts'
import { windowBar } from '../../ui/windowBar.ts'

export const pauseTitleId = 'pause-title'
export const zoomTitleId = 'zoom-title'
export const elsewhereTitleId = 'elsewhere-title'

/** The pause window: × and Continue go back to the question, Home saves and leaves. */
export function pauseWindow({ onContinue, onSettings, onHome }: { onContinue(): void; onSettings(): void; onHome(): void }): HTMLElement[] {
  const resume = element('button', { class: 'primary', type: 'button', autofocus: true, 'data-focus-id': 'pause-continue' }, t('pause.continue'))
  resume.addEventListener('click', onContinue)
  const settings = element('button', { class: 'secondary', type: 'button', 'data-focus-id': 'pause-settings' }, t('pause.settings'))
  settings.addEventListener('click', onSettings)
  return [
    windowBar({ titleId: pauseTitleId, title: t('pause.title'), onClose: onContinue, onHome }),
    element('div', { class: 'window-body' }, element('div', { class: 'pause-actions' }, resume, settings)),
  ]
}

/** The scene over the whole available area; × and Escape return to the same question. */
export function zoomWindow({ image, caption, onClose }: { image: HTMLImageElement; caption: string | null; onClose(): void }): HTMLElement[] {
  const close = iconButton('close', t('window.close'), { 'data-focus-id': 'window-close' })
  close.addEventListener('click', onClose)
  const enlarged = image.cloneNode() as HTMLImageElement
  enlarged.className = 'zoom-art'
  return [
    element('header', { class: 'window-bar' }, close, element('h2', { id: zoomTitleId, class: 'window-title' }, t('zoom.title'))),
    element(
      'figure',
      { class: 'zoom-scene' },
      enlarged,
      ...(caption === null ? [] : [element('figcaption', { class: 'scene-caption', 'aria-hidden': 'true' }, caption)]),
    ),
  ]
}

/** Another tab resumed the run: this tab stops and only offers the way home. */
export function elsewhereWindow({ onHome }: { onHome(): void }): HTMLElement[] {
  return [
    windowBar({ titleId: elsewhereTitleId, title: t('elsewhere.title'), onClose: onHome, onHome }),
    element('div', { class: 'window-body' }, element('p', { class: 'elsewhere-text' }, t('elsewhere.text'))),
  ]
}
