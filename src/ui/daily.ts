import type { CatalogCity, Locale } from '../content/types.ts'
import { plural, t } from '../i18n/index.ts'
import { element } from './element.ts'
import { windowScreen } from './windowBar.ts'

/**
 * `notOffered` before the first catalog version is effective, `inProgress` while a daily run is saved (whatever its
 * date, since a result belongs to the day it started), `done` once today has a result, else `available`.
 */
export type DailyOverviewState =
  | { status: 'notOffered'; firstUtcDate: string }
  | { status: 'available'; city: CatalogCity }
  | { status: 'inProgress'; city: CatalogCity }
  | { status: 'done'; city: CatalogCity; correct: number }

export interface DailyOverviewOptions {
  utcDate: string
  state: DailyOverviewState
  streak: number
  locale: Locale
  onStart(): void
  onContinue(): void
  onClose(): void
  onHome(): void
}

export const dailyTitleId = 'daily-title'
const dailyStopCount = 3

/** A `YYYY-MM-DD` UTC date in the player's language, never shifted by the local time zone. */
function formatUtcDate(utcDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(Date.parse(`${utcDate}T00:00:00Z`))
}

/** Today's score: `null` before any answer, `inProgress` while the run is saved. */
function dailyStats(correct: number | null | 'inProgress', streak: number): HTMLElement {
  return element(
    'dl',
    { class: 'summary-stats' },
    element(
      'div',
      {},
      element('dt', {}, t('daily.score')),
      element(
        'dd',
        {},
        correct === null ? t('daily.notPlayed') : correct === 'inProgress' ? t('daily.scoreInProgress') : t('result.outOf', { count: correct, total: dailyStopCount }),
      ),
    ),
    element('div', {}, element('dt', {}, t('daily.streak')), element('dd', {}, plural('daily.days', streak))),
  )
}

/**
 * The daily overview: the UTC date as a label, the city of the day as the heading, the state, today's score and the
 * day streak, with Start or Continue.
 */
export function dailyScreen({ utcDate, state, streak, locale, onStart, onContinue, onClose, onHome }: DailyOverviewOptions): HTMLElement {
  const heading = state.status === 'notOffered' ? t('daily.notOfferedTitle') : state.city.name[locale]
  const content: HTMLElement[] = [
    element(
      'div',
      { class: 'daily-head' },
      element('p', { class: 'daily-date' }, t('daily.date', { date: formatUtcDate(utcDate, locale) })),
      element('h3', { class: 'daily-city' }, heading),
    ),
  ]
  if (state.status === 'notOffered') {
    content.push(element('p', { class: 'daily-state' }, t('daily.notOffered', { date: formatUtcDate(state.firstUtcDate, locale) })))
  } else {
    const message =
      state.status === 'available'
        ? t('daily.available', { city: state.city.name[locale] })
        : t(state.status === 'inProgress' ? 'daily.inProgress' : 'daily.done')
    const correct = state.status === 'done' ? state.correct : state.status === 'inProgress' ? 'inProgress' : null
    content.push(element('p', { class: 'daily-state' }, message), dailyStats(correct, streak))
    if (state.status === 'available' || state.status === 'inProgress') {
      const start = state.status === 'available'
      const action = element('button', { class: 'primary', type: 'button', 'data-focus-id': 'daily-start' }, t(start ? 'daily.start' : 'daily.continue'))
      action.addEventListener('click', start ? onStart : onContinue)
      content.push(element('div', { class: 'window-actions' }, action))
    }
  }
  return windowScreen({
    className: 'daily-screen',
    titleId: dailyTitleId,
    title: t('daily.title'),
    onClose,
    onHome,
    content: [element('div', { class: 'daily' }, ...content)],
  })
}

export interface DailySummaryOptions {
  city: CatalogCity
  locale: Locale
  correct: number
  streak: number
  onOverview(): void
  onClose(): void
  onHome(): void
}

export const dailySummaryTitleId = 'daily-summary-title'

/** After the third Next: the city, the score and the day streak; the daily challenge changes no stars, postcards or unlocks. */
export function dailySummaryScreen({ city, locale, correct, streak, onOverview, onClose, onHome }: DailySummaryOptions): HTMLElement {
  const overview = element('button', { class: 'primary', type: 'button', 'data-focus-id': 'daily-summary-overview' }, t('daily.title'))
  overview.addEventListener('click', onOverview)
  const home = element('button', { class: 'secondary', type: 'button', 'data-focus-id': 'daily-summary-home' }, t('window.home'))
  home.addEventListener('click', onHome)
  return windowScreen({
    className: 'daily-screen',
    titleId: dailySummaryTitleId,
    title: t('dailySummary.title'),
    onClose,
    onHome,
    content: [
      element(
        'div',
        { class: 'daily' },
        element('h3', { class: 'daily-city' }, city.name[locale]),
        dailyStats(correct, streak),
        element('div', { class: 'window-actions' }, overview, home),
      ),
    ],
  })
}
