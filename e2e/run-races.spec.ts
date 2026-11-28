import { expect, test, type Page, type Route as RoutedRequest } from '@playwright/test'
import { startCityRun, type RunState } from '../src/game/logic/run.ts'
import { expectState, paris, playStops, recordedEvents, savedSection, seedStorage, storageKey } from './game.ts'
import { dailyPlanOn, progressWith } from './screens.ts'

// Races between tabs and between loading and the player, found by the review of the whole first version.

const today = '2026-12-05'
const parisDone = progressWith(1, 0)

/** Holds every request for `pattern` until `release()`; `requested` resolves on the first one. */
function holdRequests(page: Page, pattern: string) {
  const held: RoutedRequest[] = []
  let released = false
  const requested = new Promise<void>((resolve) => {
    void page.route(pattern, (request) => {
      resolve()
      if (released) return void request.continue()
      held.push(request)
    })
  })
  return {
    requested,
    release: async () => {
      released = true
      await Promise.all(held.map((request) => request.continue()))
    },
  }
}

const cityRow = (page: Page, name: string) => page.locator('.city-row').filter({ has: page.getByText(name, { exact: true }).and(page.locator('.city-name')) })

async function discardAndStartLondon(page: Page) {
  await page.getByRole('button', { name: 'City map' }).click()
  await cityRow(page, 'London').click()
  await page.getByRole('dialog', { name: 'London' }).getByRole('button', { name: 'Play', exact: true }).click()
  await page.getByRole('dialog', { name: 'Discard your current route?' }).getByRole('button', { name: 'Discard and start' }).click()
}

const activeRunOf = (page: Page) => page.evaluate((key) => localStorage.getItem(key), storageKey('active-run'))

/** A removed run leaves the section empty, a run never saved leaves no section. */
const savedRun = async (page: Page) => (await savedSection<{ run: RunState } | null>(page, 'active-run')) ?? null

test('Discard and start keeps a run another tab started after the player confirmed the discard', async ({ context }) => {
  const tabA = await context.newPage()
  const confirmedRun = startCityRun({ route: paris, runId: 'confirmed-run', untimed: false, random: () => 0.5 })
  await seedStorage(tabA, { progress: parisDone, 'active-run': { ownerTabId: 'closed-tab', run: confirmedRun } })
  await tabA.goto('/')
  const tabB = await context.newPage()
  await tabB.goto('/')
  const london = holdRequests(tabB, '**/src/content/routes/london.json*')
  await discardAndStartLondon(tabB)
  await london.requested

  // Tab A discards the same run and starts its own while tab B waits for its route.
  await discardAndStartLondon(tabA)
  await expectState(tabA, 'question')
  const runOfTabA = await activeRunOf(tabA)
  expect(runOfTabA).not.toContain('confirmed-run')
  await london.release()

  await expect(tabB.locator('#app')).not.toHaveAttribute('data-route-loading')
  await expect(tabB.locator('.play')).toHaveCount(0)
  await expect(tabB.getByRole('button', { name: 'Continue', exact: true })).toBeFocused()
  expect(await activeRunOf(tabB)).toBe(runOfTabA)
  expect((await recordedEvents(tabB)).filter((event) => event.name === 'route_left' || event.name === 'route_started')).toEqual([])
  await expect(tabA.getByRole('dialog', { name: 'Route paused' })).toHaveCount(0)
})

test('a daily challenge finished in another tab while the route loads is not started again', async ({ context }) => {
  const { plan, stops } = dailyPlanOn(today)
  const tabA = await context.newPage()
  await tabA.clock.install({ time: new Date(`${today}T08:00:00Z`) })
  await seedStorage(tabA, { progress: parisDone })
  await tabA.goto('/')
  const tabB = await context.newPage()
  await tabB.clock.install({ time: new Date(`${today}T08:00:00Z`) })
  await tabB.goto('/')
  const dailyRoute = holdRequests(tabB, `**/src/content/routes/${plan.cityId}.json*`)
  await tabB.getByRole('button', { name: 'Daily challenge' }).click()
  await tabB.getByRole('button', { name: 'Start' }).click()
  await dailyRoute.requested

  await tabA.getByRole('button', { name: 'Daily challenge' }).click()
  await tabA.getByRole('button', { name: 'Start' }).click()
  await playStops(tabA, stops, 'correct')
  await expect(tabA.getByRole('heading', { name: 'Daily challenge done' })).toBeVisible()
  const dailyResults = await savedSection(tabA, 'daily-results')
  await dailyRoute.release()

  await expect(tabB.locator('#app')).not.toHaveAttribute('data-route-loading')
  await expect(tabB.locator('.play')).toHaveCount(0)
  await expect(tabB.locator('.daily-state')).toHaveText('Done for today. A new challenge comes tomorrow.')
  await expect(tabB.locator('.daily').getByRole('button')).toHaveCount(0)
  expect(await savedRun(tabB)).toBeNull()
  expect(await savedSection(tabB, 'daily-results')).toEqual(dailyResults)
  expect(await recordedEvents(tabB)).toEqual([])
})

