import type { Route } from '../../content/types.ts'
import type { LifelineKind, RewardedAdResult, RunMode } from '../../platform/types.ts'
import { shuffledChoiceIds, type RandomSource } from './choiceOrder.ts'

export type RunPhase = 'loading' | 'question' | 'feedback' | 'summary'

export type StopOutcome = 'correct' | 'wrong' | 'timeout' | 'skipped'

export interface RunStop {
  stopId: string
  /** 1–10, position of the stop in its route. */
  routeStopNumber: number
  timeLimitMs: number
  /** Displayed order. */
  choiceIds: string[]
  correctChoiceId: string
}

export interface StopResult {
  stopId: string
  outcome: StopOutcome
  chosenChoiceId: string | null
}

export interface DailyRunInfo {
  utcDate: string
  catalogEffectiveUtcDate: string
}

export interface RunState {
  runId: string
  mode: RunMode
  cityId: string
  daily: DailyRunInfo | null
  untimed: boolean
  stops: RunStop[]
  stopIndex: number
  round: number
  phase: RunPhase
  remainingMs: number
  paused: boolean
  hiddenChoiceIds: string[]
  usedLifelines: LifelineKind[]
  skipAttemptId: string | null
  results: StopResult[]
  correct: number
  streak: number
  bestStreak: number
}

export type RunAction =
  | { type: 'sceneReady'; round: number }
  | { type: 'tick'; round: number; elapsedMs: number }
  | { type: 'choose'; round: number; choiceId: string; elapsedMs: number }
  | { type: 'useFiftyFifty'; round: number; elapsedMs: number }
  | { type: 'useExtraTime'; round: number; elapsedMs: number }
  | { type: 'pause'; round: number; elapsedMs: number }
  | { type: 'resume'; round: number }
  | { type: 'requestSkip'; round: number; attemptId: string }
  | { type: 'adResult'; result: RewardedAdResult }
  | { type: 'next'; round: number }

const extraTimeMs = 10_000

/** Skip for a video is offered from the third stop of the run, so the daily run allows it only on its last stop. */
const firstSkippableStopIndex = 2

export function timeLimitMs(routeStopNumber: number): number {
  if (routeStopNumber <= 4) return 25_000
  if (routeStopNumber <= 8) return 20_000
  return 18_000
}

export function createRun(options: {
  runId: string
  mode: RunMode
  cityId: string
  untimed: boolean
  stops: RunStop[]
  daily?: DailyRunInfo
}): RunState {
  return {
    runId: options.runId,
    mode: options.mode,
    cityId: options.cityId,
    daily: options.daily ?? null,
    untimed: options.untimed,
    stops: options.stops,
    stopIndex: 0,
    round: 1,
    phase: 'loading',
    remainingMs: options.stops[0].timeLimitMs,
    paused: false,
    hiddenChoiceIds: [],
    usedLifelines: [],
    skipAttemptId: null,
    results: [],
    correct: 0,
    streak: 0,
    bestStreak: 0,
  }
}

export function startCityRun(options: { route: Route; runId: string; untimed: boolean; random: RandomSource }): RunState {
  return createRun({
    runId: options.runId,
    mode: 'city',
    cityId: options.route.id,
    untimed: options.untimed,
    stops: options.route.stops.map((stop, index) => ({
      stopId: stop.id,
      routeStopNumber: index + 1,
      timeLimitMs: timeLimitMs(index + 1),
      choiceIds: shuffledChoiceIds(stop, options.random),
      correctChoiceId: stop.correctChoiceId,
    })),
  })
}

