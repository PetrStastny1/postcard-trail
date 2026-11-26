import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Catalog, CatalogCity } from '../../content/types.ts'
import type { KeyValueStore } from '../../platform/types.ts'
import { createRun, currentStop, reduceRun, type RunState, type RunStop } from '../logic/run.ts'
import { GameStorage } from './gameStorage.ts'
import { defaultSettings, ownsActiveRun, storageKeys, type Settings } from './schema.ts'

interface TestStore extends KeyValueStore {
  values: Map<string, string>
}

function memoryStore(initial: Record<string, unknown> = {}): TestStore {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
  return {
    values,
    read: (key) => values.get(key) ?? null,
    write: (key, value) => {
      values.set(key, value)
    },
  }
}

function failingStore(options: { read: boolean; write: boolean }, initial: Record<string, unknown> = {}): TestStore & { failures: number } {
  const store = memoryStore(initial)
  const failing = {
    values: store.values,
    failures: 0,
    read: (key: string) => {
      if (options.read) {
        failing.failures++
        throw new Error('SecurityError')
      }
      return store.read(key)
    },
    write: (key: string, value: string) => {
      if (options.write) {
        failing.failures++
        throw new Error('QuotaExceededError')
      }
      store.write(key, value)
    },
  }
  return failing
}

function v1(data: unknown): string {
  return JSON.stringify({ version: 1, data })
}

const text = { en: 'x', cs: 'x' }

function city(id: string): CatalogCity {
  return {
    id,
    name: text,
    coordinates: { lat: 0, lon: 0 },
    postcard: { stopId: `${id}-01`, sceneAsset: `scenes/${id}-01.webp`, sentence: text },
  }
}

const catalog: Catalog = {
  cities: ['paris', 'london', 'rome'].map(city),
  versions: [{ effectiveUtcDate: '2026-12-01', orderedCityIds: ['paris', 'london', 'rome'] }],
}

function stops(prefix: string, count: number): RunStop[] {
  return Array.from({ length: count }, (_, index) => {
    const stopId = `${prefix}${String(index + 1).padStart(2, '0')}`
    return {
      stopId,
      routeStopNumber: index + 1,
      timeLimitMs: 25_000,
      choiceIds: [`${stopId}-c`, `${stopId}-a`, `${stopId}-d`, `${stopId}-b`],
      correctChoiceId: `${stopId}-b`,
    }
  })
}

function cityRun(cityId: string, runId: string): RunState {
  return createRun({ runId, mode: 'city', cityId, untimed: false, stops: stops(cityId.slice(0, 3).toUpperCase(), 10) })
}

function dailyRun(utcDate: string, runId: string): RunState {
  return createRun({
    runId,
    mode: 'daily',
    cityId: 'rome',
    untimed: false,
    daily: { utcDate, catalogEffectiveUtcDate: '2026-12-01' },
    stops: stops('ROM', 3),
  })
}

/** Plays the remaining stops, answering the first `correctCount` correctly and the rest wrong. */
function finish(run: RunState, correctCount: number): RunState {
  let state = run.paused ? reduceRun(run, { type: 'resume', round: run.round }) : run
  while (state.phase !== 'summary') {
    if (state.phase === 'loading') state = reduceRun(state, { type: 'sceneReady', round: state.round })
    if (state.phase === 'question') {
      const stop = currentStop(state)
      const wrongChoiceId = stop.choiceIds.find((choiceId) => choiceId !== stop.correctChoiceId) ?? stop.correctChoiceId
      const choiceId = state.results.length < correctCount ? stop.correctChoiceId : wrongChoiceId
      state = reduceRun(state, { type: 'choose', round: state.round, choiceId, elapsedMs: 1_000 })
    }
    state = reduceRun(state, { type: 'next', round: state.round })
  }
  return state
}

/** Answers the first stop and pauses on the second question with 50:50 used and 4 s spent. */
function midRun(run: RunState): RunState {
  let state = reduceRun(run, { type: 'sceneReady', round: 1 })
  state = reduceRun(state, { type: 'choose', round: 1, choiceId: currentStop(state).correctChoiceId, elapsedMs: 2_000 })
  state = reduceRun(state, { type: 'next', round: 1 })
  state = reduceRun(state, { type: 'sceneReady', round: 2 })
  state = reduceRun(state, { type: 'useFiftyFifty', round: 2, elapsedMs: 1_000 })
  return reduceRun(state, { type: 'tick', round: 2, elapsedMs: 3_000 })
}

