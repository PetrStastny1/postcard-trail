import type { Locale } from '../../content/types.ts'
import type { LifelineKind } from '../../platform/types.ts'
import { emptyDailyResults, mergeDailyResults, utcDateOf, type DailyResults } from '../logic/daily.ts'
import { emptyProgress, mergeProgress, type Progress, type Stars } from '../logic/progress.ts'
import type { DailyRunInfo, RunPhase, RunState, RunStop, StopOutcome, StopResult } from '../logic/run.ts'

const cityStopCount = 10
const dailyStopCount = 3

/** Version 1 is the first schema, so there is nothing older to migrate. */
export const schemaVersion = 1

/** Keys without the `postcard-trail:` prefix, which the adapter adds. */
export const storageKeys = {
  settings: 'settings',
  progress: 'progress',
  dailyResults: 'daily-results',
  activeRun: 'active-run',
} as const

export type StorageKey = (typeof storageKeys)[keyof typeof storageKeys]

export interface Settings {
  locale: Locale
  soundEnabled: boolean
  /** 0–1 */
  volume: number
  vibrationEnabled: boolean
  reducedMotion: boolean
  untimed: boolean
  /** One-time hints the player has already seen. */
  shownHintIds: string[]
}

export const defaultSettings: Settings = {
  locale: 'en',
  soundEnabled: true,
  volume: 0.6,
  vibrationEnabled: true,
  reducedMotion: false,
  untimed: false,
  shownHintIds: [],
}

/** The single run of the device and the tab that last explicitly started or resumed it. */
export interface ActiveRun {
  ownerTabId: string
  run: RunState
}

/**
 * `usable` is a section of the current version, `newer` one written by a newer build that must stay untouched,
 * `damaged` covers a missing, unparsable or unversioned value that falls back to the default and may be overwritten.
 */
export type DecodedSection = { status: 'usable'; data: unknown } | { status: 'newer' } | { status: 'damaged' }

export function encodeSection(data: unknown): string {
  return JSON.stringify({ version: schemaVersion, data })
}

export function decodeSection(stored: string | null): DecodedSection {
  if (stored === null) return { status: 'damaged' }
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    // Unparsable JSON is damaged data, which the section replaces with its default.
    return { status: 'damaged' }
  }
  if (!isRecord(parsed) || !isCount(parsed.version) || parsed.version < 1) return { status: 'damaged' }
  if (parsed.version > schemaVersion) return { status: 'newer' }
  return { status: 'usable', data: parsed.data }
}

/** Each field falls back to its default on its own, so one bad field keeps the others. */
export function parseSettings(data: unknown): Settings {
  const fields = isRecord(data) ? data : {}
  const { locale, soundEnabled, volume, vibrationEnabled, reducedMotion, untimed, shownHintIds } = fields
  return {
    locale: locale === 'en' || locale === 'cs' ? locale : defaultSettings.locale,
    soundEnabled: typeof soundEnabled === 'boolean' ? soundEnabled : defaultSettings.soundEnabled,
    volume: typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : defaultSettings.volume,
    vibrationEnabled: typeof vibrationEnabled === 'boolean' ? vibrationEnabled : defaultSettings.vibrationEnabled,
    reducedMotion: typeof reducedMotion === 'boolean' ? reducedMotion : defaultSettings.reducedMotion,
    untimed: typeof untimed === 'boolean' ? untimed : defaultSettings.untimed,
    shownHintIds: isStringArray(shownHintIds) ? [...new Set(shownHintIds)] : [...defaultSettings.shownHintIds],
  }
}

/** Keeps every valid city entry and returns the normalized form of `mergeProgress`. */
export function parseProgress(data: unknown): Progress {
  if (!isRecord(data)) return emptyProgress
  const bestStars: Record<string, Stars> = {}
  if (isRecord(data.bestStars)) {
    for (const [cityId, stars] of Object.entries(data.bestStars)) {
      if (cityId !== '' && isStars(stars)) bestStars[cityId] = stars
    }
  }
  return mergeProgress(emptyProgress, {
    completedCityIds: cityIdsOf(data.completedCityIds),
    bestStars,
    postcardCityIds: cityIdsOf(data.postcardCityIds),
  })
}

/** Keeps every valid date entry and returns the normalized form of `mergeDailyResults`. */
export function parseDailyResults(data: unknown): DailyResults {
  if (!isRecord(data)) return emptyDailyResults
  const results: DailyResults = {}
  for (const [utcDate, result] of Object.entries(data)) {
    if (isUtcDate(utcDate) && isRecord(result) && isNonEmptyString(result.cityId) && isDailyCorrect(result.correct)) {
      results[utcDate] = { cityId: result.cityId, correct: result.correct }
    }
  }
  return mergeDailyResults(emptyDailyResults, results)
}

