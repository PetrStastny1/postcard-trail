import { expect, test, type Page } from '@playwright/test'
import { catalog, seedStorage } from './game.ts'
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

/** The number, name, state words and stars of every city row stay inside the row and clear of each other. */
async function expectCityRowsApart(page: Page) {
  const problems = await page.locator('.city-row').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const parts = ['.city-number', '.city-name', '.city-state-icon', '.city-state > span:not(.city-state-icon, .star-rating)', '.star-rating > [aria-hidden]']
        .map((selector) => row.querySelector(selector))
        .filter((part) => part !== null)
        .map((part) => {
          const range = document.createRange()
          range.selectNodeContents(part)
          return { text: part.textContent ?? '', box: range.getBoundingClientRect() }
        })
      const rowBox = row.getBoundingClientRect()
      const found: string[] = []
      for (const [index, first] of parts.entries()) {
        const { box } = first
        if (box.left < rowBox.left || box.right > rowBox.right || box.top < rowBox.top || box.bottom > rowBox.bottom) found.push(`"${first.text}" leaves its row`)
        for (const second of parts.slice(index + 1)) {
          const width = Math.min(box.right, second.box.right) - Math.max(box.left, second.box.left)
          const height = Math.min(box.bottom, second.box.bottom) - Math.max(box.top, second.box.top)
          if (width > 0.5 && height > 0.5) found.push(`"${first.text}" overlaps "${second.text}"`)
        }
      }
      return found
    }),
  )
  expect(problems).toEqual([])
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
        // The layout check leaves the map scrolled, and controls scrolled away would count as overlapping, so the
        // zoomed map is checked on a fresh map.
        await homeFromScreen(page)
        await control(page, 'title-map').click()
        await page.locator('.map-cluster').first().click()
        await expect(control(page, 'map-zoom-out')).toBeVisible()
        await expectUsableLayout(page)
        await control(page, 'map-zoom-out').click()

        // Rome has the active run, so its detail offers Continue.
        await page.locator('.city-row').nth(2).click()
        await expect(topDialog(page).locator('.city-play')).toHaveText(locale === 'en' ? 'Continue' : 'Pokračovat')
        await expectUsableLayout(page)
        await closeTopDialog(page)

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

      test('with all 20 cities done the city rows keep their texts apart and the last summary offers Map', async ({ page }) => {
        await seedStorage(page, {
          settings: settingsIn(locale),
          progress: progressWith(20, 3),
          'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext(catalog.cities[19].id, 5) },
        })
        await page.goto('/')
        await control(page, 'title-map').click()
        await expect(page.locator('.city-row')).toHaveCount(20)
        await expectCityRowsApart(page)
        await expectUsableLayout(page)
        await homeFromScreen(page)

        await continueToSummary(page)
        await expect(control(page, 'summary-next')).toHaveText(locale === 'en' ? 'Map' : 'Mapa')
        await expectUsableLayout(page)
      })

      for (const [state, time, sections] of [
        ['not offered', '2026-11-30T08:00:00Z', {}],
        ['in progress', '2026-12-05T08:00:00Z', { 'active-run': { ownerTabId: 'closed-tab', run: dailyRunBeforeLastNext('2026-12-05', 1) } }],
        ['done', '2026-12-05T08:00:00Z', { 'daily-results': { '2026-12-05': { cityId: 'paris', correct: 2 } } }],
      ] as const) {
        test(`the daily overview ${state} is usable`, async ({ page }) => {
          await seedStorage(page, { settings: settingsIn(locale), progress: progressWith(1, 0), ...sections })
          await page.clock.install({ time: new Date(time) })
          await page.goto('/')
          await control(page, 'title-daily').click()
          await expect(page.locator('.daily-city')).toBeVisible()
          await expectUsableLayout(page)
        })
      }

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
