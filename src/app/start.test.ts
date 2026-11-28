import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Feedback, FeedbackSettings } from '../game/feedback/index.ts'
import { createRun } from '../game/logic/run.ts'
import { ownsActiveRun, storageKeys } from '../game/storage/schema.ts'
import { createCrazyGamesAdapter, type CrazyGamesSdk } from '../platform/crazygames.ts'
import { createPokiAdapter, type PokiSdk } from '../platform/poki.ts'
import type { KeyValueStore, PlatformAdapter } from '../platform/types.ts'
import { changeSettings } from './settings.ts'
import { startGame, type GameSession, type StartOptions } from './start.ts'

// The adapter and the feedback are the platform area's boundary; fakes record what the app asks of them.

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return { values, read: (key) => values.get(key) ?? null, write: (key, value) => void values.set(key, value) }
}

function fakeAdapter(calls: string[], store: KeyValueStore, portalMuted = false, initFailure?: Error) {
  let initDone = false
  const muteListeners: ((muted: boolean) => void)[] = []
  const adapter: PlatformAdapter = {
    name: 'local',
    store,
    init: () =>
      new Promise((resolve, reject) => {
        calls.push('init')
        setTimeout(() => {
          if (initFailure) return reject(initFailure)
          initDone = true
          calls.push('init resolved')
          resolve()
        }, 5)
      }),
    loadingStarted: () => calls.push('loadingStarted'),
    loadingFinished: () => calls.push('loadingFinished'),
    gameplayStart: () => calls.push('gameplayStart'),
    gameplayStop: () => calls.push('gameplayStop'),
    rewardedAdsOffered: () => false,
    requestRewardedAd: () => calls.push('requestRewardedAd'),
    track: () => calls.push('track'),
    recordedEvents: () => [],
    portalAudioMuted: () => {
      assert.ok(initDone, 'portalAudioMuted is read only after init')
      calls.push('portalAudioMuted')
      return portalMuted
    },
    onPortalAudioMutedChange: (listener) => {
      calls.push('onPortalAudioMutedChange')
      muteListeners.push(listener)
    },
  }
  return { adapter, changePortalMute: (muted: boolean) => muteListeners.forEach((listener) => listener(muted)) }
}

function fakeFeedback(calls: string[]) {
  const created: FeedbackSettings[] = []
  const create = (settings: FeedbackSettings): Feedback => {
    created.push(settings)
    calls.push('createFeedback')
    return {
      unlock: () => calls.push('unlock'),
      play: (cue) => calls.push(`play ${cue}`),
      setSoundEnabled: (enabled) => calls.push(`setSoundEnabled ${enabled}`),
      setVibrationEnabled: (enabled) => calls.push(`setVibrationEnabled ${enabled}`),
      muteForAd: () => calls.push('muteForAd'),
      restoreAfterAd: () => calls.push('restoreAfterAd'),
      setPortalMuted: (muted) => calls.push(`setPortalMuted ${muted}`),
    }
  }
  return { create, created }
}

const savedSettings = (fields: Record<string, unknown>) => JSON.stringify({ version: 1, data: fields })

function startOptions(calls: string[], adapter: PlatformAdapter, overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    createAdapter: () => adapter,
    createTabId: () => 'tab-1',
    createFeedback: fakeFeedback(calls).create,
    showTitle: () => calls.push('showTitle'),
    showLoadError: () => calls.push('showLoadError'),
    ...overrides,
  }
}

test('start reports loading, initialises, wires the portal mute and finishes loading after the title', async () => {
  const calls: string[] = []
  const { adapter } = fakeAdapter(calls, memoryStore(), true)
  await startGame(startOptions(calls, adapter))
  assert.deepEqual(calls, [
    'loadingStarted',
    'init',
    'init resolved',
    'createFeedback',
    'portalAudioMuted',
    'setPortalMuted true',
    'onPortalAudioMutedChange',
    'showTitle',
    'loadingFinished',
  ])
})

test('a failed init shows the load error and never the title', async () => {
  const calls: string[] = []
  const failure = new Error('init failed')
  const { adapter } = fakeAdapter(calls, memoryStore(), false, failure)
  await assert.rejects(startGame(startOptions(calls, adapter)), failure)
  assert.deepEqual(calls, ['loadingStarted', 'init', 'showLoadError'])
})

test('a synchronous failure while creating the adapter or the tab ID also shows the load error', async () => {
  for (const overrides of [
    { createAdapter: () => { throw new Error('no platform') } },
    { createTabId: () => { throw new Error('no crypto') } },
  ] satisfies Partial<StartOptions>[]) {
    const calls: string[] = []
    await assert.rejects(startGame(startOptions(calls, fakeAdapter(calls, memoryStore()).adapter, overrides)))
    assert.ok(!calls.includes('showTitle'))
    assert.ok(!calls.includes('loadingFinished'))
    assert.equal(calls.at(-1), 'showLoadError')
  }
})

test('a portal mute change reaches the feedback', async () => {
  const calls: string[] = []
  const { adapter, changePortalMute } = fakeAdapter(calls, memoryStore())
  await startGame(startOptions(calls, adapter))
  calls.length = 0
  changePortalMute(true)
  changePortalMute(false)
  assert.deepEqual(calls, ['setPortalMuted true', 'setPortalMuted false'])
})

