import type { Catalog, CatalogCity, Locale } from '../content/types.ts'
import { unlockedCityIds, type Progress, type Stars } from '../game/logic/progress.ts'
import { plural, t } from '../i18n/index.ts'
import { element, icon } from './element.ts'
import { clusterCities, fullMapView, landPaths, project, type MapCluster, type MapView, type PlacedCity } from './europeMap.ts'
import { markMoreContent } from './moreContent.ts'
import { starRating } from './stars.ts'
import { windowBar, windowScreen } from './windowBar.ts'

export type CityState = 'locked' | 'unlocked' | 'completed'

export interface MapCity {
  city: CatalogCity
  state: CityState
  stars: Stars
  /** The city whose completion unlocks this one; `null` for the first city. */
  previous: CatalogCity | null
}

/** Every released city in catalog order with its state for the map, the list and the detail. */
export function mapCities(progress: Progress, catalog: Catalog): MapCity[] {
  const unlocked = new Set(unlockedCityIds(progress, catalog))
  const completed = new Set(progress.completedCityIds)
  return catalog.cities.map((city, index) => ({
    city,
    state: completed.has(city.id) ? 'completed' : unlocked.has(city.id) ? 'unlocked' : 'locked',
    stars: progress.bestStars[city.id] ?? 0,
    previous: index === 0 ? null : catalog.cities[index - 1],
  }))
}

export interface MapOptions {
  cities: MapCity[]
  locale: Locale
  /** `returnFocusId` is the point or list row that opened the detail. */
  onOpenCity(cityId: string, returnFocusId: string): void
  onClose(): void
  onHome(): void
}

export const mapTitleId = 'map-title'
/** Each click on a group shows at most this share of the current view, or the group itself when it is wider. */
const zoomStep = 4
const zoomMargin = 1.6

function stateLabel({ state, stars }: MapCity): string {
  if (state === 'completed') return `${t('city.completed')}, ${t('stars.spoken', { stars })}`
  return t(state === 'locked' ? 'city.locked' : 'city.unlocked')
}

/**
 * The city map: the schematic Europe with a target per city or per group of close cities, and below it (beside it in
 * landscape) the list of all cities in unlock order. A group zooms the map in; "Zoom out" shows the whole map again.
 */
