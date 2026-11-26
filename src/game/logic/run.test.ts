import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Route, Stop } from '../../content/types.ts'
import type { RandomSource } from './choiceOrder.ts'
import {
  canUseSkip,
  createRun,
  currentStop,
  reduceRun,
  restoreRun,
  startCityRun,
  timeLimitMs,
  visibleChoiceIds,
  type RunAction,
  type RunState,
  type RunStop,
} from './run.ts'

const text = { en: 'x', cs: 'x' }

function stop(id: string): Stop {
  return {
    id,
    place: text,
    difficulty: 'easy',
    sceneAsset: `scenes/${id}.webp`,
    sceneAlt: text,
    question: text,
    choices: [
      { id: `${id}-a`, label: text },
      { id: `${id}-b`, label: text },
      { id: `${id}-c`, label: text },
      { id: `${id}-d`, label: text },
    ],
    correctChoiceId: `${id}-b`,
    feedback: text,
    sourceUrls: ['https://example.org/source'],
    photoReferenceUrls: ['https://example.org/photo'],
    verifiedOn: '2026-11-26',
    stability: 'stable',
  }
}

function route(id: string, stopPrefix: string): Route {
  return {
    id,
    name: text,
    coordinates: { lat: 0, lon: 0 },
    postcardQuestionId: `${stopPrefix}01`,
    stops: Array.from({ length: 10 }, (_, index) => stop(`${stopPrefix}${String(index + 1).padStart(2, '0')}`)),
  }
}

const paris = route('paris', 'PAR')

function seeded(seed: number): RandomSource {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

// 0.999 keeps the source order, so the displayed order is a, b, c, d and b is correct.
function cityRun(options: { untimed?: boolean; runId?: string } = {}): RunState {
  return startCityRun({ route: paris, runId: options.runId ?? 'run-1', untimed: options.untimed ?? false, random: () => 0.999 })
}

function play(run: RunState, actions: RunAction[]): RunState {
  return actions.reduce(reduceRun, run)
}

function correctId(run: RunState): string {
  return currentStop(run).correctChoiceId
}

function wrongId(run: RunState): string {
  return currentStop(run).choiceIds.find((choiceId) => choiceId !== correctId(run)) ?? ''
}

function question(run: RunState): RunState {
  return reduceRun(run, { type: 'sceneReady', round: run.round })
}

function answer(run: RunState, correct: boolean): RunState {
  const asked = question(run)
  return reduceRun(asked, {
    type: 'choose',
    round: asked.round,
    choiceId: correct ? correctId(asked) : wrongId(asked),
    elapsedMs: 1000,
  })
}

function next(run: RunState): RunState {
  return reduceRun(run, { type: 'next', round: run.round })
}

function atStopIndex(run: RunState, stopIndex: number): RunState {
  let current = run
  while (current.stopIndex < stopIndex) current = next(answer(current, true))
  return current
}

function pausedQuestion(run: RunState): RunState {
  const asked = question(run)
  return reduceRun(asked, { type: 'pause', round: asked.round, elapsedMs: 0 })
}

test('time limits follow the route stop number', () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => timeLimitMs(index + 1)),
    [25_000, 25_000, 25_000, 25_000, 20_000, 20_000, 20_000, 20_000, 18_000, 18_000],
  )
})

