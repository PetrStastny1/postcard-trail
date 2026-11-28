import { t, type MessageKey } from '../i18n/index.ts'
import { element, iconButton } from './element.ts'

/**
 * A bar in the page flow above the screen, so it pushes the controls down instead of covering them. It tells the
 * player that the browser is not saving (`storage.notice`) or that a saved route could not be restored.
 */
export function storageNotice(message: MessageKey, focusId: string, onDismiss: () => void): HTMLElement {
  const dismiss = iconButton('close', t('storage.dismiss'), { 'data-focus-id': focusId })
  dismiss.addEventListener('click', onDismiss)
  return element('div', { class: 'storage-notice', role: 'status' }, element('p', {}, t(message)), dismiss)
}
