import { expect, test, type Page } from '@playwright/test'
import type { RunState } from '../src/game/logic/run.ts'
import { catalog, correctChoice, expectState, recordedEvents, savedSection, seedStorage, textOutsideChoices, wrongChoice } from './game.ts'
import { cityRunBeforeLastNext, dailyPlanOn, dailyRunBeforeLastNext, progressWith, windowHome } from './screens.ts'

const today = '2026-12-05'
const parisDone = progressWith(1, 2)
const untimedSettings = { locale: 'en', soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: false, untimed: true, shownHintIds: [] }

async function openDailyOn(page: Page, isoTime: string) {
  await page.clock.install({ time: new Date(isoTime) })
  await page.goto('/')
  await page.getByRole('button', { name: 'Daily challenge' }).click()
  await expect(page.getByRole('heading', { name: 'Daily challenge' })).toBeVisible()
}

const daily = (page: Page) => page.locator('.daily')

test('before the first completed city the tile is locked and does nothing', async ({ page }) => {
  await page.clock.install({ time: new Date(`${today}T08:00:00Z`) })
  await page.goto('/')
  const tile = page.getByRole('button', { name: 'Daily challenge' })
  await expect(tile).toHaveAttribute('aria-disabled', 'true')
  await tile.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Daily challenge' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
})

test('the day before the catalog is effective no daily challenge is offered', async ({ page }) => {
  await seedStorage(page, { progress: parisDone })
  await openDailyOn(page, '2026-11-30T23:30:00Z')
  await expect(page.locator('.daily-date')).toHaveText('November 30, 2026, UTC')
  await expect(page.locator('.daily-city')).toHaveText('Not offered yet')
  await expect(page.locator('.daily-state')).toHaveText('The first daily challenge is on December 1, 2026.')
  await expect(daily(page).getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('button', { name: 'Daily challenge' })).toBeFocused()
})

test.describe('in Prague time', () => {
  test.use({ timezoneId: 'Europe/Prague' })

  test('just after local midnight the challenge still belongs to the UTC day', async ({ page }) => {
    await seedStorage(page, { progress: parisDone })
    await openDailyOn(page, '2026-12-05T23:30:00Z')
    await expect(page.locator('.daily-date')).toHaveText('December 5, 2026, UTC')
    const { route } = dailyPlanOn(today)
    await expect(page.locator('.daily-state')).toHaveText(`Today: three stops in ${route.name.en}.`)
  })
})

test('the daily challenge plays the city and stops of dailyPlan, hides the place, ends on the daily summary and cannot start again', async ({ page }) => {
  const { plan, route, stops } = dailyPlanOn(today)
  await seedStorage(page, { progress: parisDone, settings: untimedSettings })
  await openDailyOn(page, `${today}T08:00:00Z`)
  await expect(page.locator('.daily-date')).toHaveText('December 5, 2026, UTC')
  await expect(page.getByRole('heading', { name: route.name.en })).toBeVisible()
  await expect(page.locator('.daily-state')).toHaveText(`Today: three stops in ${route.name.en}.`)
  await expect(daily(page).locator('.summary-stats > div')).toHaveText([/^Today’s scoreNot played yet$/, /^Day streak0 days$/])
  await expect(page.getByRole('button', { name: 'Start' })).toBeFocused()

  await page.goto('/')
  const totals = await page.locator('.title-progress li').allTextContents()
  await page.getByRole('button', { name: 'Daily challenge' }).click()
  await page.getByRole('button', { name: 'Start' }).click()

  await expectState(page, 'question')
  expect(await recordedEvents(page)).toEqual([{ name: 'route_started', cityId: plan.cityId, mode: 'daily', resumed: false }])
  expect((await savedSection<{ run: RunState }>(page, 'active-run')).run).toMatchObject({ mode: 'daily', untimed: true, stops: stops.map((stop) => ({ stopId: stop.id })) })

  for (const [index, stop] of stops.entries()) {
    await expectState(page, 'question')
    await expect(page.locator('.play-title')).toHaveText(`${route.name.en} · ${index + 1}/3`)
    await expect(page.locator('.question')).toHaveText(stop.question.en)
    // Untimed from the settings at the start.
    await expect(page.locator('.timer')).toBeHidden()
    const text = await textOutsideChoices(page)
    for (const place of [stop.place.en, stop.place.cs]) expect(text, `${stop.id} shows "${place}"`).not.toContain(place.toLowerCase())
    if (index === 1) {
      // After a reload the restored question still keeps the place hidden.
      await page.reload()
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Continue' }).click()
      await expectState(page, 'question')
      await expect(page.locator('.question')).toHaveText(stop.question.en)
      const restored = await textOutsideChoices(page)
      for (const place of [stop.place.en, stop.place.cs]) expect(restored, `${stop.id} shows "${place}" after a reload`).not.toContain(place.toLowerCase())
    }
    await (index === 2 ? await wrongChoice(page, stop) : correctChoice(page, stop)).click()
    await page.locator('.next').click()
  }

  await expect(page.getByRole('heading', { name: 'Daily challenge done' })).toBeVisible()
  await expect(page.getByRole('heading', { name: route.name.en })).toBeVisible()
  await expect(page.locator('.summary-stats > div')).toHaveText([/^Today’s score2\/3$/, /^Day streak1 day$/])
  await expect(page.getByRole('button', { name: 'Daily challenge' })).toBeFocused()
  const events = await recordedEvents(page)
  expect(events[0]).toEqual({ name: 'route_started', cityId: plan.cityId, mode: 'daily', resumed: true })
  expect(events.slice(-2)).toEqual([
    { name: 'route_completed', cityId: plan.cityId, mode: 'daily', correct: 2, stars: 0 },
    { name: 'daily_completed', utcDate: today, correct: 2 },
  ])
  expect(await savedSection(page, 'progress')).toEqual(parisDone)

  await page.getByRole('button', { name: 'Daily challenge' }).click()
  await expect(page.locator('.daily-city')).toHaveText(route.name.en)
  await expect(page.locator('.daily-state')).toHaveText('Done for today. A new challenge comes tomorrow.')
  await expect(daily(page).locator('.summary-stats > div')).toHaveText([/^Today’s score2\/3$/, /^Day streak1 day$/])
  await expect(daily(page).getByRole('button')).toHaveCount(0)

  await windowHome(page).click()
  await expect(page.locator('.title-progress li')).toHaveText(totals)
})

