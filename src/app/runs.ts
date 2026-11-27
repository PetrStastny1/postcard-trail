import type { Catalog, Route } from '../content/types.ts'
import type { RunState } from '../game/logic/run.ts'
import type { GameStorage } from '../game/storage/gameStorage.ts'

/**
 * A run saved in its summary phase is already finished; its completion was cut off before the rewards were stored,
 * in this page before a reload or in another tab. The app takes it over and completes it without "Continue", a summary
 * or `route_started` (decision in LOG.md). Completion is idempotent, so a second reload adds nothing. Returns whether a
 * run was completed.
 */
export function completeFinishedRun(storage: GameStorage, catalog: Catalog): boolean {
  if (storage.loadActiveRun()?.phase !== 'summary') return false
  const run = storage.resumeRun()
  if (run === null) return false
  if (run.mode === 'city') storage.completeCityRun(run, catalog)
  else storage.completeDailyRun(run)
  return true
}

/**
 * A saved run points at its route's stops and choices by ID. A run saved by another build or edited by hand may name
 * IDs the loaded route does not have; the game screen could not draw it, so it is never continued.
 */
export function runMatchesRoute(run: RunState, route: Route): boolean {
  const stopsById = new Map(route.stops.map((stop) => [stop.id, stop]))
  const stopsMatch = run.stops.every((runStop) => {
    const stop = stopsById.get(runStop.stopId)
    if (!stop || stop.correctChoiceId !== runStop.correctChoiceId) return false
    const routeChoiceIds = new Set(stop.choices.map((choice) => choice.id))
    return runStop.choiceIds.length === routeChoiceIds.size && runStop.choiceIds.every((choiceId) => routeChoiceIds.has(choiceId))
  })
  return stopsMatch && run.results.every((result, index) => result.chosenChoiceId === null || run.stops[index].choiceIds.includes(result.chosenChoiceId))
}
