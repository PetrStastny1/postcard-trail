import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Catalog, Route } from '../content/types.ts'
import type { Feedback } from '../game/feedback/index.ts'
import { dailyPlan, startDailyRun } from '../game/logic/daily.ts'
import { restoreRun, startCityRun, type RunState } from '../game/logic/run.ts'
import { GameStorage } from '../game/storage/gameStorage.ts'
import { storageKeys } from '../game/storage/schema.ts'
import type { AnalyticsEvent, KeyValueStore, PlatformAdapter, RewardedAdOutcome, RewardedAdRequest } from '../platform/types.ts'
import { createRunController, type RunCompletion, type RunListener, type SkipSpotListener } from './runController.ts'
import { completeFinishedRun } from './runs.ts'

// The adapter, the feedback and the clock are the boundary of the app; the storage and the rules are the real ones.

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const catalog = readJson('../content/catalog.json') as Catalog
const paris = readJson('../content/routes/paris.json') as Route

function memoryStore(): KeyValueStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return { values, read: (key) => values.get(key) ?? null, write: (key, value) => void values.set(key, value) }
}

function harness(run: RunState, options: { store?: KeyValueStore; tabId?: string; start?: boolean } = {}) {
  const calls: string[] = []
  const events: AnalyticsEvent[] = []
  const adRequests: RewardedAdRequest[] = []
  const store = options.store ?? memoryStore()
  const storage = new GameStorage(store, options.tabId ?? 'tab-1')
  if (options.start ?? true) storage.startRun(run)
  let clock = 1_000
  const adapter: PlatformAdapter = {
    name: 'local',
    store,
    init: () => Promise.resolve(),
    loadingStarted: () => calls.push('loadingStarted'),
    loadingFinished: () => calls.push('loadingFinished'),
    gameplayStart: () => calls.push('gameplayStart'),
    gameplayStop: () => calls.push('gameplayStop'),
    rewardedAdsOffered: () => false,
    requestRewardedAd: (request) => {
      adRequests.push(request)
      calls.push(`requestRewardedAd ${request.attemptId}`)
    },
    track: (event) => {
      events.push(event)
      calls.push(`track ${event.name}`)
    },
    recordedEvents: () => events,
    portalAudioMuted: () => false,
    onPortalAudioMutedChange: () => undefined,
  }
  const feedback: Feedback = {
    unlock: () => calls.push('unlock'),
    play: (cue) => calls.push(`play ${cue}`),
    setSoundEnabled: () => undefined,
    setVibrationEnabled: () => undefined,
    muteForAd: () => calls.push('muteForAd'),
    restoreAfterAd: () => calls.push('restoreAfterAd'),
    setPortalMuted: () => undefined,
  }
  const listened: string[] = []
  const completions: RunCompletion[] = []
  const listener: RunListener = {
    changed: () => listened.push('changed'),
    finished: (completion) => {
      listened.push('finished')
      completions.push(completion)
    },
    ownerLost: () => listened.push('ownerLost'),
  }
  const controller = createRunController({ run, storage, adapter, feedback, catalog, now: () => clock, listener })
  return {
    controller,
    storage,
    store,
    calls,
    events,
    listened,
    adRequests,
    completions,
    advance: (ms: number) => (clock += ms),
    takeCalls: () => calls.splice(0),
  }
}

const newParisRun = () => startCityRun({ route: paris, runId: 'run-1', untimed: false, random: () => 0 })
const correctChoiceId = (run: RunState) => run.stops[run.stopIndex].correctChoiceId
const wrongChoiceId = (run: RunState) => run.stops[run.stopIndex].choiceIds.find((choiceId) => choiceId !== correctChoiceId(run)) ?? ''
const savedRun = (store: KeyValueStore): RunState => JSON.parse(store.read(storageKeys.activeRun) ?? 'null').data.run

test('the countdown starts at sceneReady and counts the time between actions, never the pause', () => {
  const { controller, advance, store } = harness(newParisRun())
  advance(5_000)
  assert.equal(controller.remainingMs(), 25_000, 'loading does not count')
  controller.sceneReady()
  advance(3_200)
  assert.equal(controller.remainingMs(), 21_800)
  controller.tick()
  assert.equal(savedRun(store).remainingMs, 21_800, 'a tick saves a checkpoint')
  controller.pause()
  advance(60_000)
  assert.equal(controller.remainingMs(), 21_800)
  controller.resume()
  advance(1_000)
  assert.equal(controller.remainingMs(), 20_800)
  controller.useExtraTime()
  assert.equal(controller.run.remainingMs, 30_800)
})

