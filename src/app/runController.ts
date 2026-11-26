import type { Catalog } from '../content/types.ts'
import type { Feedback } from '../game/feedback/index.ts'
import { reduceRun, visibleChoiceIds, type RunAction, type RunState } from '../game/logic/run.ts'
import type { GameStorage } from '../game/storage/gameStorage.ts'
import type { PlatformAdapter } from '../platform/types.ts'

export interface RunListener {
  /** The run changed and its checkpoint is saved. */
  changed(run: RunState): void
  /** The run is completed and its rewards are saved. */
  finished(): void
  /** Another tab took the run over; this tab writes nothing more. */
  ownerLost(): void
}

export interface RunControllerOptions {
  run: RunState
  storage: GameStorage
  adapter: PlatformAdapter
  feedback: Feedback
  catalog: Catalog
  /** Monotonic milliseconds, `performance.now()` in the browser. */
  now(): number
  listener: RunListener
}

export type RunController = ReturnType<typeof createRunController>

/**
 * Drives one run without the DOM: measures the time between counted actions, saves a checkpoint after every change,
 * tracks the events, plays the cues and sends the gameplay signals. Once stopped (left, finished or taken over by
 * another tab) it ignores everything.
 */
export function createRunController({ run: initialRun, storage, adapter, feedback, catalog, now, listener }: RunControllerOptions) {
  let run = initialRun
  let countedAt = now()
  let stopped = false
  let pausedByZoom = false

  const running = () => run.phase === 'question' && !run.paused

  /** Time since the last counted action; the action that takes it becomes the new start. */
  function takeElapsed(): number {
    const at = now()
    const elapsedMs = at - countedAt
    countedAt = at
    return elapsedMs
  }

  function dispatch(action: RunAction): void {
    if (stopped) return
    const before = run
    const after = reduceRun(before, action)
    if (after === before) return
    run = after
    trackChange(before, after)
    if (after.phase === 'summary') return finish()
    if (storage.saveRunCheckpoint(after) === 'notOwner') return loseOwnership()
    const wasRunning = before.phase === 'question' && !before.paused
    if (!wasRunning && running()) adapter.gameplayStart()
    if (!before.paused && after.paused) adapter.gameplayStop()
    listener.changed(after)
  }

  function trackChange(before: RunState, after: RunState): void {
    if (after.results.length > before.results.length) {
      const result = after.results[after.results.length - 1]
      adapter.track({ name: 'question_resolved', cityId: after.cityId, index: after.stopIndex + 1, mode: after.mode, outcome: result.outcome })
      if (result.outcome === 'correct') feedback.play('correct')
      else if (result.outcome !== 'skipped') feedback.play('wrong')
    }
    for (const lifeline of after.usedLifelines.slice(before.usedLifelines.length)) {
      adapter.track({ name: 'lifeline_used', lifeline, mode: after.mode })
    }
  }

  function finish(): void {
    stopped = true
    adapter.gameplayStop()
    if (run.mode === 'city') {
      const completion = storage.completeCityRun(run, catalog)
      if (completion.status === 'notOwner') return listener.ownerLost()
      adapter.track({ name: 'route_completed', cityId: run.cityId, mode: 'city', correct: run.correct, stars: completion.summary.stars })
      if (completion.summary.postcardEarned) {
        adapter.track({ name: 'postcard_unlocked', cityId: run.cityId })
        feedback.play('postcard')
      }
    } else {
      if (run.daily === null) throw new Error('A daily run keeps its date.')
      const completion = storage.completeDailyRun(run)
      if (completion.status === 'notOwner') return listener.ownerLost()
      // The daily challenge never adds stars (brief §3), so its run reports none.
      adapter.track({ name: 'route_completed', cityId: run.cityId, mode: 'daily', correct: run.correct, stars: 0 })
      adapter.track({ name: 'daily_completed', utcDate: run.daily.utcDate, correct: run.correct })
    }
    listener.finished()
  }

  function loseOwnership(): void {
    stopped = true
    adapter.gameplayStop()
    listener.ownerLost()
  }

  function pause(): void {
    if (run.paused) return
    dispatch({ type: 'pause', round: run.round, elapsedMs: takeElapsed() })
  }

  function resume(): void {
    // The countdown restarts now, so the time spent paused is never counted.
    countedAt = now()
    dispatch({ type: 'resume', round: run.round })
  }

  return {
    get run() {
      return run
    },

    get stopped() {
      return stopped
    },

    /** Time left as the player sees it, including the part not yet counted by an action. */
    remainingMs(): number {
      if (!running() || run.untimed) return run.remainingMs
      return Math.max(0, run.remainingMs - (now() - countedAt))
    },

    /** The scene is decoded, the choices are drawn and the page is visible: the countdown starts. */
    sceneReady(): void {
      if (run.phase !== 'loading') return
      countedAt = now()
      dispatch({ type: 'sceneReady', round: run.round })
    },

    tick(): void {
      if (running()) dispatch({ type: 'tick', round: run.round, elapsedMs: takeElapsed() })
    },

    choose(choiceId: string): void {
      if (stopped || !running() || !visibleChoiceIds(run).includes(choiceId)) return
      feedback.play('choice')
      dispatch({ type: 'choose', round: run.round, choiceId, elapsedMs: takeElapsed() })
    },

    useFiftyFifty(): void {
      if (running()) dispatch({ type: 'useFiftyFifty', round: run.round, elapsedMs: takeElapsed() })
    },

    useExtraTime(): void {
      if (running()) dispatch({ type: 'useExtraTime', round: run.round, elapsedMs: takeElapsed() })
    },

    pause,
    resume,

    next(): void {
      dispatch({ type: 'next', round: run.round })
    },

    /** The enlarged scene covers the choices, so a running question waits for it to close. */
    zoomOpened(): void {
      if (stopped) return
      if (!running()) return adapter.gameplayStop()
      pausedByZoom = true
      pause()
    },

    /** `resumeQuestion` is false when the zoom closes because the page was hidden; the pause then waits for "Continue". */
    zoomClosed(resumeQuestion: boolean): void {
      if (!pausedByZoom) return
      pausedByZoom = false
      if (resumeQuestion) resume()
    },

    /** The page was hidden: a question that is loading or running pauses, the checkpoint is saved and play stops. */
    pageHidden(): void {
      if (stopped) return
      if (!run.paused && (run.phase === 'loading' || run.phase === 'question')) return pause()
      if (storage.saveRunCheckpoint(run) === 'notOwner') return loseOwnership()
      adapter.gameplayStop()
    },

    /** × or Home: saves the run paused where it is and leaves the game screen. */
    leave(): void {
      if (stopped) return
      if (!run.paused && run.phase !== 'feedback') pause()
      else adapter.gameplayStop()
      if (stopped) return
      stopped = true
      if (storage.saveRunCheckpoint(run) === 'notOwner') return
      adapter.track({ name: 'route_left', cityId: run.cityId, mode: run.mode, index: run.stopIndex + 1, reason: 'paused' })
    },

    /** `false` from the `storage` event or from `isActiveRunOwner()` stops this tab for good. */
    ownershipChecked(owns: boolean): void {
      if (!owns && !stopped) loseOwnership()
    },
  }
}
