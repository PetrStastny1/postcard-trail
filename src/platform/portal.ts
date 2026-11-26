import type { RewardedAdOutcome, RewardedAdRequest } from './types.ts'

/** Neither portal states a limit; without one a hanging SDK script or SDK init would keep `init()` pending forever. */
export const SDK_INIT_TIMEOUT_MS = 5000

/**
 * Runs the whole SDK start-up (script and SDK init) under one limit counted from this call. Resolves with
 * `connecting`'s result, or with `null` once the limit passes; a result that arrives later is dropped.
 * `connecting` checks `expired()` before each further SDK call, so a late script starts nothing.
 */
export async function connectWithinLimit<Connection>(
  connecting: (expired: () => boolean) => Promise<Connection | null>,
): Promise<Connection | null> {
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve(null)
    }, SDK_INIT_TIMEOUT_MS)
  })
  const connection = await Promise.race([connecting(() => expired), limit])
  clearTimeout(timer)
  return connection
}

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
      // S5.2 applies to every request, also one that ends unavailable; during a spot gameplay is already stopped.
      if (idle && gameplayRunning) {
        idle.gameplay.gameplayStop()
        gameplayRunning = false
      }
      if (!offered || !idle) {
        setTimeout(() => report('unavailable'), 0)
        return
      }
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