test('the day streak counts consecutive days with a result up to yesterday', async ({ page }) => {
  const results = {
    '2026-12-02': { cityId: 'rome', correct: 1 },
    '2026-12-03': { cityId: 'berlin', correct: 3 },
    '2026-12-04': { cityId: 'madrid', correct: 2 },
  }
  await seedStorage(page, { progress: parisDone, 'daily-results': results })
  await openDailyOn(page, `${today}T08:00:00Z`)
  await expect(daily(page).locator('.summary-stats > div')).toHaveText([/^Today’s scoreNot played yet$/, /^Day streak3 days$/])
})

test('a daily run left on the game screen shows as in progress and Continue resumes it', async ({ page }) => {
  const { route } = dailyPlanOn(today)
  await seedStorage(page, { progress: parisDone })
  await openDailyOn(page, `${today}T08:00:00Z`)
  await page.getByRole('button', { name: 'Start' }).click()
  await expectState(page, 'question')
  await page.locator('.play-bar').getByRole('button', { name: 'Save and go to Home' }).click()
  await page.getByRole('button', { name: 'Daily challenge' }).click()
  await expect(page.locator('.daily-city')).toHaveText(route.name.en)
  await expect(page.locator('.daily-state')).toHaveText('Your daily challenge is in progress.')
  await expect(daily(page).locator('.summary-stats > div').first()).toHaveText(/^Today’s scoreIn progress$/)
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
  await expect(page.locator('.play-title')).toHaveText(`${route.name.en} · 1/3`)
})

test('Start with a city run in progress asks first, and Discard and start begins the daily run', async ({ page }) => {
  const { plan } = dailyPlanOn(today)
  await seedStorage(page, { progress: parisDone, 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('london', 3) } })
  await openDailyOn(page, `${today}T08:00:00Z`)
  await page.getByRole('button', { name: 'Start' }).click()
  const change = page.getByRole('dialog', { name: 'Discard your current route?' })
  await change.getByRole('button', { name: 'Keep my route' }).click()
  await expect(page.getByRole('button', { name: 'Start' })).toBeFocused()
  await page.getByRole('button', { name: 'Start' }).click()
  await change.getByRole('button', { name: 'Discard and start' }).click()
  await expectState(page, 'question')
  await expect(page.locator('.play-title')).toHaveText(/ · 1\/3$/)
  expect(await recordedEvents(page)).toEqual([
    { name: 'route_left', cityId: 'london', mode: 'city', index: 10, reason: 'abandoned' },
    { name: 'route_started', cityId: plan.cityId, mode: 'daily', resumed: false },
  ])
  expect((await savedSection<{ run: RunState }>(page, 'active-run')).run.daily).toEqual({ utcDate: today, catalogEffectiveUtcDate: catalog.versions[0].effectiveUtcDate })
})

test('the daily summary leads to the title and changes no stars, postcards or unlocks', async ({ page }) => {
  await seedStorage(page, { progress: parisDone, 'active-run': { ownerTabId: 'closed-tab', run: dailyRunBeforeLastNext(today, 3) } })
  await page.clock.install({ time: new Date(`${today}T08:00:00Z`) })
  await page.goto('/')
  const totals = await page.locator('.title-progress li').allTextContents()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Continue' }).click()
  await page.locator('.next').click()
  await expect(page.locator('.summary-stats > div')).toHaveText([/^Today’s score3\/3$/, /^Day streak1 day$/])
  await page.locator('.daily').getByRole('button', { name: 'Home' }).click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
  await expect(page.locator('.title-progress li')).toHaveText(totals)
  expect(await savedSection(page, 'progress')).toEqual(parisDone)
})
