import type { CatalogCity, Locale } from '../content/types.ts'
import type { CityRunSummary } from '../game/logic/progress.ts'
import type { RunState } from '../game/logic/run.ts'
import { t } from '../i18n/index.ts'
import { element } from './element.ts'
import { starRating } from './stars.ts'
import { windowScreen } from './windowBar.ts'

export interface CitySummaryOptions {
  city: CatalogCity
  run: RunState
  summary: CityRunSummary
  unlockedCity: CatalogCity | null
  /** The city after this one in the catalog, `null` after the last city, when the map comes next. */
  nextCity: CatalogCity | null
  locale: Locale
  onNextCity(): void
  onMap(): void
  onPlayAgain(): void
  onClose(): void
  onHome(): void
}

export const citySummaryTitleId = 'city-summary-title'

/** The summary after the tenth Next: the same screen for every score, with the postcard sliding in when first earned. */
export function citySummaryScreen(options: CitySummaryOptions): HTMLElement {
  const { city, run, summary, unlockedCity, nextCity, locale } = options
  const next = element(
    'button',
    { class: 'primary', type: 'button', 'data-focus-id': 'summary-next' },
    t(nextCity ? 'summary.nextCity' : 'summary.map'),
  )
  next.addEventListener('click', nextCity ? options.onNextCity : options.onMap)
  const again = element('button', { class: 'secondary', type: 'button', 'data-focus-id': 'summary-again' }, t('city.playAgain'))
  again.addEventListener('click', options.onPlayAgain)

  const stats = element(
    'dl',
    { class: 'summary-stats' },
    element('div', {}, element('dt', {}, t('summary.score')), element('dd', {}, t('result.outOf', { count: run.correct, total: run.stops.length }))),
    element('div', {}, element('dt', {}, t('summary.bestStreak')), element('dd', {}, String(run.bestStreak))),
    element('div', {}, element('dt', {}, t('summary.stars')), element('dd', {}, starRating(summary.stars))),
  )
  const postcard = element(
    'figure',
    { class: 'summary-postcard', 'data-new': summary.postcardEarned },
    element('img', { class: 'postcard-art', src: `${import.meta.env.BASE_URL}${city.postcard.sceneAsset}`, alt: city.name[locale] }),
    element('figcaption', {}, t(summary.postcardEarned ? 'summary.newPostcard' : 'summary.postcard')),
  )
  const unlocked = unlockedCity ? [element('p', { class: 'summary-unlocked' }, t('summary.unlocked', { city: unlockedCity.name[locale] }))] : []

  return windowScreen({
    className: 'summary-screen',
    titleId: citySummaryTitleId,
    title: t('summary.title'),
    onClose: options.onClose,
    onHome: options.onHome,
    content: [
      element(
        'div',
        { class: 'summary' },
        postcard,
        element(
          'div',
          { class: 'summary-info' },
          element('h3', { class: 'summary-city' }, city.name[locale]),
          stats,
          ...unlocked,
          element('div', { class: 'window-actions' }, next, again),
        ),
      ),
    ],
  })
}
