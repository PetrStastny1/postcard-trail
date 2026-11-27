import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createCrazyGamesAdapter,
  loadCrazyGamesSdk,
  type CrazyGamesAdError,
  type CrazyGamesSdk,
  type CrazyGamesSettings,
} from './crazygames.ts'
import { createPokiAdapter, loadPokiSdk, type PokiSdk } from './poki.ts'
import type { AnalyticsEvent, PlatformAdapter, RewardedAdOutcome } from './types.ts'

class MemoryStorage implements Storage {
  readonly entries = new Map<string, string>();
  [name: string]: unknown

  get length(): number {
    return this.entries.size
  }
  clear(): void {
    this.entries.clear()
  }
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.entries.delete(key)
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, value)
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: Error) => void = () => {}
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** Lets pending promise reactions and 0 ms timers (the adapter's callbacks) run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

type InitBehaviour = 'resolves' | 'rejects'

/** Stands in for the Poki SDK v2 script; records each call. */
function fakePoki(init: InitBehaviour = 'resolves') {
  const calls: string[] = []
  const breaks: { onStart: () => void; result: ReturnType<typeof deferred<boolean>> }[] = []
  const sdk: PokiSdk & { commercialBreak(): Promise<void> } = {
    init: () => (init === 'resolves' ? Promise.resolve() : Promise.reject(new Error('init failed'))),
    gameLoadingFinished: () => calls.push('gameLoadingFinished'),
    gameplayStart: () => calls.push('gameplayStart'),
    gameplayStop: () => calls.push('gameplayStop'),
    rewardedBreak(onStart) {
      calls.push('rewardedBreak')
      const result = deferred<boolean>()
      breaks.push({ onStart, result })
      return result.promise
    },
    measure: (category, what, action) => calls.push(`measure ${category} ${what} ${action}`),
    commercialBreak() {
      calls.push('commercialBreak')
      return Promise.resolve()
    },
  }
  return { sdk, calls, breaks }
}

type CrazyGamesEnvironment = CrazyGamesSdk['environment']
type RequestAdCallbacks = Parameters<CrazyGamesSdk['ad']['requestAd']>[1]

/**
 * Stands in for the CrazyGames SDK v3 script; records each call. In `disabled` calls throw like the real SDK.
 * Settings listeners are kept apart from `calls`; `changeSettings` notifies them like the SDK, on every change.
 */
function fakeCrazyGames(environment: CrazyGamesEnvironment = 'crazygames', init: InitBehaviour = 'resolves', muteAudio = false) {
  const calls: string[] = []
  const ads: RequestAdCallbacks[] = []
  const settingsListeners: ((settings: CrazyGamesSettings) => void)[] = []
  let settings: CrazyGamesSettings = { muteAudio, disableChat: false }
  const call = (name: string) => {
    if (environment === 'disabled') throw new Error(`CrazyGames SDK is disabled: ${name}`)
    calls.push(name)
  }
  const changeSettings = (change: Partial<CrazyGamesSettings>) => {
    settings = { ...settings, ...change }
    for (const listener of settingsListeners) listener(settings)
  }
  const sdk: CrazyGamesSdk = {
    init: () => (init === 'resolves' ? Promise.resolve() : Promise.reject(new Error('init failed'))),
    environment,
    game: {
      loadingStart: () => call('loadingStart'),
      loadingStop: () => call('loadingStop'),
      gameplayStart: () => call('gameplayStart'),
      gameplayStop: () => call('gameplayStop'),
      get settings() {
        if (environment === 'disabled') throw new Error('CrazyGames SDK is disabled: settings')
        return settings
      },
      addSettingsChangeListener(listener) {
        if (environment === 'disabled') throw new Error('CrazyGames SDK is disabled: addSettingsChangeListener')
        settingsListeners.push(listener)
      },
    },
    ad: {
      requestAd(type: string, callbacks: RequestAdCallbacks) {
        call(`requestAd ${type}`)
        ads.push(callbacks)
      },
    },
  }
  return { sdk, calls, ads, settingsListeners, changeSettings }
}

const adError = (code: string): CrazyGamesAdError => ({ code, message: code })

type Callback = { attemptId: string; call: 'start' } | { attemptId: string; call: 'result'; outcome: RewardedAdOutcome }

function requestAd(adapter: PlatformAdapter, attemptId: string, callbacks: Callback[]): void {
  adapter.requestRewardedAd({
    attemptId,
    onStart: () => callbacks.push({ attemptId, call: 'start' }),
    onResult: (result) => callbacks.push({ attemptId: result.attemptId, call: 'result', outcome: result.outcome }),
  })
}

/** One portal behind a uniform face, so the shared rules are checked on both adapters. */
interface Portal {
  adapter: PlatformAdapter
  calls: string[]
  rewardedCall: string
  startSpot(): void
  completeSpot(): void
}

type AdapterWithoutSdk = (options: { openStorage: () => Storage; loadSdk: () => Promise<never> }) => PlatformAdapter

const portals: { name: string; create(development?: boolean): Portal; withoutSdk: AdapterWithoutSdk }[] = [
  {
    name: 'poki',
    withoutSdk: (options) => createPokiAdapter({ development: true, ...options }),
    create(development = true) {
      const poki = fakePoki()
      const adapter = createPokiAdapter({ development, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
      return {
        adapter,
        calls: poki.calls,
        rewardedCall: 'rewardedBreak',
        startSpot: () => poki.breaks.at(-1)?.onStart(),
        completeSpot: () => poki.breaks.at(-1)?.result.resolve(true),
      }
    },
  },
  {
    name: 'crazygames',
    withoutSdk: (options) => createCrazyGamesAdapter({ development: true, ...options }),
    create(development = true) {
      const crazyGames = fakeCrazyGames()
      const adapter = createCrazyGamesAdapter({
        development,
        openStorage: () => new MemoryStorage(),
        loadSdk: () => Promise.resolve(crazyGames.sdk),
      })
      return {
        adapter,
        calls: crazyGames.calls,
        rewardedCall: 'requestAd rewarded',
        startSpot: () => crazyGames.ads.at(-1)?.adStarted(),
        completeSpot: () => crazyGames.ads.at(-1)?.adFinished(),
      }
    },
  },
]

const started: AnalyticsEvent = { name: 'route_started', cityId: 'prague', mode: 'city', resumed: false }

for (const portal of portals) {
  test(`${portal.name}: the store keeps values in localStorage under the postcard-trail prefix`, () => {
    const storage = new MemoryStorage()
    const adapter = portal.withoutSdk({ openStorage: () => storage, loadSdk: () => new Promise<never>(() => {}) })

    adapter.store.write('save', 'x')

    assert.equal(adapter.name, portal.name)
    assert.equal(storage.getItem('postcard-trail:save'), 'x')
    assert.equal(adapter.store.read('save'), 'x')
    assert.equal(adapter.store.read('missing'), null)
  })

  test(`${portal.name}: development builds record tracked events, production builds none`, async () => {
    const development = portal.create(true)
    const production = portal.create(false)
    const unlocked: AnalyticsEvent = { name: 'postcard_unlocked', cityId: 'prague' }

    for (const { adapter } of [development, production]) {
      adapter.track(started)
      await adapter.init()
      adapter.track(unlocked)
      adapter.track(started)
    }

    assert.deepEqual(development.adapter.recordedEvents(), [started, unlocked, started])
    assert.deepEqual(production.adapter.recordedEvents(), [])
  })

  test(`${portal.name}: nothing reaches the SDK before init() resolves`, async () => {
    const { adapter, calls } = portal.create()

    adapter.loadingStarted()
    adapter.loadingFinished()
    adapter.gameplayStart()
    adapter.track(started)
    const initialised = adapter.init()
    adapter.gameplayStart()
    await initialised

    assert.deepEqual(calls, [])
    adapter.gameplayStart()
    assert.deepEqual(calls, ['gameplayStart'])
  })

  test(`${portal.name}: repeated gameplay signals are merged and a stop before the first start is dropped`, async () => {
    const { adapter, calls } = portal.create()
    await adapter.init()

    adapter.gameplayStop()
    adapter.gameplayStart()
    adapter.gameplayStart()
    adapter.gameplayStop()
    adapter.gameplayStop()
    adapter.gameplayStart()

    assert.deepEqual(calls, ['gameplayStart', 'gameplayStop', 'gameplayStart'])
  })

  test(`${portal.name}: a rewarded spot stops gameplay and blocks SDK calls until its first result`, async () => {
    const { adapter, calls, rewardedCall, startSpot, completeSpot } = portal.create()
    await adapter.init()
    adapter.gameplayStart()
    const callbacks: Callback[] = []

    requestAd(adapter, 'a1', callbacks)
    startSpot()
    adapter.gameplayStart()
    adapter.gameplayStop()
    adapter.track(started)
    adapter.loadingFinished()
    assert.deepEqual(callbacks, [], 'no callback runs inside requestRewardedAd')
    await settle()
    adapter.gameplayStart()
    assert.deepEqual(calls, ['gameplayStart', 'gameplayStop', rewardedCall])

    completeSpot()
    await settle()
    adapter.gameplayStop()
    adapter.gameplayStart()

    assert.deepEqual(callbacks, [
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'result', outcome: 'completed' },
    ])
    assert.deepEqual(calls, ['gameplayStart', 'gameplayStop', rewardedCall, 'gameplayStart'])
  })

  test(`${portal.name}: a spot requested while gameplay is stopped sends no extra stop`, async () => {
    const { adapter, calls, rewardedCall, completeSpot } = portal.create()
    await adapter.init()
    adapter.gameplayStart()
    adapter.gameplayStop()

    requestAd(adapter, 'a1', [])
    completeSpot()
    await settle()

    assert.deepEqual(calls, ['gameplayStart', 'gameplayStop', rewardedCall])
  })

  test(`${portal.name}: a request while a spot runs ends unavailable without calling the SDK`, async () => {
    const { adapter, calls, rewardedCall, completeSpot } = portal.create()
    await adapter.init()
    const callbacks: Callback[] = []

    requestAd(adapter, 'a1', callbacks)
    requestAd(adapter, 'a2', callbacks)
    assert.deepEqual(callbacks, [])
    await settle()
    completeSpot()
    await settle()

    assert.deepEqual(calls, [rewardedCall])
    assert.deepEqual(callbacks, [
      { attemptId: 'a2', call: 'result', outcome: 'unavailable' },
      { attemptId: 'a1', call: 'result', outcome: 'completed' },
    ])
  })

  test(`${portal.name}: without a loaded SDK the game runs on and every request is unavailable`, async () => {
    const adapter = portal.withoutSdk({
      openStorage: () => new MemoryStorage(),
      loadSdk: () => Promise.reject(new Error('Failed to load the SDK script')),
    })
    const callbacks: Callback[] = []

    await adapter.init()
    adapter.loadingStarted()
    adapter.loadingFinished()
    adapter.gameplayStart()
    adapter.gameplayStop()
    adapter.track(started)
    assert.equal(adapter.rewardedAdsOffered(), false)
    requestAd(adapter, 'a1', callbacks)
    assert.deepEqual(callbacks, [])
    await settle()

    assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
  })
}

test('poki: init() injects the SDK only when called and offers ads after PokiSDK.init() resolves', async () => {
  const poki = fakePoki()
  let loads = 0
  const adapter = createPokiAdapter({
    development: true,
    openStorage: () => new MemoryStorage(),
    loadSdk: () => {
      loads++
      return Promise.resolve(poki.sdk)
    },
  })

  assert.equal(loads, 0)
  assert.equal(adapter.rewardedAdsOffered(), false)
  await adapter.init()

  assert.equal(loads, 1)
  assert.equal(adapter.rewardedAdsOffered(), true)
})

test('poki: after a failed PokiSDK.init() signals still reach the SDK but ads are not offered', async () => {
  const poki = fakePoki('rejects')
  const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
  const callbacks: Callback[] = []

  await adapter.init()
  adapter.loadingFinished()
  adapter.gameplayStart()
  adapter.track(started)
  adapter.gameplayStop()
  requestAd(adapter, 'a1', callbacks)
  await settle()

  assert.equal(adapter.rewardedAdsOffered(), false)
  assert.deepEqual(poki.calls, ['gameLoadingFinished', 'gameplayStart', 'measure city prague start', 'gameplayStop'])
  assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
})

test('poki: a request after a failed PokiSDK.init() stops running gameplay and ends unavailable', async () => {
  const poki = fakePoki('rejects')
  const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
  const callbacks: Callback[] = []

  await adapter.init()
  adapter.gameplayStart()
  requestAd(adapter, 'a1', callbacks)
  assert.deepEqual(callbacks, [])
  await settle()
  adapter.gameplayStart()

  assert.deepEqual(poki.calls, ['gameplayStart', 'gameplayStop', 'gameplayStart'])
  assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
})

test('poki: a script that does not define PokiSDK counts as an SDK that did not load', async (t) => {
  // Stands in for the browser: the injected script "loads" and leaves no PokiSDK global.
  const fakeDocument = {
    createElement: () => ({
      addEventListener(type: string, listener: () => void) {
        if (type === 'load') setTimeout(listener, 0)
      },
    }),
    head: { append() {} },
  }
  Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'window')
  })

  await assert.rejects(loadPokiSdk(), /did not define PokiSDK/)

  const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: loadPokiSdk })
  await adapter.init()
  const callbacks: Callback[] = []
  requestAd(adapter, 'a1', callbacks)
  await settle()

  assert.equal(adapter.rewardedAdsOffered(), false)
  assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
})