test.describe('settings opened while the route loads', () => {
  async function openSettingsWhileLoading(page: Page) {
    const parisRoute = holdRequests(page, '**/src/content/routes/paris.json*')
    await page.goto('/')
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await parisRoute.requested
    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await parisRoute.release()
    // The route has arrived; the run must still not begin under the open window.
    await page.waitForTimeout(1_000)
    await expect(page.locator('.play')).toHaveCount(0)
    expect(await savedRun(page)).toBeNull()
    return settings
  }

  test('the run begins only once settings close, with its full time', async ({ page }) => {
    const settings = await openSettingsWhileLoading(page)
    await settings.getByRole('button', { name: 'Close' }).click()
    await expectState(page, 'question')
    await expect(page.locator('#app')).not.toHaveAttribute('data-route-loading')
    const run = (await savedSection<{ run: RunState }>(page, 'active-run')).run
    expect(run.remainingMs).toBe(run.stops[0].timeLimitMs)
    expect(await recordedEvents(page)).toEqual([{ name: 'route_started', cityId: 'paris', mode: 'city', resumed: false }])
  })

  test('Home in settings cancels the start', async ({ page }) => {
    const settings = await openSettingsWhileLoading(page)
    await settings.getByRole('button', { name: 'Home' }).click()
    await expect(page.locator('#app')).not.toHaveAttribute('data-route-loading')
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect(page.locator('.play')).toHaveCount(0)
    expect(await savedRun(page)).toBeNull()
    expect(await recordedEvents(page)).toEqual([])
  })
})

async function failRouteUnderSettings(page: Page) {
  let failRoute = () => undefined as void
  const routeRequested = new Promise<void>((requested) => {
    void page.route('**/src/content/routes/paris.json*', (request) => {
      requested()
      failRoute = () => void request.abort()
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await routeRequested
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  failRoute()
  // The load has failed; its error must not be drawn under the open window.
  await page.waitForTimeout(1_000)
  await expect(page.locator('.route-error-screen')).toHaveCount(0)
  await expect(page.locator('#app')).toHaveAttribute('data-route-loading')
  return settings
}

test('a route that fails to load under open settings shows its error once settings close, with the focus on Try again', async ({ page }) => {
  const settings = await failRouteUnderSettings(page)
  await settings.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.route-error-screen')).toBeVisible()
  await expect(page.locator('#app')).not.toHaveAttribute('data-route-loading')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('[data-focus-id="route-retry"]')).toBeFocused()
  expect(await savedRun(page)).toBeNull()
})

test('Home in settings opened while the route fails to load shows the title, not the error', async ({ page }) => {
  const settings = await failRouteUnderSettings(page)
  await settings.getByRole('button', { name: 'Home' }).click()
  await expect(page.locator('#app')).not.toHaveAttribute('data-route-loading')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page.locator('.route-error-screen')).toHaveCount(0)
})

const mismatches: { name: string; change(run: RunState): RunState }[] = [
  { name: 'a stop ID', change: (run) => ({ ...run, stops: run.stops.map((stop, index) => (index === 4 ? { ...stop, stopId: 'PAR99' } : stop)) }) },
  {
    name: 'a choice ID',
    change: (run) => ({ ...run, stops: run.stops.map((stop, index) => (index === 0 ? { ...stop, choiceIds: stop.choiceIds.map((id) => (id === stop.correctChoiceId ? id : `${id}-old`)) } : stop)) }),
  },
  { name: 'a city ID', change: (run) => ({ ...run, cityId: 'atlantis' }) },
]

for (const mismatch of mismatches) {
  test(`a saved run with ${mismatch.name} the route does not have is removed on Continue and the player is told once`, async ({ page }) => {
    const run = mismatch.change(startCityRun({ route: paris, runId: 'old-run', untimed: false, random: () => 0.5 }))
    const dailyResults = { '2026-12-01': { cityId: 'paris', correct: 2 } }
    await seedStorage(page, { progress: parisDone, 'daily-results': dailyResults, 'active-run': { ownerTabId: 'closed-tab', run } })
    await page.goto('/')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(page.locator('#app')).not.toHaveAttribute('data-route-loading')
    await expect(page.locator('.play')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)
    const notice = page.getByRole('status').filter({ hasText: 'Your saved route no longer matches this version of the game' })
    await expect(notice).toBeVisible()
    expect(await savedRun(page)).toBeNull()
    expect(await savedSection(page, 'progress')).toEqual(parisDone)
    expect(await savedSection(page, 'daily-results')).toEqual(dailyResults)
    expect(await recordedEvents(page)).toEqual([])

    await notice.getByRole('button', { name: 'Close the notice' }).click()
    await expect(notice).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
  })
}

test('a saved run that matches its route still continues', async ({ page }) => {
  await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run: startCityRun({ route: paris, runId: 'good-run', untimed: false, random: () => 0.5 }) } })
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('a pause opened while the third scene loads offers the skip once the scene shows', async ({ page }) => {
  const thirdScene = holdRequests(page, `**/scenes/${paris.stops[2].id}.webp`)
  await page.goto('/')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await playStops(page, paris.stops.slice(0, 2), 'correct')
  await expectState(page, 'loading')
  await page.keyboard.press('Escape')
  const pause = page.getByRole('dialog', { name: 'Paused' })
  await expect(pause).toBeVisible()
  await expect(pause.getByRole('button', { name: 'Skip with a video' })).toHaveCount(0)
  await pause.getByRole('button', { name: 'Continue' }).focus()

  await thirdScene.release()
  await expect(pause.getByRole('button', { name: 'Skip with a video' })).toBeVisible()
  await expect(pause.getByRole('button', { name: 'Continue' })).toBeFocused()
})
