import type { RewardedAdOutcome, RewardedAdRequest } from './types.ts'

export interface GameplaySdk {
  gameplayStart(): void
  gameplayStop(): void
}

/** How a portal reports its spot. Either call may come any number of times, late or synchronously. */
export interface RewardedSpot {
  started(): void
  finished(outcome: RewardedAdOutcome): void
}

/**
 * Rules both portals share: nothing reaches the SDK before it is connected or while a spot plays
 * (both SDKs forbid calls during an ad), gameplay signals are merged, only one spot runs at a time,
 * and the game's callbacks always run in a later task, never inside `requestRewardedAd`.
 */
export function createPortalSession<Sdk>() {
  let connection: { sdk: Sdk; gameplay: GameplaySdk } | null = null
  let gameplayRunning = false
  let spotPlaying = false

  const idleConnection = () => (spotPlaying ? null : connection)

  return {
    connect(sdk: Sdk, gameplay: GameplaySdk) {
      connection = { sdk, gameplay }
    },
    /** Runs `call` only when the SDK is connected and no spot is playing; otherwise drops it. */
    whenIdle(call: (sdk: Sdk) => void) {
      const idle = idleConnection()
      if (idle) call(idle.sdk)
    },
    gameplayStart() {
      const idle = idleConnection()
      if (!idle || gameplayRunning) return
      idle.gameplay.gameplayStart()
      gameplayRunning = true
    },
    gameplayStop() {
      const idle = idleConnection()
      if (!idle || !gameplayRunning) return
      idle.gameplay.gameplayStop()
      gameplayRunning = false
    },
    requestRewardedAd(
      { attemptId, onStart, onResult }: RewardedAdRequest,
      offered: boolean,
      playSpot: (sdk: Sdk, spot: RewardedSpot) => void,
    ) {
      const report = (outcome: RewardedAdOutcome) => onResult({ attemptId, outcome })
      const idle = idleConnection()
      if (!offered || !idle) {
        setTimeout(() => report('unavailable'), 0)
        return
      }
      if (gameplayRunning) idle.gameplay.gameplayStop()
      gameplayRunning = false
      spotPlaying = true
      let settled = false
      playSpot(idle.sdk, {
        started: () => setTimeout(onStart, 0),
        finished: (outcome) =>
          setTimeout(() => {
            if (!settled) {
              settled = true
              spotPlaying = false
            }
            report(outcome)
          }, 0),
      })
    },
  }
}