test('poki: loadingStarted sends nothing and gameLoadingFinished goes out at most once', async () => {
  const poki = fakePoki()
  const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
  await adapter.init()

  adapter.loadingStarted()
  adapter.loadingFinished()
  adapter.loadingStarted()
  adapter.loadingFinished()

  assert.deepEqual(poki.calls, ['gameLoadingFinished'])
})

const pokiOutcomes: { name: string; play(spot: ReturnType<typeof fakePoki>['breaks'][number]): void; callbacks: Callback[] }[] = [
  {
    name: 'true is completed',
    play: (spot) => {
      spot.onStart()
      spot.result.resolve(true)
    },
    callbacks: [
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'result', outcome: 'completed' },
    ],
  },
  {
    name: 'false after the spot started is cancelled',
    play: (spot) => {
      spot.onStart()
      spot.result.resolve(false)
    },
    callbacks: [
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'result', outcome: 'cancelled' },
    ],
  },
  {
    name: 'false without a spot is unavailable',
    play: (spot) => spot.result.resolve(false),
    callbacks: [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }],
  },
  {
    name: 'a rejected promise is unavailable',
    play: (spot) => {
      spot.onStart()
      spot.result.reject(new Error('ad failed'))
    },
    callbacks: [
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'result', outcome: 'unavailable' },
    ],
  },
]

