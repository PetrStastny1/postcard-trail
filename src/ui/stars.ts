import type { Stars } from '../game/logic/progress.ts'
import { t } from '../i18n/index.ts'
import { element } from './element.ts'

const maxStars = 3

/**
 * Stars as symbols for the eye and as words for a screen reader, so the rating never depends on colour.
 * `withCount` adds a visible "2/3" beside the symbols where the rating is the main fact (summary, city detail).
 */
export function starRating(stars: Stars, { withCount = false } = {}): HTMLSpanElement {
  return element(
    'span',
    { class: 'star-rating' },
    element('span', { 'aria-hidden': 'true' }, '★'.repeat(stars) + '☆'.repeat(maxStars - stars)),
    ...(withCount ? [element('span', { class: 'star-count', 'aria-hidden': 'true' }, t('result.outOf', { count: stars, total: maxStars }))] : []),
    element('span', { class: 'visually-hidden' }, t('stars.spoken', { stars })),
  )
}
