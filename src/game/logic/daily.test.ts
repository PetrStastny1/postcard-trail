import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Catalog, CatalogCity, Route, Stop } from '../../content/types.ts'
import {
  catalogVersionFor,
  dailyPlan,
  dailyStreak,
  dailyUnlocked,
  emptyDailyResults,
  fnv1a32,
  hasDailyResult,
  mergeDailyResults,
  recordDailyRun,
  startDailyRun,
  utcDateOf,
  type DailyPlan,
  type DailyResults,
} from './daily.ts'
import { emptyProgress, unlockedCityIds, type Progress } from './progress.ts'
import { currentStop, reduceRun, restoreRun, startCityRun, type RunState } from './run.ts'

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

function city(id: string): CatalogCity {
  return {
    id,
    name: text,
    coordinates: { lat: 0, lon: 0 },
    postcard: { stopId: `${id}-01`, sceneAsset: `scenes/${id}-01.webp`, sentence: text },
  }
}

function cityIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `city${index + 1}`)
}

function catalogOf(versions: { effectiveUtcDate: string; orderedCityIds: string[] }[]): Catalog {
  return { cities: versions[versions.length - 1].orderedCityIds.map(city), versions }
}

const firstEffectiveUtcDate = '2026-12-01'
const twentyCityIds = ['paris', ...cityIds(20).slice(1)]
const twentyCities = catalogOf([{ effectiveUtcDate: firstEffectiveUtcDate, orderedCityIds: twentyCityIds }])
const paris = route('paris', 'PAR')

function addDays(utcDate: string, days: number): string {
  return utcDateOf(Date.parse(`${utcDate}T00:00:00.000Z`) + days * 86_400_000)
}

function planFor(catalog: Catalog, utcDate: string): DailyPlan {
  const plan = dailyPlan(catalog, utcDate)
  assert.ok(plan, `a daily plan exists on ${utcDate}`)
  return plan
}

function dailyRun(plan: DailyPlan, dailyRoute: Route = plan.cityId === 'paris' ? paris : route(plan.cityId, plan.cityId.toUpperCase())): RunState {
  return startDailyRun({ route: dailyRoute, plan, runId: 'daily-1', untimed: false })
}

