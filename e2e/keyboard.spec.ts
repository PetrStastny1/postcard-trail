import { expect, test, type Page } from '@playwright/test'
import { correctChoice, expectState, installClock, paris, pauseClock, seedStorage } from './game.ts'
import { cityRunBeforeLastNext, continueToSummary, dailyRunBeforeLastNext, progressWith } from './screens.ts'

// D3, brief §4: Tab and Shift+Tab reach every control of the top layer in order, the focus is always seen, Enter and
// Space press buttons, Escape is × in a window and the pause in the game, and 1–4 only press shown, allowed choices.

const control = (page: Page, focusId: string) => page.locator(`[data-focus-id="${focusId}"]`).last()
/**
 * Escape on the top window. The browser moves the focus back at once, the app's `close` handler a task later, so the
 * test waits until the window is gone from the page before it moves the focus itself.
 */
async function closeTopDialog(page: Page) {
  const count = await page.locator('dialog').count()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog')).toHaveCount(count - 1)
}

/**
 * The map draws its groups again for its measured size. Resize observers run in the rendering step after animation
 * frames, so two frames later that has happened.
 */
async function mapDrawn(page: Page) {
  await expect(page.locator('.map-point').first()).toBeVisible()
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.focusId ?? document.activeElement?.tagName)

/**
 * Lists the tabbable controls of the top layer (the last open dialog, else the page) in document order, then walks
 * them with Tab and Shift+Tab: each press must reach the next one, wrapping round, with a visible focus ring. Controls
 * are told apart by their `data-focus-id` and name, so a screen that draws itself again (the map on resize) keeps them.
 */
