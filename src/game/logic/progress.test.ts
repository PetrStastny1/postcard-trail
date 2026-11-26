import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Catalog, CatalogCity } from '../../content/types.ts'
import {
  applyCompletedCityRun,
  emptyProgress,
  mergeProgress,
  nextCityToPlay,
  progressTotals,
  starsFor,
  unlockedCityIds,
  type Progress,
} from './progress.ts'

const text = { en: 'x', cs: 'x' }

function city(id: string): CatalogCity {
  return {
    id,
    name: text,
    coordinates: { lat: 0, lon: 0 },
    postcard: { stopId: `${id}-01`, sceneAsset: `scenes/${id}-01.webp`, sentence: text },
  }
}

function catalogOf(cityIds: string[]): Catalog {
  return {
    cities: cityIds.map(city),
    versions: [{ effectiveUtcDate: '2026-12-01', orderedCityIds: cityIds }],
  }
}

const threeCities = catalogOf(['paris', 'london', 'rome'])
const twentyCityIds = ['paris', 'london', 'rome', ...Array.from({ length: 17 }, (_, index) => `city${index + 4}`)]
const twentyCities = catalogOf(twentyCityIds)

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function completeAll(cityIds: string[], correct: number, catalog: Catalog): Progress {
  return cityIds.reduce(
    (progress, cityId) => applyCompletedCityRun(progress, { cityId, correct }, catalog).progress,
    emptyProgress,
  )
}

test('stars follow the correct-answer bands at every boundary', () => {
  const expected = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 3]
  assert.deepEqual(
    expected.map((_stars, correct) => starsFor(correct)),
    expected,
  )
})

test('without completed cities only the first catalog city is unlocked', () => {
  assert.deepEqual(unlockedCityIds(emptyProgress, threeCities), ['paris'])
})

test('completing Paris with no correct answers earns its postcard and unlocks London only', () => {
  const summary = applyCompletedCityRun(emptyProgress, { cityId: 'paris', correct: 0 }, threeCities)

  assert.equal(summary.stars, 0)
  assert.equal(summary.postcardEarned, true)
  assert.equal(summary.newlyUnlockedCityId, 'london')
  assert.deepEqual(summary.progress, {
    completedCityIds: ['paris'],
    bestStars: { paris: 0 },
    postcardCityIds: ['paris'],
  })
  assert.deepEqual(unlockedCityIds(summary.progress, threeCities), ['paris', 'london'])
})

test('replaying Paris raises stars without a new postcard or unlock and never lowers them', () => {
  const first = applyCompletedCityRun(emptyProgress, { cityId: 'paris', correct: 0 }, threeCities)
  const better = applyCompletedCityRun(first.progress, { cityId: 'paris', correct: 9 }, threeCities)

  assert.equal(better.stars, 3)
  assert.equal(better.postcardEarned, false)
  assert.equal(better.newlyUnlockedCityId, null)
  assert.deepEqual(better.progress.postcardCityIds, ['paris'])
  assert.deepEqual(better.progress.bestStars, { paris: 3 })

  const worse = applyCompletedCityRun(better.progress, { cityId: 'paris', correct: 2 }, threeCities)
  assert.equal(worse.stars, 0)
  assert.deepEqual(worse.progress.bestStars, { paris: 3 })
  assert.equal(worse.postcardEarned, false)
  assert.equal(worse.newlyUnlockedCityId, null)
})

test('applying the same completion twice changes nothing the second time', () => {
  const run = { cityId: 'paris', correct: 5 }
  const first = applyCompletedCityRun(emptyProgress, run, threeCities)
  const second = applyCompletedCityRun(first.progress, run, threeCities)

  assert.deepEqual(second.progress, first.progress)
  assert.equal(second.postcardEarned, false)
  assert.equal(second.newlyUnlockedCityId, null)
  assert.equal(second.stars, first.stars)
})

test('progress restored from JSON after a completion is not rewarded again', () => {
  const run = { cityId: 'paris', correct: 7 }
  const first = applyCompletedCityRun(emptyProgress, run, threeCities)
  const restored: Progress = JSON.parse(JSON.stringify(first.progress))

  const again = applyCompletedCityRun(restored, run, threeCities)
  assert.deepEqual(again.progress, first.progress)
  assert.equal(again.postcardEarned, false)
  assert.equal(again.newlyUnlockedCityId, null)
})

test('completing the last catalog city unlocks nothing new', () => {
  const beforeLast = completeAll(['paris', 'london'], 5, threeCities)
  const summary = applyCompletedCityRun(beforeLast, { cityId: 'rome', correct: 10 }, threeCities)

  assert.equal(summary.newlyUnlockedCityId, null)
  assert.equal(summary.postcardEarned, true)
})

test('twenty completed cities give full totals and the map as the next step', () => {
  const progress = completeAll(twentyCityIds, 10, twentyCities)

  assert.deepEqual(progressTotals(progress, twentyCities), {
    completedCities: 20,
    releasedCities: 20,
    stars: 60,
    maxStars: 60,
    postcards: 20,
  })
  assert.equal(nextCityToPlay(progress, twentyCities), null)
})

test('totals stay within the maximum for mixed results', () => {
  const progress = twentyCityIds.reduce(
    (current, cityId, index) => applyCompletedCityRun(current, { cityId, correct: index % 11 }, twentyCities).progress,
    emptyProgress,
  )
  const totals = progressTotals(progress, twentyCities)

  assert.equal(totals.completedCities, 20)
  assert.equal(totals.postcards, 20)
  assert.ok(totals.stars <= totals.maxStars)
  assert.equal(
    totals.stars,
    twentyCityIds.reduce((sum, _cityId, index) => sum + starsFor(index % 11), 0),
  )
})

