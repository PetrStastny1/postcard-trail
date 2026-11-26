import { createAnalyticsRecorder } from './analytics.ts'
import { connectWithinLimit, createPortalSession } from './portal.ts'
import { loadScript } from './script.ts'
import { createLocalStorageStore } from './storage.ts'
import type { PlatformAdapter } from './types.ts'

export const CRAZYGAMES_SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'

export interface CrazyGamesAdError {
  code: string
  message?: string
}

export interface CrazyGamesSettings {
  muteAudio: boolean
  disableChat: boolean
}

/** The part of the CrazyGames SDK v3 the game uses. */
export interface CrazyGamesSdk {
  init(): Promise<unknown>
  /** In `disabled` every other call throws. */
  readonly environment: 'local' | 'crazygames' | 'disabled'
  readonly game: {
    loadingStart(): void
    loadingStop(): void
    gameplayStart(): void
    gameplayStop(): void
    /** Read after `init()` resolves; in the `local` environment `?muteAudio=true` forces the value. */
    readonly settings: CrazyGamesSettings
    /** Called on every settings change, also when only `disableChat` changes. */
    addSettingsChangeListener(listener: (settings: CrazyGamesSettings) => void): void
  }
  readonly ad: {
    requestAd(
      type: 'rewarded',
      callbacks: { adStarted(): void; adFinished(): void; adError(error: CrazyGamesAdError): void },
    ): void
  }
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazyGamesSdk }
  }
}

export async function loadCrazyGamesSdk(): Promise<CrazyGamesSdk> {
  await loadScript(CRAZYGAMES_SDK_URL)
  const sdk = window.CrazyGames?.SDK
  if (!sdk) throw new Error('The CrazyGames SDK script did not define CrazyGames.SDK')
  return sdk
}

export interface CrazyGamesAdapterOptions {
  /** `import.meta.env.DEV`. */
  development: boolean
  openStorage: () => Storage
  /** Injects the SDK script; called from `init()` only. */
  loadSdk: () => Promise<CrazyGamesSdk>
}

export function createCrazyGamesAdapter({ development, openStorage, loadSdk }: CrazyGamesAdapterOptions): PlatformAdapter {
  const analytics = createAnalyticsRecorder(development)
  const session = createPortalSession<CrazyGamesSdk>()
  let adsOffered = false
  let loadingSignal: 'start' | 'stop' | null = null
  let portalAudioMuted = false
  const portalAudioMutedListeners: ((muted: boolean) => void)[] = []

  return {
    name: 'crazygames',
    store: createLocalStorageStore(openStorage),
    async init() {
      const sdk = await connectWithinLimit(async (expired) => {
        try {
          const loaded = await loadSdk()
          if (expired()) return null
          await loaded.init()
          return loaded
        } catch {
          // A blocked or failing SDK is expected (ad blockers): the game runs without the portal.
          return null
        }
      })
      if (!sdk || sdk.environment === 'disabled') return
      adsOffered = true
      session.connect(sdk, sdk.game)
      // Not routed through the session: the SDK calls the game here, so a running spot does not block it.
      sdk.game.addSettingsChangeListener(({ muteAudio }) => {
        if (muteAudio === portalAudioMuted) return
        portalAudioMuted = muteAudio
        for (const listener of portalAudioMutedListeners) listener(muteAudio)
      })
      portalAudioMuted = sdk.game.settings.muteAudio
    },
    loadingStarted() {
      if (loadingSignal === 'start') return
      session.whenIdle((sdk) => {
        sdk.game.loadingStart()
        loadingSignal = 'start'
      })
    },
    loadingFinished() {
      if (loadingSignal === 'stop') return
      session.whenIdle((sdk) => {
        sdk.game.loadingStop()
        loadingSignal = 'stop'
      })
    },
    gameplayStart: session.gameplayStart,
    gameplayStop: session.gameplayStop,
    rewardedAdsOffered: () => adsOffered,
    requestRewardedAd(request) {
      session.requestRewardedAd(request, adsOffered, (sdk, spot) => {
        let started = false
        const callbacks = {
          adStarted() {
            started = true
            spot.started()
          },
          adFinished: () => spot.finished('completed'),
          adError(error: CrazyGamesAdError) {
            // Ads stay off for the whole session (Basic Launch, Kids mode, offline).
            if (error.code === 'adsDisabled') adsOffered = false
            spot.finished(started ? 'cancelled' : 'unavailable')
          },
        }
        try {
          sdk.ad.requestAd('rewarded', callbacks)
        } catch {
          // Without this result the spot would stay open and block every later gameplay signal.
          spot.finished('unavailable')
        }
      })
    },
    track: analytics.record,
    recordedEvents: analytics.recordedEvents,
    portalAudioMuted: () => portalAudioMuted,
    onPortalAudioMutedChange(listener) {
      portalAudioMutedListeners.push(listener)
    },
  }
}