export function mapScreen({ cities, locale, onOpenCity, onClose, onHome }: MapOptions): HTMLElement {
  const placed: PlacedCity[] = cities.map(({ city }) => ({ cityId: city.id, ...project(city.coordinates) }))
  const byId = new Map(cities.map((entry) => [entry.city.id, entry]))
  let view: MapView = fullMapView
  let drawnKey = ''

  const land = landPaths.map((path) => `<path class="map-land" d="${path}" />`).join('')
  const outline = element('div', { class: 'map-art', role: 'img', 'aria-label': t('map.label') })
  outline.innerHTML = `<svg viewBox="0 0 ${fullMapView.width} ${fullMapView.height}" aria-hidden="true">${land}</svg>`
  const svg = outline.querySelector('svg') as SVGSVGElement
  const points = element('div', { class: 'map-points' })
  const frame = element('div', { class: 'map-frame' }, outline, points)
  const tools = element('div', { class: 'map-tools' })

  function drawPoints(focusCityId?: string): void {
    const width = frame.clientWidth
    if (width === 0) return
    const target = parseFloat(getComputedStyle(frame).getPropertyValue('--hit-target'))
    const clusters = clusterCities(placed, view, { width, height: frame.clientHeight, target })
    const key = JSON.stringify([view, clusters])
    if (key === drawnKey && focusCityId === undefined) return
    drawnKey = key
    // Redrawn on resize too, so the focused target is found again by its city.
    const focusedId = document.activeElement instanceof HTMLElement && points.contains(document.activeElement) ? document.activeElement.dataset.cityIds : undefined
    points.replaceChildren(...clusters.map(pointButton))
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`)
    const zoomed = view !== fullMapView
    tools.replaceChildren(...(zoomed ? [zoomOutButton()] : []))
    const wanted = focusCityId ?? focusedId?.split(' ')[0]
    if (wanted) [...points.querySelectorAll<HTMLElement>('.map-point')].find((point) => point.dataset.cityIds?.split(' ').includes(wanted))?.focus()
  }

  function pointButton(cluster: MapCluster): HTMLButtonElement {
    const single = cluster.cityIds.length === 1
    const entries = cluster.cityIds.map((cityId) => byId.get(cityId) as MapCity)
    const label = single
      ? t('map.point', { city: entries[0].city.name[locale], state: stateLabel(entries[0]) })
      : plural('map.cluster', entries.length, { cities: entries.map(({ city }) => city.name[locale]).join(', ') })
    const focusId = `map-point-${cluster.cityIds[0]}`
    const dot = single
      ? element('span', { class: 'map-dot', 'aria-hidden': 'true' }, ...(entries[0].state === 'completed' ? [icon('check')] : []))
      : element('span', { class: 'map-dot', 'aria-hidden': 'true' }, String(entries.length))
    const button = element(
      'button',
      {
        class: single ? 'map-point' : 'map-point map-cluster',
        type: 'button',
        'aria-label': label,
        'data-state': single ? entries[0].state : undefined,
        'data-city-ids': cluster.cityIds.join(' '),
        'data-focus-id': focusId,
      },
      dot,
    )
    button.style.left = `${cluster.x}px`
    button.style.top = `${cluster.y}px`
    button.addEventListener('click', () => (single ? onOpenCity(cluster.cityIds[0], focusId) : zoomTo(cluster)))
    return button
  }

  function zoomTo(cluster: MapCluster): void {
    const members = placed.filter((city) => cluster.cityIds.includes(city.cityId))
    const xs = members.map((city) => city.x)
    const ys = members.map((city) => city.y)
    const aspect = fullMapView.width / fullMapView.height
    const width = Math.min(
      fullMapView.width,
      Math.max(view.width / zoomStep, (Math.max(...xs) - Math.min(...xs)) * zoomMargin, (Math.max(...ys) - Math.min(...ys)) * zoomMargin * aspect),
    )
    const height = width / aspect
    const centreX = (Math.max(...xs) + Math.min(...xs)) / 2
    const centreY = (Math.max(...ys) + Math.min(...ys)) / 2
    view = {
      x: Math.min(Math.max(centreX - width / 2, 0), fullMapView.width - width),
      y: Math.min(Math.max(centreY - height / 2, 0), fullMapView.height - height),
      width,
      height,
    }
    drawPoints(cluster.cityIds[0])
  }

  function zoomOutButton(): HTMLButtonElement {
    const button = element('button', { class: 'secondary map-zoom-out', type: 'button', 'data-focus-id': 'map-zoom-out' }, t('map.zoomOut'))
    const shownCityId = points.querySelector<HTMLElement>('.map-point')?.dataset.cityIds?.split(' ')[0]
    button.addEventListener('click', () => {
      view = fullMapView
      drawPoints(shownCityId)
    })
    return button
  }

  new ResizeObserver(() => drawPoints()).observe(frame)

  const rows = cities.map((entry, index) => {
    const focusId = `map-city-${entry.city.id}`
    const row = element(
      'button',
      { class: 'city-row', type: 'button', 'data-state': entry.state, 'data-focus-id': focusId },
      element('span', { class: 'city-number', 'aria-hidden': 'true' }, String(index + 1)),
      element('span', { class: 'city-name' }, entry.city.name[locale]),
      element(
        'span',
        { class: 'city-state' },
        ...(entry.state === 'locked' ? [icon('lock', { class: 'city-state-icon' })] : []),
        element('span', {}, t(`city.${entry.state}`)),
        ...(entry.state === 'completed' ? [starRating(entry.stars)] : []),
      ),
    )
    row.addEventListener('click', () => onOpenCity(entry.city.id, focusId))
    return element('li', {}, row)
  })
  const list = element(
    'section',
    { class: 'map-list', 'aria-labelledby': 'map-list-title' },
    tools,
    element('h3', { id: 'map-list-title', class: 'section-title' }, t('map.list')),
    element('ol', { class: 'city-list' }, ...rows),
  )
  // In landscape the list scrolls beside the map on its own.
  markMoreContent(list)

  return windowScreen({
    className: 'map-screen',
    titleId: mapTitleId,
    title: t('map.title'),
    onClose,
    onHome,
    content: [element('div', { class: 'map-layout' }, frame, list)],
  })
}

export interface CityDetailOptions {
  entry: MapCity
  locale: Locale
  /** The active run is a city run of this city: the detail offers "Continue" instead. */
  hasActiveRunHere: boolean
  onPlay(): void
  onContinue(): void
  onClose(): void
  onHome(): void
}

export const cityDetailTitleId = 'city-detail-title'

/** The modal detail of a city: the unlock condition when locked, else the postcard scene, best stars and the play action. */
export function cityDetailWindow({ entry, locale, hasActiveRunHere, onPlay, onContinue, onClose, onHome }: CityDetailOptions): HTMLElement[] {
  const { city, state, stars, previous } = entry
  const bar = windowBar({ titleId: cityDetailTitleId, title: city.name[locale], onClose, onHome })
  if (state === 'locked' && previous) {
    const body = element(
      'div',
      { class: 'window-body' },
      element(
        'div',
        { class: 'city-detail is-locked' },
        icon('lock', { class: 'city-detail-lock' }),
        element('p', { class: 'city-condition' }, t('city.condition', { city: previous.name[locale] })),
      ),
    )
    return [bar, body]
  }

  const action = hasActiveRunHere ? 'continue' : state === 'completed' ? 'playAgain' : 'play'
  const play = element('button', { class: 'primary city-play', type: 'button', autofocus: true, 'data-focus-id': 'city-play' }, t(`city.${action}`))
  play.addEventListener('click', hasActiveRunHere ? onContinue : onPlay)
  const best =
    state === 'completed'
      ? element('p', { class: 'city-best' }, element('span', {}, t('city.best')), starRating(stars))
      : element('p', { class: 'city-best' }, t('city.notPlayed'))
  const body = element(
    'div',
    { class: 'window-body' },
    element(
      'div',
      { class: 'city-detail' },
      element('img', { class: 'postcard-art', src: `${import.meta.env.BASE_URL}${city.postcard.sceneAsset}`, alt: city.name[locale] }),
      element('div', { class: 'city-detail-info' }, best, ...(hasActiveRunHere ? [element('p', { class: 'city-note' }, t('city.inProgress'))] : []), play),
    ),
  )
  markMoreContent(body)
  return [bar, body]
}
