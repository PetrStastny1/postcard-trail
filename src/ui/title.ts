import type { ProgressTotals } from '../game/logic/progress.ts'
import { plural, t } from '../i18n/index.ts'
import { element } from './element.ts'
import { markMoreContent } from './moreContent.ts'
import { titleScene } from './titleScene.ts'

export interface TitleOptions {
  totals: ProgressTotals
  dailyUnlocked: boolean
  /** A saved run exists: "Continue" takes the place of "Play". */
  hasActiveRun: boolean
  onPlay(): void
  onContinue(): void
  onOpenSettings(): void
  onOpenMap(): void
  onOpenCollection(): void
  /** Called only once the daily challenge is unlocked; before that the tile does nothing. */
  onOpenDaily(): void
}

// Same markup as the static logo in index.html, so the loading screen and the title show the same logo; keep them in sync.
const logoMarkup = `<svg class="logo-arc" viewBox="0 0 240 60" aria-hidden="true"><path d="M12 56 Q120 -22 228 56" /></svg>
<span class="logo-line">Postcard</span> <span class="logo-line">Trail</span>`

/** The title screen: Play or Continue, then the map, settings, the collection and the daily challenge. */
export function titleScreen({ totals, dailyUnlocked, hasActiveRun, onPlay, onContinue, onOpenSettings, onOpenMap, onOpenCollection, onOpenDaily }: TitleOptions): HTMLElement {
  const logo = element('h1', { class: 'logo' })
  logo.innerHTML = logoMarkup

  const play = element('button', { class: 'primary title-play', type: 'button', 'data-focus-id': 'title-play' }, t(hasActiveRun ? 'title.continue' : 'title.play'))
  play.addEventListener('click', hasActiveRun ? onContinue : onPlay)
  const settings = secondaryButton('title-settings', t('title.settings'))
  settings.addEventListener('click', onOpenSettings)
  const map = secondaryButton('title-map', t('title.map'))
  map.addEventListener('click', onOpenMap)
  const collection = secondaryButton('title-collection', t('title.collection'))
  collection.addEventListener('click', onOpenCollection)

  // The condition sits under the tile as the button's description only; hidden from the name, so a screen reader reads it once.
  const daily = element(
    'button',
    {
      class: 'secondary title-daily',
      type: 'button',
      'data-focus-id': 'title-daily',
      'data-locked': !dailyUnlocked,
      'aria-disabled': dailyUnlocked ? undefined : 'true',
      'aria-describedby': dailyUnlocked ? undefined : 'title-daily-condition',
    },
    t('title.daily'),
  )
  if (dailyUnlocked) daily.addEventListener('click', onOpenDaily)
  const dailyCondition = dailyUnlocked
    ? []
    : [
        element(
          'div',
          { class: 'title-daily-note', 'aria-hidden': 'true' },
          element('p', { id: 'title-daily-condition', class: 'title-daily-condition' }, t('title.dailyLocked')),
        ),
      ]

  const progress = element(
    'ul',
    { class: 'title-progress', 'aria-label': t('title.progress') },
    element('li', {}, plural('title.cities', totals.releasedCities, { done: totals.completedCities, total: totals.releasedCities })),
    element(
      'li',
      {},
      element('span', { 'aria-hidden': 'true' }, t('title.stars', { stars: totals.stars, max: totals.maxStars })),
      element('span', { class: 'visually-hidden' }, t('title.starsSpoken', { stars: totals.stars, max: totals.maxStars })),
    ),
    element('li', {}, plural('title.postcards', totals.postcards)),
  )

  const menu = element(
    'div',
    { class: 'title-menu' },
    map,
    settings,
    collection,
    daily,
  )

  // In landscape the panel scrolls on its own when a short viewport cannot hold it.
  const panel = element('div', { class: 'title-panel' }, play, menu, ...dailyCondition, progress)
  markMoreContent(panel)

  return element('main', { class: 'title' }, logo, titleScene(), panel)
}

function secondaryButton(focusId: string, label: string): HTMLButtonElement {
  return element('button', { class: 'secondary', type: 'button', 'data-focus-id': focusId }, label)
}
