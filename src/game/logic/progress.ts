import type { Catalog } from '../../content/types.ts'

export type Stars = 0 | 1 | 2 | 3

/** City IDs in both arrays and the `bestStars` keys are unique and sorted ascending, so equal progress has one JSON form. */
export interface Progress {
  completedCityIds: string[]
  bestStars: Record<string, Stars>
  postcardCityIds: string[]
}

export interface CompletedCityRun {
  cityId: string
  correct: number
}

export interface CityRunSummary {
  progress: Progress
  stars: Stars
  postcardEarned: boolean
  newlyUnlockedCityId: string | null
}

export interface ProgressTotals {
  completedCities: number
  releasedCities: number
  stars: number
  maxStars: number
  postcards: number
}

export const emptyProgress: Progress = { completedCityIds: [], bestStars: {}, postcardCityIds: [] }

export function starsFor(correct: number): Stars {
  if (correct >= 9) return 3
  if (correct >= 7) return 2
  if (correct >= 4) return 1
  return 0
}

// Completion is a merge with a one-city progress, so applying the same run twice changes nothing.
export function applyCompletedCityRun(progress: Progress, run: CompletedCityRun, catalog: Catalog): CityRunSummary {
  const stars = starsFor(run.correct)
  const merged = mergeProgress(progress, {
    completedCityIds: [run.cityId],
    bestStars: { [run.cityId]: stars },
    postcardCityIds: [run.cityId],
  })
  const unlockedBefore = new Set(unlockedCityIds(progress, catalog))
  const newlyUnlockedCityId = unlockedCityIds(merged, catalog).find((cityId) => !unlockedBefore.has(cityId)) ?? null
  return {
    progress: merged,
    stars,
    postcardEarned: !progress.postcardCityIds.includes(run.cityId),
    newlyUnlockedCityId,
  }
}

export function unlockedCityIds(progress: Progress, catalog: Catalog): string[] {
  const completed = new Set(progress.completedCityIds)
  return catalog.cities
    .filter((_city, index) => index === 0 || completed.has(catalog.cities[index - 1].id))
    .map((city) => city.id)
}

export function progressTotals(progress: Progress, catalog: Catalog): ProgressTotals {
  const completed = new Set(progress.completedCityIds)
  const postcards = new Set(progress.postcardCityIds)
  const cityIds = catalog.cities.map((city) => city.id)
  return {
    completedCities: cityIds.filter((cityId) => completed.has(cityId)).length,
    releasedCities: cityIds.length,
    stars: cityIds.reduce((sum, cityId) => sum + (progress.bestStars[cityId] ?? 0), 0),
    maxStars: 3 * cityIds.length,
    postcards: cityIds.filter((cityId) => postcards.has(cityId)).length,
  }
}

/** The first unlocked city not yet completed, or `null` when every released city is done and the map is next. */
export function nextCityToPlay(progress: Progress, catalog: Catalog): string | null {
  const completed = new Set(progress.completedCityIds)
  return unlockedCityIds(progress, catalog).find((cityId) => !completed.has(cityId)) ?? null
}

export function mergeProgress(a: Progress, b: Progress): Progress {
  const bestStars: Record<string, Stars> = {}
  for (const cityId of sortedUnion(Object.keys(a.bestStars), Object.keys(b.bestStars))) {
    const starsA = a.bestStars[cityId] ?? 0
    const starsB = b.bestStars[cityId] ?? 0
    bestStars[cityId] = starsA >= starsB ? starsA : starsB
  }
  return {
    completedCityIds: sortedUnion(a.completedCityIds, b.completedCityIds),
    bestStars,
    postcardCityIds: sortedUnion(a.postcardCityIds, b.postcardCityIds),
  }
}

function sortedUnion(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort()
}