test('sections live under separate unprefixed keys as versioned JSON', () => {
  const store = memoryStore()
  const storage = new GameStorage(store, 'tab-a')
  storage.saveSettings({ ...defaultSettings, locale: 'cs' })
  const run = finish(cityRun('paris', 'run-1'), 0)
  storage.startRun(run)
  storage.completeCityRun(run, catalog)
  const daily = finish(dailyRun('2026-12-02', 'run-2'), 3)
  storage.startRun(daily)
  storage.completeDailyRun(daily)

  assert.deepEqual([...store.values.keys()].sort(), ['active-run', 'daily-results', 'progress', 'settings'])
  assert.deepEqual(Object.values(storageKeys).sort(), ['active-run', 'daily-results', 'progress', 'settings'])
  for (const value of store.values.values()) {
    const parsed: unknown = JSON.parse(value)
    assert.deepEqual(Object.keys(parsed as object).sort(), ['data', 'version'])
    assert.equal((parsed as { version: unknown }).version, 1)
  }
  assert.deepEqual(JSON.parse(store.values.get('active-run') ?? ''), { version: 1, data: null })
})

test('an empty store gives the default settings, empty rewards and no active run', () => {
  const storage = new GameStorage(memoryStore(), 'tab-a')
  assert.deepEqual(storage.loadSettings(), {
    locale: 'en',
    soundEnabled: true,
    volume: 0.6,
    vibrationEnabled: true,
    reducedMotion: false,
    untimed: false,
    shownHintIds: [],
  })
  assert.deepEqual(storage.loadProgress(), { completedCityIds: [], bestStars: {}, postcardCityIds: [] })
  assert.deepEqual(storage.loadDailyResults(), {})
  assert.equal(storage.loadActiveRun(), null)
  assert.equal(storage.resumeRun(), null)
  assert.equal(storage.isActiveRunOwner(), false)
  assert.equal(storage.takeUnavailableNotice(), false)
})

test('loaded default settings are a fresh value that changing does not leak into later loads', () => {
  const storage = new GameStorage(memoryStore(), 'tab-a')
  storage.loadSettings().shownHintIds.push('pause')
  assert.deepEqual(storage.loadSettings().shownHintIds, [])
  assert.deepEqual(defaultSettings.shownHintIds, [])
  const invalidHints = new GameStorage(memoryStore({ settings: v1({ shownHintIds: 'pause' }) }), 'tab-a')
  invalidHints.loadSettings().shownHintIds.push('pause')
  assert.deepEqual(invalidHints.loadSettings().shownHintIds, [])
})

test('broken progress JSON keeps valid settings and falls back to empty progress', () => {
  const settings: Settings = { ...defaultSettings, locale: 'cs', volume: 0.2, shownHintIds: ['pause'] }
  const storage = new GameStorage(memoryStore({ settings: v1(settings), progress: '{"version":1,"data":' }), 'tab-a')
  assert.deepEqual(storage.loadSettings(), settings)
  assert.deepEqual(storage.loadProgress(), { completedCityIds: [], bestStars: {}, postcardCityIds: [] })
  assert.equal(storage.takeUnavailableNotice(), false)
})

test('an invalid settings field falls back on its own and the others are kept', () => {
  const storage = new GameStorage(
    memoryStore({
      settings: v1({
        locale: 'de',
        soundEnabled: false,
        volume: 1.5,
        vibrationEnabled: 'yes',
        reducedMotion: true,
        untimed: true,
        shownHintIds: ['pause', 1],
      }),
    }),
    'tab-a',
  )
  assert.deepEqual(storage.loadSettings(), {
    locale: 'en',
    soundEnabled: false,
    volume: 0.6,
    vibrationEnabled: true,
    reducedMotion: true,
    untimed: true,
    shownHintIds: [],
  })
})

test('settings are not merged between tabs, the last write wins', () => {
  const store = memoryStore()
  new GameStorage(store, 'tab-a').saveSettings({ ...defaultSettings, locale: 'cs', shownHintIds: ['pause'] })
  new GameStorage(store, 'tab-b').saveSettings({ ...defaultSettings, soundEnabled: false })
  assert.deepEqual(new GameStorage(store, 'tab-c').loadSettings(), { ...defaultSettings, soundEnabled: false })
})

test('an invalid city entry is dropped and the valid one is kept', () => {
  const storage = new GameStorage(
    memoryStore({
      progress: v1({
        completedCityIds: ['paris', 'london', 3, ''],
        bestStars: { paris: 2, london: 7, rome: 1.5, '': 1 },
        postcardCityIds: ['paris', null],
      }),
    }),
    'tab-a',
  )
  assert.deepEqual(storage.loadProgress(), {
    completedCityIds: ['london', 'paris'],
    bestStars: { paris: 2 },
    postcardCityIds: ['paris'],
  })
})

test('an invalid progress field empties only that field', () => {
  const storage = new GameStorage(
    memoryStore({ progress: v1({ completedCityIds: 'paris', bestStars: [], postcardCityIds: ['paris'] }) }),
    'tab-a',
  )
  assert.deepEqual(storage.loadProgress(), { completedCityIds: [], bestStars: {}, postcardCityIds: ['paris'] })
})

