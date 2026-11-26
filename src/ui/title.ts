import type { ProgressTotals } from '../game/logic/progress.ts'
import { plural, t } from '../i18n/index.ts'
import { element } from './element.ts'
import { markMoreContent } from './moreContent.ts'
import { titleScene } from './titleScene.ts'

export interface TitleOptions {
  totals: ProgressTotals
  dailyUnlocked: boolean
  onOpenSettings(): void
}

// Same markup as the static logo in index.html, so the loading screen and the title show the same logo; keep them in sync.
const logoMarkup = `<svg class="logo-arc" viewBox="0 0 240 60" aria-hidden="true"><path d="M12 56 Q120 -22 228 56" /></svg>
<span class="logo-line">Postcard</span> <span class="logo-line">Trail</span>`

/**
 * The title screen. Play, the map, the collection and the daily challenge are wired by the later packages;
 * until then only Settings opens a window.
 */
export function titleScreen({ totals, dailyUnlocked, onOpenSettings }: TitleOptions): HTMLElement {
  const logo = element('h1', { class: 'logo' })
  logo.innerHTML = logoMarkup

  const play = element('button', { class: 'primary title-play', type: 'button', 'data-focus-id': 'title-play' }, t('title.play'))
  const settings = secondaryButton('title-settings', t('title.settings'))
  settings.addEventListener('click', onOpenSettings)

  // The condition sits under the menu as the button's description only; hidden from the name, so a screen reader reads it once.
  const daily = element(
    'button',
    {
      class: 'secondary title-daily',
      type: 'button',
      'data-focus-id': 'title-daily',
      'data-locked': !dailyUnlocked,
      'aria-describedby': dailyUnlocked ? undefined : 'title-daily-condition',
    },
    t('title.daily'),
  )
  const dailyCondition = dailyUnlocked
    ? []
    : [element('p', { id: 'title-daily-condition', class: 'title-daily-condition', 'aria-hidden': 'true' }, t('title.dailyLocked'))]

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
    secondaryButton('title-map', t('title.map')),
    settings,
    secondaryButton('title-collection', t('title.collection')),
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