test('a city run starts loading the first of ten stops in route order without lifelines, results or streak', () => {
  const run = cityRun()
  assert.equal(run.mode, 'city')
  assert.equal(run.cityId, 'paris')
  assert.equal(run.daily, null)
  assert.deepEqual(
    run.stops.map((runStop) => runStop.stopId),
    paris.stops.map((routeStop) => routeStop.id),
  )
  assert.deepEqual(
    run.stops.map((runStop) => runStop.routeStopNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  )
  assert.deepEqual(
    run.stops.map((runStop) => runStop.timeLimitMs),
    [25_000, 25_000, 25_000, 25_000, 20_000, 20_000, 20_000, 20_000, 18_000, 18_000],
  )
  assert.equal(run.phase, 'loading')
  assert.equal(run.stopIndex, 0)
  assert.equal(run.remainingMs, 25_000)
  assert.equal(run.paused, false)
  assert.deepEqual(run.usedLifelines, [])
  assert.deepEqual(run.hiddenChoiceIds, [])
  assert.equal(run.skipAttemptId, null)
  assert.deepEqual(run.results, [])
  assert.equal(run.correct, 0)
  assert.equal(run.streak, 0)
  assert.equal(run.bestStreak, 0)
})

test('two different random sources give a different choice order on at least one stop', () => {
  const first = startCityRun({ route: paris, runId: 'run-1', untimed: false, random: seeded(1) })
  const second = startCityRun({ route: paris, runId: 'run-2', untimed: false, random: seeded(2) })
  assert.ok(first.stops.some((runStop, index) => runStop.choiceIds.join() !== second.stops[index].choiceIds.join()))
  for (const run of [first, second]) {
    run.stops.forEach((runStop, index) => {
      assert.deepEqual([...runStop.choiceIds].sort(), paris.stops[index].choices.map((choice) => choice.id).sort())
      assert.equal(runStop.correctChoiceId, paris.stops[index].correctChoiceId)
    })
  }
})

/** Sort rank of each source choice's English and Czech label, so the label sets order the choices differently. */
interface LabelRanks {
  en: number[]
  cs: number[]
}

const labelSets: Record<string, LabelRanks> = {
  // English sorts like the source order and Czech against it.
  Alpha: { en: [0, 1, 2, 3], cs: [3, 2, 1, 0] },
  // English sorts against the source order and Czech like it.
  Omega: { en: [3, 2, 1, 0], cs: [0, 1, 2, 3] },
  // Both languages share the text, in an order unrelated to the source.
  Sigma: { en: [2, 0, 3, 1], cs: [2, 0, 3, 1] },
}

/** The same route with its own English and Czech texts, so only the labels and the language differ. */
function relabeled(source: Route, tag: string): Route {
  const ranks = labelSets[tag]
  const label = (field: string) => ({ en: `${tag} english ${field}`, cs: `${tag} česky ${field}` })
  const choiceLabel = (choiceIndex: number, field: string) => {
    const sameText = ranks.en.join() === ranks.cs.join()
    const en = `${'ABCD'[ranks.en[choiceIndex]]} ${tag} english ${field}`
    return { en, cs: sameText ? en : `${'ABCD'[ranks.cs[choiceIndex]]} ${tag} česky ${field}` }
  }
  return {
    ...source,
    name: label(source.id),
    stops: source.stops.map((routeStop) => ({
      ...routeStop,
      place: label(`${routeStop.id} place`),
      sceneAlt: label(`${routeStop.id} scene`),
      question: label(`${routeStop.id} question`),
      feedback: label(`${routeStop.id} feedback`),
      choices: [
        { ...routeStop.choices[0], label: choiceLabel(0, routeStop.choices[0].id) },
        { ...routeStop.choices[1], label: choiceLabel(1, routeStop.choices[1].id) },
        { ...routeStop.choices[2], label: choiceLabel(2, routeStop.choices[2].id) },
        { ...routeStop.choices[3], label: choiceLabel(3, routeStop.choices[3].id) },
      ],
    })),
  }
}

test('the choice order does not depend on labels or language and the run holds no text or locale', () => {
  const choiceOrders = (run: RunState) => run.stops.map((runStop) => runStop.choiceIds)
  const unlabeled = startCityRun({ route: paris, runId: 'run-1', untimed: false, random: seeded(7) })
  assert.ok(unlabeled.stops.some((runStop, index) => runStop.choiceIds.join() !== paris.stops[index].choices.map((choice) => choice.id).join()))
  for (const tag of Object.keys(labelSets)) {
    const run = startCityRun({ route: relabeled(paris, tag), runId: 'run-1', untimed: false, random: seeded(7) })
    assert.deepEqual(choiceOrders(run), choiceOrders(unlabeled), tag)
    const json = JSON.stringify(run)
    assert.doesNotMatch(json, /Alpha|Omega|Sigma|english|česky/)
    assert.doesNotMatch(json, /"(en|cs|locale)"/)
  }
})

const budapest = route('budapest', 'B')
budapest.stops[8] = {
  ...stop('B09'),
  choices: [
    { id: 'M1', label: text },
    { id: 'M2', label: text },
    { id: 'M3', label: text },
    { id: 'M4', label: text },
  ],
  correctChoiceId: 'M1',
}

test('a city run with a random source that always returns 0 or 0.999 has the exact choice order on every stop', () => {
  const expectedOrders = [
    { random: () => 0, order: ['b', 'c', 'd', 'a'] },
    { random: () => 0.999, order: ['a', 'b', 'c', 'd'] },
  ]
  for (const { random, order } of expectedOrders) {
    const run = startCityRun({ route: budapest, runId: 'run-1', untimed: false, random })
    run.stops.forEach((runStop) => {
      const expected = runStop.stopId === 'B09' ? ['M1', 'M2', 'M3', 'M4'] : order.map((letter) => `${runStop.stopId}-${letter}`)
      assert.deepEqual(runStop.choiceIds, expected, runStop.stopId)
    })
  }
})

test('B09 keeps its source order in a city run for any random source', () => {
  for (const random of [seeded(1), seeded(2), () => 0]) {
    const run = startCityRun({ route: budapest, runId: 'run-1', untimed: false, random })
    assert.deepEqual(run.stops[8].choiceIds, ['M1', 'M2', 'M3', 'M4'])
  }
})

test('the countdown starts only with sceneReady and actions while loading do not change the time', () => {
  const run = cityRun()
  for (const action of [
    { type: 'tick', round: 1, elapsedMs: 30_000 },
    { type: 'choose', round: 1, choiceId: correctId(run), elapsedMs: 5000 },
    { type: 'useFiftyFifty', round: 1, elapsedMs: 5000 },
    { type: 'useExtraTime', round: 1, elapsedMs: 5000 },
    { type: 'next', round: 1 },
  ] satisfies RunAction[]) {
    assert.equal(reduceRun(run, action), run)
  }
  const asked = question(run)
  assert.equal(asked.phase, 'question')
  assert.equal(asked.remainingMs, 25_000)
  assert.equal(reduceRun(asked, { type: 'tick', round: 1, elapsedMs: 4000 }).remainingMs, 21_000)
})

test('a choice with elapsedMs equal to the remaining time times out, 1 ms less is accepted', () => {
  const ready = question(next(answer(cityRun(), true)))
  const timedOut = reduceRun(ready, { type: 'choose', round: ready.round, choiceId: correctId(ready), elapsedMs: 25_000 })
  assert.equal(timedOut.phase, 'feedback')
  assert.deepEqual(timedOut.results.at(-1), { stopId: 'PAR02', outcome: 'timeout', chosenChoiceId: null })
  assert.equal(timedOut.remainingMs, 0)
  assert.equal(timedOut.streak, 0)
  assert.equal(timedOut.correct, 1)

  const accepted = reduceRun(ready, { type: 'choose', round: ready.round, choiceId: correctId(ready), elapsedMs: 24_999 })
  assert.deepEqual(accepted.results.at(-1), { stopId: 'PAR02', outcome: 'correct', chosenChoiceId: correctId(ready) })
  assert.equal(accepted.remainingMs, 1)
  assert.equal(accepted.correct, 2)
})

test('50:50 and +10 s at the deadline time out and stay unused, 1 ms earlier they apply', () => {
  const asked = question(cityRun())
  for (const type of ['useFiftyFifty', 'useExtraTime'] as const) {
    const timedOut = reduceRun(asked, { type, round: 1, elapsedMs: 25_000 })
    assert.equal(timedOut.phase, 'feedback')
    assert.equal(timedOut.results[0].outcome, 'timeout')
    assert.deepEqual(timedOut.usedLifelines, [])
    assert.deepEqual(timedOut.hiddenChoiceIds, [])

    const used = reduceRun(asked, { type, round: 1, elapsedMs: 24_999 })
    assert.equal(used.phase, 'question')
    assert.equal(used.usedLifelines.length, 1)
  }
  assert.equal(reduceRun(asked, { type: 'useExtraTime', round: 1, elapsedMs: 24_999 }).remainingMs, 10_001)
})

test('a tick that uses up the time ends the question as a timeout and resets the streak', () => {
  const asked = question(next(answer(cityRun(), true)))
  assert.equal(asked.streak, 1)
  const timedOut = reduceRun(asked, { type: 'tick', round: asked.round, elapsedMs: 30_000 })
  assert.equal(timedOut.phase, 'feedback')
  assert.equal(timedOut.results.at(-1)?.outcome, 'timeout')
  assert.equal(timedOut.streak, 0)
  assert.equal(timedOut.bestStreak, 1)
})

test('only the first choice in a round counts and actions with an old round are ignored', () => {
  const answered = answer(cityRun(), false)
  const doubleClick = reduceRun(answered, { type: 'choose', round: 1, choiceId: correctId(answered), elapsedMs: 10 })
  assert.equal(doubleClick, answered)
  assert.equal(reduceRun(answered, { type: 'useFiftyFifty', round: 1, elapsedMs: 0 }), answered)

  const moved = next(answered)
  assert.equal(moved.round, 2)
  assert.equal(reduceRun(moved, { type: 'next', round: 1 }), moved)
  assert.equal(reduceRun(moved, { type: 'sceneReady', round: 1 }), moved)
  const asked = question(moved)
  assert.equal(reduceRun(asked, { type: 'choose', round: 1, choiceId: correctId(asked), elapsedMs: 0 }), asked)
})

test('correct, correct, wrong, correct gives 3 correct, streak 1 and best streak 2', () => {
  let run = cityRun()
  for (const correct of [true, true, false]) run = next(answer(run, correct))
  run = answer(run, true)
  assert.equal(run.correct, 3)
  assert.equal(run.streak, 1)
  assert.equal(run.bestStreak, 2)
  assert.deepEqual(
    run.results.map((result) => result.outcome),
    ['correct', 'correct', 'wrong', 'correct'],
  )
})

test('50:50 hides two wrong choices, keeps the correct one and the first wrong one in displayed order', () => {
  const displayed = ['PAR01-d', 'PAR01-b', 'PAR01-a', 'PAR01-c']
  const run = createRun({
    runId: 'run-1',
    mode: 'city',
    cityId: 'paris',
    untimed: false,
    stops: [{ ...cityRun().stops[0], choiceIds: displayed }, ...cityRun().stops.slice(1)],
  })
  const halved = reduceRun(question(run), { type: 'useFiftyFifty', round: 1, elapsedMs: 0 })
  assert.deepEqual(halved.hiddenChoiceIds, ['PAR01-a', 'PAR01-c'])
  assert.deepEqual(visibleChoiceIds(halved), ['PAR01-d', 'PAR01-b'])
  assert.deepEqual(halved.usedLifelines, ['fiftyFifty'])

  const hiddenChoice = reduceRun(halved, { type: 'choose', round: 1, choiceId: 'PAR01-a', elapsedMs: 500 })
  assert.equal(hiddenChoice.phase, 'question')
  assert.deepEqual(hiddenChoice.results, [])
  assert.equal(hiddenChoice.remainingMs, 24_500)

  const secondStop = question(next(reduceRun(halved, { type: 'choose', round: 1, choiceId: 'PAR01-b', elapsedMs: 0 })))
  assert.deepEqual(secondStop.hiddenChoiceIds, [])
  const secondUse = reduceRun(secondStop, { type: 'useFiftyFifty', round: 2, elapsedMs: 0 })
  assert.deepEqual(secondUse.hiddenChoiceIds, [])
  assert.equal(visibleChoiceIds(secondUse).length, 4)
})

test('+10 s adds 10 000 ms once per run', () => {
  const extended = reduceRun(question(cityRun()), { type: 'useExtraTime', round: 1, elapsedMs: 5000 })
  assert.equal(extended.remainingMs, 30_000)
  assert.equal(reduceRun(extended, { type: 'useExtraTime', round: 1, elapsedMs: 0 }).remainingMs, 30_000)

  const later = question(next(reduceRun(extended, { type: 'choose', round: 1, choiceId: correctId(extended), elapsedMs: 0 })))
  assert.equal(reduceRun(later, { type: 'useExtraTime', round: 2, elapsedMs: 0 }).remainingMs, 25_000)
})

test('50:50 and +10 s on one question still allow a correct answer', () => {
  const run = play(question(cityRun()), [
    { type: 'useFiftyFifty', round: 1, elapsedMs: 1000 },
    { type: 'useExtraTime', round: 1, elapsedMs: 1000 },
    { type: 'choose', round: 1, choiceId: 'PAR01-b', elapsedMs: 1000 },
  ])
  assert.deepEqual([...run.usedLifelines].sort(), ['extraTime', 'fiftyFifty'])
  assert.equal(run.remainingMs, 32_000)
  assert.equal(run.results[0].outcome, 'correct')
  assert.equal(run.correct, 1)
})

test('in untimed mode a large elapsedMs never times out and +10 s is unavailable', () => {
  const asked = question(cityRun({ untimed: true }))
  const ticked = reduceRun(asked, { type: 'tick', round: 1, elapsedMs: 10_000_000 })
  assert.equal(ticked.phase, 'question')
  assert.equal(ticked.remainingMs, 25_000)
  assert.equal(reduceRun(asked, { type: 'useExtraTime', round: 1, elapsedMs: 0 }), asked)

  const chosen = reduceRun(asked, { type: 'choose', round: 1, choiceId: correctId(asked), elapsedMs: 10_000_000 })
  assert.equal(chosen.results[0].outcome, 'correct')
})

test('pause freezes the time, resume keeps it and a paused question accepts no choice or lifeline', () => {
  const asked = question(cityRun())
  const paused = reduceRun(asked, { type: 'pause', round: 1, elapsedMs: 3000 })
  assert.equal(paused.paused, true)
  assert.equal(paused.remainingMs, 22_000)

  for (const action of [
    { type: 'tick', round: 1, elapsedMs: 60_000 },
    { type: 'choose', round: 1, choiceId: correctId(asked), elapsedMs: 0 },
    { type: 'useFiftyFifty', round: 1, elapsedMs: 0 },
    { type: 'useExtraTime', round: 1, elapsedMs: 0 },
    { type: 'pause', round: 1, elapsedMs: 0 },
  ] satisfies RunAction[]) {
    assert.equal(reduceRun(paused, action), paused)
  }

  const resumed = reduceRun(paused, { type: 'resume', round: 1 })
  assert.equal(resumed.paused, false)
  assert.equal(resumed.remainingMs, 22_000)
  assert.equal(reduceRun(resumed, { type: 'resume', round: 1 }), resumed)
})

test('a pause at the deadline ends the question as a timeout', () => {
  const run = reduceRun(question(cityRun()), { type: 'pause', round: 1, elapsedMs: 25_000 })
  assert.equal(run.phase, 'feedback')
  assert.equal(run.results[0].outcome, 'timeout')
  assert.equal(run.paused, true)
  assert.equal(next(run), run)
})

test('pause while loading or in feedback does not touch the time and Next waits for resume', () => {
  const loading = reduceRun(cityRun(), { type: 'pause', round: 1, elapsedMs: 9000 })
  assert.equal(loading.paused, true)
  assert.equal(loading.remainingMs, 25_000)

  const feedback = reduceRun(answer(cityRun(), true), { type: 'pause', round: 1, elapsedMs: 9000 })
  assert.equal(feedback.paused, true)
  assert.equal(feedback.remainingMs, 24_000)
  assert.equal(next(feedback), feedback)
  assert.equal(next(reduceRun(feedback, { type: 'resume', round: 1 })).stopIndex, 1)
})

test('skip for a video is available only while paused in a question from the third stop of a city run', () => {
  const secondStop = atStopIndex(cityRun(), 1)
  assert.equal(canUseSkip(pausedQuestion(secondStop)), false)

  const thirdStop = atStopIndex(cityRun(), 2)
  assert.equal(canUseSkip(thirdStop), false)
  assert.equal(canUseSkip(question(thirdStop)), false)
  assert.equal(canUseSkip(pausedQuestion(thirdStop)), true)
  assert.equal(canUseSkip(reduceRun(answer(thirdStop, true), { type: 'pause', round: 3, elapsedMs: 0 })), false)
})

test('a three-stop daily run allows skip for a video only on its third stop', () => {
  const stops: RunStop[] = paris.stops.slice(5, 8).map((routeStop, index) => ({
    stopId: routeStop.id,
    routeStopNumber: index + 6,
    timeLimitMs: timeLimitMs(index + 6),
    choiceIds: routeStop.choices.map((choice) => choice.id),
    correctChoiceId: routeStop.correctChoiceId,
  }))
  const daily = createRun({
    runId: 'daily-1',
    mode: 'daily',
    cityId: 'paris',
    untimed: false,
    stops,
    daily: { utcDate: '2026-12-07', catalogEffectiveUtcDate: '2026-12-01' },
  })
  assert.equal(daily.remainingMs, 20_000)
  assert.deepEqual(daily.daily, { utcDate: '2026-12-07', catalogEffectiveUtcDate: '2026-12-01' })
  assert.equal(canUseSkip(pausedQuestion(daily)), false)
  assert.equal(canUseSkip(pausedQuestion(atStopIndex(daily, 1))), false)
  assert.equal(canUseSkip(pausedQuestion(atStopIndex(daily, 2))), true)

  const finished = next(answer(atStopIndex(daily, 2), false))
  assert.equal(finished.phase, 'summary')
  assert.equal(finished.correct, 2)
})

test('a completed ad skips the question, keeps the streak and the correct count and uses the lifeline once', () => {
  const paused = pausedQuestion(atStopIndex(cityRun(), 3))
  assert.equal(paused.streak, 3)
  const requested = reduceRun(paused, { type: 'requestSkip', round: 4, attemptId: 'ad-1' })
  assert.equal(requested.skipAttemptId, 'ad-1')
  assert.equal(reduceRun(requested, { type: 'requestSkip', round: 4, attemptId: 'ad-2' }), requested)

  const skipped = reduceRun(requested, { type: 'adResult', result: { attemptId: 'ad-1', outcome: 'completed' } })
  assert.equal(skipped.phase, 'feedback')
  assert.equal(skipped.paused, false)
  assert.deepEqual(skipped.results.at(-1), { stopId: 'PAR04', outcome: 'skipped', chosenChoiceId: null })
  assert.equal(skipped.streak, 3)
  assert.equal(skipped.correct, 3)
  assert.deepEqual(skipped.usedLifelines, ['skipVideo'])
  assert.equal(skipped.skipAttemptId, null)
  assert.equal(skipped.remainingMs, paused.remainingMs)

  assert.equal(reduceRun(skipped, { type: 'adResult', result: { attemptId: 'ad-1', outcome: 'completed' } }), skipped)
  const laterStop = pausedQuestion(next(skipped))
  assert.equal(canUseSkip(laterStop), false)
  assert.equal(reduceRun(laterStop, { type: 'requestSkip', round: 5, attemptId: 'ad-3' }), laterStop)
})

test('a cancelled or unavailable ad keeps the paused question, its time and the lifeline', () => {
  const paused = pausedQuestion(atStopIndex(cityRun(), 2))
  for (const outcome of ['cancelled', 'unavailable'] as const) {
    const requested = reduceRun(paused, { type: 'requestSkip', round: 3, attemptId: 'ad-1' })
    const failed = reduceRun(requested, { type: 'adResult', result: { attemptId: 'ad-1', outcome } })
    assert.equal(failed.phase, 'question')
    assert.equal(failed.paused, true)
    assert.equal(failed.remainingMs, paused.remainingMs)
    assert.equal(failed.skipAttemptId, null)
    assert.deepEqual(failed.usedLifelines, [])
    assert.equal(canUseSkip(failed), true)
    assert.equal(reduceRun(failed, { type: 'adResult', result: { attemptId: 'ad-1', outcome: 'completed' } }), failed)
  }
})

test('ad results with a foreign ID or without a running attempt are ignored', () => {
  const paused = pausedQuestion(atStopIndex(cityRun(), 2))
  assert.equal(reduceRun(paused, { type: 'adResult', result: { attemptId: 'ad-1', outcome: 'completed' } }), paused)

  const requested = reduceRun(paused, { type: 'requestSkip', round: 3, attemptId: 'ad-1' })
  assert.equal(reduceRun(requested, { type: 'adResult', result: { attemptId: 'ad-0', outcome: 'completed' } }), requested)
})

test('resuming abandons a running ad attempt so its late result is ignored', () => {
  const requested = reduceRun(pausedQuestion(atStopIndex(cityRun(), 2)), { type: 'requestSkip', round: 3, attemptId: 'ad-1' })
  const resumed = reduceRun(requested, { type: 'resume', round: 3 })
  assert.equal(resumed.skipAttemptId, null)
  assert.equal(reduceRun(resumed, { type: 'adResult', result: { attemptId: 'ad-1', outcome: 'completed' } }), resumed)
})

test('Next moves to the next stop with a new round and after the tenth stop to the summary', () => {
  const answered = answer(cityRun(), true)
  const moved = next(answered)
  assert.equal(moved.phase, 'loading')
  assert.equal(moved.stopIndex, 1)
  assert.equal(moved.round, 2)
  assert.equal(moved.remainingMs, 25_000)

  const lastStop = answer(atStopIndex(cityRun(), 9), true)
  assert.equal(lastStop.remainingMs, 17_000)
  const finished = next(lastStop)
  assert.equal(finished.phase, 'summary')
  assert.equal(finished.correct, 10)
  assert.equal(reduceRun(finished, { type: 'next', round: finished.round }), finished)
})

test('ten timeouts finish the run with zero correct', () => {
  let run = cityRun()
  for (let stopIndex = 0; stopIndex < 10; stopIndex++) {
    const asked = question(run)
    run = next(reduceRun(asked, { type: 'tick', round: asked.round, elapsedMs: 60_000 }))
  }
  assert.equal(run.phase, 'summary')
  assert.equal(run.correct, 0)
  assert.equal(run.results.length, 10)
  assert.ok(run.results.every((result) => result.outcome === 'timeout'))
})

test('a run restored from JSON keeps its phase, stop, lifelines, results, time and choice order, paused and without an ad attempt', () => {
  const played = play(question(atStopIndex(startCityRun({ route: paris, runId: 'run-1', untimed: false, random: seeded(7) }), 2)), [
    { type: 'useFiftyFifty', round: 3, elapsedMs: 4000 },
    { type: 'pause', round: 3, elapsedMs: 1500 },
    { type: 'requestSkip', round: 3, attemptId: 'ad-1' },
  ])
  const restored = restoreRun(JSON.parse(JSON.stringify(played)) as RunState)
  assert.equal(restored.phase, 'question')
  assert.equal(restored.stopIndex, 2)
  assert.equal(restored.remainingMs, 19_500)
  assert.deepEqual(restored.usedLifelines, ['fiftyFifty'])
  assert.deepEqual(restored.hiddenChoiceIds, played.hiddenChoiceIds)
  assert.deepEqual(restored.results, played.results)
  assert.deepEqual(restored.stops, played.stops)
  assert.equal(restored.paused, true)
  assert.equal(restored.skipAttemptId, null)
  assert.equal(canUseSkip(restored), true)

  const resumed = reduceRun(restored, { type: 'resume', round: 3 })
  assert.equal(resumed.remainingMs, 19_500)
})

test('a run restored while loading or in feedback comes back paused', () => {
  assert.equal(restoreRun(cityRun()).paused, true)
  const feedback = restoreRun(JSON.parse(JSON.stringify(answer(cityRun(), true))) as RunState)
  assert.equal(feedback.phase, 'feedback')
  assert.equal(feedback.paused, true)
})

test('a new run of the same route has a new ID, new permutations and nothing from the previous run', () => {
  const previous = play(question(startCityRun({ route: paris, runId: 'run-1', untimed: false, random: seeded(1) })), [
    { type: 'useFiftyFifty', round: 1, elapsedMs: 0 },
    { type: 'useExtraTime', round: 1, elapsedMs: 0 },
    { type: 'choose', round: 1, choiceId: 'PAR01-b', elapsedMs: 0 },
  ])
  const restarted = startCityRun({ route: paris, runId: 'run-2', untimed: false, random: seeded(2) })
  assert.equal(restarted.runId, 'run-2')
  assert.ok(restarted.stops.some((runStop, index) => runStop.choiceIds.join() !== previous.stops[index].choiceIds.join()))
  assert.deepEqual(restarted.usedLifelines, [])
  assert.deepEqual(restarted.results, [])
  assert.equal(restarted.correct, 0)
  assert.equal(restarted.streak, 0)
  assert.equal(restarted.bestStreak, 0)
  assert.equal(restarted.phase, 'loading')
})

test('a run with an empty run, city, stop or choice ID and a skip request with an empty attempt ID are rejected', () => {
  const stops = cityRun().stops
  const base = { runId: 'run-1', mode: 'city' as const, cityId: 'paris', untimed: false, stops }
  assert.throws(() => createRun({ ...base, runId: '' }), Error)
  assert.throws(() => createRun({ ...base, cityId: '' }), Error)
  assert.throws(() => createRun({ ...base, stops: [{ ...stops[0], stopId: '' }, ...stops.slice(1)] }), Error)
  assert.throws(() => createRun({ ...base, stops: [...stops.slice(0, 9), { ...stops[9], choiceIds: ['', 'b', 'c', 'd'] }] }), Error)
  assert.throws(() => startCityRun({ route: paris, runId: '', untimed: false, random: () => 0 }), Error)

  const paused = pausedQuestion(atStopIndex(cityRun(), 2))
  assert.throws(() => reduceRun(paused, { type: 'requestSkip', round: paused.round, attemptId: '' }), Error)
  assert.throws(() => reduceRun(paused, { type: 'requestSkip', round: paused.round - 1, attemptId: '' }), Error)
  const finished = next(answer(atStopIndex(cityRun(), 9), true))
  assert.equal(finished.phase, 'summary')
  assert.throws(() => reduceRun(finished, { type: 'requestSkip', round: finished.round, attemptId: '' }), Error)
  assert.equal(reduceRun(paused, { type: 'requestSkip', round: paused.round, attemptId: 'ad-1' }).skipAttemptId, 'ad-1')
})

test('the reducer does not change the run it receives', () => {
  const asked = question(cityRun())
  const snapshot = structuredClone(asked)
  play(asked, [
    { type: 'useFiftyFifty', round: 1, elapsedMs: 100 },
    { type: 'useExtraTime', round: 1, elapsedMs: 100 },
    { type: 'choose', round: 1, choiceId: correctId(asked), elapsedMs: 100 },
  ])
  reduceRun(asked, { type: 'tick', round: 1, elapsedMs: 60_000 })
  assert.deepEqual(asked, snapshot)
})
