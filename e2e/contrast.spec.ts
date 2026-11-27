import { expect, test, type Page } from '@playwright/test'
import { contrast, expectReadableScreen, type ContrastReport } from './contrast.ts'
import { correctChoice, expectState, installClock, paris, pauseClock, seedStorage, wrongChoice } from './game.ts'
import { cityRunBeforeLastNext, continueToSummary, dailyRunBeforeLastNext, progressWith } from './screens.ts'

// D2: every screen of the game, measured as drawn. Each screen's lowest ratios land in the test's annotations.

async function measure(page: Page, where: string, options?: { rings?: boolean }) {
  const report: ContrastReport = await expectReadableScreen(page, where, options)
  test.info().annotations.push({
    type: 'contrast',
    description: `${where}: ${report.texts} texts (lowest ${report.lowestText.toFixed(2)}:1, ${report.inactive} of them on inactive controls), ${report.rings} focus rings (lowest ${report.lowestRing.toFixed(2)}:1)`,
  })
}

test('the measure itself: navy on cream passes, the separator colour on cream would not', () => {
  expect(contrast([21, 31, 68], [255, 244, 224])).toBeGreaterThan(14)
  expect(contrast([196, 196, 207], [255, 244, 224])).toBeLessThan(3)
})

for (const locale of ['en', 'cs'] as const) {
  test.describe(`in ${locale}`, () => {
    const settings = { locale, soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: false, untimed: false, shownHintIds: [] }

    test('loading, title, settings, and the game with every result, 50:50, pause and the skip windows', async ({ page }) => {
      await page.route('**/src/main.ts*', () => undefined)
      await page.goto('/', { waitUntil: 'commit' })
      await expect(page.locator('#boot')).toHaveAttribute('data-state', 'loading')
      await measure(page, 'static loading', { rings: false })
      await page.unroute('**/src/main.ts*')
      await page.route('**/src/main.ts*', (route) => route.abort())
      await page.reload()
      await expect(page.locator('#boot-retry')).toBeVisible()
      await measure(page, 'static load error')
      await page.unroute('**/src/main.ts*')

      await seedStorage(page, { settings })
      let releaseScene = () => undefined as void
      await page.route('**/scenes/PAR01.webp', (route) => {
        releaseScene = () => void route.continue()
      })
      await installClock(page)
      await page.goto('/?ad=cancelled')
      await pauseClock(page)
      await expect(page.locator('[data-focus-id="title-play"]')).toBeVisible()
      await measure(page, 'title')
      await page.locator('[data-focus-id="title-settings"]').click()
      await measure(page, 'settings')
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog')).toHaveCount(0)

      await page.locator('[data-focus-id="title-play"]').click()
      await expectState(page, 'loading')
      await measure(page, 'scene loading')
      releaseScene()
      await expectState(page, 'question')
      await measure(page, 'question')
      await correctChoice(page, paris.stops[0], locale).click()
      await measure(page, 'result correct')
      await page.locator('.next').click()
      await expectState(page, 'question')
      await expect(page.locator('.lifeline-hint')).toBeVisible()
      await measure(page, '50:50 hint', { rings: false })
      await page.locator('[data-lifeline="fifty"]').click()
      await measure(page, 'after 50:50')
      await (await wrongChoice(page, paris.stops[1], locale)).click()
      await measure(page, 'result wrong')
      await page.locator('.next').click()
      await expectState(page, 'question')
      await page.clock.runFor(25_000)
      await expectState(page, 'result')
      await measure(page, 'result time is up')
      await page.locator('.next').click()
      await expectState(page, 'question')

      await page.keyboard.press('Escape')
      await expect(page.locator('dialog[open]')).toHaveCount(1)
      await measure(page, 'pause')
      await page.locator('[data-focus-id="pause-skip"]').click()
      await measure(page, 'skip confirmation')
      await page.locator('dialog[open] .skip-play').click()
      await expect(page.locator('dialog[open] .scene-loading-bar')).toBeVisible()
      await measure(page, 'wait for the spot', { rings: false })
      await page.clock.runFor(600)
      await expect(page.locator('dialog[open] [data-focus-id="skip-back"]')).toBeVisible()
      await measure(page, 'spot cancelled')
    })

    test('a skipped question, the scene error and the route error', async ({ page }) => {
      await seedStorage(page, { settings })
      await installClock(page)
      await page.goto('/?ad=completed')
      await pauseClock(page)
      await page.locator('[data-focus-id="title-play"]').click()
      for (const stop of paris.stops.slice(0, 2)) {
        await correctChoice(page, stop, locale).click()
        await page.locator('.next').click()
      }
      await expectState(page, 'question')
      await page.keyboard.press('Escape')
      await page.locator('[data-focus-id="pause-skip"]').click()
      await page.locator('dialog[open] .skip-play').click()
      await page.clock.runFor(600)
      await expect(page.locator('.play')).toHaveAttribute('data-verdict', 'skipped')
      await measure(page, 'result skipped')

      await page.route('**/scenes/PAR04.webp', (route) => route.abort())
      await page.locator('.next').click()
      await expectState(page, 'error')
      await measure(page, 'scene error')

      await page.route('**/src/content/routes/paris.json*', (route) => route.abort())
      await page.reload()
      await page.locator('[data-focus-id="title-play"]').click()
      await expect(page.locator('.route-error')).toBeVisible()
      await measure(page, 'route error')
    })

    test('map, details, route change, collection, card, summaries and the daily screens', async ({ page }) => {
      await seedStorage(page, { settings, progress: progressWith(2, 2), 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('rome', 6) } })
      await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
      await page.goto('/')
      await page.locator('[data-focus-id="title-map"]').click()
      await expect(page.locator('.map-point').first()).toBeVisible()
      await measure(page, 'map')
      await page.locator('.map-cluster').first().click()
      await expect(page.locator('.map-label').first()).toBeVisible()
      await measure(page, 'zoomed map with names')
      await page.locator('[data-focus-id="map-zoom-out"]').click()
      for (const [row, what] of [
        [0, 'completed city'],
        [2, 'city in progress'],
        [3, 'locked city'],
      ] as const) {
        await page.locator('.city-row').nth(row).click()
        await expect(page.locator('dialog[open]')).toHaveCount(1)
        await measure(page, what)
        if (row === 0) {
          await page.locator('dialog[open] .city-play').click()
          await expect(page.locator('dialog[open]')).toHaveCount(2)
          await measure(page, 'route change')
          await page.keyboard.press('Escape')
          await expect(page.locator('dialog')).toHaveCount(1)
        }
        await page.keyboard.press('Escape')
        await expect(page.locator('dialog')).toHaveCount(0)
      }
      await page.keyboard.press('Escape')

      await page.locator('[data-focus-id="title-collection"]').click()
      await measure(page, 'collection')
      await page.locator('.postcard-card').first().click()
      await measure(page, 'postcard')
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog')).toHaveCount(0)
      await page.keyboard.press('Escape')

      await page.locator('[data-focus-id="title-daily"]').click()
      await measure(page, 'daily available')
      await page.keyboard.press('Escape')

      await continueToSummary(page)
      await expect(page.locator('.summary-postcard')).toBeVisible()
      await measure(page, 'city summary')

      await page.evaluate((run) => localStorage.setItem('postcard-trail:active-run', JSON.stringify({ version: 1, data: { ownerTabId: 'closed-tab', run } })), dailyRunBeforeLastNext('2026-12-05', 2))
      await page.reload()
      await page.locator('[data-focus-id="title-daily"]').click()
      await measure(page, 'daily in progress')
      await page.keyboard.press('Escape')
      await continueToSummary(page)
      await expect(page.locator('[data-focus-id="daily-summary-overview"]')).toBeVisible()
      await measure(page, 'daily summary')
      await page.locator('[data-focus-id="daily-summary-overview"]').click()
      await measure(page, 'daily done')
    })

    test('the daily overview before the first catalog and with the daily tile locked', async ({ page }) => {
      await seedStorage(page, { settings, progress: progressWith(1, 0) })
      await page.clock.install({ time: new Date('2026-11-30T08:00:00Z') })
      await page.goto('/')
      await page.locator('[data-focus-id="title-daily"]').click()
      await expect(page.locator('.daily-city')).toBeVisible()
      await measure(page, 'daily not offered')
      await page.evaluate(() => localStorage.removeItem('postcard-trail:progress'))
      await page.reload()
      await expect(page.locator('.title-daily-condition')).toBeVisible()
      await measure(page, 'title with the locked daily tile')
    })
  })
}