test('daily results keep valid dates and drop invalid dates and counts', () => {
  const storage = new GameStorage(
    memoryStore({
      'daily-results': v1({
        '2026-12-03': { cityId: 'rome', correct: 3 },
        '2026-12-01': { cityId: 'paris', correct: 0 },
        '2026-02-30': { cityId: 'paris', correct: 1 },
        '2026-12-4': { cityId: 'paris', correct: 1 },
        yesterday: { cityId: 'paris', correct: 1 },
        '2026-12-05': { cityId: 'paris', correct: 4 },
        '2026-12-06': { cityId: 'paris', correct: -1 },
        '2026-12-07': { cityId: 'paris', correct: 1.5 },
        '2026-12-08': { cityId: '', correct: 1 },
        '2026-12-09': null,
      }),
    }),
    'tab-a',
  )
  const results = storage.loadDailyResults()
  assert.deepEqual(results, { '2026-12-01': { cityId: 'paris', correct: 0 }, '2026-12-03': { cityId: 'rome', correct: 3 } })
  assert.deepEqual(Object.keys(results), ['2026-12-01', '2026-12-03'])
})

test('loaded progress and daily results are normalized like mergeProgress and mergeDailyResults', () => {
  const storage = new GameStorage(
    memoryStore({
      progress: v1({
        completedCityIds: ['rome', 'paris', 'rome'],
        bestStars: { rome: 1, paris: 3 },
        postcardCityIds: ['rome', 'paris', 'paris'],
      }),
      'daily-results': v1({ '2026-12-03': { cityId: 'rome', correct: 2, extra: true }, '2026-12-01': { cityId: 'paris', correct: 1 } }),
    }),
    'tab-a',
  )
  const progress = storage.loadProgress()
  assert.equal(
    JSON.stringify(progress),
    JSON.stringify({ completedCityIds: ['paris', 'rome'], bestStars: { paris: 3, rome: 1 }, postcardCityIds: ['paris', 'rome'] }),
  )
  assert.equal(
    JSON.stringify(storage.loadDailyResults()),
    JSON.stringify({ '2026-12-01': { cityId: 'paris', correct: 1 }, '2026-12-03': { cityId: 'rome', correct: 2 } }),
  )
})

test('an active run without the shape of RunState is not used and the rewards stay', () => {
  const progress = { completedCityIds: ['paris'], bestStars: { paris: 1 }, postcardCityIds: ['paris'] }
  const run = cityRun('london', 'run-1')
  const broken = [
    { ...run, phase: 'paused' },
    { ...run, stopIndex: 10 },
    { ...run, stops: [] },
    { ...run, mode: 'daily' },
    { ...run, stops: [{ ...run.stops[0], choiceIds: ['a', 'b', 'c'] }] },
    { ...run, results: [{ stopId: 'LON01', outcome: 'maybe', chosenChoiceId: null }] },
    { ...run, usedLifelines: ['fiftyFifty', 'fiftyFifty'] },
    { ...run, remainingMs: '25000' },
    { stopIndex: 0 },
  ]
  for (const brokenRun of broken) {
    const store = memoryStore({ progress: v1(progress), 'active-run': v1({ ownerTabId: 'tab-a', run: brokenRun }) })
    const storage = new GameStorage(store, 'tab-a')
    assert.equal(storage.loadActiveRun(), null, JSON.stringify(brokenRun).slice(0, 80))
    assert.equal(storage.resumeRun(), null)
    assert.equal(storage.isActiveRunOwner(), false)
    assert.deepEqual(storage.loadProgress(), progress)
  }
  const missingOwner = new GameStorage(memoryStore({ 'active-run': v1({ run }) }), 'tab-a')
  assert.equal(missingOwner.loadActiveRun(), null)
})

test('a run the reducer builds from the shortest IDs it accepts, with a pending ad attempt, is stored and loaded back', () => {
  for (const run of [cityRun('paris', 'r'), dailyRun('2026-12-02', 'r')]) {
    let state = run
    for (let index = 0; index < 2; index++) {
      state = reduceRun(state, { type: 'sceneReady', round: state.round })
      state = reduceRun(state, { type: 'choose', round: state.round, choiceId: currentStop(state).correctChoiceId, elapsedMs: 1_000 })
      state = reduceRun(state, { type: 'next', round: state.round })
    }
    state = reduceRun(state, { type: 'sceneReady', round: state.round })
    state = reduceRun(state, { type: 'pause', round: state.round, elapsedMs: 0 })
    state = reduceRun(state, { type: 'requestSkip', round: state.round, attemptId: 'a' })
    assert.equal(state.skipAttemptId, 'a')

    const store = memoryStore()
    new GameStorage(store, 't').startRun(state)
    assert.deepEqual(new GameStorage(store, 't').loadActiveRun(), state)
  }
})

