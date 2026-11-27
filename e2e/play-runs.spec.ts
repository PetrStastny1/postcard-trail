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
import { cityRunBeforeLastNext } from './screens.ts'

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
  await expect(elsewhereHome(page)).toBeFocused()
}

/** The primary Home under the sentence; the window bar has its own Home too. */
const elsewhereHome = (page: Page) => elsewhere(page).locator('.window-body').getByRole('button', { name: 'Home' })

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

test('rewards that fail to save at the last Next complete after a reload and cannot be discarded by a route change', async ({ page }) => {
  await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 0) } })
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('dialog', { name: 'Paused' }).locator('.window-body .primary').click()
  await expectState(page, 'result')
  // Only this page, so the reload below has a working store again.
  await page.evaluate((progressKey) => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === progressKey) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      setItem.call(this, key, value)
    }
  }, storageKey('progress'))
  await page.locator('.next').click()

  await expect(page.getByRole('heading', { name: 'Route complete' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'This browser is not saving the game.' })).toBeVisible()
  expect((await savedSection<{ run: RunState }>(page, 'active-run')).run.phase).toBe('summary')
  expect(await savedSection(page, 'progress')).toBeUndefined()
  expect((await recordedEvents(page)).filter((event) => event.name === 'route_completed')).toHaveLength(1)

  // The finished run is no active run any more: the next city starts without asking to discard it.
  await page.getByRole('button', { name: 'Next city' }).click()
  await expectState(page, 'question')
  await expect(page.getByRole('dialog', { name: 'Discard your current route?' })).toHaveCount(0)
  await expect(page.locator('.play')).toContainText('London')

  await page.reload()
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^0\/60 ★/, '1 postcard'])
  expect(await savedSection(page, 'active-run')).toBeNull()
  expect(await savedSection(page, 'progress')).toEqual({ completedCityIds: ['paris'], bestStars: { paris: 0 }, postcardCityIds: ['paris'] })
  expect(await recordedEvents(page)).toEqual([])

  await page.reload()
  await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^0\/60 ★/, '1 postcard'])
  expect(await recordedEvents(page)).toEqual([])
})

test('a saved daily run keeps the place hidden and completes after the third Next on the daily summary', async ({ page }) => {
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
    await expect(page.locator('.result-sentence')).toHaveText(stop.feedback.en)
    await page.locator('.next').click()
  }
  await expect(page.getByRole('heading', { name: 'Daily challenge done' })).toBeVisible()
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
  await page.locator('.window-bar').getByRole('button', { name: 'Home' }).click()
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

    await expect(elsewhereHome(first)).toHaveClass(/primary/)
    await elsewhereHome(first).click()
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

    test('a whole Paris run by tap ends on the summary, and Home shows London unlocked', async ({ page }) => {
      await page.goto('/')
      await page.getByRole('button', { name: 'Play' }).tap()
      for (const stop of paris.stops) {
        await expectState(page, 'question')
        await correctChoice(page, stop).tap()
        await expectState(page, 'result')
        await page.locator('.next').tap()
      }
      await expect(page.getByRole('heading', { name: 'Route complete' })).toBeVisible()
      await page.getByRole('button', { name: 'Home' }).tap()
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

test('a run restored after the route changed its order shows its own stop, found by ID', async ({ page }) => {
  // The run was started when the route listed its stops in the opposite order.
  const run = startCityRun({ route: { ...paris, stops: paris.stops.toReversed() }, runId: 'reordered-run', untimed: false, random: () => 0.5 })
  const firstStop = paris.stops.at(-1) as Stop
  await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run } })
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Continue' }).click()
  await expectState(page, 'question')
  await expect(page.locator('.question')).toHaveText(firstStop.question.en)
  await correctChoice(page, firstStop).click()
  await expect(page.locator('.result-sentence')).toHaveText(firstStop.feedback.en)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`while the route loads after Play a bar across the top shows the game is working (${reducedMotion} motion)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    let releaseRoute = () => undefined as void
    const routeRequested = new Promise<void>((requested) => {
      void page.route('**/src/content/routes/paris.json*', (route) => {
        requested()
        releaseRoute = () => void route.continue()
      })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Play' }).click()
    await routeRequested
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true')
    const bar = await page.evaluate(() => {
      const app = document.querySelector('#app') as HTMLElement
      const track = getComputedStyle(app, '::before')
      const segment = getComputedStyle(app, '::after')
      return {
        cursor: getComputedStyle(app).cursor,
        track: [track.position, track.top, track.height, track.width, track.backgroundColor],
        segment: [segment.height, segment.backgroundColor, segment.animationName],
        viewport: `${innerWidth}px`,
      }
    })
    expect(bar.cursor).toBe('progress')
    expect(bar.track).toEqual(['fixed', '0px', '4px', bar.viewport, 'rgb(21, 31, 68)'])
    expect(bar.segment).toEqual(['4px', 'rgb(255, 191, 54)', reducedMotion === 'reduce' ? 'none' : 'route-loading-bar'])

    releaseRoute()
    await expectState(page, 'question')
    await expect(page.locator('#app')).not.toHaveAttribute('aria-busy')
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#app') as HTMLElement, '::before').content)).toBe('none')
  })
}

test('a route load error takes the focus on Try again, and Escape works like × back to the title', async ({ page }) => {
  await page.route('**/src/content/routes/paris.json*', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('alert')).toHaveText(/The route could not load\./)
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeFocused()
  expect(await savedSection(page, 'active-run')).toBeUndefined()
})

test('a failed placeholders.json is a route load failure, and Try again starts the run with the scene caption', async ({ page }) => {
  let failing = true
  await page.route('**/scenes/placeholders.json', (route) => (failing ? route.abort() : route.fulfill({ json: { stopIds: [paris.stops[0].id] } })))
  await page.goto('/')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('alert')).toHaveText(/The route could not load\./)
  expect(await savedSection(page, 'active-run')).toBeUndefined()
  failing = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expectState(page, 'question')
  await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
  await expect(page.locator('.scene-caption')).toHaveText(paris.stops[0].sceneAlt.en)
})

test('a route that fails to load offers Try again and Home, and the retry starts the run', async ({ page }) => {
  let failing = true
  await page.route('**/src/content/routes/paris.json*', (route) => (failing ? route.abort() : route.continue()))
  await page.goto('/')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('alert')).toHaveText(/The route could not load\./)
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
  expect(await savedSection(page, 'active-run')).toBeUndefined()
  failing = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expectState(page, 'question')
  await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
})
