/// <reference types="node" />
import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { createLocalAdapter, LATE_RESULT_DELAY_MS, SIMULATED_SPOT_MS } from './local.ts'
import type { AnalyticsEvent, PlatformAdapter } from './types.ts'

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

function blockedStorage(): Storage {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

function developmentAdapter(search: string): PlatformAdapter {
  return createLocalAdapter({ development: true, search, openStorage: () => new MemoryStorage() })
}

type Callback = { at: number; attemptId: string; call: 'start' } | { at: number; attemptId: string; call: 'result'; outcome: string }

function requestAd(adapter: PlatformAdapter, attemptId: string, callbacks: Callback[]): void {
  adapter.requestRewardedAd({
    attemptId,
    onStart: () => callbacks.push({ at: Date.now(), attemptId, call: 'start' }),
    onResult: (result) => callbacks.push({ at: Date.now(), attemptId: result.attemptId, call: 'result', outcome: result.outcome }),
  })
}

// Long enough for every simulated spot to finish.
const SETTLE_MS = 10_000

/**
 * A single `mock.timers.tick(ms)` shows the target time to every timer it fires and
 * `runAll()` skips timers scheduled while it runs, so time moves in 1 ms steps.
 */
function advance(ms: number): void {
  mock.timers.tick(0)
  for (let step = 0; step < ms; step++) mock.timers.tick(1)
}

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }))
afterEach(() => mock.timers.reset())

test('the store keeps values in localStorage under the postcard-trail prefix', () => {
  const storage = new MemoryStorage()
  const adapter = createLocalAdapter({ development: true, search: '', openStorage: () => storage })

  adapter.store.write('save', 'x')

  assert.equal(storage.getItem('postcard-trail:save'), 'x')
  assert.equal(adapter.store.read('save'), 'x')
  assert.equal(adapter.store.read('missing'), null)
})

test('the store lets storage errors through and opens storage only on use', () => {
  const adapter = createLocalAdapter({ development: true, search: '', openStorage: blockedStorage })

  assert.throws(() => adapter.store.read('save'), { name: 'SecurityError' })
  assert.throws(() => adapter.store.write('save', 'x'), { name: 'SecurityError' })
})

test('the store lets a failing write through', () => {
  const storage = new MemoryStorage()
  storage.setItem = () => {
    throw new DOMException('Quota exceeded.', 'QuotaExceededError')
  }
  const adapter = createLocalAdapter({ development: true, search: '', openStorage: () => storage })

  assert.throws(() => adapter.store.write('save', 'x'), { name: 'QuotaExceededError' })
})

test('development builds record every tracked event in order and hand out a copy', () => {
  const adapter = developmentAdapter('')
  const started: AnalyticsEvent = { name: 'route_started', cityId: 'prague', mode: 'city', resumed: false }
  const unlocked: AnalyticsEvent = { name: 'postcard_unlocked', cityId: 'prague' }

  adapter.track(started)
  adapter.track(unlocked)
  adapter.track(started)
  const recorded = adapter.recordedEvents()
  ;(recorded as AnalyticsEvent[]).length = 0

  assert.deepEqual(adapter.recordedEvents(), [started, unlocked, started])
  assert.equal(JSON.stringify(adapter.recordedEvents()), JSON.stringify([started, unlocked, started]))
})

test('production builds record no events', () => {
  const adapter = createLocalAdapter({ development: false, search: '', openStorage: () => new MemoryStorage() })

  adapter.track({ name: 'postcard_unlocked', cityId: 'prague' })

  assert.deepEqual(adapter.recordedEvents(), [])
})