test('an active run whose fields contradict each other is not used', () => {
  const city = cityRun('london', 'run-1')
  const daily = dailyRun('2026-12-02', 'run-2')
  const answered = midRun(city)
  const feedback = reduceRun(reduceRun(city, { type: 'sceneReady', round: 1 }), {
    type: 'choose',
    round: 1,
    choiceId: city.stops[0].correctChoiceId,
    elapsedMs: 1_000,
  })
  const finishedDaily = finish(daily, 3)
  const broken = [
    { ...daily, stops: stops('ROM', 4) },
    { ...finish({ ...daily, stops: stops('ROM', 5) }, 5) },
    { ...daily, daily: null },
    { ...city, stops: stops('LON', 3) },
    { ...city, daily: daily.daily },
    { ...answered, results: [] },
    { ...answered, results: [...answered.results, ...answered.results] },
    { ...feedback, results: [] },
    { ...finishedDaily, results: finishedDaily.results.slice(1) },
    { ...answered, hiddenChoiceIds: ['LON01-a'] },
    { ...answered, hiddenChoiceIds: [answered.stops[1].correctChoiceId] },
    { ...answered, untimed: true, hiddenChoiceIds: [...answered.stops[1].choiceIds] },
    { ...answered, correct: 2 },
    { ...finishedDaily, correct: 4 },
    { ...feedback, phase: 'summary' },
    { ...finish(daily, 3), stopIndex: 1, results: finishedDaily.results.slice(0, 2), correct: 2 },
    { ...answered, results: [{ ...answered.results[0], stopId: 'LON02' }] },
    { ...finishedDaily, results: [...finishedDaily.results].reverse() },
  ]
  for (const brokenRun of broken) {
    const storage = new GameStorage(memoryStore({ 'active-run': v1({ ownerTabId: 'tab-a', run: brokenRun }) }), 'tab-a')
    assert.equal(storage.loadActiveRun(), null, JSON.stringify(brokenRun).slice(0, 120))
    assert.equal(storage.isActiveRunOwner(), false)
  }
  for (const consistentRun of [city, daily, answered, feedback, finishedDaily, finish(city, 0)]) {
    const storage = new GameStorage(memoryStore({ 'active-run': v1({ ownerTabId: 'tab-a', run: consistentRun }) }), 'tab-a')
    assert.deepEqual(storage.loadActiveRun(), consistentRun)
  }
})

test('a section from a newer schema is neither used nor overwritten and is kept in memory', () => {
  const newerProgress = JSON.stringify({ version: 2, data: { cities: { paris: { stars: 3 } } } })
  const newerSettings = JSON.stringify({ version: 2, data: { locale: 'fr' } })
  const store = memoryStore({ progress: newerProgress, settings: newerSettings })
  const storage = new GameStorage(store, 'tab-a')

  assert.deepEqual(storage.loadProgress(), { completedCityIds: [], bestStars: {}, postcardCityIds: [] })
  assert.deepEqual(storage.loadSettings(), defaultSettings)

  const run = finish(cityRun('paris', 'run-1'), 9)
  storage.startRun(run)
  const completion = storage.completeCityRun(run, catalog)
  assert.equal(completion.status, 'completed')
  storage.saveSettings({ ...defaultSettings, locale: 'cs' })

  assert.equal(store.values.get('progress'), newerProgress)
  assert.equal(store.values.get('settings'), newerSettings)
  assert.deepEqual(storage.loadProgress(), { completedCityIds: ['paris'], bestStars: { paris: 3 }, postcardCityIds: ['paris'] })
  assert.equal(storage.loadSettings().locale, 'cs')
  assert.deepEqual(JSON.parse(store.values.get('active-run') ?? ''), { version: 1, data: null })
  assert.equal(storage.takeUnavailableNotice(), true)
  assert.equal(storage.takeUnavailableNotice(), false)
})

test('a newer section is not overwritten even when it is written before it was read', () => {
  const newerSettings = JSON.stringify({ version: 3, data: {} })
  const store = memoryStore({ settings: newerSettings })
  const storage = new GameStorage(store, 'tab-a')
  storage.saveSettings({ ...defaultSettings, untimed: true })
  assert.equal(store.values.get('settings'), newerSettings)
  assert.equal(storage.loadSettings().untimed, true)
  assert.equal(storage.takeUnavailableNotice(), true)
})

test('a missing, non-numeric or invalid version is damaged data that falls back and may be overwritten', () => {
  const progress = { completedCityIds: ['paris'], bestStars: { paris: 1 }, postcardCityIds: ['paris'] }
  const damaged = [
    JSON.stringify({ data: progress }),
    JSON.stringify({ version: 0, data: progress }),
    JSON.stringify({ version: '1', data: progress }),
    JSON.stringify({ version: 1.5, data: progress }),
    JSON.stringify({ version: -1, data: progress }),
    JSON.stringify({ version: null, data: progress }),
    JSON.stringify(progress),
    JSON.stringify([1, progress]),
    'null',
  ]
  for (const stored of damaged) {
    const store = memoryStore({ progress: stored })
    const storage = new GameStorage(store, 'tab-a')
    assert.deepEqual(storage.loadProgress(), { completedCityIds: [], bestStars: {}, postcardCityIds: [] }, stored)
    const run = finish(cityRun('paris', 'run-1'), 0)
    storage.startRun(run)
    storage.completeCityRun(run, catalog)
    assert.deepEqual(JSON.parse(store.values.get('progress') ?? ''), {
      version: 1,
      data: { completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] },
    })
    assert.equal(storage.takeUnavailableNotice(), false, stored)
  }
})