test('a choice just before zero is accepted and the deadline itself is a timeout', () => {
  const early = harness(newParisRun())
  early.controller.sceneReady()
  early.advance(24_999)
  early.controller.choose(correctChoiceId(early.controller.run))
  assert.equal(early.controller.run.results[0].outcome, 'correct')

  const late = harness(newParisRun())
  late.controller.sceneReady()
  late.advance(25_000)
  late.controller.tick()
  assert.equal(late.controller.run.results[0].outcome, 'timeout')
})

test('gameplay signals follow the question the player opened, pauses, zoom, hiding and leaving', () => {
  const { controller, takeCalls, advance } = harness(newParisRun())
  const signals = () => takeCalls().filter((call) => call.startsWith('gameplay'))
  controller.sceneReady()
  assert.deepEqual(signals(), ['gameplayStart'])
  controller.choose(correctChoiceId(controller.run))
  assert.deepEqual(signals(), [], 'the result keeps playing')
  controller.next()
  controller.sceneReady()
  assert.deepEqual(signals(), ['gameplayStart'], 'the question after Next is opened by the player')
  controller.pause()
  assert.deepEqual(signals(), ['gameplayStop'])
  controller.resume()
  assert.deepEqual(signals(), ['gameplayStart'])
  controller.zoomOpened()
  assert.deepEqual(signals(), ['gameplayStop'])
  advance(4_000)
  controller.zoomClosed(true)
  assert.deepEqual(signals(), ['gameplayStart'])
  assert.equal(controller.remainingMs(), 25_000, 'the zoom held the time')
  controller.pageHidden()
  assert.deepEqual(signals(), ['gameplayStop'])
  assert.equal(controller.run.paused, true)
  controller.resume()
  signals()
  controller.leave()
  assert.deepEqual(signals(), ['gameplayStop'])
})

test('a restored run waits paused without gameplayStart until Continue', () => {
  const first = harness(newParisRun())
  first.controller.sceneReady()
  first.advance(2_000)
  first.controller.leave()
  // A reload is a new tab, which takes the run over by resuming it.
  const restored = new GameStorage(first.store, 'tab-2').resumeRun()
  assert.ok(restored)
  const { controller, takeCalls } = harness(restored, { store: first.store, tabId: 'tab-2', start: false })
  controller.sceneReady()
  assert.ok(!takeCalls().includes('gameplayStart'))
  assert.equal(controller.remainingMs(), 23_000)
  controller.resume()
  assert.ok(takeCalls().includes('gameplayStart'))
})

test('a choice plays the click and then the verdict cue; a timeout plays the wrong cue', () => {
  const right = harness(newParisRun())
  right.controller.sceneReady()
  right.takeCalls()
  right.controller.choose(correctChoiceId(right.controller.run))
  assert.deepEqual(right.takeCalls().filter((call) => call.startsWith('play')), ['play choice', 'play correct'])

  const wrong = harness(newParisRun())
  wrong.controller.sceneReady()
  wrong.takeCalls()
  wrong.controller.choose(wrongChoiceId(wrong.controller.run))
  wrong.controller.choose(correctChoiceId(wrong.controller.run))
  assert.deepEqual(wrong.takeCalls().filter((call) => call.startsWith('play')), ['play choice', 'play wrong'], 'a second choice does nothing')
})

test('a hidden choice cannot be chosen and lifelines are tracked once', () => {
  const { controller, events } = harness(newParisRun())
  controller.sceneReady()
  controller.useFiftyFifty()
  controller.useFiftyFifty()
  controller.useExtraTime()
  const hidden = controller.run.hiddenChoiceIds[0]
  controller.choose(hidden)
  assert.equal(controller.run.phase, 'question')
  assert.deepEqual(
    events.filter((event) => event.name === 'lifeline_used'),
    [
      { name: 'lifeline_used', lifeline: 'fiftyFifty', mode: 'city' },
      { name: 'lifeline_used', lifeline: 'extraTime', mode: 'city' },
    ],
  )
})

