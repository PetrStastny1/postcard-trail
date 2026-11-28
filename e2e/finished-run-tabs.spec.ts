import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { expectState, recordedEvents, savedSection, seedStorage, storageKey } from './game.ts'
import { cityRunBeforeLastNext, dailyPlanOn, dailyRunBeforeLastNext, progressWith } from './screens.ts'

/*
 * A11 across tabs: tab A plays the last Next of a run while its store refuses the rewards, so the run stays saved in
 * its summary phase. Tab B, open before that, must complete it and never offer it to continue or to discard.
 */

const today = '2026-12-05'
const parisDone = progressWith(1, 0)

type FinishingRun = { mode: 'city' | 'daily'; progress: typeof parisDone }

/** Tab A opens on the title with a London or daily run saved one Next before its summary. */
async function openTabA(page: Page, { mode, progress }: FinishingRun) {
  await page.clock.install({ time: new Date(`${today}T08:00:00Z`) })
  const run = mode === 'city' ? cityRunBeforeLastNext('london', 0) : dailyRunBeforeLastNext(today, 2)
  await seedStorage(page, { progress, 'active-run': { ownerTabId: 'closed-tab', run } })
  await page.goto('/')
}

/** Continue from the title up to the last result, which takes the run over in this tab. */
async function continueToLastResult(page: Page) {
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('dialog', { name: 'Paused' }).locator('.window-body .primary').click()
  await expectState(page, 'result')
}

/** Tab A continues the run up to its last result; its store will refuse the rewards. */
async function tabA(page: Page, finishing: FinishingRun) {
  await openTabA(page, finishing)
  await continueToLastResult(page)
  await refuseRewards(page, finishing.mode)
}

async function refuseRewards(page: Page, mode: FinishingRun['mode']) {
  await page.evaluate((rewardsKey) => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === rewardsKey) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      setItem.call(this, key, value)
    }
  }, storageKey(mode === 'city' ? 'progress' : 'daily-results'))
}

/** Tab A's last Next: the summary shows, the rewards stay unsaved and the run stays saved in its summary phase. */
async function finishInTabA(page: Page, mode: FinishingRun['mode']) {
  await page.locator('.next').click()
  await expect(page.getByRole('heading', { name: mode === 'city' ? 'Route complete' : 'Daily challenge done' })).toBeVisible()
}