test('two tabs completing different cities keep both postcards and both cities', () => {
  const store = memoryStore()
  const tabA = new GameStorage(store, 'tab-a')
  const tabB = new GameStorage(store, 'tab-b')
  const staleProgressOfB = tabB.loadProgress()

  const parisRun = finish(cityRun('paris', 'run-a'), 7)
  tabA.startRun(parisRun)
  assert.equal(tabA.completeCityRun(parisRun, catalog).status, 'completed')

  const londonRun = finish(cityRun('london', 'run-b'), 4)
  tabB.startRun(londonRun)
  const completion = tabB.completeCityRun(londonRun, catalog)
  assert.deepEqual(staleProgressOfB.completedCityIds, [])
  assert.equal(completion.status, 'completed')
  assert.deepEqual(new GameStorage(store, 'tab-c').loadProgress(), {
    completedCityIds: ['london', 'paris'],
    bestStars: { london: 1, paris: 2 },
    postcardCityIds: ['london', 'paris'],
  })
})

test('two daily results of the same date from different tabs keep the first saved one', () => {
  const store = memoryStore()
  const tabA = new GameStorage(store, 'tab-a')
  const tabB = new GameStorage(store, 'tab-b')

  const runA = finish(dailyRun('2026-12-02', 'run-a'), 1)
  tabA.startRun(runA)
  assert.equal(tabA.completeDailyRun(runA).status, 'completed')

  const runB = finish(dailyRun('2026-12-02', 'run-b'), 3)
  tabB.startRun(runB)
  const completion = tabB.completeDailyRun(runB)
  assert.deepEqual(completion, { status: 'completed', dailyResults: { '2026-12-02': { cityId: 'rome', correct: 1 } } })
  assert.deepEqual(new GameStorage(store, 'tab-c').loadDailyResults(), { '2026-12-02': { cityId: 'rome', correct: 1 } })
})

test('a zero score completes Paris through the storage with one postcard and London unlocked', () => {
  const store = memoryStore()
  const storage = new GameStorage(store, 'tab-a')
  const run = finish(cityRun('paris', 'run-1'), 0)
  assert.equal(run.correct, 0)
  storage.startRun(run)

  const completion = storage.completeCityRun(run, catalog)
  assert.deepEqual(completion, {
    status: 'completed',
    summary: {
      progress: { completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] },
      stars: 0,
      postcardEarned: true,
      newlyUnlockedCityId: 'london',
    },
  })
  assert.equal(storage.loadActiveRun(), null)
  assert.deepEqual(new GameStorage(store, 'tab-b').loadProgress(), completion.status === 'completed' ? completion.summary.progress : null)
})

test('completing the same city run again adds nothing, also after it is restored from the store', () => {
  const store = memoryStore()
  const storage = new GameStorage(store, 'tab-a')
  const run = finish(cityRun('paris', 'run-1'), 9)
  storage.startRun(run)
  assert.equal(storage.completeCityRun(run, catalog).status, 'completed')
  const progressAfterFirst = store.values.get('progress')

  assert.deepEqual(storage.completeCityRun(run, catalog), { status: 'notOwner' })
  assert.equal(store.values.get('progress'), progressAfterFirst)

  // A reload after the last click, before the run was removed: the summary checkpoint is still stored.
  storage.startRun(run)
  const reloaded = new GameStorage(store, 'tab-reloaded')
  const restored = reloaded.resumeRun()
  assert.ok(restored)
  assert.equal(restored.phase, 'summary')
  const again = reloaded.completeCityRun(restored, catalog)
  assert.deepEqual(again, {
    status: 'completed',
    summary: {
      progress: { completedCityIds: ['paris'], bestStars: { paris: 3 }, postcardCityIds: ['paris'] },
      stars: 3,
      postcardEarned: false,
      newlyUnlockedCityId: null,
    },
  })
  assert.equal(store.values.get('progress'), progressAfterFirst)
  assert.equal(reloaded.loadActiveRun(), null)
})

test('completing a daily run records its start date, removes the run and leaves progress unchanged', () => {
  const progress = { completedCityIds: ['paris'], bestStars: { paris: 2 }, postcardCityIds: ['paris'] }
  const store = memoryStore({ progress: v1(progress) })
  const storage = new GameStorage(store, 'tab-a')
  // Started before midnight, finished after it: the result belongs to the start date.
  const run = finish(dailyRun('2026-12-02', 'run-1'), 2)
  storage.startRun(run)

  assert.deepEqual(storage.completeDailyRun(run), {
    status: 'completed',
    dailyResults: { '2026-12-02': { cityId: 'rome', correct: 2 } },
  })
  assert.equal(storage.loadActiveRun(), null)
  assert.deepEqual(storage.loadProgress(), progress)
  assert.equal(store.values.get('progress'), v1(progress))
  assert.deepEqual(storage.completeDailyRun(run), { status: 'notOwner' })
})