/** Answers every remaining stop correctly and ends in the summary. */
function finish(run: RunState): RunState {
  let state = run.paused ? reduceRun(run, { type: 'resume', round: run.round }) : run
  while (state.phase !== 'summary') {
    if (state.phase === 'loading') state = reduceRun(state, { type: 'sceneReady', round: state.round })
    if (state.phase === 'question') {
      state = reduceRun(state, {
        type: 'choose',
        round: state.round,
        choiceId: currentStop(state).correctChoiceId,
        elapsedMs: 1_000,
      })
    }
    state = reduceRun(state, { type: 'next', round: state.round })
  }
  return state
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

test('fnv1a32 matches the published FNV-1a 32-bit vectors as an unsigned number', () => {
  assert.equal(fnv1a32(''), 2_166_136_261)
  assert.equal(fnv1a32('a'), 3_826_002_220)
  assert.equal(fnv1a32('foobar'), 3_214_735_720)
  assert.equal(fnv1a32('2026-12-01:paris:PAR01'), 881_135_748)
})

test('fnv1a32 hashes UTF-8 bytes, not UTF-16 code units', () => {
  assert.equal(fnv1a32('é'), 513_665_217)
  assert.equal(fnv1a32('2026-12-01:zurich:ZÜR01'), 3_626_356_452)
})

test('the last millisecond of a UTC day and the first of the next are two dates', () => {
  assert.equal(utcDateOf(Date.UTC(2026, 11, 31, 23, 59, 59, 999)), '2026-12-31')
  assert.equal(utcDateOf(Date.UTC(2027, 0, 1, 0, 0, 0, 0)), '2027-01-01')
})

test('the UTC date does not depend on the local time zone', () => {
  const originalTimeZone = process.env.TZ
  const instants = [Date.UTC(2026, 11, 31, 23, 59, 59, 999), Date.UTC(2027, 0, 1, 0, 0, 0, 0)]
  try {
    process.env.TZ = 'Pacific/Kiritimati'
    const ahead = instants.map(utcDateOf)
    process.env.TZ = 'Pacific/Pago_Pago'
    const behind = instants.map(utcDateOf)
    assert.deepEqual(ahead, ['2026-12-31', '2027-01-01'])
    assert.deepEqual(behind, ahead)
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimeZone
  }
})

test('the version effective on a date is the last one not after it, and none exists before the first', () => {
  const catalog = catalogOf([
    { effectiveUtcDate: '2026-12-01', orderedCityIds: cityIds(20) },
    { effectiveUtcDate: '2027-06-01', orderedCityIds: cityIds(30) },
  ])
  assert.equal(catalogVersionFor(catalog, '2026-11-30'), null)
  assert.equal(dailyPlan(catalog, '2026-11-30'), null)
  assert.equal(catalogVersionFor(catalog, '2026-12-01')?.effectiveUtcDate, '2026-12-01')
  assert.equal(catalogVersionFor(catalog, '2027-05-31')?.effectiveUtcDate, '2026-12-01')
  assert.equal(catalogVersionFor(catalog, '2027-06-01')?.effectiveUtcDate, '2027-06-01')
  assert.equal(catalogVersionFor(catalog, '2030-01-01')?.effectiveUtcDate, '2027-06-01')
})

test('the effective day plays city 0 from stop 1', () => {
  assert.deepEqual(dailyPlan(twentyCities, firstEffectiveUtcDate), {
    utcDate: firstEffectiveUtcDate,
    catalogEffectiveUtcDate: firstEffectiveUtcDate,
    cityId: 'paris',
    firstStopNumber: 1,
  })
})

test('the schedule follows city D mod n and first stop 1 + floor(D / n) mod 8', () => {
  for (const [days, cityIndex, firstStopNumber] of [
    [1, 1, 1],
    [19, 19, 1],
    [20, 0, 2],
    [47, 7, 3],
    [159, 19, 8],
    [160, 0, 1],
    [365, 5, 3],
  ]) {
    const plan = planFor(twentyCities, addDays(firstEffectiveUtcDate, days))
    assert.equal(plan.cityId, twentyCityIds[cityIndex], `city on day ${days}`)
    assert.equal(plan.firstStopNumber, firstStopNumber, `first stop on day ${days}`)
  }
})

test('20 consecutive days of the 20-city catalog play 20 different cities', () => {
  const played = Array.from({ length: 20 }, (_, days) => planFor(twentyCities, addDays(firstEffectiveUtcDate, days)).cityId)
  assert.equal(new Set(played).size, 20)
})

function firstStopsByCity(catalog: Catalog, dayCount: number): Map<string, Set<number>> {
  const startsByCity = new Map<string, Set<number>>()
  for (let days = 0; days < dayCount; days++) {
    const plan = planFor(catalog, addDays(firstEffectiveUtcDate, days))
    const starts = startsByCity.get(plan.cityId) ?? new Set<number>()
    starts.add(plan.firstStopNumber)
    startsByCity.set(plan.cityId, starts)
  }
  return startsByCity
}

test('160 days give every city of the 20-city catalog the 8 first stops 1–8', () => {
  const startsByCity = firstStopsByCity(twentyCities, 160)
  assert.equal(startsByCity.size, 20)
  for (const [cityId, starts] of startsByCity) {
    assert.deepEqual([...starts].sort(), [1, 2, 3, 4, 5, 6, 7, 8], cityId)
  }
})

test('catalogs with 30, 40 and 47 cities give every city 8 different starts within 8n days', () => {
  for (const cityCount of [30, 40, 47]) {
    const catalog = catalogOf([{ effectiveUtcDate: firstEffectiveUtcDate, orderedCityIds: cityIds(cityCount) }])
    const startsByCity = firstStopsByCity(catalog, 8 * cityCount)
    assert.equal(startsByCity.size, cityCount)
    for (const [cityId, starts] of startsByCity) {
      assert.deepEqual([...starts].sort(), [1, 2, 3, 4, 5, 6, 7, 8], `${cityId} of ${cityCount}`)
    }
  }
})

test('a new catalog version starts a new round on its effective date and covers all its cities', () => {
  const extendedCityIds = [...twentyCityIds, ...cityIds(30).slice(20)]
  const catalog = catalogOf([
    { effectiveUtcDate: firstEffectiveUtcDate, orderedCityIds: twentyCityIds },
    { effectiveUtcDate: '2027-02-10', orderedCityIds: extendedCityIds },
  ])
  const dayBefore = planFor(catalog, '2027-02-09')
  assert.equal(dayBefore.catalogEffectiveUtcDate, firstEffectiveUtcDate)
  // 70 days after 2026-12-01: city 70 mod 20 = 10, first stop 1 + floor(70 / 20) = 4.
  assert.equal(dayBefore.cityId, twentyCityIds[10])
  assert.equal(dayBefore.firstStopNumber, 4)

  assert.deepEqual(dailyPlan(catalog, '2027-02-10'), {
    utcDate: '2027-02-10',
    catalogEffectiveUtcDate: '2027-02-10',
    cityId: extendedCityIds[0],
    firstStopNumber: 1,
  })
  const played = Array.from({ length: 30 }, (_, days) => planFor(catalog, addDays('2027-02-10', days)).cityId)
  assert.deepEqual([...new Set(played)].sort(), [...extendedCityIds].sort())
})

test('the schedule includes cities the player has not unlocked', () => {
  const plan = planFor(twentyCities, addDays(firstEffectiveUtcDate, 5))
  assert.equal(plan.cityId, twentyCityIds[5])
  assert.ok(!unlockedCityIds(emptyProgress, twentyCities).includes(plan.cityId))
})

test('a daily run plays the first stop and the next two in route order with the route time limits', () => {
  const run = dailyRun({ utcDate: '2027-01-05', catalogEffectiveUtcDate: firstEffectiveUtcDate, cityId: 'paris', firstStopNumber: 4 })
  assert.equal(run.mode, 'daily')
  assert.equal(run.cityId, 'paris')
  assert.deepEqual(run.daily, { utcDate: '2027-01-05', catalogEffectiveUtcDate: firstEffectiveUtcDate })
  assert.deepEqual(
    run.stops.map((runStop) => [runStop.stopId, runStop.routeStopNumber, runStop.timeLimitMs, runStop.correctChoiceId]),
    [
      ['PAR04', 4, 25_000, 'PAR04-b'],
      ['PAR05', 5, 20_000, 'PAR05-b'],
      ['PAR06', 6, 20_000, 'PAR06-b'],
    ],
  )
  assert.equal(run.phase, 'loading')
  assert.equal(run.remainingMs, 25_000)
})

test('a daily run starting at stop 8 ends with stop 10 and its 18 s limit', () => {
  const run = dailyRun({ utcDate: '2027-01-05', catalogEffectiveUtcDate: firstEffectiveUtcDate, cityId: 'paris', firstStopNumber: 8 })
  assert.deepEqual(
    run.stops.map((runStop) => [runStop.stopId, runStop.timeLimitMs]),
    [
      ['PAR08', 20_000],
      ['PAR09', 18_000],
      ['PAR10', 18_000],
    ],
  )
})

test('daily choice orders are the FNV-1a permutation of date, city and stop', () => {
  // fnv1a32 of "2026-12-01:paris:PAR01" / PAR02 / PAR03 is 881135748, 931468605, 914690986: permutations 12, 21, 10.
  const run = dailyRun(planFor(twentyCities, firstEffectiveUtcDate))
  assert.deepEqual(
    run.stops.map((runStop) => runStop.choiceIds),
    [
      ['PAR01-c', 'PAR01-a', 'PAR01-b', 'PAR01-d'],
      ['PAR02-d', 'PAR02-b', 'PAR02-c', 'PAR02-a'],
      ['PAR03-b', 'PAR03-d', 'PAR03-a', 'PAR03-c'],
    ],
  )
})

test('the same date and catalog give the same city, stops and choice order twice', () => {
  const utcDate = addDays(firstEffectiveUtcDate, 40)
  const first = dailyRun(planFor(twentyCities, utcDate))
  const second = dailyRun(planFor(twentyCities, utcDate))
  assert.deepEqual(second, first)
})

test('B09 keeps its source choice order in the daily run on every date', () => {
  const budapest = route('budapest', 'B')
  const orders = ['2026-12-01', '2027-01-17', '2027-04-02', '2027-08-30'].flatMap((utcDate) =>
    [7, 8].map((firstStopNumber) => {
      const run = dailyRun({ utcDate, catalogEffectiveUtcDate: firstEffectiveUtcDate, cityId: 'budapest', firstStopNumber }, budapest)
      return run.stops.find((runStop) => runStop.stopId === 'B09')?.choiceIds
    }),
  )
  for (const choiceIds of orders) assert.deepEqual(choiceIds, ['B09-a', 'B09-b', 'B09-c', 'B09-d'])
})

test('a run started before midnight and restored after it keeps its date, stops and order and records to the start date', () => {
  const startedAt = Date.UTC(2026, 11, 14, 23, 59, 30)
  const startDate = utcDateOf(startedAt)
  const started = dailyRun(planFor(twentyCities, startDate))
  const firstAnswered = reduceRun(
    reduceRun(reduceRun(started, { type: 'sceneReady', round: 1 }), {
      type: 'choose',
      round: 1,
      choiceId: currentStop(started).correctChoiceId,
      elapsedMs: 2_000,
    }),
    { type: 'pause', round: 1, elapsedMs: 0 },
  )
  const restored = restoreRun(JSON.parse(JSON.stringify(firstAnswered)) as RunState)
  const finishedAt = Date.UTC(2026, 11, 15, 0, 1, 0)
  assert.notEqual(utcDateOf(finishedAt), startDate)

  assert.deepEqual(restored.daily, started.daily)
  assert.deepEqual(restored.stops, started.stops)

  const finished = finish(restored)
  const results = recordDailyRun(emptyDailyResults, finished)
  assert.deepEqual(results, { '2026-12-14': { cityId: started.cityId, correct: 3 } })
  assert.ok(!hasDailyResult(results, utcDateOf(finishedAt)))
})

test('a run restored after a new catalog version keeps its saved stops', () => {
  const startDate = '2027-02-09'
  const started = dailyRun(planFor(twentyCities, startDate))
  const updatedCatalog = catalogOf([
    ...twentyCities.versions,
    { effectiveUtcDate: startDate, orderedCityIds: [...twentyCityIds].reverse() },
  ])
  assert.notEqual(planFor(updatedCatalog, startDate).cityId, started.cityId)

  const restored = restoreRun(JSON.parse(JSON.stringify(started)) as RunState)
  assert.deepEqual(restored.stops, started.stops)
  assert.deepEqual(restored.daily, { utcDate: startDate, catalogEffectiveUtcDate: firstEffectiveUtcDate })
  assert.deepEqual(Object.keys(recordDailyRun(emptyDailyResults, finish(restored))), [startDate])
})

test('a date keeps its first result and reports that it has one', () => {
  const plan = planFor(twentyCities, '2026-12-03')
  const firstRun = finish(dailyRun(plan))
  const wrongFirst = reduceRun(reduceRun(dailyRun(plan), { type: 'sceneReady', round: 1 }), {
    type: 'tick',
    round: 1,
    elapsedMs: 25_000,
  })
  const secondRun = finish(wrongFirst)
  assert.equal(secondRun.correct, 2)

  assert.ok(!hasDailyResult(emptyDailyResults, '2026-12-03'))
  const once = recordDailyRun(emptyDailyResults, firstRun)
  const twice = recordDailyRun(once, secondRun)
  assert.ok(hasDailyResult(once, '2026-12-03'))
  assert.ok(!hasDailyResult(once, '2026-12-04'))
  assert.deepEqual(twice, { '2026-12-03': { cityId: plan.cityId, correct: 3 } })
})

test('only a finished daily run can be recorded', () => {
  const unfinished = dailyRun(planFor(twentyCities, '2026-12-03'))
  assert.throws(() => recordDailyRun(emptyDailyResults, unfinished))
  const cityRun = finish(startCityRun({ route: paris, runId: 'city-1', untimed: false, random: () => 0.5 }))
  assert.throws(() => recordDailyRun(emptyDailyResults, cityRun))
  const cityModeWithDaily: RunState = { ...finish(dailyRun(planFor(twentyCities, '2026-12-03'))), mode: 'city' }
  assert.equal(cityModeWithDaily.phase, 'summary')
  assert.throws(() => recordDailyRun(emptyDailyResults, cityModeWithDaily))
})

test('merging results from two tabs keeps the stored result per date and unites the dates in one JSON form', () => {
  const stored: DailyResults = {
    '2026-12-05': { cityId: 'city6', correct: 1 },
    '2026-12-03': { cityId: 'city4', correct: 2 },
  }
  const incoming: DailyResults = {
    '2026-12-05': { cityId: 'city6', correct: 3 },
    '2026-12-04': { correct: 0, cityId: 'city5' },
  }
  const merged = mergeDailyResults(stored, incoming)
  assert.deepEqual(merged, {
    '2026-12-03': { cityId: 'city4', correct: 2 },
    '2026-12-04': { cityId: 'city5', correct: 0 },
    '2026-12-05': { cityId: 'city6', correct: 1 },
  })
  assert.equal(
    JSON.stringify(merged),
    '{"2026-12-03":{"cityId":"city4","correct":2},"2026-12-04":{"cityId":"city5","correct":0},"2026-12-05":{"cityId":"city6","correct":1}}',
  )
  assert.equal(JSON.stringify(mergeDailyResults(merged, merged)), JSON.stringify(merged))
})

function resultsOn(utcDates: string[]): DailyResults {
  const results: DailyResults = {}
  for (const utcDate of utcDates) results[utcDate] = { cityId: 'paris', correct: 2 }
  return results
}

test('the day streak counts consecutive days ending today or yesterday', () => {
  assert.equal(dailyStreak(resultsOn(['2027-01-10', '2027-01-09', '2027-01-08']), '2027-01-10'), 3)
  assert.equal(dailyStreak(resultsOn(['2027-01-09', '2027-01-08']), '2027-01-10'), 2)
  assert.equal(dailyStreak(resultsOn(['2027-01-07']), '2027-01-10'), 0)
  assert.equal(dailyStreak(resultsOn(['2027-01-10', '2027-01-08']), '2027-01-10'), 1)
  assert.equal(dailyStreak(emptyDailyResults, '2027-01-10'), 0)
})

test('the day streak does not depend on the order results were saved in', () => {
  const dates = ['2027-01-08', '2027-01-09', '2027-01-10']
  assert.equal(dailyStreak(resultsOn([...dates].reverse()), '2027-01-10'), dailyStreak(resultsOn(dates), '2027-01-10'))
  assert.equal(dailyStreak(resultsOn([...dates].reverse()), '2027-01-10'), 3)
})

test('the day streak crosses month, year and leap-day boundaries', () => {
  assert.equal(dailyStreak(resultsOn(['2026-12-30', '2026-12-31', '2027-01-01']), '2027-01-01'), 3)
  assert.equal(dailyStreak(resultsOn(['2027-02-27', '2027-02-28', '2027-03-01']), '2027-03-02'), 3)
  assert.equal(dailyStreak(resultsOn(['2028-02-28', '2028-02-29', '2028-03-01']), '2028-03-01'), 3)
  assert.equal(dailyStreak(resultsOn(['2028-02-28', '2028-03-01']), '2028-03-01'), 1)
})

test('the daily overview unlocks after the first completed city', () => {
  assert.equal(dailyUnlocked(emptyProgress), false)
  assert.equal(dailyUnlocked({ completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] }), true)
})

