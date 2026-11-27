import type { Catalog, CatalogCity, Locale } from '../content/types.ts'
import { t } from '../i18n/index.ts'
import { element } from './element.ts'
import { markMoreContent } from './moreContent.ts'
import { windowBar, windowScreen } from './windowBar.ts'

export interface CollectionOptions {
  catalog: Catalog
  postcardCityIds: string[]
  locale: Locale
  /** `returnFocusId` is the card that opened the detail. */
  onOpenCard(cityId: string, returnFocusId: string): void
  onClose(): void
  onHome(): void
}

export const collectionTitleId = 'collection-title'

const postcardSrc = (city: CatalogCity) => `${import.meta.env.BASE_URL}${city.postcard.sceneAsset}`

/** One place per released city in catalog order; a place not yet earned gives away only the city name. */
export function collectionScreen({ catalog, postcardCityIds, locale, onOpenCard, onClose, onHome }: CollectionOptions): HTMLElement {
  const earned = new Set(postcardCityIds)
  const count = catalog.cities.filter((city) => earned.has(city.id)).length
  const cards = catalog.cities.map((city) => {
    const name = city.name[locale]
    if (!earned.has(city.id)) {
      return element(
        'li',
        { class: 'postcard-slot is-missing' },
        element('span', { class: 'postcard-blank', 'aria-hidden': 'true' }),
        element('span', { class: 'postcard-name' }, name, element('span', { class: 'visually-hidden' }, `, ${t('collection.missing')}`)),
      )
    }
    const focusId = `collection-card-${city.id}`
    const card = element(
      'button',
      { class: 'postcard-card', type: 'button', 'data-focus-id': focusId },
      element('img', { class: 'postcard-art', src: postcardSrc(city), alt: '', loading: 'lazy' }),
      element('span', { class: 'postcard-name' }, name),
    )
    card.addEventListener('click', () => onOpenCard(city.id, focusId))
    return element('li', { class: 'postcard-slot' }, card)
  })
  return windowScreen({
    className: 'collection-screen',
    titleId: collectionTitleId,
    title: t('collection.title'),
    onClose,
    onHome,
    content: [
      element(
        'div',
        { class: 'collection' },
        element('p', { class: 'collection-count' }, t('collection.count', { count, total: catalog.cities.length })),
        ...(count === 0 ? [element('p', { class: 'collection-empty' }, t('collection.empty'))] : []),
        element('ul', { class: 'postcard-grid' }, ...cards),
      ),
    ],
  })
}

export const postcardTitleId = 'postcard-title'

/** The card detail: the illustration, the city and the sentence of the stop the illustration comes from. */
export function postcardWindow({ city, locale, onClose, onHome }: { city: CatalogCity; locale: Locale; onClose(): void; onHome(): void }): HTMLElement[] {
  const body = element(
    'div',
    { class: 'window-body' },
    element(
      'figure',
      { class: 'postcard-detail' },
      element('img', { class: 'postcard-art', src: postcardSrc(city), alt: city.name[locale] }),
      element('figcaption', { class: 'postcard-sentence' }, city.postcard.sentence[locale]),
    ),
  )
  markMoreContent(body)
  return [windowBar({ titleId: postcardTitleId, title: city.name[locale], onClose, onHome }), body]
}