test('completion rejects a run that is not finished or has the other mode', () => {
  const storage = new GameStorage(memoryStore(), 'tab-a')
  const unfinished = cityRun('paris', 'run-1')
  storage.startRun(unfinished)
  assert.throws(() => storage.completeCityRun(unfinished, catalog))
  assert.throws(() => storage.completeCityRun(finish(dailyRun('2026-12-02', 'run-2'), 1), catalog))
  assert.throws(() => storage.completeDailyRun(finish(unfinished, 1)))
  assert.deepEqual(storage.loadActiveRun(), unfinished)
})

test('the store holds at most one active run; a new run replaces it and discarding keeps rewards and settings', () => {
  const store = memoryStore()
  const storage = new GameStorage(store, 'tab-a')
  const settings = { ...defaultSettings, locale: 'cs' as const }
  storage.saveSettings(settings)
  const parisRun = finish(cityRun('paris', 'run-1'), 5)
  storage.startRun(parisRun)
  storage.completeCityRun(parisRun, catalog)

  const londonRun = cityRun('london', 'run-2')
  storage.startRun(londonRun)
  const dailyRunState = dailyRun('2026-12-02', 'run-3')
  storage.startRun(dailyRunState)
  assert.deepEqual(storage.loadActiveRun(), dailyRunState)
  assert.equal(storage.saveRunCheckpoint(londonRun), 'notOwner')
  assert.equal(storage.discardRun('run-2'), 'notOwner')
  assert.deepEqual(storage.loadActiveRun(), dailyRunState)

  assert.equal(storage.discardRun('run-3'), 'written')
  assert.equal(storage.loadActiveRun(), null)
  assert.deepEqual(storage.loadSettings(), settings)
  assert.deepEqual(storage.loadProgress(), { completedCityIds: ['paris'], bestStars: { paris: 1 }, postcardCityIds: ['paris'] })
  assert.equal(storage.discardRun('run-3'), 'notOwner')
})

test('a checkpoint of the owned run is saved and read back', () => {
  const store = memoryStore()
  const storage = new GameStorage(store, 'tab-a')
  const run = cityRun('paris', 'run-1')
  storage.startRun(run)
  const checkpoint = midRun(run)
  assert.equal(storage.saveRunCheckpoint(checkpoint), 'written')
  assert.deepEqual(new GameStorage(store, 'tab-b').loadActiveRun(), checkpoint)
})

test('the tab that resumes the run owns it and the previous tab can no longer write it', () => {
  const store = memoryStore()
  const tabA = new GameStorage(store, 'tab-a')
  const tabB = new GameStorage(store, 'tab-b')
  const run = cityRun('paris', 'run-1')
  tabA.startRun(run)
  assert.equal(ownsActiveRun(store.read(storageKeys.activeRun), 'tab-a'), true)
  assert.equal(ownsActiveRun(store.read(storageKeys.activeRun), 'tab-b'), false)

  const resumedByB = tabB.resumeRun()
  assert.ok(resumedByB)
  const storedByB = store.read(storageKeys.activeRun)
  assert.equal(ownsActiveRun(storedByB, 'tab-a'), false)
  assert.equal(ownsActiveRun(storedByB, 'tab-b'), true)
  assert.equal(tabA.isActiveRunOwner(), false)
  assert.equal(tabB.isActiveRunOwner(), true)

  const finishedByA = finish(midRun(run), 10)
  assert.equal(tabA.saveRunCheckpoint(midRun(run)), 'notOwner')
  assert.equal(tabA.discardRun('run-1'), 'notOwner')
  assert.deepEqual(tabA.completeCityRun(finishedByA, catalog), { status: 'notOwner' })
  assert.equal(store.read(storageKeys.activeRun), storedByB)
  assert.equal(store.read(storageKeys.progress), null)

  assert.equal(tabB.saveRunCheckpoint(midRun(resumedByB)), 'written')
})

test('completing a daily run from a tab that no longer owns it writes no daily result', () => {
  const earlierResults = v1({ '2026-12-01': { cityId: 'paris', correct: 2 } })
  const store = memoryStore({ 'daily-results': earlierResults })
  const tabA = new GameStorage(store, 'tab-a')
  const tabB = new GameStorage(store, 'tab-b')
  const run = dailyRun('2026-12-02', 'run-1')
  tabA.startRun(run)
  assert.ok(tabB.resumeRun())
  const storedByB = store.read(storageKeys.activeRun)

  assert.deepEqual(tabA.completeDailyRun(finish(run, 3)), { status: 'notOwner' })
  assert.equal(store.read(storageKeys.dailyResults), earlierResults)
  assert.equal(store.read(storageKeys.activeRun), storedByB)
  assert.deepEqual(tabA.loadDailyResults(), { '2026-12-01': { cityId: 'paris', correct: 2 } })
})