for (const row of pokiOutcomes) {
  test(`poki: rewardedBreak resolving ${row.name}`, async () => {
    const poki = fakePoki()
    const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
    await adapter.init()
    const callbacks: Callback[] = []

    requestAd(adapter, 'a1', callbacks)
    const spot = poki.breaks[0]
    assert.ok(spot)
    row.play(spot)
    assert.deepEqual(callbacks, [])
    await settle()

    assert.deepEqual(callbacks, row.callbacks)
  })
}

test('poki: a late onStart is forwarded after the result', async () => {
  const poki = fakePoki()
  const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
  await adapter.init()
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  poki.breaks[0]?.result.resolve(false)
  await settle()
  poki.breaks[0]?.onStart()
  await settle()

  assert.deepEqual(callbacks, [
    { attemptId: 'a1', call: 'result', outcome: 'unavailable' },
    { attemptId: 'a1', call: 'start' },
  ])
})

test('poki: a rewardedBreak that throws ends unavailable and frees the SDK', async () => {
  const poki = fakePoki()
  poki.sdk.rewardedBreak = () => {
    throw new Error('rewardedBreak failed')
  }
  const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
  await adapter.init()
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  await settle()
  adapter.gameplayStart()

  assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
  assert.deepEqual(poki.calls, ['gameplayStart'])
})

