import { expect, test, type Page } from '@playwright/test'
import type { Stop } from '../src/content/types.ts'
import { dailyPlan, startDailyRun } from '../src/game/logic/daily.ts'
import { reduceRun, startCityRun, type RunState } from '../src/game/logic/run.ts'
import {
  catalog,
  correctChoice,
  expectState,
  paris,
  playStops,
  readRoute,
  recordedEvents,
  savedSection,
  seedStorage,
  startParis,
  storageKey,
} from './game.ts'

/** A Paris run answered wrongly at every stop up to its summary phase, as the rules build it. */
function finishedParisRun(): RunState {
  let run = startCityRun({ route: paris, runId: 'finished-run', untimed: false, random: () => 0.5 })
  for (let stopIndex = 0; stopIndex < 10; stopIndex++) {
    const stop = run.stops[stopIndex]
    const wrongChoiceId = stop.choiceIds.find((choiceId) => choiceId !== stop.correctChoiceId) ?? ''
    run = reduceRun(run, { type: 'sceneReady', round: run.round })
    run = reduceRun(run, { type: 'choose', round: run.round, choiceId: wrongChoiceId, elapsedMs: 1_000 })
    run = reduceRun(run, { type: 'next', round: run.round })
  }
  return run
}

function savedDailyRun() {
  const plan = dailyPlan(catalog, '2026-12-05')
  if (!plan) throw new Error('The catalog offers no daily challenge on 2026-12-05.')
  const route = readRoute(plan.cityId)
  const run = startDailyRun({ route, plan, runId: 'daily-run', untimed: false })
  return { route, run, stops: run.stops.map((runStop) => route.stops.find((stop) => stop.id === runStop.stopId) as Stop) }
}

const elsewhere = (page: Page) => page.getByRole('dialog', { name: 'Route paused' })

async function expectStoppedForOtherTab(page: Page) {
  await expect(elsewhere(page)).toBeVisible()
  await expect(elsewhere(page)).toContainText('This route continues in another tab.')
}

test('a run saved in its summary phase completes at start without Continue, and a second reload adds nothing', async ({ page }) => {
  await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run: finishedParisRun() } })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^0\/60 ★/, '1 postcard'])
  expect(await recordedEvents(page)).toEqual([])
  expect(await savedSection(page, 'active-run')).toBeNull()
  const progress = await savedSection(page, 'progress')

  await page.reload()
  await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^0\/60 ★/, '1 postcard'])
  expect(await savedSection(page, 'progress')).toEqual(progress)
  expect(await recordedEvents(page)).toEqual([])
})

test('a saved daily run keeps the place hidden, completes after the third Next and returns to the title', async ({ page }) => {
  const { route, run, stops } = savedDailyRun()
  await seedStorage(page, { 'active-run': { ownerTabId: 'other-tab', run } })
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue' }).click()
  const pause = page.getByRole('dialog', { name: 'Paused' })
  await expect(pause).toBeVisible()
  await pause.getByRole('button', { name: 'Continue' }).click()
  for (const [index, stop] of stops.entries()) {
    await expectState(page, 'question')
    await expect(page.locator('.play-title')).toHaveText(`${route.name.en} · ${index + 1}/3`)
    await expect(page.locator('.trail li')).toHaveCount(3)
    const text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement
      clone.querySelectorAll('.choice, script').forEach((node) => node.remove())
      const names = [...document.querySelectorAll('[aria-label], [alt], [title]')].filter((node) => !node.closest('.choice'))
      return [clone.textContent, ...names.map((node) => `${node.getAttribute('aria-label')} ${node.getAttribute('alt')} ${node.getAttribute('title')}`)].join(' ').toLowerCase()
    })
    for (const place of [stop.place.en, stop.place.cs]) expect(text).not.toContain(place.toLowerCase())
    await correctChoice(page, stop).click()
    await expect(page.locator('.result-place')).toHaveText(stop.place.en)
    await page.locator('.next').click()
  }
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  const events = await recordedEvents(page)
  expect(events[0]).toEqual({ name: 'route_started', cityId: route.id, mode: 'daily', resumed: true })
  expect(events.filter((event) => event.name === 'question_resolved').map((event) => event.name === 'question_resolved' && [event.index, event.mode])).toEqual([
    [1, 'daily'],
    [2, 'daily'],
    [3, 'daily'],
  ])
  expect(events.slice(-2)).toEqual([
    { name: 'route_completed', cityId: route.id, mode: 'daily', correct: 3, stars: 0 },
    { name: 'daily_completed', utcDate: '2026-12-05', correct: 3 },
  ])
  expect(await savedSection(page, 'daily-results')).toEqual({ '2026-12-05': { cityId: route.id, correct: 3 } })
  await expect(page.locator('.title-progress li')).toHaveText(['0/20 cities', /^0\/60 ★/, '0 postcards'])
})

