import { t } from '../i18n/index.ts'
import { element, iconButton } from './element.ts'

export interface WindowBarOptions {
  titleId: string
  title: string
  onClose(): void
  onHome(): void
}

/** The top bar every window except the title screen has: × on the left, the name, Home on the right. */
export function windowBar({ titleId, title, onClose, onHome }: WindowBarOptions): HTMLElement {
  const close = iconButton('close', t('window.close'), { 'data-focus-id': 'window-close' })
  close.addEventListener('click', onClose)
  const home = element('button', { class: 'window-home', type: 'button', 'data-focus-id': 'window-home' }, t('window.home'))
  home.addEventListener('click', onHome)
  return element('header', { class: 'window-bar' }, close, element('h2', { id: titleId, class: 'window-title' }, title), home)
}