test('poki: measure follows the S7.1 table and skips ad outcomes and daily completion', async () => {
  const poki = fakePoki()
  const adapter = createPokiAdapter({ development: false, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })
  await adapter.init()
  const events: AnalyticsEvent[] = [
    { name: 'route_started', cityId: 'prague', mode: 'city', resumed: false },
    { name: 'route_started', cityId: 'oslo', mode: 'daily', resumed: true },
    { name: 'question_resolved', cityId: 'prague', index: 3, mode: 'city', outcome: 'timeout' },
    { name: 'question_resolved', cityId: 'oslo', index: 1, mode: 'daily', outcome: 'skipped' },
    { name: 'route_left', cityId: 'prague', index: 4, mode: 'city', reason: 'paused' },
    { name: 'route_left', cityId: 'oslo', index: 2, mode: 'daily', reason: 'abandoned' },
    { name: 'route_completed', cityId: 'prague', mode: 'city', correct: 8, stars: 2 },
    { name: 'lifeline_used', lifeline: 'fiftyFifty', mode: 'city' },
    { name: 'postcard_unlocked', cityId: 'prague' },
    { name: 'rewarded_ad_outcome', outcome: 'completed' },
    { name: 'daily_completed', utcDate: '2026-11-26', correct: 3 },
  ]

  for (const event of events) adapter.track(event)

  assert.deepEqual(poki.calls, [
    'measure city prague start',
    'measure daily oslo resume',
    'measure city-stop 3 timeout',
    'measure daily-stop 1 skipped',
    'measure city-stop 4 left-paused',
    'measure daily-stop 2 left-abandoned',
    'measure city prague complete',
    'measure lifeline fiftyFifty used',
    'measure postcard prague unlocked',
  ])
})

test('poki: a whole session never calls commercialBreak', async () => {
  const poki = fakePoki()
  const adapter = createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(poki.sdk) })

  await adapter.init()
  adapter.loadingFinished()
  adapter.gameplayStart()
  adapter.gameplayStop()
  adapter.gameplayStart()
  requestAd(adapter, 'a1', [])
  poki.breaks[0]?.result.resolve(true)
  await settle()
  adapter.gameplayStart()

  assert.equal(poki.calls.includes('commercialBreak'), false)
})

for (const environment of ['crazygames', 'local'] as const) {
  test(`crazygames: ads are offered after init in the ${environment} environment`, async () => {
    const crazyGames = fakeCrazyGames(environment)
    let loads = 0
    const adapter = createCrazyGamesAdapter({
      development: true,
      openStorage: () => new MemoryStorage(),
      loadSdk: () => {
        loads++
        return Promise.resolve(crazyGames.sdk)
      },
    })

    assert.equal(loads, 0)
    assert.equal(adapter.rewardedAdsOffered(), false)
    await adapter.init()

    assert.equal(loads, 1)
    assert.equal(adapter.rewardedAdsOffered(), true)
  })
}

for (const [environment, init] of [
  ['disabled', 'resolves'],
  ['crazygames', 'rejects'],
] as const) {
  test(`crazygames: with init ${init} in ${environment} nothing reaches the SDK and nothing throws`, async () => {
    const crazyGames = fakeCrazyGames(environment, init)
    const adapter = createCrazyGamesAdapter({
      development: true,
      openStorage: () => new MemoryStorage(),
      loadSdk: () => Promise.resolve(crazyGames.sdk),
    })
    const callbacks: Callback[] = []

    await adapter.init()
    adapter.loadingStarted()
    adapter.loadingFinished()
    adapter.gameplayStart()
    adapter.gameplayStop()
    adapter.track(started)
    requestAd(adapter, 'a1', callbacks)
    await settle()

    assert.equal(adapter.rewardedAdsOffered(), false)
    assert.deepEqual(crazyGames.calls, [])
    assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
  })
}

test('crazygames: loading signals are merged', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
  await adapter.init()

  adapter.loadingStarted()
  adapter.loadingStarted()
  adapter.loadingFinished()
  adapter.loadingFinished()
  adapter.loadingStarted()

  assert.deepEqual(crazyGames.calls, ['loadingStart', 'loadingStop', 'loadingStart'])
})

test('crazygames: a loadingStarted before init() is sent once the SDK is connected, and loadingStop follows once', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })

  adapter.loadingStarted()
  assert.deepEqual(crazyGames.calls, [])
  await adapter.init()
  assert.deepEqual(crazyGames.calls, ['loadingStart'])
  adapter.loadingStarted()
  adapter.loadingFinished()
  adapter.loadingFinished()

  assert.deepEqual(crazyGames.calls, ['loadingStart', 'loadingStop'])
})