async function expectTabCycle(page: Page, what: string) {
  const expected = await page.evaluate(() => {
    const key = (node: Element) => `${(node as HTMLElement).dataset.focusId ?? node.tagName}|${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim()}`
    const layer: ParentNode = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document
    return [...layer.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')]
      .filter((node) => {
        const style = getComputedStyle(node)
        const box = node.getBoundingClientRect()
        return node.tabIndex >= 0 && !(node as HTMLButtonElement).disabled && !node.closest('[inert]') && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
      })
      .map(key)
  })
  const count = expected.length
  expect(count, `${what}: tabbable controls`).toBeGreaterThan(0)
  expect(new Set(expected).size, `${what}: every control can be told apart`).toBe(count)
  expect(await page.locator('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])').count(), `${what}: no positive tabindex`).toBe(0)

  for (const [press, step] of [
    ['Tab', 1],
    ['Shift+Tab', -1],
  ] as const) {
    const reached: number[] = []
    for (let index = 0; index < count * 2 + 2; index++) {
      await page.keyboard.press(press)
      const state = await page.evaluate(() => {
        const node = document.activeElement as HTMLElement | null
        if (!node || node === document.body) return null
        const style = getComputedStyle(node)
        return {
          key: `${node.dataset.focusId ?? node.tagName}|${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim()}`,
          ring: node.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2,
        }
      })
      // Leaving the last control of the page passes through the browser's own UI, which the page does not see.
      if (state === null) continue
      const order = expected.indexOf(state.key)
      expect(order, `${what}: ${press} reached ${state.key} outside the expected controls`).not.toBe(-1)
      expect(state.ring, `${what}: ${state.key} has no visible focus ring`).toBe(true)
      reached.push(order)
    }
    for (let index = 1; index < reached.length; index++) {
      expect(reached[index], `${what}: ${press} after ${expected[reached[index - 1]]}`).toBe((reached[index - 1] + step + count) % count)
    }
    expect(new Set(reached).size, `${what}: ${press} reaches every control`).toBe(count)
  }
}

test.describe('Tab and Shift+Tab on every screen', () => {
  test('title, settings, map, city details, route change, collection, card and daily overview', async ({ page }) => {
    await seedStorage(page, { progress: progressWith(2, 1), 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('rome', 3) } })
    await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
    await page.goto('/')
    await expect(control(page, 'title-play')).toBeVisible()
    await expectTabCycle(page, 'title')
    await control(page, 'title-settings').focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expectTabCycle(page, 'settings')
    await closeTopDialog(page)
    await expect(control(page, 'title-settings')).toBeFocused()

    await control(page, 'title-map').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'City map' })).toBeVisible()
    await mapDrawn(page)
    await expectTabCycle(page, 'map')
    await page.locator('.map-cluster').first().focus()
    await page.keyboard.press('Space')
    await expect(control(page, 'map-zoom-out')).toBeVisible()
    await mapDrawn(page)
    await expectTabCycle(page, 'zoomed map')
    await control(page, 'map-zoom-out').focus()
    await page.keyboard.press('Enter')
    await expect(control(page, 'map-zoom-out')).toHaveCount(0)

    await control(page, 'map-city-paris').focus()
    await page.keyboard.press('Enter')
    const detail = page.getByRole('dialog', { name: 'Paris' })
    await expect(detail).toBeVisible()
    await expectTabCycle(page, 'city detail')
    await control(page, 'city-play').focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('dialog', { name: 'Discard your current route?' })).toBeVisible()
    await expectTabCycle(page, 'route change')
    await closeTopDialog(page)
    await expect(control(page, 'city-play')).toBeFocused()
    await closeTopDialog(page)
    await expect(control(page, 'map-city-paris')).toBeFocused()
    await control(page, 'map-city-berlin').focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('dialog', { name: 'Berlin' })).toBeVisible()
    await expectTabCycle(page, 'locked city detail')
    await closeTopDialog(page)
    await page.keyboard.press('Escape')
    await expect(control(page, 'title-map')).toBeFocused()

    await control(page, 'title-collection').focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible()
    await expectTabCycle(page, 'collection')
    await page.locator('.postcard-card').first().focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('dialog[open] .postcard-sentence')).toBeVisible()
    await expectTabCycle(page, 'postcard')
    await closeTopDialog(page)
    await expect(page.locator('.postcard-card').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(control(page, 'title-collection')).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible()
    await page.keyboard.press('Escape')
    await control(page, 'title-daily').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Daily challenge' })).toBeVisible()
    await expectTabCycle(page, 'daily overview')
    await page.keyboard.press('Escape')
    await expect(control(page, 'title-daily')).toBeFocused()
  })

  test('game question, result, pause, settings over the pause, zoom, skip windows and the other tab', async ({ page }) => {
    await installClock(page)
    await page.goto('/?ad=cancelled')
    await pauseClock(page)
    await control(page, 'title-play').focus()
    await page.keyboard.press('Enter')
    await expectState(page, 'question')
    await expect(page.locator('.question')).toBeFocused()
    await expectTabCycle(page, 'question')

    await correctChoice(page, paris.stops[0]).focus()
    await page.keyboard.press('Space')
    await expectState(page, 'result')
    await expect(control(page, 'play-next')).toBeFocused()
    await expectTabCycle(page, 'result')
    await control(page, 'play-zoom').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('dialog.zoom-window')).toBeVisible()
    await expectTabCycle(page, 'zoom')
    await closeTopDialog(page)
    await expect(control(page, 'play-zoom')).toBeFocused()
    await control(page, 'play-next').focus()
    await page.keyboard.press('Enter')
    await expectState(page, 'question')
    await expect(page.locator('.play-title')).toHaveText('Paris · 2/10')
    await correctChoice(page, paris.stops[1]).focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.locator('.play-title')).toHaveText('Paris · 3/10')

    // Escape on the game pauses; in the pause it works like ×, which continues.
    await page.keyboard.press('Escape')
    const pause = page.getByRole('dialog', { name: 'Paused' })
    await expect(pause).toBeVisible()
    await expectTabCycle(page, 'pause')
    await closeTopDialog(page)
    await expect(pause).toHaveCount(0)
    await expect(control(page, 'play-pause')).toBeFocused()
    await page.keyboard.press('Enter')
    await control(page, 'pause-settings').focus()
    await page.keyboard.press('Space')
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expectTabCycle(page, 'settings over the pause')
    await closeTopDialog(page)
    await expect(control(page, 'pause-settings')).toBeFocused()

    await control(page, 'pause-skip').focus()
    await page.keyboard.press('Enter')
    const skip = page.getByRole('dialog', { name: 'Skip with a video' })
    await expect(control(page, 'skip-back')).toBeFocused()
    await expectTabCycle(page, 'skip confirmation')
    await control(page, 'skip-play').focus()
    await page.keyboard.press('Space')
    await page.clock.runFor(600)
    await expect(skip).toContainText('The video didn’t finish')
    await expectTabCycle(page, 'skip outcome')
    await page.keyboard.press('Escape')
    await expect(pause).toBeVisible()
    await expect(control(page, 'pause-skip')).toBeFocused()
    await control(page, 'pause-continue').focus()
    await page.keyboard.press('Enter')
    await expect(pause).toHaveCount(0)

    await page.evaluate(() => {
      const key = 'postcard-trail:active-run'
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      saved.data.ownerTabId = 'other-tab'
      localStorage.setItem(key, JSON.stringify(saved))
      dispatchEvent(new StorageEvent('storage', { key, newValue: localStorage.getItem(key) }))
    })
    await expect(control(page, 'elsewhere-home')).toBeFocused()
    await expectTabCycle(page, 'route continues in another tab')
    await page.keyboard.press('Space')
    await expect(control(page, 'title-play')).toBeVisible()
  })

  test('the loading and error states of the game, the route error and the static error', async ({ page }) => {
    await page.route('**/scenes/PAR01.webp', (route) => route.abort())
    await page.goto('/')
    await control(page, 'title-play').focus()
    await page.keyboard.press('Enter')
    await expectState(page, 'error')
    await expectTabCycle(page, 'scene error')
    // Brief §4: the error has no pause, so Escape leaves the screen alone.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await control(page, 'scene-home').focus()
    await page.keyboard.press('Enter')

    // A new page load, so the route is not in the module cache any more.
    await page.route('**/src/content/routes/paris.json*', (route) => route.abort())
    await page.reload()
    await control(page, 'title-play').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.route-error')).toBeVisible()
    await expectTabCycle(page, 'route error')
    await control(page, 'route-home').focus()
    await page.keyboard.press('Space')
    await expect(control(page, 'title-play')).toBeVisible()

    await page.route('**/src/main.ts*', (route) => route.abort())
    await page.reload()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expectTabCycle(page, 'static load error')
  })

  test('city summary and daily summary', async ({ page }) => {
    await seedStorage(page, { progress: progressWith(1, 0), 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('london', 4) } })
    await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
    await page.goto('/')
    await continueToSummary(page)
    await expect(control(page, 'summary-next')).toBeFocused()
    await expectTabCycle(page, 'city summary')
    await page.keyboard.press('Escape')
    await expect(control(page, 'title-play')).toBeFocused()

    await page.evaluate(
      (run) => localStorage.setItem('postcard-trail:active-run', JSON.stringify({ version: 1, data: { ownerTabId: 'closed-tab', run } })),
      dailyRunBeforeLastNext('2026-12-05', 1),
    )
    await page.reload()
    await continueToSummary(page)
    await expect(control(page, 'daily-summary-overview')).toBeFocused()
    await expectTabCycle(page, 'daily summary')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: 'Daily challenge', exact: true })).toBeVisible()
  })
})

