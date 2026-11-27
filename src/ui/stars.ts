import type { Stars } from '../game/logic/progress.ts'
import { t } from '../i18n/index.ts'
import { element } from './element.ts'

const maxStars = 3

/** Stars as symbols for the eye and as words for a screen reader, so the rating never depends on colour. */
export function starRating(stars: Stars): HTMLSpanElement {
  return element(
    'span',
    { class: 'star-rating' },
    element('span', { 'aria-hidden': 'true' }, '★'.repeat(stars) + '☆'.repeat(maxStars - stars)),
    element('span', { class: 'visually-hidden' }, t('stars.spoken', { stars })),
  )
}
