import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Catalog } from '../content/types.ts'
import { clusterCities, fullMapView, maxZoomStep, project, zoomView, type MapCluster, type MapView, type PlacedCity } from './europeMap.ts'

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

const spacing = target + 8
const frameFor = (width: number) => ({ width, height: (width * fullMapView.height) / fullMapView.width, target })
const inside = (city: PlacedCity, view: MapView) => city.x >= view.x && city.x <= view.x + view.width && city.y >= view.y && city.y <= view.y + view.height

test('a group close enough is zoomed only as far as its two cities need to stand apart', () => {
  // Two cities 30 px apart on the nearer axis in a 300 px frame need 52 / 30 ≈ 1.73×, less than the maximum.
  const view: MapView = { x: 0, y: 0, width: 300, height: 300 * (fullMapView.height / fullMapView.width) }
  const pair: PlacedCity[] = [
    { cityId: 'a', x: 140, y: 120 },
    { cityId: 'b', x: 170, y: 125 },
  ]
  const zoomed = zoomView(pair, view, { width: 300, spacing })
  assert.ok(Math.abs(view.width / zoomed.width - spacing / 30) < 1e-9, 'zoom factor')
  const clusters = clusterCities(pair, zoomed, frameFor(300))
  assert.deepEqual(clusters.map((cluster) => cluster.cityIds), [['a'], ['b']])
  assert.ok(Math.abs(clusters[0].x - clusters[1].x) >= spacing - 1e-9)
})

test('each click zooms at most the maximum step and keeps every city of the group in view', () => {
  for (const width of [288, 500, 900]) {
    for (const cluster of clusterCities(placed, fullMapView, frameFor(width)).filter((candidate) => candidate.cityIds.length > 1)) {
      const members = placed.filter((city) => cluster.cityIds.includes(city.cityId))
      const zoomed = zoomView(members, fullMapView, { width, spacing })
      assert.ok(fullMapView.width / zoomed.width <= maxZoomStep + 1e-9, `${cluster.cityIds} at ${width} px zooms at most ${maxZoomStep}×`)
      assert.ok(zoomed.width < fullMapView.width, `${cluster.cityIds} at ${width} px zooms in`)
      for (const city of members) assert.ok(inside(city, zoomed), `${city.cityId} stays in view at ${width} px`)
    }
  }
})

test('Vienna and Bratislava get their own targets after a few clicks on their group', () => {
  const frame = frameFor(288)
  let view = fullMapView
  for (let clicks = 1; clicks <= 4; clicks++) {
    const group = clusterCities(placed, view, frame).find((cluster) => cluster.cityIds.includes('vienna')) as MapCluster
    if (!group.cityIds.includes('bratislava')) return
    view = zoomView(placed.filter((city) => group.cityIds.includes(city.cityId)), view, { width: frame.width, spacing })
  }
  const vienna = clusterCities(placed, view, frame).find((cluster) => cluster.cityIds.includes('vienna'))
  assert.deepEqual(vienna?.cityIds, ['vienna'])
})