test.describe('keys 1–4', () => {
  test('press only shown, allowed choices: not while loading, not removed by 50:50, not under the pause, not in the result', async ({ page }) => {
    let releaseScene = () => undefined as void
    await page.route('**/scenes/PAR01.webp', (route) => {
      releaseScene = () => void route.continue()
    })
    await installClock(page)
    await page.goto('/')
    await pauseClock(page)
    await control(page, 'title-play').click()
    await expectState(page, 'loading')
    for (const key of ['1', '2', '3', '4']) await page.keyboard.press(key)
    await expectState(page, 'loading')
    releaseScene()
    await expectState(page, 'question')

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
    for (const key of ['1', '2', '3', '4']) await page.keyboard.press(key)
    await closeTopDialog(page)
    await expectState(page, 'question')

    await control(page, 'lifeline-fifty').click()
    const removedKeys = await page.locator('.choice').evaluateAll((choices) =>
      choices.flatMap((choice, index) => (choice.classList.contains('is-removed') ? [String(index + 1)] : [])),
    )
    expect(removedKeys).toHaveLength(2)
    for (const key of removedKeys) await page.keyboard.press(key)
    await expectState(page, 'question')

    const shownKey = await page.locator('.choice').evaluateAll((choices) => String(choices.findIndex((choice) => !choice.classList.contains('is-removed')) + 1))
    await page.keyboard.press(shownKey)
    await expectState(page, 'result')
    const marked = await page.locator('.choice.is-correct, .choice.is-wrong').count()
    for (const key of ['1', '2', '3', '4']) await page.keyboard.press(key)
    await expect(page.locator('.choice.is-correct, .choice.is-wrong')).toHaveCount(marked)
    await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
  })

  test('a key presses the choice in its shown position', async ({ page }) => {
    await page.goto('/')
    await control(page, 'title-play').click()
    await expectState(page, 'question')
    const labels = await page.locator('.choice-label').allTextContents()
    const wrongIndex = labels.findIndex((label) => label !== paris.stops[0].choices.find((choice) => choice.id === paris.stops[0].correctChoiceId)?.label.en)
    await page.keyboard.press(String(wrongIndex + 1))
    await expectState(page, 'result')
    await expect(page.locator('.choice').nth(wrongIndex)).toHaveClass(/is-wrong/)
    expect(await focused(page)).toBe('play-next')
  })
})
