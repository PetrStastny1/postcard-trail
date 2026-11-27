import { t } from '../../i18n/index.ts'
import { element, icon } from '../../ui/element.ts'
import { windowBar } from '../../ui/windowBar.ts'

export const pauseTitleId = 'pause-title'
export const zoomTitleId = 'zoom-title'
export const elsewhereTitleId = 'elsewhere-title'

export interface PauseHandlers {
  onContinue(): void
  onSettings(): void
  onHome(): void
  /** Present only while the skip lifeline can be used and the portal offers rewarded spots. */
  onSkip: (() => void) | null
}

/** The pause window: × and Continue go back to the question, Home saves and leaves. */
export function pauseWindow({ onContinue, onSettings, onHome, onSkip }: PauseHandlers): HTMLElement[] {
  const resume = element('button', { class: 'primary', type: 'button', autofocus: true, 'data-focus-id': 'pause-continue' }, t('pause.continue'))
  resume.addEventListener('click', onContinue)
  const settings = element('button', { class: 'secondary', type: 'button', 'data-focus-id': 'pause-settings' }, t('pause.settings'))
  settings.addEventListener('click', onSettings)
  const actions = element('div', { class: 'pause-actions' }, resume)
  if (onSkip) {
    const skip = element('button', { class: 'secondary pause-skip', type: 'button', 'data-focus-id': 'pause-skip' }, icon('video', { class: 'skip-play-icon' }), t('pause.skip'))
    skip.addEventListener('click', onSkip)
    actions.append(skip)
  }
  actions.append(settings)
  return [
    windowBar({ titleId: pauseTitleId, title: t('pause.title'), onClose: onContinue, onHome }),
    element('div', { class: 'window-body' }, actions),
  ]
}

/** The scene over the whole available area; × and Escape return to the same question, Home saves and leaves. */
export function zoomWindow({ image, caption, onClose, onHome }: { image: HTMLImageElement; caption: string | null; onClose(): void; onHome(): void }): HTMLElement[] {
  const enlarged = image.cloneNode() as HTMLImageElement
  enlarged.className = 'zoom-art'
  return [
    windowBar({ titleId: zoomTitleId, title: t('zoom.title'), onClose, onHome }),
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
  const home = element('button', { class: 'primary', type: 'button', autofocus: true, 'data-focus-id': 'elsewhere-home' }, t('window.home'))
  home.addEventListener('click', onHome)
  return [
    windowBar({ titleId: elsewhereTitleId, title: t('elsewhere.title'), onClose: onHome, onHome }),
    element('div', { class: 'window-body' }, element('div', { class: 'elsewhere-body' }, element('p', { class: 'elsewhere-text' }, t('elsewhere.text')), home)),
  ]
}
