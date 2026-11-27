/**
 * The map's own schematic Europe without map tiles or outside data: a coarse outline drawn from hand-picked
 * coastline points, projected like every city. Kept free of the DOM, so the clustering has unit tests.
 */

export interface MapPoint {
  x: number
  y: number
}

/** A part of the map in projected units; the whole map is `fullMapView`. */
export interface MapView {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacedCity extends MapPoint {
  cityId: string
}

/** One target on the map: a single city or a group of cities too close to tell apart at the current scale. */
export interface MapCluster extends MapPoint {
  cityIds: string[]
}

const west = -25
const east = 36
const north = 71.5
const south = 34.5
/** Units per degree of latitude. */
const scale = 10
// An equirectangular projection corrected by the cosine of the middle latitude keeps Europe's shape close enough.
const lonFactor = Math.cos((((north + south) / 2) * Math.PI) / 180)

export const fullMapView: MapView = { x: 0, y: 0, width: (east - west) * lonFactor * scale, height: (north - south) * scale }

export function project(coordinates: { lat: number; lon: number }): MapPoint {
  return { x: (coordinates.lon - west) * lonFactor * scale, y: (north - coordinates.lat) * scale }
}

/** Mainland Europe with Anatolia; the Black Sea opens to the east edge of the map. Points are [lon, lat]. */
const mainland: [number, number][] = [
  [-8.9, 37.0], [-6.0, 36.2], [-5.6, 36.0], [-2.0, 36.7], [-0.5, 38.3], [0.2, 39.5], [3.2, 41.9], [3.1, 43.0],
  [4.8, 43.4], [7.5, 43.8], [8.9, 44.4], [10.3, 43.5], [12.0, 41.8], [15.6, 40.0], [15.7, 38.0], [16.6, 38.9],
  [17.1, 39.4], [16.9, 40.4], [18.5, 40.1], [16.5, 41.3], [14.2, 42.4], [13.6, 43.6], [12.3, 45.4], [13.7, 45.6],
  [14.5, 45.2], [15.9, 43.5], [18.5, 42.4], [19.4, 41.8], [19.4, 40.4], [20.7, 38.8], [21.6, 37.0], [22.9, 36.4],
  [23.2, 37.4], [24.1, 37.7], [24.0, 38.3], [22.9, 39.5], [23.0, 40.6], [24.5, 40.9], [26.0, 40.8], [26.4, 40.2],
  [26.8, 38.5], [27.4, 37.0], [29.0, 36.6], [30.6, 36.8], [32.5, 36.1], [34.5, 36.8], [36.0, 36.5], [36.0, 41.3],
  [34.0, 42.0], [31.0, 41.2], [29.1, 41.2], [28.0, 41.6], [28.0, 42.0], [28.6, 43.4], [29.6, 45.2], [30.7, 46.5],
  [33.5, 46.0], [36.0, 46.9], [36.0, 69.0], [31.0, 70.2], [25.8, 71.1], [23.0, 70.6], [19.0, 70.0], [16.0, 69.0],
  [14.0, 68.0], [12.5, 66.0], [10.5, 64.5], [8.0, 63.0], [5.0, 62.0], [5.0, 60.5], [5.6, 58.9], [7.0, 58.0],
  [8.0, 58.1], [10.6, 59.0], [11.3, 58.9], [11.8, 58.0], [12.6, 56.6], [12.9, 55.4], [14.2, 55.4], [16.0, 56.2],
  [16.6, 57.5], [16.7, 58.6], [18.6, 59.3], [18.8, 60.2], [17.2, 61.0], [17.5, 62.5], [20.3, 63.8], [22.2, 65.6],
  [25.4, 65.0], [24.5, 64.0], [21.5, 63.0], [21.4, 61.0], [22.5, 60.2], [24.9, 60.0], [27.0, 60.4], [29.9, 60.1],
  [28.0, 59.4], [23.5, 59.2], [23.4, 58.2], [24.2, 57.3], [21.6, 57.4], [21.1, 56.0], [21.2, 55.2], [19.9, 54.4],
  [18.6, 54.4], [16.0, 54.3], [14.2, 53.9], [11.0, 54.0], [10.0, 54.8], [10.6, 56.0], [10.5, 57.6], [8.6, 57.1],
  [8.1, 56.0], [8.6, 55.0], [8.6, 53.6], [7.0, 53.4], [4.8, 53.0], [4.3, 52.0], [3.4, 51.4], [2.5, 51.1],
  [1.6, 50.9], [1.5, 50.1], [0.1, 49.5], [-1.3, 49.6], [-1.6, 48.6], [-4.7, 48.4], [-4.3, 47.8], [-2.2, 47.2],
  [-1.2, 46.0], [-1.4, 44.6], [-1.8, 43.4], [-4.0, 43.5], [-8.0, 43.7], [-9.3, 43.0], [-8.8, 42.0], [-8.7, 41.0],
  [-9.5, 38.8], [-8.8, 38.0],
]

const islands: [number, number][][] = [
  // Great Britain
  [
    [-5.7, 50.1], [-4.2, 50.4], [-3.0, 50.7], [-1.0, 50.8], [1.4, 51.2], [1.7, 52.6], [0.3, 53.4], [-0.2, 54.0],
    [-1.6, 55.6], [-2.0, 56.0], [-1.8, 57.6], [-3.0, 58.6], [-5.0, 58.6], [-6.2, 57.5], [-5.6, 56.4], [-5.6, 55.3],
    [-4.9, 54.8], [-3.4, 54.9], [-3.0, 53.9], [-3.2, 53.3], [-4.6, 53.3], [-4.2, 52.3], [-5.2, 51.7], [-3.2, 51.4],
    [-4.5, 51.0],
  ],
  // Ireland
  [
    [-6.4, 52.2], [-6.0, 53.4], [-5.9, 54.6], [-7.0, 55.3], [-8.4, 55.2], [-8.6, 54.3], [-10.0, 54.2], [-9.9, 53.4],
    [-9.3, 52.6], [-10.4, 51.9], [-9.6, 51.5], [-8.2, 51.8],
  ],
  // Iceland
  [
    [-22.7, 63.9], [-21.0, 63.8], [-18.0, 63.4], [-15.0, 64.3], [-13.6, 65.1], [-14.5, 66.2], [-16.0, 66.5],
    [-18.2, 66.2], [-20.5, 66.1], [-22.4, 66.4], [-24.0, 65.5], [-23.8, 64.9], [-22.3, 64.6], [-22.4, 64.2],
  ],
  // Zealand
  [[11.0, 55.2], [12.2, 54.9], [12.7, 55.4], [12.6, 56.1], [11.8, 56.0], [10.9, 55.7]],
  // Sicily, Sardinia, Corsica, Crete
  [[12.4, 38.1], [15.6, 38.3], [15.1, 36.7], [12.6, 37.6]],
  [[8.4, 41.0], [9.8, 41.0], [9.6, 39.1], [8.4, 39.0]],
  [[8.6, 43.0], [9.5, 42.9], [9.3, 41.4], [8.7, 41.6]],
  [[23.5, 35.5], [26.3, 35.3], [26.0, 35.0], [24.0, 35.2]],
]

function outlinePath(points: [number, number][]): string {
  const projected = points.map(([lon, lat]) => project({ lat, lon }))
  return `M${projected.map(({ x, y }) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`
}

/** SVG path data of the land, in the units of `fullMapView`. */
export const landPaths: string[] = [mainland, ...islands].map(outlinePath)

/**
 * Groups the cities inside `view` whose targets would touch when the view fills a frame of `width` × `height` CSS px.
 * A target is a square of `target` px kept whole inside the frame. Two targets touch when they are closer than
 * `target` on both axes, so no two drawn targets ever overlap. Positions are in px within the frame.
 */
export function clusterCities(
  cities: PlacedCity[],
  view: MapView,
  frame: { width: number; height: number; target: number },
): MapCluster[] {
  const pixelsPerUnit = frame.width / view.width
  const half = frame.target / 2
  const clamp = (value: number, size: number) => Math.min(Math.max(value, half), size - half)
  const inView = cities.filter(({ x, y }) => x >= view.x && x <= view.x + view.width && y >= view.y && y <= view.y + view.height)
  let groups = inView.map((city) => [city])
  const centre = (group: PlacedCity[]): MapPoint => ({
    x: clamp(((group.reduce((sum, city) => sum + city.x, 0) / group.length) - view.x) * pixelsPerUnit, frame.width),
    y: clamp(((group.reduce((sum, city) => sum + city.y, 0) / group.length) - view.y) * pixelsPerUnit, frame.height),
  })
  // Merging moves a group's centre, which may bring it close to another group, so the merge repeats until none touch.
  for (let merged = true; merged; ) {
    merged = false
    const centres = groups.map(centre)
    search: for (let first = 0; first < groups.length; first++) {
      for (let second = first + 1; second < groups.length; second++) {
        const dx = Math.abs(centres[first].x - centres[second].x)
        const dy = Math.abs(centres[first].y - centres[second].y)
        if (dx < frame.target && dy < frame.target) {
          const joined = [...groups[first], ...groups[second]]
          groups = groups.filter((_group, index) => index !== second).map((group, index) => (index === first ? joined : group))
          merged = true
          break search
        }
      }
    }
  }
  return groups.map((group) => ({ ...centre(group), cityIds: group.map((city) => city.cityId) }))
}
