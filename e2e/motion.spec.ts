import { expect, test, type Page } from '@playwright/test'
import { correctChoice, expectState, installClock, paris, pauseClock, seedStorage } from './game.ts'
import { cityRunBeforeLastNext, continueToSummary, progressWith } from './screens.ts'

// Brief §8, A13: with less motion asked for, by the system or by "Reduce motion", nothing moves for longer than 100 ms.

const maxMotionMs = 100

/** Running animations and transitions longer than 100 ms on any element or its ::before and ::after. */
async function expectNoLongMotion(page: Page, where: string) {
  const moving = await page.evaluate((limit) => {
    const found: string[] = []
    const name = (node: Element) => `${node.tagName.toLowerCase()}.${typeof node.className === 'string' ? node.className : node.getAttribute('class')}`
    for (const animation of document.getAnimations()) {
      if (animation.playState !== 'running') continue
      const timing = animation.effect?.getComputedTiming()
      const total = Number(timing?.endTime ?? 0)
      const target = (animation.effect as KeyframeEffect | null)?.target
      if (!Number.isFinite(total) || total > limit) found.push(`${animation.constructor.name} ${(animation as CSSAnimation).animationName ?? ''} on ${target ? name(target) : '?'} runs ${total} ms`)
    }
    const seconds = (value: string) => Math.max(...value.split(',').map((part) => parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000)))
    for (const node of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(node, pseudo)
        if (style.transitionProperty === 'none') continue
        const longest = seconds(style.transitionDuration) + seconds(style.transitionDelay)
        if (longest > limit) found.push(`${name(node)}${pseudo ?? ''} has a ${longest} ms transition of ${style.transitionProperty}`)
        const animated = style.animationName !== 'none' && style.animationPlayState === 'running'
        if (animated && seconds(style.animationDuration) > limit) found.push(`${name(node)}${pseudo ?? ''} has the animation ${style.animationName}`)
      }
    }
    return found
  }, maxMotionMs)
  expect(moving, where).toEqual([])
}

const settings = (reducedMotion: boolean) => ({ locale: 'en', soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion, untimed: false, shownHintIds: [] })

for (const [mode, setting] of [
  ['the system asks for reduced motion', false],
  ['the Reduce motion setting is on', true],
] as const) {
  test.describe(`when ${mode}`, () => {
    if (!setting) test.use({ reducedMotion: 'reduce' })

    test('the loading screen, title, settings and the game with its hints and marker step stand still', async ({ page }) => {
      await seedStorage(page, { settings: settings(setting) })
      await page.route('**/src/main.ts*', () => undefined)
      await page.goto('/', { waitUntil: 'commit' })
      await expect(page.locator('#boot')).toHaveAttribute('data-state', 'loading')
      // The static loading screen runs before the setting is known; it has no motion at all.
      await expectNoLongMotion(page, 'loading')
      await page.unroute('**/src/main.ts*')

      await installClock(page)
      await page.goto('/')
      await pauseClock(page)
      await expect(page.locator('.title-scene')).toBeVisible()
      await expectNoLongMotion(page, 'title')
      await page.locator('[data-focus-id="title-settings"]').click()
      await page.getByRole('switch', { name: 'Sound' }).click()
      await expectNoLongMotion(page, 'settings with a switch just pressed')
      await page.keyboard.press('Escape')
      await expect(page.locator('dialog')).toHaveCount(0)

      await page.locator('[data-focus-id="title-play"]').click()
      await expectState(page, 'question')
      await expectNoLongMotion(page, 'first scene')
      await correctChoice(page, paris.stops[0]).click()
      await expectState(page, 'result')
      await expectNoLongMotion(page, 'result')
      await page.locator('.next').click()
      await expect(page.locator('.lifeline-hint')).toBeVisible()
      await expectNoLongMotion(page, 'next scene with the 50:50 hint')
      await correctChoice(page, paris.stops[1]).click()
      await page.locator('.next').click()
      await expect(page.locator('.trail[data-advance]')).toBeAttached()
      await expectNoLongMotion(page, 'marker step on stop 3')
      await correctChoice(page, paris.stops[2]).click()
      await page.locator('.next').click()
      await expect(page.locator('.pause-hint')).toBeVisible()
      await expectNoLongMotion(page, 'the hint by the pause button')
    })

    test('the wait for a video spot stands still', async ({ page }) => {
      await seedStorage(page, { settings: settings(setting) })
      await installClock(page)
      await page.goto('/?ad=interrupted')
      await pauseClock(page)
      await page.locator('[data-focus-id="title-play"]').click()
      for (const stop of paris.stops.slice(0, 2)) {
        await correctChoice(page, stop).click()
        await page.locator('.next').click()
      }
      await expectState(page, 'question')
      await page.keyboard.press('Escape')
      await page.locator('[data-focus-id="pause-skip"]').click()
      await page.locator('dialog[open] .skip-play').click()
      await expect(page.locator('dialog[open] .scene-loading-bar')).toBeVisible()
      await expectNoLongMotion(page, 'wait for the spot')
    })

    test('a new postcard, the map, the collection and the daily overview stand still', async ({ page }) => {
      await seedStorage(page, { settings: settings(setting), progress: progressWith(0, 0), 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 4) } })
      await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
      await page.goto('/')
      await continueToSummary(page)
      await expect(page.locator('.summary-postcard[data-new]')).toBeVisible()
      await expectNoLongMotion(page, 'new postcard')
      await page.keyboard.press('Escape')
      for (const [tile, ready] of [
        ['title-map', '.map-point'],
        ['title-collection', '.postcard-card'],
        ['title-daily', '.daily-city'],
      ] as const) {
        await page.locator(`[data-focus-id="${tile}"]`).click()
        await expect(page.locator(ready).first()).toBeVisible()
        await expectNoLongMotion(page, tile)
        if (tile === 'title-map') {
          await page.locator('.map-cluster').first().click()
          await expectNoLongMotion(page, 'zoomed map')
        }
        await page.keyboard.press('Escape')
      }
    })
  })
}

test('without reduced motion the check does find the motion', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.title-scene')).toBeVisible()
  await expect(expectNoLongMotion(page, 'title')).rejects.toThrow(/title-boat|title-bob|title-shimmer/)
})