test('completing a run that is no longer the active one adds no rewards', () => {
  const store = memoryStore()
  const storage = new GameStorage(store, 'tab-a')
  const oldRun = finish(cityRun('paris', 'run-old'), 10)
  storage.startRun(oldRun)
  storage.startRun(cityRun('london', 'run-new'))
  assert.deepEqual(storage.completeCityRun(oldRun, catalog), { status: 'notOwner' })
  assert.equal(store.read(storageKeys.progress), null)
  assert.equal(storage.loadActiveRun()?.runId, 'run-new')
})

test('ownsActiveRun treats a missing, damaged, newer or empty value as not owned', () => {
  const run = cityRun('paris', 'run-1')
  assert.equal(ownsActiveRun(null, 'tab-a'), false)
  assert.equal(ownsActiveRun('{', 'tab-a'), false)
  assert.equal(ownsActiveRun(v1(null), 'tab-a'), false)
  assert.equal(ownsActiveRun(v1({ ownerTabId: 'tab-a', run: { ...run, phase: 'over' } }), 'tab-a'), false)
  assert.equal(ownsActiveRun(JSON.stringify({ version: 2, data: { ownerTabId: 'tab-a', run } }), 'tab-a'), false)
  assert.equal(ownsActiveRun(v1({ ownerTabId: 'tab-a', run }), 'tab-a'), true)
})

test('a resumed run is paused without a pending ad and keeps stop, phase, time, lifelines, results and order', () => {
  const store = memoryStore()
  const run = cityRun('paris', 'run-1')
  const tabA = new GameStorage(store, 'tab-a')
  tabA.startRun(run)
  // An ad attempt interrupted by the reload; skip is offered only from the third stop, so it is set directly.
  const checkpoint = { ...reduceRun(midRun(run), { type: 'pause', round: 2, elapsedMs: 500 }), skipAttemptId: 'ad-1' }
  assert.equal(tabA.saveRunCheckpoint(checkpoint), 'written')

  const resumed = new GameStorage(store, 'tab-b').resumeRun()
  assert.ok(resumed)
  assert.equal(resumed.paused, true)
  assert.equal(resumed.skipAttemptId, null)
  assert.deepEqual({ ...resumed, paused: checkpoint.paused, skipAttemptId: checkpoint.skipAttemptId }, checkpoint)
  assert.equal(resumed.stopIndex, 1)
  assert.equal(resumed.phase, 'question')
  assert.equal(resumed.remainingMs, 25_000 - 4_500)
  assert.deepEqual(resumed.usedLifelines, ['fiftyFifty'])
  assert.deepEqual(resumed.stops.map((stop) => stop.choiceIds), run.stops.map((stop) => stop.choiceIds))

  const runningCheckpoint = midRun(run)
  const tabC = new GameStorage(store, 'tab-c')
  tabC.startRun(runningCheckpoint)
  assert.equal(new GameStorage(store, 'tab-d').resumeRun()?.paused, true)
})

test('a store that throws on every call keeps the game in memory and offers the notice once', () => {
  const store = failingStore({ read: true, write: true })
  const storage = new GameStorage(store, 'tab-a')

  assert.deepEqual(storage.loadSettings(), defaultSettings)
  assert.equal(storage.takeUnavailableNotice(), true)
  storage.saveSettings({ ...defaultSettings, locale: 'cs' })
  assert.equal(storage.loadSettings().locale, 'cs')

  const run = cityRun('paris', 'run-1')
  storage.startRun(run)
  assert.deepEqual(storage.loadActiveRun(), run)
  assert.equal(storage.isActiveRunOwner(), true)
  assert.equal(storage.saveRunCheckpoint(midRun(run)), 'written')
  assert.deepEqual(storage.resumeRun(), { ...midRun(run), paused: true })
  const completion = storage.completeCityRun(finish(midRun(run), 10), catalog)
  assert.equal(completion.status, 'completed')
  assert.deepEqual(storage.loadProgress().postcardCityIds, ['paris'])
  assert.equal(storage.loadActiveRun(), null)

  const daily = finish(dailyRun('2026-12-02', 'run-2'), 3)
  storage.startRun(daily)
  assert.equal(storage.completeDailyRun(daily).status, 'completed')
  assert.deepEqual(storage.loadDailyResults(), { '2026-12-02': { cityId: 'rome', correct: 3 } })

  assert.ok(store.failures > 1)
  assert.equal(store.values.size, 0)
  assert.equal(storage.takeUnavailableNotice(), false)
})

test('a store whose writes fail keeps the written data readable in the session and does not overwrite the store', () => {
  const progress = { completedCityIds: ['paris'], bestStars: { paris: 1 }, postcardCityIds: ['paris'] }
  const store = failingStore({ read: false, write: true }, { progress: v1(progress) })
  const storage = new GameStorage(store, 'tab-a')
  assert.deepEqual(storage.loadProgress(), progress)
  assert.equal(storage.takeUnavailableNotice(), false)

  const run = finish(cityRun('london', 'run-1'), 9)
  storage.startRun(run)
  assert.equal(storage.completeCityRun(run, catalog).status, 'completed')
  assert.deepEqual(storage.loadProgress(), {
    completedCityIds: ['london', 'paris'],
    bestStars: { london: 3, paris: 1 },
    postcardCityIds: ['london', 'paris'],
  })
  storage.saveSettings({ ...defaultSettings, reducedMotion: true })
  assert.equal(storage.loadSettings().reducedMotion, true)
  assert.equal(store.values.get('progress'), v1(progress))
  assert.equal(storage.takeUnavailableNotice(), true)
  assert.equal(storage.takeUnavailableNotice(), false)
})