export function reduceRun(run: RunState, action: RunAction): RunState {
  if (run.phase === 'summary') return run
  if (action.type === 'adResult') return applyAdResult(run, action.result)
  if (action.round !== run.round) return run

  switch (action.type) {
    case 'sceneReady':
      return run.phase === 'loading' ? { ...run, phase: 'question' } : run

    case 'tick':
      return isRunning(run) ? elapse(run, action.elapsedMs) : run

    case 'choose': {
      if (!isRunning(run)) return run
      const elapsed = elapse(run, action.elapsedMs)
      if (elapsed.phase !== 'question' || !visibleChoiceIds(elapsed).includes(action.choiceId)) return elapsed
      const outcome = action.choiceId === currentStop(elapsed).correctChoiceId ? 'correct' : 'wrong'
      return resolveStop(elapsed, outcome, action.choiceId)
    }

    case 'useFiftyFifty': {
      if (!isRunning(run)) return run
      const elapsed = elapse(run, action.elapsedMs)
      if (elapsed.phase !== 'question' || elapsed.usedLifelines.includes('fiftyFifty')) return elapsed
      const stop = currentStop(elapsed)
      const wrongChoiceIds = stop.choiceIds.filter((choiceId) => choiceId !== stop.correctChoiceId)
      return {
        ...elapsed,
        hiddenChoiceIds: wrongChoiceIds.slice(1),
        usedLifelines: [...elapsed.usedLifelines, 'fiftyFifty'],
      }
    }

    case 'useExtraTime': {
      if (run.untimed || !isRunning(run)) return run
      const elapsed = elapse(run, action.elapsedMs)
      if (elapsed.phase !== 'question' || elapsed.usedLifelines.includes('extraTime')) return elapsed
      return {
        ...elapsed,
        remainingMs: elapsed.remainingMs + extraTimeMs,
        usedLifelines: [...elapsed.usedLifelines, 'extraTime'],
      }
    }

    case 'pause': {
      if (run.paused) return run
      if (!isRunning(run)) return { ...run, paused: true }
      const elapsed = elapse(run, action.elapsedMs)
      return elapsed.phase === 'question' ? { ...elapsed, paused: true } : elapsed
    }

    case 'resume':
      // Leaving the pause abandons a pending ad attempt, so a late result cannot skip a running question.
      return run.paused ? { ...run, paused: false, skipAttemptId: null } : run

    case 'requestSkip':
      return canUseSkip(run) && run.skipAttemptId === null ? { ...run, skipAttemptId: action.attemptId } : run

    case 'next': {
      if (run.phase !== 'feedback' || run.paused) return run
      const nextStopIndex = run.stopIndex + 1
      if (nextStopIndex === run.stops.length) return { ...run, phase: 'summary' }
      return {
        ...run,
        stopIndex: nextStopIndex,
        round: run.round + 1,
        phase: 'loading',
        remainingMs: run.stops[nextStopIndex].timeLimitMs,
        hiddenChoiceIds: [],
      }
    }
  }
}

/** A saved run always comes back paused; an ad interrupted by the reload counts as not completed. */
export function restoreRun(run: RunState): RunState {
  return { ...run, paused: run.phase !== 'summary', skipAttemptId: null }
}

export function currentStop(run: RunState): RunStop {
  return run.stops[run.stopIndex]
}

export function visibleChoiceIds(run: RunState): string[] {
  return currentStop(run).choiceIds.filter((choiceId) => !run.hiddenChoiceIds.includes(choiceId))
}

export function canUseSkip(run: RunState): boolean {
  return (
    run.phase === 'question' &&
    run.paused &&
    run.stopIndex >= firstSkippableStopIndex &&
    !run.usedLifelines.includes('skipVideo')
  )
}

function isRunning(run: RunState): boolean {
  return run.phase === 'question' && !run.paused
}

/** Counts the time before the action itself; reaching zero ends the question before the action applies. */
function elapse(run: RunState, elapsedMs: number): RunState {
  if (run.untimed) return run
  if (elapsedMs >= run.remainingMs) return resolveStop({ ...run, remainingMs: 0 }, 'timeout', null)
  return { ...run, remainingMs: run.remainingMs - elapsedMs }
}

function applyAdResult(run: RunState, result: RewardedAdResult): RunState {
  if (run.skipAttemptId === null || result.attemptId !== run.skipAttemptId) return run
  if (result.outcome !== 'completed') return { ...run, skipAttemptId: null }
  return resolveStop(
    { ...run, paused: false, skipAttemptId: null, usedLifelines: [...run.usedLifelines, 'skipVideo'] },
    'skipped',
    null,
  )
}

function resolveStop(run: RunState, outcome: StopOutcome, chosenChoiceId: string | null): RunState {
  const streak = outcome === 'correct' ? run.streak + 1 : outcome === 'skipped' ? run.streak : 0
  return {
    ...run,
    phase: 'feedback',
    results: [...run.results, { stopId: currentStop(run).stopId, outcome, chosenChoiceId }],
    correct: outcome === 'correct' ? run.correct + 1 : run.correct,
    streak,
    bestStreak: Math.max(run.bestStreak, streak),
  }
}
