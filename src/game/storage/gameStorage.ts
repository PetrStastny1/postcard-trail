import type { Catalog } from '../../content/types.ts'
import type { KeyValueStore } from '../../platform/types.ts'
import { recordDailyRun, type DailyResults } from '../logic/daily.ts'
import { applyCompletedCityRun, type CityRunSummary, type Progress } from '../logic/progress.ts'
import { restoreRun, type RunState } from '../logic/run.ts'
import {
  decodeSection,
  encodeSection,
  parseActiveRun,
  parseDailyResults,
  parseProgress,
  parseSettings,
  storageKeys,
  type ActiveRun,
  type Settings,
  type StorageKey,
} from './schema.ts'

/** `notOwner`: another tab took the run over, or the run is no longer the active one. Nothing was written. */
export type RunWriteResult = 'written' | 'notOwner'

export type CityRunCompletion = { status: 'completed'; summary: CityRunSummary } | { status: 'notOwner' }

/** `dailyResults` are the merged stored results; the run's date keeps a result saved earlier by another tab. */
export type DailyRunCompletion = { status: 'completed'; dailyResults: DailyResults } | { status: 'notOwner' }

/**
 * The versioned save of one tab. It never throws on storage failures: a section whose `KeyValueStore` call
 * failed, or that a newer build wrote, is kept in memory for the rest of the session and never written to the store.
 */
export class GameStorage {
  readonly #store: KeyValueStore
  readonly #tabId: string
  /** Last value read from or written for each section, used once the section is memory-only. */
  readonly #memory = new Map<StorageKey, string | null>()
  readonly #memoryOnlyKeys = new Set<StorageKey>()
  #notice: 'none' | 'pending' | 'taken' = 'none'

  constructor(store: KeyValueStore, tabId: string) {
    this.#store = store
    this.#tabId = tabId
  }

  loadSettings(): Settings {
    return parseSettings(this.#readSection(storageKeys.settings))
  }

  /** Settings are not merged between tabs; the last write wins. */
  saveSettings(settings: Settings): void {
    this.#writeSection(storageKeys.settings, settings)
  }

  loadProgress(): Progress {
    return parseProgress(this.#readSection(storageKeys.progress))
  }

  loadDailyResults(): DailyResults {
    return parseDailyResults(this.#readSection(storageKeys.dailyResults))
  }

  /** The stored run as saved, without taking it over, e.g. to offer "Continue". */
  loadActiveRun(): RunState | null {
    return this.#activeRun()?.run ?? null
  }

  isActiveRunOwner(): boolean {
    return this.#activeRun()?.ownerTabId === this.#tabId
  }

  /** Replaces any stored run; this tab becomes its owner. */
  startRun(run: RunState): void {
    this.#writeSection(storageKeys.activeRun, { ownerTabId: this.#tabId, run } satisfies ActiveRun)
  }

  /** Takes the stored run over and returns it paused through `restoreRun`, or `null` when there is none. */
  resumeRun(): RunState | null {
    const activeRun = this.#activeRun()
    if (activeRun === null) return null
    const run = restoreRun(activeRun.run)
    this.#writeSection(storageKeys.activeRun, { ownerTabId: this.#tabId, run } satisfies ActiveRun)
    return run
  }

  saveRunCheckpoint(run: RunState): RunWriteResult {
    if (!this.#ownsRun(run.runId)) return 'notOwner'
    this.#writeSection(storageKeys.activeRun, { ownerTabId: this.#tabId, run } satisfies ActiveRun)
    return 'written'
  }

  /** Removes only the active run; rewards and settings stay. */
  discardRun(runId: string): RunWriteResult {
    if (!this.#ownsRun(runId)) return 'notOwner'
    this.#writeSection(storageKeys.activeRun, null)
    return 'written'
  }

  /** Merges the rewards into the stored progress first, then removes the run, so a reload in between cannot duplicate them. */
  completeCityRun(run: RunState, catalog: Catalog): CityRunCompletion {
    if (run.mode !== 'city' || run.phase !== 'summary') throw new Error('Only a finished city run can be completed.')
    if (!this.#ownsRun(run.runId)) return { status: 'notOwner' }
    const summary = applyCompletedCityRun(this.loadProgress(), { cityId: run.cityId, correct: run.correct }, catalog)
    this.#writeSection(storageKeys.progress, summary.progress)
    this.#writeSection(storageKeys.activeRun, null)
    return { status: 'completed', summary }
  }

  completeDailyRun(run: RunState): DailyRunCompletion {
    const dailyResults = recordDailyRun(this.loadDailyResults(), run)
    if (!this.#ownsRun(run.runId)) return { status: 'notOwner' }
    this.#writeSection(storageKeys.dailyResults, dailyResults)
    this.#writeSection(storageKeys.activeRun, null)
    return { status: 'completed', dailyResults }
  }

  /** `true` exactly once per session after the store failed or a newer save was found. */
  takeUnavailableNotice(): boolean {
    if (this.#notice !== 'pending') return false
    this.#notice = 'taken'
    return true
  }

  #activeRun(): ActiveRun | null {
    return parseActiveRun(this.#readSection(storageKeys.activeRun))
  }

  #ownsRun(runId: string): boolean {
    const activeRun = this.#activeRun()
    return activeRun !== null && activeRun.ownerTabId === this.#tabId && activeRun.run.runId === runId
  }

  /** The data of a usable section, `undefined` when the section falls back to its default. */
  #readSection(key: StorageKey): unknown {
    if (!this.#memoryOnlyKeys.has(key)) {
      try {
        const stored = this.#store.read(key)
        const section = decodeSection(stored)
        if (section.status !== 'newer') {
          this.#memory.set(key, stored)
          return section.status === 'usable' ? section.data : undefined
        }
        this.#keepInMemory(key)
      } catch {
        // An unavailable store is expected (private mode, blocked storage); the session continues in memory.
        this.#keepInMemory(key)
      }
    }
    const remembered = decodeSection(this.#memory.get(key) ?? null)
    return remembered.status === 'usable' ? remembered.data : undefined
  }

  #writeSection(key: StorageKey, data: unknown): void {
    // Reading first finds a section saved by a newer build, which must not be overwritten.
    this.#readSection(key)
    const encoded = encodeSection(data)
    this.#memory.set(key, encoded)
    if (this.#memoryOnlyKeys.has(key)) return
    try {
      this.#store.write(key, encoded)
    } catch {
      // A failed write (quota, blocked storage) keeps the section in memory, so the session reads its own data back.
      this.#keepInMemory(key)
    }
  }

  #keepInMemory(key: StorageKey): void {
    this.#memoryOnlyKeys.add(key)
    if (this.#notice === 'none') this.#notice = 'pending'
  }
}