test('crazygames: loading that finished before init() resolves sends nothing on connect', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })

  adapter.loadingStarted()
  const initialised = adapter.init()
  adapter.loadingFinished()
  await initialised

  assert.deepEqual(crazyGames.calls, [])
})

const crazyGamesOutcomes: { name: string; play(callbacks: RequestAdCallbacks): void; callbacks: Callback[] }[] = [
  {
    name: 'adStarted then adFinished is completed',
    play: (ad) => {
      ad.adStarted()
      ad.adFinished()
    },
    callbacks: [
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'result', outcome: 'completed' },
    ],
  },
  {
    name: 'adError after adStarted is cancelled',
    play: (ad) => {
      ad.adStarted()
      ad.adError(adError('other'))
    },
    callbacks: [
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'result', outcome: 'cancelled' },
    ],
  },
  ...['unfilled', 'adblock', 'adCooldown', 'other'].map((code) => ({
    name: `adError ${code} without adStarted is unavailable`,
    play: (ad: RequestAdCallbacks) => ad.adError(adError(code)),
    callbacks: [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' } as const],
  })),
  {
    name: 'repeated and late callbacks are all forwarded with the attempt ID',
    play: (ad) => {
      ad.adStarted()
      ad.adStarted()
      ad.adError(adError('other'))
      ad.adFinished()
      ad.adFinished()
    },
    callbacks: [
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'start' },
      { attemptId: 'a1', call: 'result', outcome: 'cancelled' },
      { attemptId: 'a1', call: 'result', outcome: 'completed' },
      { attemptId: 'a1', call: 'result', outcome: 'completed' },
    ],
  },
]

for (const row of crazyGamesOutcomes) {
  test(`crazygames: ${row.name}`, async () => {
    const crazyGames = fakeCrazyGames()
    const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
    await adapter.init()
    const callbacks: Callback[] = []

    requestAd(adapter, 'a1', callbacks)
    const ad = crazyGames.ads[0]
    assert.ok(ad)
    row.play(ad)
    assert.deepEqual(callbacks, [])
    await settle()

    assert.deepEqual(callbacks, row.callbacks)
    assert.deepEqual(crazyGames.calls, ['requestAd rewarded'])
  })
}

test('crazygames: callbacks called synchronously inside requestAd still arrive later', async () => {
  const crazyGames = fakeCrazyGames()
  crazyGames.sdk.ad.requestAd = (_type, ad) => ad.adError(adError('adCooldown'))
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
  await adapter.init()
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  assert.deepEqual(callbacks, [])
  await settle()
  adapter.gameplayStart()

  assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
  assert.deepEqual(crazyGames.calls, ['gameplayStart'])
})

test('crazygames: a late result of an earlier attempt keeps its attempt ID and does not end the next spot', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
  await adapter.init()
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  crazyGames.ads[0]?.adError(adError('unfilled'))
  await settle()
  requestAd(adapter, 'a2', callbacks)
  crazyGames.ads[0]?.adFinished()
  await settle()
  adapter.gameplayStart()
  crazyGames.ads[1]?.adFinished()
  await settle()
  adapter.gameplayStart()

  assert.deepEqual(callbacks, [
    { attemptId: 'a1', call: 'result', outcome: 'unavailable' },
    { attemptId: 'a1', call: 'result', outcome: 'completed' },
    { attemptId: 'a2', call: 'result', outcome: 'completed' },
  ])
  assert.deepEqual(crazyGames.calls, ['requestAd rewarded', 'requestAd rewarded', 'gameplayStart'])
})

test('crazygames: after adsDisabled ads stay off for the session without calling the SDK', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
  await adapter.init()
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  crazyGames.ads[0]?.adError(adError('adsDisabled'))
  await settle()
  requestAd(adapter, 'a2', callbacks)
  await settle()

  assert.equal(adapter.rewardedAdsOffered(), false)
  assert.deepEqual(crazyGames.calls, ['requestAd rewarded'])
  assert.deepEqual(callbacks, [
    { attemptId: 'a1', call: 'result', outcome: 'unavailable' },
    { attemptId: 'a2', call: 'result', outcome: 'unavailable' },
  ])
})

test('crazygames: a request after adsDisabled stops running gameplay and ends unavailable', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
  await adapter.init()
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  crazyGames.ads[0]?.adError(adError('adsDisabled'))
  await settle()
  adapter.gameplayStart()
  requestAd(adapter, 'a2', callbacks)
  await settle()
  adapter.gameplayStart()

  assert.deepEqual(crazyGames.calls, ['requestAd rewarded', 'gameplayStart', 'gameplayStop', 'gameplayStart'])
  assert.deepEqual(callbacks, [
    { attemptId: 'a1', call: 'result', outcome: 'unavailable' },
    { attemptId: 'a2', call: 'result', outcome: 'unavailable' },
  ])
})