test('finishing and recording a daily run leaves progress unchanged', () => {
  const progress: Progress = deepFreeze({ completedCityIds: ['paris'], bestStars: { paris: 1 }, postcardCityIds: ['paris'] })
  const before = structuredClone(progress)
  const run = finish(dailyRun(planFor(twentyCities, '2026-12-02'), route('city2', 'CITY2')))
  recordDailyRun(emptyDailyResults, run)
  assert.equal(dailyUnlocked(progress), true)
  assert.deepEqual(progress, before)
})

test('the daily module uses no DOM, clock, randomness or storage', () => {
  const source = readFileSync(new URL('./daily.ts', import.meta.url), 'utf8')
  for (const forbidden of ['document', 'window', 'Date.now', 'Math.random', 'localStorage', 'sessionStorage', 'indexedDB']) {
    assert.ok(!source.includes(forbidden), `daily.ts must not use ${forbidden}`)
  }
  const dateUses = [...source.matchAll(/(new\s+)?\bDate\b(\.\w+)?\s*\(([^)]*)\)/g)]
  assert.ok(dateUses.length > 0)
  for (const [use, newKeyword, member, argument] of dateUses) {
    const allowed = (newKeyword !== undefined && member === undefined && argument.trim() !== '') || member === '.UTC'
    assert.ok(allowed, `daily.ts must only construct Date from a given time or use Date.UTC, found ${use}`)
  }
  assert.equal([...source.matchAll(/\bDate\b/g)].length, dateUses.length, 'every Date use is a checked call')
})