const unavailable: Callback[] = [{ at: 0, attemptId: 'a1', call: 'result', outcome: 'unavailable' }]
const spotRows: { search: string; offered: boolean; callbacks: Callback[] }[] = [
  { search: '', offered: true, callbacks: unavailable },
  { search: '?ad=bogus', offered: true, callbacks: unavailable },
  { search: '?ad=unavailable', offered: true, callbacks: unavailable },
  { search: '?ads=none', offered: false, callbacks: unavailable },
  { search: '?ads=none&ad=completed', offered: false, callbacks: unavailable },
  {
    search: '?ad=completed',
    offered: true,
    callbacks: [
      { at: 0, attemptId: 'a1', call: 'start' },
      { at: SIMULATED_SPOT_MS, attemptId: 'a1', call: 'result', outcome: 'completed' },
    ],
  },
  {
    search: '?ad=cancelled',
    offered: true,
    callbacks: [
      { at: 0, attemptId: 'a1', call: 'start' },
      { at: SIMULATED_SPOT_MS, attemptId: 'a1', call: 'result', outcome: 'cancelled' },
    ],
  },
  { search: '?ad=interrupted', offered: true, callbacks: [{ at: 0, attemptId: 'a1', call: 'start' }] },
  {
    search: '?ad=duplicate',
    offered: true,
    callbacks: [
      { at: 0, attemptId: 'a1', call: 'start' },
      { at: SIMULATED_SPOT_MS, attemptId: 'a1', call: 'result', outcome: 'completed' },
      { at: SIMULATED_SPOT_MS, attemptId: 'a1', call: 'result', outcome: 'completed' },
    ],
  },
  {
    search: '?ad=late',
    offered: true,
    callbacks: [
      { at: 0, attemptId: 'a1', call: 'start' },
      { at: SIMULATED_SPOT_MS, attemptId: 'a1', call: 'result', outcome: 'cancelled' },
      { at: SIMULATED_SPOT_MS + LATE_RESULT_DELAY_MS, attemptId: 'a1', call: 'result', outcome: 'completed' },
    ],
  },
]

for (const row of spotRows) {
  test(`development build with "${row.search}" simulates the rewarded spot from the table`, () => {
    const adapter = developmentAdapter(row.search)
    const callbacks: Callback[] = []

    assert.equal(adapter.rewardedAdsOffered(), row.offered)
    requestAd(adapter, 'a1', callbacks)
    assert.deepEqual(callbacks, [], 'no callback runs inside requestRewardedAd')
    advance(SETTLE_MS)

    assert.deepEqual(callbacks, row.callbacks)
  })
}

for (const search of ['', '?ad=completed', '?ad=late']) {
  test(`production build ignores "${search}" and reports one unavailable result`, () => {
    const adapter = createLocalAdapter({ development: false, search, openStorage: () => new MemoryStorage() })
    const callbacks: Callback[] = []

    assert.equal(adapter.rewardedAdsOffered(), false)
    requestAd(adapter, 'a1', callbacks)
    assert.deepEqual(callbacks, [])
    advance(SETTLE_MS)

    assert.deepEqual(callbacks, unavailable)
  })
}

test('concurrent late requests each get their own results with their own attemptId', () => {
  const adapter = developmentAdapter('?ad=late')
  const callbacks: Callback[] = []

  requestAd(adapter, 'a1', callbacks)
  advance(SIMULATED_SPOT_MS + 1000)
  requestAd(adapter, 'a2', callbacks)
  advance(SETTLE_MS)

  const second = SIMULATED_SPOT_MS + 1000
  assert.deepEqual(callbacks, [
    { at: 0, attemptId: 'a1', call: 'start' },
    { at: SIMULATED_SPOT_MS, attemptId: 'a1', call: 'result', outcome: 'cancelled' },
    { at: second, attemptId: 'a2', call: 'start' },
    { at: second + SIMULATED_SPOT_MS, attemptId: 'a2', call: 'result', outcome: 'cancelled' },
    { at: SIMULATED_SPOT_MS + LATE_RESULT_DELAY_MS, attemptId: 'a1', call: 'result', outcome: 'completed' },
    { at: second + SIMULATED_SPOT_MS + LATE_RESULT_DELAY_MS, attemptId: 'a2', call: 'result', outcome: 'completed' },
  ])
})

test('without a request the adapter never calls back, and its signals do nothing', async () => {
  const adapter = developmentAdapter('?ad=completed')

  await adapter.init()
  adapter.loadingStarted()
  adapter.loadingFinished()
  adapter.gameplayStart()
  adapter.gameplayStop()
  advance(SETTLE_MS)

  assert.equal(adapter.name, 'local')
  assert.deepEqual(adapter.recordedEvents(), [])
})