async function openTabB(context: BrowserContext): Promise<Page> {
  const tabB = await context.newPage()
  await tabB.clock.install({ time: new Date(`${today}T08:00:00Z`) })
  await tabB.goto('/')
  await expect(tabB.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  return tabB
}

const cityRow = (page: Page, name: string) => page.locator('.city-row').filter({ has: page.getByText(name, { exact: true }).and(page.locator('.city-name')) })

/** The rewards of tab A's run, as tab B completed them. */
async function expectRewardsOf(tabB: Page, mode: FinishingRun['mode']) {
  if (mode === 'city') {
    expect(await savedSection(tabB, 'progress')).toEqual({
      completedCityIds: ['london', 'paris'],
      bestStars: { london: 0, paris: 0 },
      postcardCityIds: ['london', 'paris'],
    })
  } else {
    expect(await savedSection(tabB, 'daily-results')).toEqual({ [today]: { cityId: dailyPlanOn(today).plan.cityId, correct: 2 } })
    expect(await savedSection(tabB, 'progress')).toEqual(parisDone)
  }
}

test('a tab open on the title before another tab fails to save the rewards completes the run and offers Play', async ({ page, context }) => {
  await tabA(page, { mode: 'city', progress: parisDone })
  const tabB = await openTabB(context)

  await finishInTabA(page, 'city')

  await expect(tabB.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(tabB.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)
  await expect(tabB.locator('.title-progress li')).toHaveText(['2/20 cities', /^0\/60 ★/, '2 postcards'])
  expect(await savedSection(tabB, 'active-run')).toBeNull()
  await expectRewardsOf(tabB, 'city')
  expect(await recordedEvents(tabB)).toEqual([])
})

test('a tab open on the map before another tab fails to save the rewards redraws the map and starts without asking', async ({ page, context }) => {
  await tabA(page, { mode: 'city', progress: parisDone })
  const tabB = await openTabB(context)
  await tabB.getByRole('button', { name: 'City map' }).click()
  await expect(cityRow(tabB, 'London').locator('.city-state')).toHaveText('In progress')

  await finishInTabA(page, 'city')

  await expect(cityRow(tabB, 'London').locator('.city-state')).toHaveText(/^Completed/)
  await cityRow(tabB, 'London').click()
  const detail = tabB.getByRole('dialog', { name: 'London' })
  await expect(detail.getByRole('button', { name: 'Continue' })).toHaveCount(0)
  await detail.getByRole('button', { name: 'Play again' }).click()
  await expectState(tabB, 'question')
  await expect(tabB.getByRole('dialog', { name: 'Discard your current route?' })).toHaveCount(0)
  await expectRewardsOf(tabB, 'city')
  expect((await recordedEvents(tabB)).map((event) => event.name)).toEqual(['route_started'])
})

for (const mode of ['city', 'daily'] as const) {
  test(`Discard and start in a route change window opened before a ${mode} run fails to save completes that run and discards nothing`, async ({ page, context }) => {
    await tabA(page, { mode, progress: parisDone })
    const tabB = await openTabB(context)
    await tabB.getByRole('button', { name: 'City map' }).click()
    await cityRow(tabB, 'Paris').click()
    await tabB.getByRole('dialog', { name: 'Paris' }).getByRole('button', { name: 'Play again' }).click()
    const change = tabB.getByRole('dialog', { name: 'Discard your current route?' })
    await expect(change).toBeVisible()

    await finishInTabA(page, mode)

    await change.getByRole('button', { name: 'Discard and start' }).click()
    await expectState(tabB, 'question')
    await expect(tabB.locator('.play-title')).toHaveText('Paris · 1/10')
    await expectRewardsOf(tabB, mode)
    expect(await recordedEvents(tabB)).toEqual([{ name: 'route_started', cityId: 'paris', mode: 'city', resumed: false }])
  })
}

test('Discard and start from the daily overview, opened before the city run fails to save, completes it and starts the daily run', async ({ page, context }) => {
  await tabA(page, { mode: 'city', progress: parisDone })
  const tabB = await openTabB(context)
  await tabB.getByRole('button', { name: 'Daily challenge' }).click()
  await tabB.getByRole('button', { name: 'Start' }).click()
  const change = tabB.getByRole('dialog', { name: 'Discard your current route?' })
  await expect(change).toBeVisible()

  await finishInTabA(page, 'city')

  await change.getByRole('button', { name: 'Discard and start' }).click()
  await expectState(tabB, 'question')
  const { route } = dailyPlanOn(today)
  await expect(tabB.locator('.play-title')).toHaveText(`${route.name.en} · 1/3`)
  await expectRewardsOf(tabB, 'city')
  expect(await recordedEvents(tabB)).toEqual([{ name: 'route_started', cityId: route.id, mode: 'daily', resumed: false }])
})

test('a tab showing Route paused completes the run another tab failed to save, and Home offers Play', async ({ page, context }) => {
  await openTabA(page, { mode: 'city', progress: parisDone })
  const tabB = await openTabB(context)
  await continueToLastResult(tabB)
  // Tab A takes the run over, so tab B stops with the "Route paused" window.
  await continueToLastResult(page)
  const paused = tabB.getByRole('dialog', { name: 'Route paused' })
  await expect(paused).toBeVisible()
  await refuseRewards(page, 'city')

  await finishInTabA(page, 'city')

  await paused.locator('.window-body').getByRole('button', { name: 'Home' }).click()
  await expect(tabB.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(tabB.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)
  await expect(tabB.locator('.title-progress li')).toHaveText(['2/20 cities', /^0\/60 ★/, '2 postcards'])
  expect(await savedSection(tabB, 'active-run')).toBeNull()
  await expectRewardsOf(tabB, 'city')
  const events = await recordedEvents(tabB)
  expect(events.filter((event) => event.name === 'route_left')).toEqual([])
  expect(events.filter((event) => event.name === 'route_started')).toHaveLength(1)
})

test('a run that fails to save while the route of Discard and start loads is completed, not discarded', async ({ page, context }) => {
  await tabA(page, { mode: 'city', progress: parisDone })
  const tabB = await openTabB(context)
  let releaseRoute = () => undefined as void
  const routeRequested = new Promise<void>((requested) => {
    void tabB.route('**/src/content/routes/paris.json*', (route) => {
      requested()
      releaseRoute = () => void route.continue()
    })
  })
  await tabB.getByRole('button', { name: 'City map' }).click()
  await cityRow(tabB, 'Paris').click()
  await tabB.getByRole('dialog', { name: 'Paris' }).getByRole('button', { name: 'Play again' }).click()
  await tabB.getByRole('dialog', { name: 'Discard your current route?' }).getByRole('button', { name: 'Discard and start' }).click()
  await routeRequested

  await finishInTabA(page, 'city')
  releaseRoute()

  await expectState(tabB, 'question')
  await expect(tabB.locator('.play-title')).toHaveText('Paris · 1/10')
  await expectRewardsOf(tabB, 'city')
  expect(await recordedEvents(tabB)).toEqual([{ name: 'route_started', cityId: 'paris', mode: 'city', resumed: false }])
})

test('a daily overview open before another tab fails to save the daily result shows today as done', async ({ page, context }) => {
  await tabA(page, { mode: 'daily', progress: parisDone })
  const tabB = await openTabB(context)
  await tabB.getByRole('button', { name: 'Daily challenge' }).click()
  await expect(tabB.getByRole('button', { name: 'Continue' })).toBeVisible()

  await finishInTabA(page, 'daily')

  await expect(tabB.locator('.daily-state')).toHaveText('Done for today. A new challenge comes tomorrow.')
  await expect(tabB.locator('.daily .summary-stats > div')).toHaveText([/^Today’s score2\/3$/, /^Day streak1 day$/])
  await expect(tabB.locator('.daily').getByRole('button')).toHaveCount(0)
  expect(await savedSection(tabB, 'active-run')).toBeNull()
  await expectRewardsOf(tabB, 'daily')
  expect(await recordedEvents(tabB)).toEqual([])
})

test('a collection open before another tab fails to save the rewards shows the new postcard', async ({ page, context }) => {
  await tabA(page, { mode: 'city', progress: parisDone })
  const tabB = await openTabB(context)
  await tabB.getByRole('button', { name: 'Collection' }).click()
  await expect(tabB.locator('.collection-count')).toHaveText('1/20 postcards')

  await finishInTabA(page, 'city')

  await expect(tabB.locator('.collection-count')).toHaveText('2/20 postcards')
  await expectRewardsOf(tabB, 'city')
})

test('Continue does not start when another tab replaced the run while its route loaded', async ({ page }) => {
  const ownRun = cityRunBeforeLastNext('london', 0)
  const otherRun = { ...cityRunBeforeLastNext('london', 3), runId: 'other-run' }
  await seedStorage(page, { progress: parisDone, 'active-run': { ownerTabId: 'closed-tab', run: ownRun } })
  let releaseRoute = () => undefined as void
  const routeRequested = new Promise<void>((requested) => {
    void page.route('**/src/content/routes/london.json*', (route) => {
      requested()
      releaseRoute = () => void route.continue()
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await routeRequested
  const otherSave = JSON.stringify({ version: 1, data: { ownerTabId: 'other-tab', run: otherRun } })
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [storageKey('active-run'), otherSave])
  releaseRoute()

  await expect(page.locator('#app')).not.toHaveAttribute('data-route-loading')
  await expect(page.locator('.play')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeFocused()
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey('active-run'))).toBe(otherSave)
  expect(await recordedEvents(page)).toEqual([])
})