test('crazygames: a requestAd that throws ends unavailable and frees the SDK', async () => {
  const crazyGames = fakeCrazyGames()
  crazyGames.sdk.ad.requestAd = () => {
    throw new Error('requestAd failed')
  }
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
  await adapter.init()
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  await settle()
  adapter.gameplayStart()

  assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
  assert.deepEqual(crazyGames.calls, ['gameplayStart'])
})

test('crazygames: a script that defines CrazyGames without SDK counts as an SDK that did not load', async (t) => {
  // Stands in for the browser: the injected script "loads" and leaves a CrazyGames global without SDK.
  const fakeDocument = {
    createElement: () => ({
      addEventListener(type: string, listener: () => void) {
        if (type === 'load') setTimeout(listener, 0)
      },
    }),
    head: { append() {} },
  }
  Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true })
  Object.defineProperty(globalThis, 'window', { value: { CrazyGames: {} }, configurable: true })
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'window')
  })

  await assert.rejects(loadCrazyGamesSdk(), /did not define CrazyGames\.SDK/)

  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: loadCrazyGamesSdk })
  await adapter.init()
  const callbacks: Callback[] = []
  requestAd(adapter, 'a1', callbacks)
  await settle()

  assert.equal(adapter.rewardedAdsOffered(), false)
  assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
})

test('crazygames: sends no custom events and never requests a midgame ad', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(crazyGames.sdk) })
  await adapter.init()

  adapter.loadingStarted()
  adapter.loadingFinished()
  adapter.gameplayStart()
  adapter.track(started)
  adapter.track({ name: 'route_completed', cityId: 'prague', mode: 'city', correct: 8, stars: 2 })
  adapter.gameplayStop()
  adapter.gameplayStart()
  requestAd(adapter, 'a1', [])
  crazyGames.ads[0]?.adFinished()
  await settle()

  assert.deepEqual(crazyGames.calls, ['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'gameplayStart', 'gameplayStop', 'requestAd rewarded'])
})

/** Lets promise reactions run while `setTimeout` is under the test's mocked clock. */
async function flushPromises(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await new Promise((resolve) => setImmediate(resolve))
}

/** A portal whose SDK script and SDK init finish only when the test says so. */
interface SlowPortal {
  adapter: PlatformAdapter
  /** SDK calls, including `init`. */
  calls: string[]
  rewardedCall: string
  finishScript(): void
  finishSdkInit(): void
}

const slowPortals: { name: string; create(): SlowPortal }[] = [
  {
    name: 'poki',
    create() {
      const poki = fakePoki()
      const script = deferred<PokiSdk>()
      const sdkInit = deferred<unknown>()
      poki.sdk.init = () => {
        poki.calls.push('init')
        return sdkInit.promise
      }
      return {
        adapter: createPokiAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => script.promise }),
        calls: poki.calls,
        rewardedCall: 'rewardedBreak',
        finishScript: () => script.resolve(poki.sdk),
        finishSdkInit: () => sdkInit.resolve(undefined),
      }
    },
  },
  {
    name: 'crazygames',
    create() {
      const crazyGames = fakeCrazyGames()
      const script = deferred<CrazyGamesSdk>()
      const sdkInit = deferred<unknown>()
      crazyGames.sdk.init = () => {
        crazyGames.calls.push('init')
        return sdkInit.promise
      }
      return {
        adapter: createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => script.promise }),
        calls: crazyGames.calls,
        rewardedCall: 'requestAd rewarded',
        finishScript: () => script.resolve(crazyGames.sdk),
        finishSdkInit: () => sdkInit.resolve(undefined),
      }
    },
  },
]

/** Sends every kind of call the game makes and returns the rewarded request's callbacks. */
async function playThrough(adapter: PlatformAdapter, tick: (milliseconds: number) => void): Promise<Callback[]> {
  const callbacks: Callback[] = []
  adapter.loadingStarted()
  adapter.loadingFinished()
  adapter.gameplayStart()
  adapter.track(started)
  adapter.gameplayStop()
  requestAd(adapter, 'a1', callbacks)
  tick(0)
  await flushPromises()
  return callbacks
}

for (const portal of slowPortals) {
  for (const hanging of ['script', 'SDK init'] as const) {
    test(`${portal.name}: with a hanging ${hanging} init() resolves after 5000 ms and not before`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const slow = portal.create()
      if (hanging === 'SDK init') slow.finishScript()
      let resolved = false

      void slow.adapter.init().then(() => {
        resolved = true
      })
      await flushPromises()
      t.mock.timers.tick(4999)
      await flushPromises()
      assert.equal(resolved, false)
      t.mock.timers.tick(1)
      await flushPromises()

      assert.equal(resolved, true)
      assert.equal(slow.adapter.rewardedAdsOffered(), false)
      assert.deepEqual(slow.calls, hanging === 'SDK init' ? ['init'] : [])
    })

    test(`${portal.name}: ${hanging === 'script' ? 'a script' : 'an SDK init'} that finishes after the limit activates nothing`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const slow = portal.create()
      if (hanging === 'SDK init') slow.finishScript()

      const initialised = slow.adapter.init()
      await flushPromises()
      t.mock.timers.tick(5000)
      await initialised
      slow.finishScript()
      slow.finishSdkInit()
      await flushPromises()
      const callbacks = await playThrough(slow.adapter, (milliseconds) => t.mock.timers.tick(milliseconds))

      assert.equal(slow.adapter.rewardedAdsOffered(), false)
      assert.deepEqual(callbacks, [{ attemptId: 'a1', call: 'result', outcome: 'unavailable' }])
      assert.deepEqual(slow.calls, hanging === 'SDK init' ? ['init'] : [])
    })
  }

  test(`${portal.name}: an SDK ready just before the limit is used as usual`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const slow = portal.create()

    const initialised = slow.adapter.init()
    t.mock.timers.tick(2000)
    slow.finishScript()
    await flushPromises()
    t.mock.timers.tick(2999)
    slow.finishSdkInit()
    await initialised
    t.mock.timers.tick(1)
    const callbacks = await playThrough(slow.adapter, (milliseconds) => t.mock.timers.tick(milliseconds))

    assert.equal(slow.adapter.rewardedAdsOffered(), true)
    assert.deepEqual(callbacks, [])
    assert.equal(slow.calls[0], 'init')
    assert.ok(slow.calls.includes('gameplayStart'))
    assert.equal(slow.calls.at(-1), slow.rewardedCall)
  })
}

