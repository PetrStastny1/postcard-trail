import type { Catalog } from '../content/types.ts'
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
