import { createAnalyticsRecorder } from './analytics.ts'
import { createLocalStorageStore } from './storage.ts'
import type { PlatformAdapter, RewardedAdOutcome, RewardedAdRequest } from './types.ts'

export const SIMULATED_SPOT_MS = 500
export const LATE_RESULT_DELAY_MS = 2000

const simulatedAds = ['completed', 'cancelled', 'unavailable', 'interrupted', 'duplicate', 'late'] as const

type SimulatedAd = (typeof simulatedAds)[number]

function isSimulatedAd(value: string | null): value is SimulatedAd {
  return simulatedAds.some((simulatedAd) => simulatedAd === value)
}

export interface LocalAdapterOptions {
  /** `import.meta.env.DEV`. Production builds ignore the URL and offer no ads. */
  development: boolean
  /** `location.search`, read once at creation. */
  search: string
  openStorage: () => Storage
}

export function createLocalAdapter({ development, search, openStorage }: LocalAdapterOptions): PlatformAdapter {
  const params = new URLSearchParams(search)
  const adsOffered = development && params.get('ads') !== 'none'
  const requestedAd = params.get('ad')
  const simulatedAd: SimulatedAd = adsOffered && isSimulatedAd(requestedAd) ? requestedAd : 'unavailable'
  const analytics = createAnalyticsRecorder(development)

  function playSpot({ attemptId, onStart, onResult }: RewardedAdRequest): void {
    const finish = (outcome: RewardedAdOutcome) => onResult({ attemptId, outcome })
    if (simulatedAd === 'unavailable') {
      finish('unavailable')
      return
    }
    onStart()
    // An interrupted spot ends with a page reload, so no result ever arrives.
    if (simulatedAd === 'interrupted') return
    setTimeout(() => {
      if (simulatedAd === 'late') {
        finish('cancelled')
        setTimeout(() => finish('completed'), LATE_RESULT_DELAY_MS)
        return
      }
      finish(simulatedAd === 'cancelled' ? 'cancelled' : 'completed')
      if (simulatedAd === 'duplicate') finish('completed')
    }, SIMULATED_SPOT_MS)
  }

  return {
    name: 'local',
    store: createLocalStorageStore(openStorage),
    init: () => Promise.resolve(),
    loadingStarted() {},
    loadingFinished() {},
    gameplayStart() {},
    gameplayStop() {},
    rewardedAdsOffered: () => adsOffered,
    requestRewardedAd(request) {
      setTimeout(() => playSpot(request), 0)
    },
    track: analytics.record,
    recordedEvents: analytics.recordedEvents,
    portalAudioMuted: () => false,
    onPortalAudioMutedChange() {},
  }
}
