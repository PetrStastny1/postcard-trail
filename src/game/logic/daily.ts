import type { Catalog, CatalogVersion, Route } from '../../content/types.ts'
import { permutedChoiceIds } from './choiceOrder.ts'
import type { Progress } from './progress.ts'
import { createRun, timeLimitMs, type RunState } from './run.ts'

export interface DailyPlan {
  utcDate: string
  catalogEffectiveUtcDate: string
  cityId: string
  /** 1–8, the route stop number the three daily stops start at. */
  firstStopNumber: number
}

export interface DailyResult {
  cityId: string
  /** 0–3 */
  correct: number
}

/** Keyed by the UTC date the run started on; keys are sorted ascending, so equal results have one JSON form. */
export type DailyResults = Record<string, DailyResult>

const dayMs = 86_400_000
const dailyStopCount = 3
const startingStopCount = 8
const permutationCount = 24
const fnvOffsetBasis = 2_166_136_261
const fnvPrime = 16_777_619

export const emptyDailyResults: DailyResults = {}

export function fnv1a32(text: string): number {
  let hash = fnvOffsetBasis
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, fnvPrime) >>> 0
  }
  return hash
}

export function utcDateOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/** The last version effective on `utcDate`, or `null` before the first version, when no daily challenge is offered. */
export function catalogVersionFor(catalog: Catalog, utcDate: string): CatalogVersion | null {
  return catalog.versions.findLast((version) => version.effectiveUtcDate <= utcDate) ?? null
}

// Brief §3: the schedule ignores the player's progress, so locked cities are played too.
export function dailyPlan(catalog: Catalog, utcDate: string): DailyPlan | null {
  const version = catalogVersionFor(catalog, utcDate)
  if (version === null) return null
  const cityCount = version.orderedCityIds.length
  const daysSinceEffective = dayNumber(utcDate) - dayNumber(version.effectiveUtcDate)
  return {
    utcDate,
    catalogEffectiveUtcDate: version.effectiveUtcDate,
    cityId: version.orderedCityIds[daysSinceEffective % cityCount],
    firstStopNumber: 1 + (Math.floor(daysSinceEffective / cityCount) % startingStopCount),
  }
}

/** `route` is the route of `plan.cityId`. The run keeps the date and stops, so midnight or a new catalog cannot change it. */
export function startDailyRun(options: { route: Route; plan: DailyPlan; runId: string; untimed: boolean }): RunState {
  const { route, plan } = options
  const firstStopIndex = plan.firstStopNumber - 1
  return createRun({
    runId: options.runId,
    mode: 'daily',
    cityId: route.id,
    untimed: options.untimed,
    daily: { utcDate: plan.utcDate, catalogEffectiveUtcDate: plan.catalogEffectiveUtcDate },
    stops: route.stops.slice(firstStopIndex, firstStopIndex + dailyStopCount).map((stop, offset) => {
      const routeStopNumber = plan.firstStopNumber + offset
      return {
        stopId: stop.id,
        routeStopNumber,
        timeLimitMs: timeLimitMs(routeStopNumber),
        choiceIds: permutedChoiceIds(stop, fnv1a32(`${plan.utcDate}:${route.id}:${stop.id}`) % permutationCount),
        correctChoiceId: stop.correctChoiceId,
      }
    }),
  })
}

/** Records a finished daily run under its start date; a date that already has a result keeps it. */
export function recordDailyRun(results: DailyResults, run: RunState): DailyResults {
  if (run.daily === null || run.phase !== 'summary') {
    throw new Error('Only a finished daily run has a daily result.')
  }
  return mergeDailyResults(results, { [run.daily.utcDate]: { cityId: run.cityId, correct: run.correct } })
}

export function hasDailyResult(results: DailyResults, utcDate: string): boolean {
  return Object.hasOwn(results, utcDate)
}

/** Consecutive days with a result ending today, or yesterday when today has none yet. */
export function dailyStreak(results: DailyResults, todayUtcDate: string): number {
  const today = dayNumber(todayUtcDate)
  let day = hasDailyResult(results, todayUtcDate) ? today : today - 1
  let streak = 0
  while (hasDailyResult(results, utcDateOf(day * dayMs))) {
    streak++
    day--
  }
  return streak
}

/** The stored result wins for each date, so a second tab cannot replace the first saved result. */
export function mergeDailyResults(stored: DailyResults, incoming: DailyResults): DailyResults {
  const merged: DailyResults = {}
  for (const utcDate of [...new Set([...Object.keys(stored), ...Object.keys(incoming)])].sort()) {
    const { cityId, correct } = stored[utcDate] ?? incoming[utcDate]
    merged[utcDate] = { cityId, correct }
  }
  return merged
}

export function dailyUnlocked(progress: Progress): boolean {
  return progress.completedCityIds.length > 0
}

function dayNumber(utcDate: string): number {
  const [year, month, day] = utcDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / dayMs
}
