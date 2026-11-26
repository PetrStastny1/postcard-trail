import type { ProgressTotals } from '../game/logic/progress.ts'
import { plural, t } from '../i18n/index.ts'
import { element } from './element.ts'
import { titleScene } from './titleScene.ts'

export interface TitleOptions {
  totals: ProgressTotals
  onOpenSettings(): void
}

// Same markup as the static logo in index.html, so the loading screen turns into the title without a jump.
const logoMarkup = `<svg class="logo-arc" viewBox="0 0 240 60" aria-hidden="true"><path d="M12 56 Q120 -22 228 56" /></svg>
<span class="logo-line">Postcard</span> <span class="logo-line">Trail</span>`

/**
 * The title screen. Play, the map, the collection and the daily challenge are wired by the later packages;
 * until then only Settings opens a window.
 */
export function titleScreen({ totals, onOpenSettings }: TitleOptions): HTMLElement {
  const logo = element('h1', { class: 'logo' })
  logo.innerHTML = logoMarkup

  const play = element('button', { class: 'primary title-play', type: 'button', 'data-focus-id': 'title-play' }, t('title.play'))
  const settings = secondaryButton('title-settings', t('title.settings'))
  settings.addEventListener('click', onOpenSettings)

  const dailyUnlocked = totals.completedCities > 0
  const daily = element(
    'button',
    { class: 'secondary title-daily', type: 'button', 'data-focus-id': 'title-daily', 'aria-describedby': dailyUnlocked ? undefined : 'title-daily-condition' },
    element('span', { class: 'title-daily-name' }, t('title.daily')),
    ...(dailyUnlocked ? [] : [element('span', { id: 'title-daily-condition', class: 'title-daily-condition' }, t('title.dailyLocked'))]),
  )

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

  return element(
    'main',
    { class: 'title' },
    titleScene(),
    element('div', { class: 'title-panel' }, logo, play, menu, progress),
  )
}

function secondaryButton(focusId: string, label: string): HTMLButtonElement {
  return element('button', { class: 'secondary', type: 'button', 'data-focus-id': focusId }, label)
}