function crazyGamesAdapter(sdk: CrazyGamesSdk): PlatformAdapter {
  return createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => Promise.resolve(sdk) })
}

function recordPortalMute(adapter: PlatformAdapter): boolean[] {
  const changes: boolean[] = []
  adapter.onPortalAudioMutedChange((muted) => changes.push(muted))
  return changes
}

for (const environment of ['crazygames', 'local'] as const) {
  for (const muteAudio of [true, false]) {
    test(`S10.1 crazygames: in ${environment} with muteAudio ${muteAudio} portalAudioMuted() follows the setting once init() resolves`, async () => {
      const crazyGames = fakeCrazyGames(environment, 'resolves', muteAudio)
      const sdkInit = deferred<unknown>()
      crazyGames.sdk.init = () => sdkInit.promise
      const adapter = crazyGamesAdapter(crazyGames.sdk)
      const changes = recordPortalMute(adapter)

      assert.equal(adapter.portalAudioMuted(), false)
      const initialised = adapter.init()
      await settle()
      assert.equal(adapter.portalAudioMuted(), false, 'not valid before init() resolves')
      sdkInit.resolve(undefined)
      await initialised

      assert.equal(adapter.portalAudioMuted(), muteAudio)
      assert.deepEqual(changes, [], 'the value read at start is not a change')
      assert.equal(crazyGames.settingsListeners.length, 1)
    })
  }
}

test('S10.1 crazygames: an SDK that calls the settings listener on registration does not report the start value as a change', async () => {
  const crazyGames = fakeCrazyGames('crazygames', 'resolves', true)
  crazyGames.sdk.game.addSettingsChangeListener = (listener) => {
    crazyGames.settingsListeners.push(listener)
    listener(crazyGames.sdk.game.settings)
  }
  const adapter = crazyGamesAdapter(crazyGames.sdk)
  const changes = recordPortalMute(adapter)

  await adapter.init()

  assert.equal(adapter.portalAudioMuted(), true)
  assert.deepEqual(changes, [])
  crazyGames.changeSettings({ muteAudio: false })
  assert.deepEqual(changes, [false])
})

test('S10.2 crazygames: a muteAudio change reaches every listener once in registration order, other settings changes do not', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = crazyGamesAdapter(crazyGames.sdk)
  const deliveries: string[] = []
  adapter.onPortalAudioMutedChange((muted) => deliveries.push(`before init: ${muted}`))
  await adapter.init()
  adapter.onPortalAudioMutedChange((muted) => deliveries.push(`after init: ${muted}`))

  crazyGames.changeSettings({ muteAudio: true })
  assert.equal(adapter.portalAudioMuted(), true)
  crazyGames.changeSettings({ disableChat: true })
  crazyGames.changeSettings({ muteAudio: true })
  assert.deepEqual(deliveries, ['before init: true', 'after init: true'])
  crazyGames.changeSettings({ muteAudio: false })

  assert.equal(adapter.portalAudioMuted(), false)
  assert.deepEqual(deliveries, ['before init: true', 'after init: true', 'before init: false', 'after init: false'])
  assert.equal(crazyGames.settingsListeners.length, 1, 'the adapter subscribes to the SDK once')
  assert.deepEqual(crazyGames.calls, [], 'settings changes send nothing to the SDK')
})

test('S10.2 crazygames: a muteAudio true at start is lifted with one call to false', async () => {
  const crazyGames = fakeCrazyGames('crazygames', 'resolves', true)
  const adapter = crazyGamesAdapter(crazyGames.sdk)
  await adapter.init()
  const changes = recordPortalMute(adapter)

  crazyGames.changeSettings({ disableChat: true })
  crazyGames.changeSettings({ muteAudio: false })

  assert.equal(adapter.portalAudioMuted(), false)
  assert.deepEqual(changes, [false])
})

