import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Catalog } from '../content/types.ts'
import { clusterCities, fullMapView, project, type MapCluster, type PlacedCity } from './europeMap.ts'

const catalog = JSON.parse(readFileSync(new URL('../content/catalog.json', import.meta.url), 'utf8')) as Catalog
const placed: PlacedCity[] = catalog.cities.map((city) => ({ cityId: city.id, ...project(city.coordinates) }))
const target = 44

function expectNoTouchingTargets(clusters: MapCluster[], frame: { width: number; height: number }) {
  for (const [index, first] of clusters.entries()) {
    assert.ok(first.x >= target / 2 && first.x <= frame.width - target / 2, `${first.cityIds} inside the frame horizontally`)
    assert.ok(first.y >= target / 2 && first.y <= frame.height - target / 2, `${first.cityIds} inside the frame vertically`)
    for (const second of clusters.slice(index + 1)) {
      const apart = Math.abs(first.x - second.x) >= target || Math.abs(first.y - second.y) >= target
      assert.ok(apart, `${first.cityIds} and ${second.cityIds} do not touch`)
    }
  }
}

test('every released city lies inside the whole map', () => {
  for (const city of placed) {
    assert.ok(city.x > 0 && city.x < fullMapView.width && city.y > 0 && city.y < fullMapView.height, city.cityId)
  }
})

for (const width of [288, 500, 900]) {
  test(`at ${width} px every city is in exactly one target and no two targets touch`, () => {
    const frame = { width, height: (width * fullMapView.height) / fullMapView.width, target }
    const clusters = clusterCities(placed, fullMapView, frame)
    assert.deepEqual(clusters.flatMap((cluster) => cluster.cityIds).sort(), placed.map((city) => city.cityId).sort())
    expectNoTouchingTargets(clusters, frame)
  })
}

test('a small map groups Vienna with Bratislava, a zoomed view on them splits them', () => {
  const frame = { width: 288, height: (288 * fullMapView.height) / fullMapView.width, target }
  const vienna = clusterCities(placed, fullMapView, frame).find((cluster) => cluster.cityIds.includes('vienna'))
  assert.ok(vienna?.cityIds.includes('bratislava'))

  const centre = project({ lat: 48.18, lon: 16.74 })
  const width = 15
  const height = (width * fullMapView.height) / fullMapView.width
  const view = { x: centre.x - width / 2, y: centre.y - height / 2, width, height }
  const clusters = clusterCities(placed, view, frame)
  assert.deepEqual(
    clusters.filter((cluster) => cluster.cityIds.includes('vienna') || cluster.cityIds.includes('bratislava')).map((cluster) => cluster.cityIds),
    [['bratislava'], ['vienna']],
  )
  assert.ok(!clusters.some((cluster) => cluster.cityIds.includes('paris')), 'cities outside the view are left out')
  expectNoTouchingTargets(clusters, frame)
})
