import { t } from '../i18n/index.ts'
import { element, iconButton } from './element.ts'

/** A bar in the page flow above the screen, so it pushes the controls down instead of covering them. */
export function storageNotice(onDismiss: () => void): HTMLElement {
  const dismiss = iconButton('close', t('storage.dismiss'), { 'data-focus-id': 'storage-dismiss' })
  dismiss.addEventListener('click', onDismiss)
  return element('div', { class: 'storage-notice', role: 'status' }, element('p', {}, t('storage.notice')), dismiss)
}