test.describe('two tabs', () => {
  test('when the second tab continues the run, the first stops, writes nothing more and offers Home', async ({ context }) => {
    const first = await context.newPage()
    await startParis(first)
    const second = await context.newPage()
    await second.goto('/')
    await second.getByRole('button', { name: 'Continue' }).click()
    await expect(second.getByRole('dialog', { name: 'Paused' })).toBeVisible()

    await expectStoppedForOtherTab(first)
    const stored = await first.evaluate((key) => localStorage.getItem(key), storageKey('active-run'))
    await first.keyboard.press('1')
    await first.waitForTimeout(1_200)
    expect(await first.evaluate((key) => localStorage.getItem(key), storageKey('active-run'))).toBe(stored)

    await elsewhere(first).getByRole('button', { name: 'Home' }).click()
    await expect(first.getByRole('button', { name: 'Continue' })).toBeVisible()
    expect(await first.evaluate((key) => localStorage.getItem(key), storageKey('active-run'))).toBe(stored)
    expect((await recordedEvents(first)).filter((event) => event.name === 'route_left')).toEqual([])
  })

  test.describe('without the storage event', () => {
    test.beforeEach(async ({ context }) => {
      // Registered before the game's listener, so the first tab never hears that the run moved.
      await context.addInitScript(() => addEventListener('storage', (event) => event.stopImmediatePropagation()))
    })

    test('coming back to the page finds that another tab owns the run', async ({ context }) => {
      const first = await context.newPage()
      await startParis(first)
      const second = await context.newPage()
      await second.goto('/')
      await second.getByRole('button', { name: 'Continue' }).click()
      await expect(second.getByRole('dialog', { name: 'Paused' })).toBeVisible()
      await expect(elsewhere(first)).toHaveCount(0)

      await first.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expectStoppedForOtherTab(first)
    })

    test('a checkpoint refused as notOwner stops the tab', async ({ context }) => {
      const first = await context.newPage()
      await startParis(first)
      const second = await context.newPage()
      await second.goto('/')
      await second.getByRole('button', { name: 'Continue' }).click()
      await expect(second.getByRole('dialog', { name: 'Paused' })).toBeVisible()
      const stored = await first.evaluate((key) => localStorage.getItem(key), storageKey('active-run'))

      await correctChoice(first, paris.stops[0]).click()
      await expectStoppedForOtherTab(first)
      expect(await first.evaluate((key) => localStorage.getItem(key), storageKey('active-run'))).toBe(stored)
    })
  })
})

for (const viewport of [
  { width: 375, height: 812 },
  { width: 320, height: 568 },
]) {
  test.describe(`touch phone ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true })

    test('a whole Paris run by tap ends on the title with London unlocked', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('button', { name: 'Play' }).tap()
      for (const stop of paris.stops) {
        await expectState(page, 'question')
        await correctChoice(page, stop).tap()
        await expectState(page, 'result')
        await page.locator('.next').tap()
      }
      await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^3\/60 ★/, '1 postcard'])
      await page.getByRole('button', { name: 'Play' }).tap()
      await expect(page.locator('.play-title')).toHaveText('London · 1/10')
    })
  })
}

test('a reload in the middle of a run continues at the same stop', async ({ page }) => {
  await startParis(page)
  await playStops(page, paris.stops.slice(0, 3), 'correct')
  await expectState(page, 'question')
  await page.reload()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator('.play-title')).toHaveText('Paris · 4/10')
  await expect(page.locator('.streak')).toHaveText('Streak 3')
})