test('a whole Paris run tracks each question once, completes with the rewards and the postcard cue, and stops play', () => {
  const { controller, events, storage, takeCalls, listened, completions } = harness(newParisRun())
  for (let stop = 0; stop < 10; stop++) {
    controller.sceneReady()
    controller.choose(wrongChoiceId(controller.run))
    controller.next()
  }
  assert.deepEqual(
    events.filter((event) => event.name === 'question_resolved').map((event) => event.name === 'question_resolved' && [event.index, event.outcome, event.mode]),
    Array.from({ length: 10 }, (_unused, index) => [index + 1, 'wrong', 'city']),
  )
  assert.deepEqual(events.slice(-2), [
    { name: 'route_completed', cityId: 'paris', mode: 'city', correct: 0, stars: 0 },
    { name: 'postcard_unlocked', cityId: 'paris' },
  ])
  const calls = takeCalls()
  assert.deepEqual(calls.slice(-4), ['gameplayStop', 'track route_completed', 'track postcard_unlocked', 'play postcard'])
  assert.deepEqual(listened.at(-1), 'finished')
  assert.deepEqual(completions, [
    {
      mode: 'city',
      run: controller.run,
      summary: {
        progress: { completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] },
        stars: 0,
        postcardEarned: true,
        newlyUnlockedCityId: 'london',
      },
    },
  ])
  assert.equal(storage.loadActiveRun(), null)
  assert.deepEqual(storage.loadProgress(), { completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] })
  controller.next()
  assert.equal(events.length, 12, 'nothing after the finish')
})

test('a daily run completes with the daily events', () => {
  const plan = dailyPlan(catalog, '2026-12-05')
  assert.ok(plan)
  const route = readJson(`../content/routes/${plan.cityId}.json`) as Route
  const { controller, events, storage, calls, completions } = harness(startDailyRun({ route, plan, runId: 'daily-1', untimed: false }))
  for (let stop = 0; stop < 3; stop++) {
    controller.sceneReady()
    controller.choose(correctChoiceId(controller.run))
    controller.next()
  }
  assert.deepEqual(events.slice(-2), [
    { name: 'route_completed', cityId: plan.cityId, mode: 'daily', correct: 3, stars: 0 },
    { name: 'daily_completed', utcDate: '2026-12-05', correct: 3 },
  ])
  assert.deepEqual(storage.loadDailyResults(), { '2026-12-05': { cityId: plan.cityId, correct: 3 } })
  assert.ok(calls.lastIndexOf('gameplayStop') > calls.lastIndexOf('gameplayStart'), 'the summary stops play')
  assert.deepEqual(completions, [
    { mode: 'daily', run: controller.run, utcDate: '2026-12-05', dailyResults: { '2026-12-05': { cityId: plan.cityId, correct: 3 } } },
  ])
})

test('leaving saves the run paused and tracks route_left once', () => {
  const { controller, events, store } = harness(newParisRun())
  controller.sceneReady()
  controller.choose(correctChoiceId(controller.run))
  controller.leave()
  controller.leave()
  assert.deepEqual(events.filter((event) => event.name === 'route_left'), [{ name: 'route_left', cityId: 'paris', mode: 'city', index: 1, reason: 'paused' }])
  assert.equal(savedRun(store).phase, 'feedback')
  assert.equal(restoreRun(savedRun(store)).paused, true)
})

test('when another tab resumes the run, the next action writes nothing and reports the lost ownership', () => {
  const first = harness(newParisRun())
  first.controller.sceneReady()
  first.advance(1_000)
  first.controller.tick()
  new GameStorage(first.store, 'tab-2').resumeRun()
  const takenOver = first.store.read(storageKeys.activeRun)
  first.advance(1_000)
  first.controller.tick()
  assert.deepEqual(first.listened.at(-1), 'ownerLost')
  assert.equal(first.controller.stopped, true)
  first.controller.choose(correctChoiceId(first.controller.run))
  first.controller.leave()
  assert.equal(first.store.read(storageKeys.activeRun), takenOver)
})

test('a choice in a tab that lost the run tracks and plays no verdict, and the time stops', () => {
  const first = harness(newParisRun())
  first.controller.sceneReady()
  first.advance(2_000)
  new GameStorage(first.store, 'tab-2').resumeRun()
  first.takeCalls()
  first.controller.choose(correctChoiceId(first.controller.run))
  assert.equal(first.events.some((event) => event.name === 'question_resolved'), false)
  assert.deepEqual(first.takeCalls(), ['play choice', 'gameplayStop'])
  assert.equal(first.listened.at(-1), 'ownerLost')
  const left = first.controller.remainingMs()
  first.advance(5_000)
  assert.equal(first.controller.remainingMs(), left)
})

test('the ownership check from a storage event stops the tab', () => {
  const { controller, listened, takeCalls } = harness(newParisRun())
  controller.sceneReady()
  takeCalls()
  controller.ownershipChecked(true)
  assert.equal(controller.stopped, false)
  controller.ownershipChecked(false)
  assert.deepEqual(listened.at(-1), 'ownerLost')
  assert.deepEqual(takeCalls(), ['gameplayStop'])
})