/** Writes to `failingKey` throw until `healed`, as after a full quota is freed by a reload. */
function storeFailingWritesTo(failingKey: string): TestStore & { healed: boolean } {
  const store = memoryStore()
  const partial = {
    values: store.values,
    healed: false,
    read: store.read,
    write: (key: string, value: string) => {
      if (key === failingKey && !partial.healed) throw new Error('QuotaExceededError')
      store.write(key, value)
    },
  }
  return partial
}

function storedRun(store: TestStore): unknown {
  return (JSON.parse(store.values.get('active-run') ?? '') as { data: { run: unknown } | null }).data?.run
}

test('a city run whose progress write fails stays stored and completes once after a reload', () => {
  const store = storeFailingWritesTo('progress')
  const storage = new GameStorage(store, 'tab-a')
  const run = finish(cityRun('paris', 'run-1'), 9)
  storage.startRun(run)

  const first = storage.completeCityRun(run, catalog)
  assert.equal(first.status === 'completed' && first.summary.postcardEarned, true)
  assert.equal(store.values.has('progress'), false)
  assert.deepEqual(storedRun(store), run)
  assert.equal(storage.loadActiveRun(), null)
  assert.deepEqual(storage.completeCityRun(run, catalog), { status: 'notOwner' })
  assert.deepEqual(storage.loadProgress().postcardCityIds, ['paris'])
  assert.equal(storage.takeUnavailableNotice(), true)

  store.healed = true
  const reloaded = new GameStorage(store, 'tab-reloaded')
  const restored = reloaded.resumeRun()
  assert.ok(restored)
  assert.equal(restored.phase, 'summary')
  const again = reloaded.completeCityRun(restored, catalog)
  assert.deepEqual(again, {
    status: 'completed',
    summary: {
      progress: { completedCityIds: ['paris'], bestStars: { paris: 3 }, postcardCityIds: ['paris'] },
      stars: 3,
      postcardEarned: true,
      newlyUnlockedCityId: 'london',
    },
  })
  assert.equal(store.values.get('progress'), v1(again.status === 'completed' ? again.summary.progress : null))
  assert.equal(storedRun(store), undefined)
  assert.deepEqual(reloaded.completeCityRun(restored, catalog), { status: 'notOwner' })
  assert.equal(reloaded.takeUnavailableNotice(), false)
})

test('a daily run whose result write fails stays stored and records one result after a reload', () => {
  const store = storeFailingWritesTo('daily-results')
  const storage = new GameStorage(store, 'tab-a')
  const run = finish(dailyRun('2026-12-02', 'run-1'), 2)
  storage.startRun(run)

  assert.equal(storage.completeDailyRun(run).status, 'completed')
  assert.equal(store.values.has('daily-results'), false)
  assert.deepEqual(storedRun(store), run)
  assert.equal(storage.loadActiveRun(), null)
  assert.deepEqual(storage.loadDailyResults(), { '2026-12-02': { cityId: 'rome', correct: 2 } })

  store.healed = true
  const reloaded = new GameStorage(store, 'tab-reloaded')
  const restored = reloaded.resumeRun()
  assert.ok(restored)
  assert.deepEqual(reloaded.completeDailyRun(restored), {
    status: 'completed',
    dailyResults: { '2026-12-02': { cityId: 'rome', correct: 2 } },
  })
  assert.equal(store.values.get('daily-results'), v1({ '2026-12-02': { cityId: 'rome', correct: 2 } }))
  assert.equal(storedRun(store), undefined)
  assert.deepEqual(reloaded.completeDailyRun(restored), { status: 'notOwner' })
})

test('a store whose reads fail still keeps session data readable', () => {
  const store = failingStore({ read: true, write: false })
  const storage = new GameStorage(store, 'tab-a')
  storage.saveSettings({ ...defaultSettings, volume: 0.3 })
  assert.equal(storage.loadSettings().volume, 0.3)
  assert.equal(storage.takeUnavailableNotice(), true)
  assert.equal(storage.takeUnavailableNotice(), false)
})

test('the storage module touches data only through the passed KeyValueStore', () => {
  const directory = new URL('.', import.meta.url)
  for (const fileName of readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
    const source = readFileSync(new URL(fileName, directory), 'utf8')
    for (const forbidden of ['localStorage', 'sessionStorage', 'window', 'document', 'Date.now', 'Math.random', 'new Date()']) {
      assert.equal(source.includes(forbidden), false, `${fileName} uses ${forbidden}`)
    }
  }
})
