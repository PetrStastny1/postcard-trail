import type { Catalog } from '../content/types.ts'
import type { GameStorage } from '../game/storage/gameStorage.ts'

/**
 * A run saved in its summary phase is already finished; its completion was cut off before the rewards were stored.
 * The app takes it over and completes it whenever it reads the active run, at start and in a tab opened before the
 * failure alike, without "Continue", a summary or `route_started` (decision in LOG.md). Completion is idempotent, so a
 * second reload adds nothing.
 */
export function completeFinishedRun(storage: GameStorage, catalog: Catalog): void {
  if (storage.loadActiveRun()?.phase !== 'summary') return
  const run = storage.resumeRun()
  if (run === null) return
  if (run.mode === 'city') storage.completeCityRun(run, catalog)
  else storage.completeDailyRun(run)
}