test('a run saved in its summary phase is completed at start once', () => {
  const store = memoryStore()
  let run = newParisRun()
  const storage = new GameStorage(store, 'old-tab')
  storage.startRun(run)
  const { controller } = harness(run, { store, tabId: 'old-tab', start: false })
  for (let stop = 0; stop < 9; stop++) {
    controller.sceneReady()
    controller.choose(wrongChoiceId(controller.run))
    controller.next()
  }
  controller.sceneReady()
  controller.choose(wrongChoiceId(controller.run))
  run = { ...controller.run, phase: 'summary' }
  storage.saveRunCheckpoint(run)

  completeFinishedRun(new GameStorage(store, 'tab-a'), catalog)
  completeFinishedRun(new GameStorage(store, 'tab-b'), catalog)
  const reloaded = new GameStorage(store, 'tab-c')
  assert.equal(reloaded.loadActiveRun(), null)
  assert.deepEqual(reloaded.loadProgress(), { completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] })
})

test('rewards that fail to reach the store leave the run saved in its summary phase, and a reload completes it', () => {
  const store = memoryStore()
  const failingStore: KeyValueStore = {
    read: store.read,
    write: (key, value) => {
      if (key === storageKeys.progress) throw new Error('QuotaExceededError')
      store.write(key, value)
    },
  }
  const { controller, events, completions, storage } = harness(newParisRun(), { store: failingStore })
  for (let stop = 0; stop < 10; stop++) {
    controller.sceneReady()
    controller.choose(wrongChoiceId(controller.run))
    controller.next()
  }
  assert.equal(completions.length, 1, 'the summary still shows')
  assert.equal(storage.takeUnavailableNotice(), true)
  assert.equal(savedRun(store).phase, 'summary')
  assert.equal(events.filter((event) => event.name === 'route_completed').length, 1)

  completeFinishedRun(new GameStorage(store, 'tab-after-reload'), catalog)
  const reloaded = new GameStorage(store, 'tab-after-reload')
  assert.equal(reloaded.loadActiveRun(), null)
  assert.deepEqual(reloaded.loadProgress(), { completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] })
})

/** A Paris run paused in the question of the third stop after two correct answers, so the skip is on offer. */
function pausedAtThirdStop() {
  const setup = harness(newParisRun())
  for (let stop = 0; stop < 2; stop++) {
    setup.controller.sceneReady()
    setup.controller.choose(correctChoiceId(setup.controller.run))
    setup.controller.next()
  }
  setup.controller.sceneReady()
  setup.advance(4_000)
  setup.controller.pause()
  setup.takeCalls()
  setup.events.length = 0
  const spot: string[] = []
  const listener: SkipSpotListener = { started: () => spot.push('started'), finished: (outcome) => spot.push(`finished ${outcome}`) }
  return { ...setup, spot, listener }
}

const answer = (request: RewardedAdRequest, outcome: RewardedAdOutcome) => request.onResult({ attemptId: request.attemptId, outcome })

test('a completed spot skips the question with the streak kept, once, and sends no gameplay signal', () => {
  const { controller, adRequests, takeCalls, events, spot, listener, store } = pausedAtThirdStop()
  assert.equal(controller.requestSkip('attempt-1', listener), true)
  assert.equal(savedRun(store).skipAttemptId, 'attempt-1')
  assert.deepEqual(takeCalls(), ['requestRewardedAd attempt-1'])
  assert.equal(controller.requestSkip('attempt-2', listener), false, 'one attempt at a time')
  const [request] = adRequests
  request.onStart()
  answer(request, 'completed')
  answer(request, 'completed')
  assert.deepEqual(takeCalls(), ['muteForAd', 'restoreAfterAd', 'track rewarded_ad_outcome', 'track question_resolved', 'track lifeline_used'])
  assert.deepEqual(spot, ['started', 'finished completed'])
  assert.deepEqual(events, [
    { name: 'rewarded_ad_outcome', outcome: 'completed' },
    { name: 'question_resolved', cityId: 'paris', index: 3, mode: 'city', outcome: 'skipped' },
    { name: 'lifeline_used', lifeline: 'skipVideo', mode: 'city' },
  ])
  assert.equal(controller.run.phase, 'feedback')
  assert.equal(controller.run.streak, 2)
  assert.equal(controller.run.correct, 2)
  assert.equal(controller.requestSkip('attempt-3', listener), false, 'the lifeline is used')
})