test('the next step is the first city without progress and London after Paris', () => {
  assert.equal(nextCityToPlay(emptyProgress, threeCities), 'paris')
  const afterParis = completeAll(['paris'], 0, threeCities)
  assert.equal(nextCityToPlay(afterParis, threeCities), 'london')
})

test('extending the catalog from 20 to 30 cities unlocks the 21st city for a finished player', () => {
  const progress = completeAll(twentyCityIds, 10, twentyCities)
  const thirtyCityIds = [...twentyCityIds, ...Array.from({ length: 10 }, (_, index) => `new${index + 21}`)]
  const thirtyCities = catalogOf(thirtyCityIds)

  assert.deepEqual(unlockedCityIds(progress, thirtyCities), thirtyCityIds.slice(0, 21))
  assert.equal(nextCityToPlay(progress, thirtyCities), 'new21')
  assert.deepEqual(progressTotals(progress, thirtyCities), {
    completedCities: 20,
    releasedCities: 30,
    stars: 60,
    maxStars: 90,
    postcards: 20,
  })
})

test('totals ignore city IDs missing from the catalog', () => {
  const progress: Progress = {
    completedCityIds: ['gone', 'paris'],
    bestStars: { gone: 3, paris: 2 },
    postcardCityIds: ['gone', 'paris'],
  }

  assert.deepEqual(progressTotals(progress, threeCities), {
    completedCities: 1,
    releasedCities: 3,
    stars: 2,
    maxStars: 9,
    postcards: 1,
  })
})

test('merging keeps the best stars and the union of cities and postcards', () => {
  const a: Progress = {
    completedCityIds: ['london', 'paris'],
    bestStars: { paris: 3, london: 0 },
    postcardCityIds: ['london', 'paris'],
  }
  const b: Progress = {
    completedCityIds: ['paris', 'rome'],
    bestStars: { paris: 1, rome: 2 },
    postcardCityIds: ['paris', 'rome'],
  }

  const expected: Progress = {
    completedCityIds: ['london', 'paris', 'rome'],
    bestStars: { paris: 3, london: 0, rome: 2 },
    postcardCityIds: ['london', 'paris', 'rome'],
  }
  assert.deepEqual(mergeProgress(a, b), expected)
  assert.deepEqual(mergeProgress(b, a), expected)
  assert.deepEqual(mergeProgress(a, a), a)
  assert.deepEqual(mergeProgress(a, emptyProgress), a)
})

test('progress built by completions is unchanged by merging with itself', () => {
  const progress = completeAll(['paris', 'london', 'rome'], 8, threeCities)
  assert.deepEqual(mergeProgress(progress, progress), progress)
})

test('two tabs completing different cities merge into both postcards', () => {
  const shared = completeAll(['paris'], 3, threeCities)
  const tabA = applyCompletedCityRun(shared, { cityId: 'paris', correct: 10 }, threeCities).progress
  const tabB = applyCompletedCityRun(shared, { cityId: 'london', correct: 4 }, threeCities).progress

  assert.deepEqual(mergeProgress(tabA, tabB), {
    completedCityIds: ['london', 'paris'],
    bestStars: { paris: 3, london: 1 },
    postcardCityIds: ['london', 'paris'],
  })
  assert.deepEqual(mergeProgress(tabB, tabA), mergeProgress(tabA, tabB))
})

test('merging in either order gives the same JSON with sorted star keys', () => {
  const a: Progress = {
    completedCityIds: ['paris', 'rome'],
    bestStars: { rome: 2, paris: 1 },
    postcardCityIds: ['paris', 'rome'],
  }
  const b: Progress = {
    completedCityIds: ['london', 'paris'],
    bestStars: { paris: 3, london: 0 },
    postcardCityIds: ['london', 'paris'],
  }

  assert.equal(JSON.stringify(mergeProgress(a, b)), JSON.stringify(mergeProgress(b, a)))
  assert.deepEqual(Object.keys(mergeProgress(a, b).bestStars), ['london', 'paris', 'rome'])
})

test('completions in different orders give the same JSON', () => {
  const forward = completeAll(['paris', 'london', 'rome'], 8, threeCities)
  const backward = completeAll(['rome', 'london', 'paris'], 8, threeCities)
  assert.equal(JSON.stringify(forward), JSON.stringify(backward))
})

test('functions do not modify their inputs', () => {
  const progress = deepFreeze(completeAll(['paris'], 4, threeCities))
  const other = deepFreeze<Progress>({ completedCityIds: ['rome'], bestStars: { rome: 1 }, postcardCityIds: ['rome'] })
  const catalog = deepFreeze(catalogOf(['paris', 'london', 'rome']))
  const empty = deepFreeze(emptyProgress)
  const snapshot = JSON.stringify([progress, other, catalog, empty])

  applyCompletedCityRun(progress, { cityId: 'london', correct: 9 }, catalog)
  applyCompletedCityRun(empty, { cityId: 'paris', correct: 9 }, catalog)
  unlockedCityIds(progress, catalog)
  progressTotals(progress, catalog)
  nextCityToPlay(progress, catalog)
  mergeProgress(progress, other)
  mergeProgress(other, progress)

  assert.equal(JSON.stringify([progress, other, catalog, empty]), snapshot)
})

test('progress survives a JSON round trip unchanged', () => {
  const progress = completeAll(['paris', 'london'], 9, threeCities)
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), progress)
})

test('the progress module uses no DOM, clock, randomness or storage', () => {
  const source = readFileSync(new URL('./progress.ts', import.meta.url), 'utf8')
  for (const forbidden of ['document', 'window', 'Date', 'Math.random', 'localStorage', 'sessionStorage', 'indexedDB']) {
    assert.ok(!source.includes(forbidden), `progress.ts must not use ${forbidden}`)
  }
})
