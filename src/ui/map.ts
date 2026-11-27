import type { Catalog, CatalogCity, Locale } from '../content/types.ts'
import { unlockedCityIds, type Progress, type Stars } from '../game/logic/progress.ts'
import { plural, t } from '../i18n/index.ts'
import { element, icon } from './element.ts'
import { clusterCities, fullMapView, landPaths, project, zoomView, type MapCluster, type MapView, type PlacedCity } from './europeMap.ts'
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
    const target = cssPixels('--hit-target')
    const clusters = clusterCities(placed, view, { width, height: frame.clientHeight, target })
    const key = JSON.stringify([view, clusters])
    if (key === drawnKey && focusCityId === undefined) return
    drawnKey = key
    // Redrawn on resize too, so the focused target is found again by its city.
    const focusedId = document.activeElement instanceof HTMLElement && points.contains(document.activeElement) ? document.activeElement.dataset.cityIds : undefined
    points.replaceChildren(...clusters.map(pointButton))
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`)
    const zoomed = view !== fullMapView
    if (zoomed) labelPoints(clusters)
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

  function cssPixels(token: string): number {
    return parseFloat(getComputedStyle(frame).getPropertyValue(token))
  }

  function zoomTo(cluster: MapCluster): void {
    const members = placed.filter((city) => cluster.cityIds.includes(city.cityId))
    view = zoomView(members, view, { width: frame.clientWidth, spacing: cssPixels('--hit-target') + cssPixels('--space-2') })
    drawPoints(cluster.cityIds[0])
  }

  /**
   * Zoomed in, each single city gets its name beside the dot: right, left, below or above, whichever stays inside the
   * map and clear of every dot and earlier name. A name that fits nowhere is left out; the target still says it.
   */
  function labelPoints(clusters: MapCluster[]): void {
    const origin = points.getBoundingClientRect()
    const relative = (rect: DOMRect) => ({ left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top })
    const taken = [...points.querySelectorAll('.map-dot')].map((dot) => relative(dot.getBoundingClientRect()))
    const offset = cssPixels('--space-6') / 2 + cssPixels('--space-1')
    for (const cluster of clusters) {
      if (cluster.cityIds.length > 1) continue
      const label = element('span', { class: 'map-label', 'aria-hidden': 'true' }, (byId.get(cluster.cityIds[0]) as MapCity).city.name[locale])
      points.append(label)
      const { width, height } = label.getBoundingClientRect()
      const spots = [
        { left: cluster.x + offset, top: cluster.y - height / 2 },
        { left: cluster.x - offset - width, top: cluster.y - height / 2 },
        { left: cluster.x - width / 2, top: cluster.y + offset },
        { left: cluster.x - width / 2, top: cluster.y - offset - height },
      ].map(({ left, top }) => ({ left, top, right: left + width, bottom: top + height }))
      const free = spots.find(
        (spot) =>
          spot.left >= 0 &&
          spot.top >= 0 &&
          spot.right <= origin.width &&
          spot.bottom <= origin.height &&
          taken.every((box) => spot.right <= box.left || spot.left >= box.right || spot.bottom <= box.top || spot.top >= box.bottom),
      )
      if (!free) {
        label.remove()
        continue
      }
      label.style.left = `${free.left}px`
      label.style.top = `${free.top}px`
      taken.push(free)
    }
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

/**
 * The modal detail of a city: the postcard scene (a dashed place with a lock while locked), the main state and the
 * play action, or the unlock condition without any action while locked.
 */
export function cityDetailWindow({ entry, locale, hasActiveRunHere, onPlay, onContinue, onClose, onHome }: CityDetailOptions): HTMLElement[] {
  const { city, state, stars, previous } = entry
  const bar = windowBar({ titleId: cityDetailTitleId, title: city.name[locale], onClose, onHome })
  let art: HTMLElement
  let info: HTMLElement[]
  if (state === 'locked' && previous) {
    art = element('span', { class: 'city-detail-blank', 'aria-hidden': 'true' }, icon('lock', { class: 'city-detail-lock' }))
    info = [element('p', { class: 'city-condition' }, t('city.condition', { city: previous.name[locale] }))]
  } else {
    const action = hasActiveRunHere ? 'continue' : state === 'completed' ? 'playAgain' : 'play'
    const play = element('button', { class: 'primary city-play', type: 'button', autofocus: true, 'data-focus-id': 'city-play' }, t(`city.${action}`))
    play.addEventListener('click', hasActiveRunHere ? onContinue : onPlay)
    art = element('img', { class: 'postcard-art', src: `${import.meta.env.BASE_URL}${city.postcard.sceneAsset}`, alt: city.name[locale] })
    // A run in progress is the main state; the best stars of an earlier completion stay beside it.
    info = [
      ...(hasActiveRunHere ? [element('p', { class: 'city-status' }, t('city.inProgress'))] : []),
      ...(state === 'completed' ? [element('p', { class: 'city-best' }, element('span', {}, t('city.best')), starRating(stars, { withCount: true }))] : []),
      ...(!hasActiveRunHere && state !== 'completed' ? [element('p', { class: 'city-status' }, t('city.notPlayed'))] : []),
      play,
    ]
  }
  const body = element(
    'div',
    { class: 'window-body' },
    element('div', { class: state === 'locked' ? 'city-detail is-locked' : 'city-detail' }, art, element('div', { class: 'city-detail-info' }, ...info)),
  )
  markMoreContent(body)
  return [bar, body]
}
