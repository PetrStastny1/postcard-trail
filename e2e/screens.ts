import { expect, type Page } from '@playwright/test'
import type { Route } from '../src/content/types.ts'
import { dailyPlan, startDailyRun } from '../src/game/logic/daily.ts'
import type { Progress, Stars } from '../src/game/logic/progress.ts'
import { reduceRun, startCityRun, type RunState } from '../src/game/logic/run.ts'
import { catalog, readRoute } from './game.ts'

/**
 * A run answered at every stop up to the last result, as the rules build it: one Next away from its summary.
 * `correct` stops are answered right, the rest wrong.
 */
function answeredRun(run: RunState, correct: number): RunState {
  let answered = run
  for (let stopIndex = 0; stopIndex < run.stops.length; stopIndex++) {
    const stop = answered.stops[stopIndex]
    const choiceId = stopIndex < correct ? stop.correctChoiceId : (stop.choiceIds.find((id) => id !== stop.correctChoiceId) ?? '')
    answered = reduceRun(answered, { type: 'sceneReady', round: answered.round })
    answered = reduceRun(answered, { type: 'choose', round: answered.round, choiceId, elapsedMs: 1_000 })
    if (stopIndex < run.stops.length - 1) answered = reduceRun(answered, { type: 'next', round: answered.round })
  }
  return answered
}

export function cityRunBeforeLastNext(cityId: string, correct: number): RunState {
  return answeredRun(startCityRun({ route: readRoute(cityId), runId: `last-next-${cityId}`, untimed: false, random: () => 0.5 }), correct)
}

export function dailyPlanOn(utcDate: string) {
  const plan = dailyPlan(catalog, utcDate)
  if (!plan) throw new Error(`The catalog offers no daily challenge on ${utcDate}.`)
  const route: Route = readRoute(plan.cityId)
  return { plan, route, stops: route.stops.slice(plan.firstStopNumber - 1, plan.firstStopNumber + 2) }
}

export function dailyRunBeforeLastNext(utcDate: string, correct: number): RunState {
  const { plan, route } = dailyPlanOn(utcDate)
  return answeredRun(startDailyRun({ route, plan, runId: `last-next-daily-${utcDate}`, untimed: false }), correct)
}

/** Progress with the first `count` cities completed with the same stars and their postcards. */
export function progressWith(count: number, stars: Stars): Progress {
  const cityIds = catalog.cities.slice(0, count).map((city) => city.id)
  return {
    completedCityIds: [...cityIds].sort(),
    bestStars: Object.fromEntries([...cityIds].sort().map((cityId) => [cityId, stars])),
    postcardCityIds: [...cityIds].sort(),
  }
}

/** Continues the saved run from the title and confirms its last result, which opens the summary. */
export async function continueToSummary(page: Page) {
  await page.getByRole('button', { name: /^(Continue|Pokračovat)$/ }).click()
  const pause = page.getByRole('dialog')
  await expect(pause).toBeVisible()
  await pause.locator('.window-body .primary').click()
  await page.locator('.next').click()
}

export const windowHome = (page: Page) => page.locator('.window-bar').getByRole('button', { name: /^(Home|Úvod)$/ })