/** `null` both for no active run and for a run that does not have the shape of `RunState`. */
export function parseActiveRun(data: unknown): ActiveRun | null {
  if (!isRecord(data) || !isNonEmptyString(data.ownerTabId) || !isRunState(data.run)) return null
  return { ownerTabId: data.ownerTabId, run: data.run }
}

/** Pure check over the stored active-run value, e.g. `StorageEvent.newValue` of the active-run key. */
export function ownsActiveRun(storedActiveRun: string | null, tabId: string): boolean {
  const section = decodeSection(storedActiveRun)
  return section.status === 'usable' && parseActiveRun(section.data)?.ownerTabId === tabId
}

/** Checks the shape of `RunState` and the consistency between its fields that `reduceRun` keeps. */
function isRunState(value: unknown): value is RunState {
  if (!isRecord(value)) return false
  const { stops, stopIndex, phase, results, hiddenChoiceIds } = value
  if (!Array.isArray(stops) || !stops.every(isRunStop) || !isCount(stopIndex) || stopIndex >= stops.length) return false
  if (!isRunPhase(phase) || !Array.isArray(results) || !results.every(isStopResult)) return false
  const stop = stops[stopIndex]
  const answeredStops = phase === 'loading' || phase === 'question' ? stopIndex : stopIndex + 1
  return (
    isNonEmptyString(value.runId) &&
    (value.mode === 'city'
      ? stops.length === cityStopCount && value.daily === null
      : value.mode === 'daily' && stops.length === dailyStopCount && isDailyRunInfo(value.daily)) &&
    isNonEmptyString(value.cityId) &&
    typeof value.untimed === 'boolean' &&
    isCount(value.round) &&
    value.round >= 1 &&
    typeof value.remainingMs === 'number' &&
    value.remainingMs >= 0 &&
    typeof value.paused === 'boolean' &&
    isStringArray(hiddenChoiceIds) &&
    hiddenChoiceIds.every((choiceId) => stop.choiceIds.includes(choiceId) && choiceId !== stop.correctChoiceId) &&
    Array.isArray(value.usedLifelines) &&
    value.usedLifelines.every(isLifelineKind) &&
    new Set(value.usedLifelines).size === value.usedLifelines.length &&
    (value.skipAttemptId === null || isNonEmptyString(value.skipAttemptId)) &&
    results.length === answeredStops &&
    results.every((result, index) => result.stopId === stops[index].stopId) &&
    (phase !== 'summary' || stopIndex === stops.length - 1) &&
    value.correct === results.filter((result) => result.outcome === 'correct').length &&
    isCount(value.streak) &&
    isCount(value.bestStreak)
  )
}

function isDailyRunInfo(value: unknown): value is DailyRunInfo {
  return isRecord(value) && isUtcDate(value.utcDate) && isUtcDate(value.catalogEffectiveUtcDate)
}

function isRunStop(value: unknown): value is RunStop {
  if (!isRecord(value)) return false
  const { choiceIds } = value
  return (
    isNonEmptyString(value.stopId) &&
    isCount(value.routeStopNumber) &&
    value.routeStopNumber >= 1 &&
    value.routeStopNumber <= 10 &&
    typeof value.timeLimitMs === 'number' &&
    value.timeLimitMs > 0 &&
    isStringArray(choiceIds) &&
    choiceIds.length === 4 &&
    new Set(choiceIds).size === 4 &&
    isNonEmptyString(value.correctChoiceId) &&
    choiceIds.includes(value.correctChoiceId)
  )
}

function isStopResult(value: unknown): value is StopResult {
  return (
    isRecord(value) &&
    isNonEmptyString(value.stopId) &&
    isStopOutcome(value.outcome) &&
    (value.chosenChoiceId === null || isNonEmptyString(value.chosenChoiceId))
  )
}

function isRunPhase(value: unknown): value is RunPhase {
  return value === 'loading' || value === 'question' || value === 'feedback' || value === 'summary'
}

function isStopOutcome(value: unknown): value is StopOutcome {
  return value === 'correct' || value === 'wrong' || value === 'timeout' || value === 'skipped'
}

function isLifelineKind(value: unknown): value is LifelineKind {
  return value === 'fiftyFifty' || value === 'extraTime' || value === 'skipVideo'
}

function isStars(value: unknown): value is Stars {
  return value === 0 || value === 1 || value === 2 || value === 3
}

function isDailyCorrect(value: unknown): value is number {
  return isCount(value) && value <= 3
}

function isUtcDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  // A date such as 2026-02-30 rolls over to another day and fails the round trip.
  return utcDateOf(Date.UTC(year, month - 1, day)) === value
}

function cityIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : []
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
