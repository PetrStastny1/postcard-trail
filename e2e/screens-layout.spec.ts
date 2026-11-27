import { expect, test, type Page } from '@playwright/test'
import { seedStorage } from './game.ts'
import { expectUsableLayout, layoutSizes } from './layout.ts'
import { cityRunBeforeLastNext, continueToSummary, dailyRunBeforeLastNext, progressWith } from './screens.ts'

const settingsIn = (locale: 'en' | 'cs') => ({ locale, soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: false, untimed: false, shownHintIds: [] })
const control = (page: Page, focusId: string) => page.locator(`[data-focus-id="${focusId}"]`)
const topDialog = (page: Page) => page.locator('dialog[open]').last()

async function closeTopDialog(page: Page) {
  const count = await page.locator('dialog[open]').count()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(count - 1)
}

async function homeFromScreen(page: Page) {
  await page.locator('.window-screen [data-focus-id="window-home"]').click()
  await expect(control(page, 'title-play')).toBeVisible()
}

for (const locale of ['en', 'cs'] as const) {
  for (const size of layoutSizes) {
    test.describe(`${size.width} × ${size.height} in ${locale}`, () => {
      test.use({ viewport: size })

      test('map, city details, route change, collection, card, daily overview and city summary are usable', async ({ page }) => {
        await seedStorage(page, {
          settings: settingsIn(locale),
          progress: progressWith(2, 1),
          'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('rome', 9) },
        })
        await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
        await page.goto('/')

        await control(page, 'title-map').click()
        await expect(page.locator('.map-point').first()).toBeVisible()
        await expectUsableLayout(page)

        await page.locator('.city-row').nth(0).click()
        await expect(topDialog(page).locator('.postcard-art')).toBeVisible()
        await expectUsableLayout(page)
        await topDialog(page).locator('.city-play').click()
        await expect(topDialog(page).locator('.route-change')).toBeVisible()
        await expectUsableLayout(page)
        await closeTopDialog(page)
        await closeTopDialog(page)

        await page.locator('.city-row').nth(3).click()
        await expect(topDialog(page).locator('.city-condition')).toBeVisible()
        await expectUsableLayout(page)
        await closeTopDialog(page)
        await homeFromScreen(page)

        await control(page, 'title-collection').click()
        await expect(page.locator('.postcard-grid')).toBeVisible()
        await expectUsableLayout(page)
        await page.locator('.postcard-card').first().click()
        await expect(topDialog(page).locator('.postcard-sentence')).toBeVisible()
        await expectUsableLayout(page)
        await closeTopDialog(page)
        await homeFromScreen(page)

        await control(page, 'title-daily').click()
        await expect(control(page, 'daily-start')).toBeVisible()
        await expectUsableLayout(page)
        await homeFromScreen(page)

        await continueToSummary(page)
        await expect(page.locator('.summary-postcard')).toBeVisible()
        await expectUsableLayout(page)
      })

      test('the daily summary is usable', async ({ page }) => {
        await seedStorage(page, {
          settings: settingsIn(locale),
          progress: progressWith(1, 0),
          'active-run': { ownerTabId: 'closed-tab', run: dailyRunBeforeLastNext('2026-12-05', 2) },
        })
        await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
        await page.goto('/')
        await continueToSummary(page)
        await expect(control(page, 'daily-summary-overview')).toBeVisible()
        await expectUsableLayout(page)
      })
    })
  }
}