for (const [setup, environment, init] of [
  ['init rejects', 'crazygames', 'rejects'],
  ['the environment is disabled', 'disabled', 'resolves'],
] as const) {
  test(`S10.3 crazygames: when ${setup} portalAudioMuted() stays false and nothing subscribes`, async () => {
    const crazyGames = fakeCrazyGames(environment, init, true)
    const adapter = crazyGamesAdapter(crazyGames.sdk)
    const changes = recordPortalMute(adapter)

    await adapter.init()
    crazyGames.changeSettings({ muteAudio: false })
    crazyGames.changeSettings({ muteAudio: true })

    assert.equal(adapter.portalAudioMuted(), false)
    assert.equal(crazyGames.settingsListeners.length, 0)
    assert.deepEqual(changes, [])
  })
}

for (const breakage of ['game.settings is missing', 'addSettingsChangeListener throws'] as const) {
  test(`S10.3 crazygames: when ${breakage} init() resolves, portalAudioMuted() stays false and ads and signals still work`, async () => {
    const crazyGames = fakeCrazyGames('crazygames', 'resolves', true)
    if (breakage === 'game.settings is missing') Reflect.deleteProperty(crazyGames.sdk.game, 'settings')
    else
      crazyGames.sdk.game.addSettingsChangeListener = () => {
        throw new Error('settings API unavailable')
      }
    const adapter = crazyGamesAdapter(crazyGames.sdk)
    const changes = recordPortalMute(adapter)

    await adapter.init()
    crazyGames.changeSettings({ muteAudio: false })
    crazyGames.changeSettings({ muteAudio: true })
    adapter.loadingStarted()
    await settle()

    assert.equal(adapter.portalAudioMuted(), false)
    assert.deepEqual(changes, [])
    assert.equal(adapter.rewardedAdsOffered(), true)
    assert.deepEqual(crazyGames.calls, ['loadingStart'])
  })
}

test('S10.3 crazygames: without a loaded SDK portalAudioMuted() stays false', async () => {
  const adapter = createCrazyGamesAdapter({
    development: true,
    openStorage: () => new MemoryStorage(),
    loadSdk: () => Promise.reject(new Error('Failed to load the SDK script')),
  })
  const changes = recordPortalMute(adapter)

  await adapter.init()

  assert.equal(adapter.portalAudioMuted(), false)
  assert.deepEqual(changes, [])
})

for (const hanging of ['script', 'SDK init'] as const) {
  test(`S10.3 crazygames: a ${hanging} that finishes after the limit leaves portalAudioMuted() false and subscribes nothing`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const crazyGames = fakeCrazyGames('crazygames', 'resolves', true)
    const script = deferred<CrazyGamesSdk>()
    const sdkInit = deferred<unknown>()
    crazyGames.sdk.init = () => sdkInit.promise
    const adapter = createCrazyGamesAdapter({ development: true, openStorage: () => new MemoryStorage(), loadSdk: () => script.promise })
    const changes = recordPortalMute(adapter)
    if (hanging === 'SDK init') script.resolve(crazyGames.sdk)

    const initialised = adapter.init()
    await flushPromises()
    t.mock.timers.tick(5000)
    await initialised
    script.resolve(crazyGames.sdk)
    sdkInit.resolve(undefined)
    await flushPromises()
    crazyGames.changeSettings({ muteAudio: false })
    crazyGames.changeSettings({ muteAudio: true })

    assert.equal(adapter.portalAudioMuted(), false)
    assert.equal(crazyGames.settingsListeners.length, 0)
    assert.deepEqual(changes, [])
  })
}

test('S10.4 crazygames: a muteAudio change during a running spot is passed on at once', async () => {
  const crazyGames = fakeCrazyGames()
  const adapter = crazyGamesAdapter(crazyGames.sdk)
  await adapter.init()
  const changes = recordPortalMute(adapter)
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  crazyGames.ads[0]?.adStarted()
  crazyGames.changeSettings({ muteAudio: true })

  assert.deepEqual(changes, [true])
  assert.equal(adapter.portalAudioMuted(), true)

  crazyGames.changeSettings({ muteAudio: false })
  crazyGames.ads[0]?.adFinished()
  await settle()

  assert.deepEqual(changes, [true, false])
  assert.equal(adapter.portalAudioMuted(), false)
  assert.deepEqual(crazyGames.calls, ['requestAd rewarded'])
  assert.deepEqual(callbacks, [
    { attemptId: 'a1', call: 'start' },
    { attemptId: 'a1', call: 'result', outcome: 'completed' },
  ])
})

for (const [setup, init, loads] of [
  ['init resolves', 'resolves', true],
  ['init rejects', 'rejects', true],
  ['the SDK does not load', 'resolves', false],
] as const) {
  test(`S10.5 poki: when ${setup} portalAudioMuted() is false and the listener is never called`, async () => {
    const poki = fakePoki(init)
    const adapter = createPokiAdapter({
      development: true,
      openStorage: () => new MemoryStorage(),
      loadSdk: () => (loads ? Promise.resolve(poki.sdk) : Promise.reject(new Error('Failed to load the SDK script'))),
    })
    const changes = recordPortalMute(adapter)

    assert.equal(adapter.portalAudioMuted(), false)
    await adapter.init()
    adapter.gameplayStart()
    requestAd(adapter, 'a1', [])
    poki.breaks[0]?.onStart()
    poki.breaks[0]?.result.resolve(true)
    await settle()

    assert.equal(adapter.portalAudioMuted(), false)
    assert.deepEqual(changes, [])
  })
}