test('the feedback starts from the settings saved in the adapter store', async () => {
  const calls: string[] = []
  const store = memoryStore({ [storageKeys.settings]: savedSettings({ soundEnabled: false, vibrationEnabled: false, locale: 'cs' }) })
  const feedback = fakeFeedback(calls)
  let shown: GameSession | undefined
  await startGame(startOptions(calls, fakeAdapter(calls, store).adapter, { createFeedback: feedback.create, showTitle: (session) => (shown = session) }))
  assert.deepEqual(feedback.created, [{ sound: false, vibration: false }])
  assert.equal(shown?.settings.locale, 'cs')
})

test('the storage writes through the adapter store as the given tab', async () => {
  const calls: string[] = []
  const store = memoryStore()
  const session = await startGame(startOptions(calls, fakeAdapter(calls, store).adapter, { createTabId: () => 'tab-7' }))
  const stop = { stopId: 'PAR01', routeStopNumber: 1, timeLimitMs: 25_000, choiceIds: ['a', 'b', 'c', 'd'], correctChoiceId: 'a' }
  const stops = Array.from({ length: 10 }, (_unused, index) => ({ ...stop, stopId: `PAR0${index}`, routeStopNumber: index + 1 }))
  session.storage.startRun(createRun({ runId: 'run-1', mode: 'city', cityId: 'paris', untimed: false, stops }))
  const storedRun = store.values.get(storageKeys.activeRun) ?? null
  assert.ok(ownsActiveRun(storedRun, 'tab-7'))
  assert.ok(!ownsActiveRun(storedRun, 'tab-1'))
})

test('a settings change is saved at once and only changed sound or vibration reach the feedback', async () => {
  const calls: string[] = []
  const store = memoryStore()
  const session = await startGame(startOptions(calls, fakeAdapter(calls, store).adapter))
  calls.length = 0
  changeSettings(session, { soundEnabled: false })
  changeSettings(session, { vibrationEnabled: false })
  changeSettings(session, { locale: 'cs', reducedMotion: true, untimed: true })
  assert.deepEqual(calls, ['setSoundEnabled false', 'setVibrationEnabled false'])
  assert.deepEqual(session.storage.loadSettings(), {
    ...session.settings,
    soundEnabled: false,
    vibrationEnabled: false,
    locale: 'cs',
    reducedMotion: true,
    untimed: true,
  })
  assert.equal(JSON.parse(store.values.get(storageKeys.settings) ?? '{}').data.untimed, true)
})

/** The `Storage` the portal adapters open; only what their store uses. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  }
}

/** Stands in for the CrazyGames SDK v3 script; records each call in the same list as the app. */
function fakeCrazyGamesSdk(calls: string[], environment: CrazyGamesSdk['environment'] = 'crazygames'): CrazyGamesSdk {
  const call = (name: string) => () => {
    if (environment === 'disabled') throw new Error(`CrazyGames SDK is disabled: ${name}`)
    calls.push(name)
  }
  return {
    init: () => Promise.resolve(),
    environment,
    game: {
      loadingStart: call('loadingStart'),
      loadingStop: call('loadingStop'),
      gameplayStart: call('gameplayStart'),
      gameplayStop: call('gameplayStop'),
      settings: { muteAudio: false, disableChat: false },
      addSettingsChangeListener: () => undefined,
    },
    ad: { requestAd: call('requestAd') },
  }
}

const crazyGamesStart = (calls: string[], loadSdk: () => Promise<CrazyGamesSdk>) =>
  startOptions(calls, createCrazyGamesAdapter({ development: false, openStorage: memoryStorage, loadSdk }))

test('on CrazyGames the start sends loadingStart once after the SDK connects and loadingStop once after the title', async () => {
  const calls: string[] = []
  await startGame(crazyGamesStart(calls, () => Promise.resolve(fakeCrazyGamesSdk(calls))))
  assert.deepEqual(
    calls.filter((call) => call !== 'createFeedback' && !call.startsWith('setPortalMuted')),
    ['loadingStart', 'showTitle', 'loadingStop'],
  )
})

for (const [name, loadSdk] of [
  ['a blocked SDK script', () => Promise.reject(new Error('blocked'))],
  ['a disabled SDK', () => Promise.resolve(fakeCrazyGamesSdk([], 'disabled'))],
  ['an SDK whose init fails', () => Promise.resolve({ ...fakeCrazyGamesSdk([]), init: () => Promise.reject(new Error('init failed')) })],
] satisfies [string, () => Promise<CrazyGamesSdk>][]) {
  test(`on CrazyGames with ${name} the start sends no loading signal and shows the title`, async () => {
    const calls: string[] = []
    await startGame(crazyGamesStart(calls, loadSdk))
    assert.deepEqual(calls.filter((call) => call.startsWith('loading') || call === 'showTitle'), ['showTitle'])
  })
}

test('on Poki the start sends only gameLoadingFinished, once, after the title', async () => {
  const calls: string[] = []
  const sdk: PokiSdk = {
    init: () => Promise.resolve(),
    gameLoadingFinished: () => calls.push('gameLoadingFinished'),
    gameplayStart: () => calls.push('gameplayStart'),
    gameplayStop: () => calls.push('gameplayStop'),
    rewardedBreak: () => Promise.resolve(false),
    measure: () => calls.push('measure'),
  }
  const adapter = createPokiAdapter({ development: false, openStorage: memoryStorage, loadSdk: () => Promise.resolve(sdk) })
  await startGame(startOptions(calls, adapter))
  assert.deepEqual(calls.filter((call) => call !== 'createFeedback' && !call.startsWith('setPortalMuted')), ['showTitle', 'gameLoadingFinished'])
})
