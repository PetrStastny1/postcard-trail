import { expect, test, type Page } from '@playwright/test'
import { correctChoice, expectState, inspectPlayLayout, readRoute, seedStorage, storageKey } from './game.ts'
import { expectUsableLayout } from './layout.ts'
import { progressWith } from './screens.ts'

// D1: the screens and windows not covered by screens-layout, play-layout and skip specs, at the minimum and Poki sizes.

const d1Sizes = [
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 640, height: 360 },
  { width: 836, height: 470 },
  { width: 1031, height: 580 },
] as const

const words = {
  en: { play: 'Play', settings: 'Settings', paused: 'Paused', start: 'Start', daily: 'Daily challenge' },
  cs: { play: 'Hrát', settings: 'Nastavení', paused: 'Pauza', start: 'Začít', daily: 'Denní výzva' },
} as const

const settingsIn = (locale: 'en' | 'cs') => ({ locale, soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: false, untimed: false, shownHintIds: [] })

async function startCity(page: Page, locale: 'en' | 'cs') {
  await page.getByRole('button', { name: words[locale].play, exact: true }).click()
}

for (const locale of ['en', 'cs'] as const) {
  for (const size of d1Sizes) {
    test.describe(`${size.width} × ${size.height} in ${locale}`, () => {
      test.use({ viewport: size })

      test('the static loading and its error state are usable', async ({ page }) => {
        // The static screen is English by design: the saved language is known only once the script runs.
        await page.route('**/src/main.ts*', () => undefined)
        // The held entry module keeps the document from finishing, so the navigation is awaited only until it commits.
        await page.goto('/', { waitUntil: 'commit' })
        await expect(page.locator('#boot')).toHaveAttribute('data-state', 'loading')
        await expectUsableLayout(page)
        await page.unroute('**/src/main.ts*')
        await page.route('**/src/main.ts*', (route) => route.abort())
        await page.reload()
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
        await expectUsableLayout(page)
      })

      test('title, settings, pause, settings over the pause, zoom and the other-tab window are usable', async ({ page }) => {
        await seedStorage(page, { settings: settingsIn(locale) })
        await page.goto('/')
        await expect(page.getByRole('button', { name: words[locale].play, exact: true })).toBeVisible()
        await expectUsableLayout(page)
        await page.locator('[data-focus-id="title-settings"]').click()
        await expect(page.getByRole('dialog', { name: words[locale].settings })).toBeVisible()
        await expectUsableLayout(page)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)

        await startCity(page, locale)
        await expectState(page, 'question')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name: words[locale].paused })).toBeVisible()
        await expectUsableLayout(page)
        await page.getByRole('dialog', { name: words[locale].paused }).locator('[data-focus-id="pause-settings"]').click()
        await expect(page.getByRole('dialog', { name: words[locale].settings })).toBeVisible()
        await expectUsableLayout(page)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)

        await page.locator('.zoom-button').click()
        await expect(page.locator('dialog.zoom-window')).toBeVisible()
        await expectUsableLayout(page)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)

        // Another tab takes the run over: the storage event tells this one.
        await page.evaluate((key) => {
          const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
          saved.data.ownerTabId = 'other-tab'
          const newValue = JSON.stringify(saved)
          localStorage.setItem(key, newValue)
          dispatchEvent(new StorageEvent('storage', { key, newValue }))
        }, storageKey('active-run'))
        await expect(page.locator('dialog[open] [data-focus-id="elsewhere-home"]')).toBeFocused()
        await expectUsableLayout(page)
      })

      test('the route load error is usable', async ({ page }) => {
        await seedStorage(page, { settings: settingsIn(locale) })
        await page.route('**/src/content/routes/paris.json*', (route) => route.abort())
        await page.goto('/')
        await startCity(page, locale)
        await expect(page.locator('.route-error')).toBeVisible()
        await expectUsableLayout(page)
      })

      test('the daily question and result pass the game screen checks', async ({ page }) => {
        const madrid = readRoute('madrid')
        await seedStorage(page, { settings: settingsIn(locale), progress: progressWith(1, 0) })
        await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
        await page.goto('/')
        await page.getByRole('button', { name: words[locale].daily }).click()
        await page.getByRole('button', { name: words[locale].start }).click()
        await expectState(page, 'question')
        await expect(page.locator('.play-title')).toHaveText(`${madrid.name[locale]} · 1/3`)
        expect((await inspectPlayLayout(page)).problems, 'question').toEqual([])
        await correctChoice(page, madrid.stops[0], locale).click()
        await expectState(page, 'result')
        expect((await inspectPlayLayout(page)).problems, 'result').toEqual([])
      })
    })
  }
}