for (const outcome of ['cancelled', 'unavailable'] as const) {
  test(`a ${outcome} spot keeps the question paused with its time, and going back starts gameplay again`, () => {
    const { controller, adRequests, takeCalls, events, spot, listener, advance } = pausedAtThirdStop()
    controller.requestSkip('attempt-1', listener)
    takeCalls()
    if (outcome === 'cancelled') adRequests[0].onStart()
    answer(adRequests[0], outcome)
    assert.deepEqual(events, [{ name: 'rewarded_ad_outcome', outcome }])
    assert.ok(takeCalls().includes('restoreAfterAd'))
    assert.deepEqual(spot.at(-1), `finished ${outcome}`)
    assert.equal(controller.run.paused, true)
    assert.equal(controller.run.skipAttemptId, null)
    advance(30_000)
    assert.equal(controller.remainingMs(), 21_000)
    controller.resume()
    assert.deepEqual(takeCalls(), ['gameplayStart'])
    advance(1_000)
    assert.equal(controller.remainingMs(), 20_000)
    controller.pause()
    assert.equal(controller.requestSkip('attempt-2', listener), true, 'the lifeline is still there')
  })
}

test('a late completed after a cancelled spot skips nothing and is not reported again', () => {
  const { controller, adRequests, events, listener } = pausedAtThirdStop()
  controller.requestSkip('attempt-1', listener)
  adRequests[0].onStart()
  answer(adRequests[0], 'cancelled')
  controller.resume()
  answer(adRequests[0], 'completed')
  assert.equal(controller.run.phase, 'question')
  assert.deepEqual(events, [{ name: 'rewarded_ad_outcome', outcome: 'cancelled' }])
})

test('a result with a foreign attempt ID changes nothing', () => {
  const { controller, adRequests, events, spot, listener } = pausedAtThirdStop()
  controller.requestSkip('attempt-1', listener)
  adRequests[0].onResult({ attemptId: 'other', outcome: 'completed' })
  assert.equal(controller.run.skipAttemptId, 'attempt-1')
  assert.deepEqual(events, [])
  assert.deepEqual(spot, [])
})

test('a hung spot given up restores the sound, runs the question from its time and ignores the late result', () => {
  const { controller, adRequests, takeCalls, events, listener, advance } = pausedAtThirdStop()
  controller.requestSkip('attempt-1', listener)
  adRequests[0].onStart()
  takeCalls()
  advance(90_000)
  controller.abandonSkip()
  assert.deepEqual(takeCalls(), ['restoreAfterAd', 'gameplayStart'])
  assert.equal(controller.remainingMs(), 21_000)
  answer(adRequests[0], 'completed')
  assert.equal(controller.run.phase, 'question')
  assert.deepEqual(events, [])
  assert.equal(controller.run.usedLifelines.includes('skipVideo'), false)
  assert.deepEqual(takeCalls(), ['gameplayStart'], 'the adapter dropped the first start while the portal had no result')
  answer(adRequests[0], 'completed')
  assert.deepEqual(takeCalls(), [], 'a repeated late result sends nothing')
})

test('a late result of a hung spot sends no gameplay signal when the question is not running', () => {
  const { controller, adRequests, takeCalls, listener } = pausedAtThirdStop()
  controller.requestSkip('attempt-1', listener)
  adRequests[0].onStart()
  controller.abandonSkip()
  controller.pause()
  takeCalls()
  answer(adRequests[0], 'completed')
  assert.deepEqual(takeCalls(), [])
})

test('hiding the page during a spot sends no gameplay signal', () => {
  const { controller, adRequests, takeCalls, listener } = pausedAtThirdStop()
  controller.requestSkip('attempt-1', listener)
  adRequests[0].onStart()
  takeCalls()
  controller.pageHidden()
  assert.deepEqual(takeCalls(), [])
  assert.equal(controller.run.skipAttemptId, 'attempt-1')
})

test('the skip is not offered before the third stop or outside the pause', () => {
  const early = harness(newParisRun())
  early.controller.sceneReady()
  early.controller.pause()
  assert.equal(early.controller.requestSkip('attempt-1', { started() {}, finished() {} }), false)
  const { controller, adRequests, listener } = pausedAtThirdStop()
  controller.resume()
  assert.equal(controller.requestSkip('attempt-2', listener), false)
  assert.equal(early.adRequests.length + adRequests.length, 0)
})

test('a tab that loses the run during a spot restores the sound and ignores the result', () => {
  const { controller, adRequests, takeCalls, events, store, listener, spot } = pausedAtThirdStop()
  controller.requestSkip('attempt-1', listener)
  adRequests[0].onStart()
  takeCalls()
  new GameStorage(store, 'tab-2').resumeRun()
  controller.ownershipChecked(false)
  assert.deepEqual(takeCalls(), ['restoreAfterAd', 'gameplayStop'])
  answer(adRequests[0], 'completed')
  assert.deepEqual(events, [])
  assert.deepEqual(spot, ['started'])
})
