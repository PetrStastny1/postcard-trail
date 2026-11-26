import { createAnalyticsRecorder } from './analytics.ts'
import { createPortalSession } from './portal.ts'
import { loadScript } from './script.ts'
import { createLocalStorageStore } from './storage.ts'
import type { AnalyticsEvent, PlatformAdapter } from './types.ts'

export const POKI_SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js'

/** The part of the Poki SDK v2 the game uses. */
export interface PokiSdk {
  init(): Promise<unknown>
  gameLoadingFinished(): void
  gameplayStart(): void
  gameplayStop(): void
  rewardedBreak(onStart: () => void): Promise<boolean>
  measure(category: string, what: string, action: string): void
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk
  }
}

export async function loadPokiSdk(): Promise<PokiSdk> {
  await loadScript(POKI_SDK_URL)
  if (!window.PokiSDK) throw new Error('The Poki SDK script did not define PokiSDK')
  return window.PokiSDK
}

type Measurement = [category: string, what: string, action: string]

/** Spec S7.1. Poki measures ads itself and daily runs are covered by `route_completed`. */
function pokiMeasurement(event: AnalyticsEvent): Measurement | null {
  switch (event.name) {
    case 'route_started':
      return [event.mode, event.cityId, event.resumed ? 'resume' : 'start']
    case 'route_completed':
      return [event.mode, event.cityId, 'complete']
    case 'question_resolved':
      return [`${event.mode}-stop`, String(event.index), event.outcome]
    case 'route_left':
      return [`${event.mode}-stop`, String(event.index), `left-${event.reason}`]
    case 'lifeline_used':
      return ['lifeline', event.lifeline, 'used']
    case 'postcard_unlocked':
      return ['postcard', event.cityId, 'unlocked']
    case 'rewarded_ad_outcome':
    case 'daily_completed':
      return null
  }
}

export interface PokiAdapterOptions {
  /** `import.meta.env.DEV`. */
  development: boolean
  openStorage: () => Storage
  /** Injects the SDK script; called from `init()` only. */
  loadSdk: () => Promise<PokiSdk>
}

export function createPokiAdapter({ development, openStorage, loadSdk }: PokiAdapterOptions): PlatformAdapter {
  const analytics = createAnalyticsRecorder(development)
  const session = createPortalSession<PokiSdk>()
  let adsOffered = false
  let loadingFinishedSent = false

  return {
    name: 'poki',
    store: createLocalStorageStore(openStorage),
    async init() {
      let sdk: PokiSdk
      try {
        sdk = await loadSdk()
      } catch {
        // A blocked SDK is expected (ad blockers): the game runs without the portal.
        return
      }
      try {
        await sdk.init()
        adsOffered = true
      } catch {
        // Poki asks games to continue after a failed init; the SDK still takes signals, only ads are off.
      }
      session.connect(sdk, sdk)
    },
    loadingStarted() {},
    loadingFinished() {
      if (loadingFinishedSent) return
      session.whenIdle((sdk) => {
        sdk.gameLoadingFinished()
        loadingFinishedSent = true
      })
    },
    gameplayStart: session.gameplayStart,
    gameplayStop: session.gameplayStop,
    rewardedAdsOffered: () => adsOffered,
    requestRewardedAd(request) {
      session.requestRewardedAd(request, adsOffered, (sdk, spot) => {
        let started = false
        sdk
          .rewardedBreak(() => {
            started = true
            spot.started()
          })
          .then(
            (rewarded) => spot.finished(rewarded ? 'completed' : started ? 'cancelled' : 'unavailable'),
            () => spot.finished('unavailable'),
          )
      })
    },
    track(event) {
      analytics.record(event)
      const measurement = pokiMeasurement(event)
      if (measurement) session.whenIdle((sdk) => sdk.measure(...measurement))
    },
    recordedEvents: analytics.recordedEvents,
  }
}
