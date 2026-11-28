import { expect, test, type Page } from '@playwright/test'
import type { Stop } from '../src/content/types.ts'
import type { RunState } from '../src/game/logic/run.ts'
import {
  correctChoice,
  correctLabel,
  expectState,
  installClock,
  paris,
  pauseClock,
  playStops,
  recordedEvents,
  savedSection,
  seedStorage,
  startParis,
  textOutsideChoices,
  wrongChoice,
} from './game.ts'

const timer = (page: Page) => page.locator('.timer-value')
const verdict = (page: Page) => page.locator('.result-verdict')
const choiceLabels = (page: Page) => page.locator('.choice-label').allTextContents()

async function expectPlaceHidden(page: Page, stop: Stop) {
  const text = await textOutsideChoices(page)
  for (const place of [stop.place.en, stop.place.cs]) expect(text, `${stop.id} shows "${place}" before the answer`).not.toContain(place.toLowerCase())
}

test('Play starts Paris as a new timed run and downloads only its route', async ({ page }) => {
  const routeRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/src/content/routes/')) routeRequests.push(new URL(request.url()).pathname)
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(routeRequests).toEqual([])

  await page.getByRole('button', { name: 'Play' }).click()
  await expectState(page, 'question')
  expect(routeRequests).toEqual(['/src/content/routes/paris.json'])
  await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
  const active = await savedSection<{ ownerTabId: string; run: RunState }>(page, 'active-run')
  expect(active.ownerTabId).toMatch(/^[0-9a-f-]{36}$/)
  expect(active.run).toMatchObject({ cityId: 'paris', mode: 'city', untimed: false, stopIndex: 0 })
  expect(active.run.runId).toMatch(/^[0-9a-f-]{36}$/)
  expect(await recordedEvents(page)).toEqual([{ name: 'route_started', cityId: 'paris', mode: 'city', resumed: false }])
})

test('the question screen has the bar, route line, difficulty, scene, question, four choices with keys, time and lifelines', async ({ page }) => {
  await startParis(page)
  const stop = paris.stops[0]
  await expect(page.getByRole('button', { name: 'Save and go to Home' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.locator('.trail li')).toHaveCount(10)
  await expect(page.locator('.trail')).toHaveAttribute('aria-label', 'Route, stop 1 of 10')
  await expect(page.locator('.trail .current')).toHaveAttribute('aria-current', 'step')
  await expect(page.locator('.difficulty')).toHaveText('Easy')
  await expect(page.locator('.streak')).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(stop.question.en)
  await expect(page.locator('.choice')).toHaveCount(4)
  await expect(page.locator('.choice-key')).toHaveText(['1', '2', '3', '4'])
  for (const [index, choice] of (await page.locator('.choice').all()).entries()) await expect(choice).toHaveAttribute('aria-keyshortcuts', String(index + 1))
  expect((await choiceLabels(page)).sort()).toEqual(stop.choices.map((choice) => choice.label.en).sort())
  await expect(timer(page)).toHaveText('25 s')
  await expect(page.getByRole('button', { name: '50:50, removes two choices' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Plus 10 seconds' })).toBeEnabled()
  const zoom = page.getByRole('button', { name: 'Enlarge the scene' })
  const zoomBox = (await zoom.boundingBox())!
  const frameBox = (await page.locator('.scene-frame').boundingBox())!
  expect(zoomBox.x + zoomBox.width).toBeGreaterThan(frameBox.x + frameBox.width / 2)
  expect(zoomBox.y + zoomBox.height).toBeGreaterThan(frameBox.y + frameBox.height / 2)
})

test('the place of a stop is never on the question screen, in a run and after a reload; the result shows the feedback sentence', async ({ page }) => {
  await startParis(page)
  for (const stop of paris.stops) {
    await expectState(page, 'question')
    await expectPlaceHidden(page, stop)
    await page.reload()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
    await expectPlaceHidden(page, stop)
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
    await expectState(page, 'question')
    await expectPlaceHidden(page, stop)
    await correctChoice(page, stop).click()
    await expect(page.locator('.result-sentence')).toHaveText(stop.feedback.en)
    await page.locator('.next').click()
  }
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
})

test('the place stays hidden in Czech too', async ({ page }) => {
  await seedStorage(page, { settings: { locale: 'cs' } })
  await startParis(page, { playName: 'Hrát' })
  for (const stop of paris.stops.slice(0, 4)) {
    await expectState(page, 'question')
    await expectPlaceHidden(page, stop)
    await correctChoice(page, stop, 'cs').click()
    await expect(page.locator('.result-sentence')).toHaveText(stop.feedback.cs)
    await page.locator('.next').click()
  }
})

test('while the scene loads the choices and lifelines are off and the time stands at the full limit', async ({ page }) => {
  await installClock(page)
  let release = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/scenes/PAR01.webp', async (route) => {
    await released
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await pauseClock(page)
  await page.getByRole('button', { name: 'Play' }).click()
  await expectState(page, 'loading')
  await expect(page.locator('.scene-loading')).toContainText('Loading the scene…')
  for (const choice of await page.locator('.choice').all()) await expect(choice).toBeDisabled()
  for (const lifeline of await page.locator('.lifeline').all()) await expect(lifeline).toBeDisabled()
  await expect(timer(page)).toHaveText('25 s')
  // The caption band is there while the scene loads, so the question does not move when it is ready.
  await expect(page.locator('.scene-caption')).toHaveText(paris.stops[0].sceneAlt.en)
  const questionTop = async () => (await page.locator('.question').boundingBox())?.y
  const loadingTop = await questionTop()
  await page.clock.runFor(10_000)
  await expect(timer(page)).toHaveText('25 s')
  release()
  await expectState(page, 'question')
  expect(await questionTop()).toBe(loadingTop)
  await expect(timer(page)).toHaveText('25 s')
  await page.clock.runFor(1_000)
  await expect(timer(page)).toHaveText('24 s')
})

test('after the scene is ready exactly the next scene is preloaded', async ({ page }) => {
  const scenes: string[] = []
  page.on('request', (request) => {
    const match = /scenes\/(\w+)\.webp/.exec(request.url())
    if (match) scenes.push(match[1])
  })
  await startParis(page)
  await expect.poll(() => scenes).toContain('PAR02')
  expect(scenes).toEqual(['PAR01', 'PAR02'])
  await correctChoice(page, paris.stops[0]).click()
  await page.locator('.next').click()
  await expectState(page, 'question')
  await expect.poll(() => scenes).toContain('PAR03')
  expect(scenes).not.toContain('PAR04')
})

test('a scene that fails offers the route, the stop sentence, Try again, × and Home, and the retry loads the same asset', async ({ page }) => {
  let failing = true
  let requests = 0
  await page.route('**/scenes/PAR01.webp', (route) => {
    requests += 1
    return failing ? route.abort() : route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Play' }).click()
  await expectState(page, 'error')
  await expect(page.getByRole('alert')).toContainText('Stop 1 could not load.')
  await expect(page.locator('.trail')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save and go to Home' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toBeHidden()
  await expect(page.locator('.timer')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeHidden()
  const saved = await savedSection<{ run: RunState }>(page, 'active-run')
  expect(saved.run).toMatchObject({ phase: 'loading', remainingMs: 25_000 })

  failing = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expectState(page, 'question')
  expect(requests).toBe(2)
  await expect(timer(page)).toHaveText('25 s')
})

test('a placeholder scene shows its description under the image once for screen readers', async ({ page }) => {
  const stop = paris.stops[0]
  await startParis(page)
  const caption = page.locator('.scene-caption')
  await expect(caption).toHaveText(stop.sceneAlt.en)
  await expect(caption).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('.scene-art')).toHaveAttribute('alt', stop.sceneAlt.en)
  await expect(page.getByRole('img', { name: stop.sceneAlt.en })).toHaveCount(1)
  await expect(page.locator('main')).toMatchAriaSnapshot(`- img "${stop.sceneAlt.en}"`)
  const snapshot = await page.locator('main').ariaSnapshot()
  expect(snapshot.split(stop.sceneAlt.en).length - 1).toBe(1)
})

test('a final scene, not listed in placeholders.json, has no description under it', async ({ page }) => {
  await page.route('**/scenes/placeholders.json', (route) => route.fulfill({ json: { stopIds: ['PAR02'] } }))
  await startParis(page)
  await expect(page.locator('.scene-art')).toHaveAttribute('alt', paris.stops[0].sceneAlt.en)
  await expect(page.locator('.scene-caption')).toHaveCount(0)
})

test('a choice locks the question and the result shows the verdict, the sentence and only Next', async ({ page }) => {
  await startParis(page)
  const stop = paris.stops[0]
  const wrong = await wrongChoice(page, stop)
  await wrong.click()
  await expectState(page, 'result')
  await expect(wrong).toHaveClass(/is-wrong/)
  await expect(wrong).toHaveCSS('background-color', 'rgb(156, 46, 50)')
  await expect(correctChoice(page, stop)).toHaveClass(/is-correct/)
  await expect(correctChoice(page, stop)).toHaveCSS('background-color', 'rgb(24, 96, 69)')
  await expect(page.locator('.choice.is-correct, .choice.is-wrong')).toHaveCount(2)
  const correctIndex = (await choiceLabels(page)).indexOf(correctLabel(stop))
  await page.keyboard.press(String(correctIndex + 1))
  await expect(wrong).toHaveClass(/is-wrong/)
  await expect(verdict(page)).toHaveText('Not quite')
  await expect(verdict(page).locator('svg')).toBeVisible()
  const status = page.getByRole('status').filter({ hasText: 'Not quite' })
  await expect(status).toContainText(stop.feedback.en)
  await expect(page.locator('.result-place')).toHaveCount(0)
  await expect(page.locator('.lifelines')).toBeHidden()
  await expect(page.locator('.timer')).toBeHidden()
  await expect(page.locator('.timer')).not.toHaveAttribute('aria-live')
  await expect(page.locator('.timer')).toHaveAttribute('role', 'timer')
  await expect(page.locator('.next')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Next' })).toBeFocused()
  expect((await recordedEvents(page)).filter((event) => event.name === 'question_resolved')).toHaveLength(1)

  await page.keyboard.press('Enter')
  await expectState(page, 'question')
  await expect(page.locator('.play-title')).toHaveText('Paris · 2/10')
  // Next goes away with the result, so the keyboard continues from the new question, which is no control to outline.
  await expect(page.locator('.question')).toBeFocused()
  await expect(page.locator('.question')).toHaveCSS('outline-style', 'none')

  const second = paris.stops[1]
  const index = (await choiceLabels(page)).indexOf(correctLabel(second))
  await page.keyboard.press(String(index + 1))
  await expectState(page, 'result')
  await expect(verdict(page)).toHaveText('Correct!')
  await page.keyboard.press(String(((index + 1) % 4) + 1))
  await expect(page.locator('.choice.is-wrong')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Next' })).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.locator('.play-title')).toHaveText('Paris · 3/10')
  await expectState(page, 'question')
  await expect(page.locator('.question')).toBeFocused()
})

test('the countdown shows whole seconds rounded up, a choice just before zero counts and zero is "Time’s up"', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  await expect(timer(page)).toHaveText('25 s')
  await page.clock.runFor(999)
  await expect(timer(page)).toHaveText('25 s')
  await page.clock.runFor(1)
  await expect(timer(page)).toHaveText('24 s')
  await page.clock.runFor(24_000)
  await expectState(page, 'result')
  await expect(verdict(page)).toHaveText('Time’s up')
  await expect(page.locator('.choice.is-correct')).toHaveCount(1)
  await expect(page.locator('.choice.is-wrong')).toHaveCount(0)
  await expect(correctChoice(page, paris.stops[0])).toHaveClass(/is-correct/)

  await page.locator('.next').click()
  await expectState(page, 'question')
  await page.clock.runFor(24_999)
  await expect(timer(page)).toHaveText('1 s')
  await correctChoice(page, paris.stops[1]).click()
  await expect(verdict(page)).toHaveText('Correct!')
  const resolved = (await recordedEvents(page)).filter((event) => event.name === 'question_resolved')
  expect(resolved.map((event) => event.name === 'question_resolved' && event.outcome)).toEqual(['timeout', 'correct'])
})

test('50:50 and +10 s work together on one question, then a correct answer counts', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  const stop = paris.stops[0]
  const fifty = page.locator('[data-lifeline="fifty"]')
  await fifty.click()
  const removed = page.locator('.choice.is-removed')
  await expect(removed).toHaveCount(2)
  for (const choice of await removed.all()) {
    await expect(choice).toBeDisabled()
    await expect(choice).toHaveAttribute('aria-hidden', 'true')
    await expect(choice).toHaveCSS('border-top-style', 'dashed')
  }
  await expect(correctChoice(page, stop)).not.toHaveClass(/is-removed/)
  await expect(fifty).toBeDisabled()
  await expect(fifty).toHaveClass(/is-used/)
  await expect(fifty).toHaveCSS('border-top-style', 'dashed')
  await expect(fifty).toHaveCSS('text-decoration-line', 'line-through')

  const keys = await page.locator('.choice').evaluateAll((choices) => choices.flatMap((choice, index) => (choice.classList.contains('is-removed') ? [String(index + 1)] : [])))
  for (const key of keys) await page.keyboard.press(key)
  await expectState(page, 'question')

  await page.clock.runFor(5_000)
  await expect(timer(page)).toHaveText('20 s')
  await page.getByRole('button', { name: 'Plus 10 seconds' }).click()
  await expect(timer(page)).toHaveText('30 s')
  await expect(page.getByRole('button', { name: 'Plus 10 seconds' })).toBeDisabled()
  await correctChoice(page, stop).click()
  await expect(verdict(page)).toHaveText('Correct!')
  const lifelines = (await recordedEvents(page)).filter((event) => event.name === 'lifeline_used')
  expect(lifelines).toEqual([
    { name: 'lifeline_used', lifeline: 'fiftyFifty', mode: 'city' },
    { name: 'lifeline_used', lifeline: 'extraTime', mode: 'city' },
  ])

  await page.locator('.next').click()
  await expectState(page, 'question')
  await expect(page.locator('[data-lifeline="fifty"]')).toBeDisabled()
  await expect(page.locator('.choice.is-removed')).toHaveCount(0)
})

test('a lifeline used from the keyboard hands focus to the other lifeline, and the last one to the question', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  const fifty = page.locator('[data-lifeline="fifty"]')
  const extraTime = page.locator('[data-lifeline="time"]')
  await fifty.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.choice.is-removed')).toHaveCount(2)
  await expect(extraTime).toBeFocused()
  await page.keyboard.press('Space')
  await expect(timer(page)).toHaveText('35 s')
  await expect(page.locator('.question')).toBeFocused()
})

test('in the untimed mode 50:50 used from the keyboard hands focus to the question', async ({ page }) => {
  await seedStorage(page, { settings: { untimed: true } })
  await startParis(page)
  await page.locator('[data-lifeline="fifty"]').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.choice.is-removed')).toHaveCount(2)
  await expect(page.locator('.question')).toBeFocused()
})

test('the untimed mode from settings hides the time and +10 s and never times out', async ({ page }) => {
  await seedStorage(page, { settings: { untimed: true } })
  await startParis(page, { pausedClock: true })
  await expect(page.locator('.timer')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Plus 10 seconds' })).toBeHidden()
  await expect(page.getByRole('button', { name: '50:50, removes two choices' })).toBeVisible()
  await page.clock.runFor(120_000)
  await expectState(page, 'question')
  expect((await savedSection<{ run: RunState }>(page, 'active-run')).run.untimed).toBe(true)
})

test('switching to untimed during a run applies only from the next new run', async ({ page }) => {
  await startParis(page)
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Untimed' }).click()
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator('.timer')).toBeVisible()
})

test('learning the game: the 50:50 hint on stop 2, the streak from 2 and the marker step on stop 3', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  await expect(page.locator('.lifeline-hint')).toBeHidden()
  await correctChoice(page, paris.stops[0]).click()
  await expect(page.locator('.streak')).toBeHidden()
  await page.locator('.next').click()
  await expectState(page, 'question')
  const hint = page.locator('.lifeline-hint')
  await expect(hint).toBeVisible()
  await expect(hint).toHaveText('Removes two choices')
  await expect(page.locator('[data-lifeline="fifty"]')).toHaveAccessibleName(/removes two choices/i)
  expect((await savedSection<{ shownHintIds: string[] }>(page, 'settings')).shownHintIds).toEqual(['fifty-fifty'])
  await page.clock.runFor(1_000)
  await expect(timer(page)).toHaveText('24 s')
  await expect(hint).toBeVisible()
  await page.clock.runFor(500)
  await expect(hint).toBeHidden()

  await correctChoice(page, paris.stops[1]).click()
  await expect(page.locator('.streak')).toHaveText('Streak 2')
  await page.locator('.next').click()
  await expectState(page, 'question')
  await expect(page.locator('.trail')).toHaveAttribute('data-advance')
  await expect(page.locator('.trail .current')).toHaveCSS('animation-name', 'trail-advance')
  await expect(page.locator('.scene-art')).toHaveCSS('animation-duration', '0.25s')
  await expect(page.locator('.scene-art')).toHaveCSS('opacity', '1')
  await (await wrongChoice(page, paris.stops[2])).click()
  await expect(page.locator('.streak')).toBeHidden()
})

test('an answer within the 1 500 ms of the 50:50 hint takes the hint away, also from the next stop', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  await correctChoice(page, paris.stops[0]).click()
  await page.locator('.next').click()
  await expectState(page, 'question')
  const hint = page.locator('.lifeline-hint')
  await expect(hint).toBeVisible()
  await page.clock.runFor(300)
  await correctChoice(page, paris.stops[1]).click()
  await expectState(page, 'result')
  await expect(hint).toBeHidden()
  await page.locator('.next').click()
  await expectState(page, 'question')
  await expect(hint).toBeHidden()
  await page.clock.runFor(1_500)
  await expect(hint).toBeHidden()
})

test('the 50:50 hint is not shown again once seen', async ({ page }) => {
  await seedStorage(page, { settings: { shownHintIds: ['fifty-fifty'] } })
  await startParis(page)
  await correctChoice(page, paris.stops[0]).click()
  await page.locator('.next').click()
  await expectState(page, 'question')
  await expect(page.locator('.lifeline-hint')).toBeHidden()
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the next scene and the marker appear without animation', async ({ page }) => {
    await startParis(page)
    await expect(page.locator('.scene-art')).toHaveCSS('animation-name', 'none')
  })
})

test('the scene zoom holds the question time, returns with × and Escape and works in the result', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  const zoom = page.getByRole('button', { name: 'Enlarge the scene' })
  await zoom.click()
  const dialog = page.getByRole('dialog', { name: 'Scene' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('img', { name: paris.stops[0].sceneAlt.en })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Home' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.clock.runFor(5_000)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(zoom).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(timer(page)).toHaveText('25 s')
  await page.clock.runFor(1_000)
  await expect(timer(page)).toHaveText('24 s')

  await zoom.click()
  await page.clock.runFor(3_000)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(zoom).toBeFocused()
  await expect(timer(page)).toHaveText('24 s')

  await correctChoice(page, paris.stops[0]).click()
  await zoom.click()
  await expect(page.getByRole('dialog', { name: 'Scene' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expectState(page, 'result')
})

test('in the portrait result the zoom moves into the result band, takes the focus back and leaves the scene corner', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await startParis(page, { pausedClock: true })
  const cornerZoom = page.locator('[data-focus-id="play-zoom"]')
  const bandZoom = page.locator('[data-focus-id="result-zoom"]')
  await expect(cornerZoom).toBeVisible()
  await expect(bandZoom).toBeHidden()

  await correctChoice(page, paris.stops[0]).click()
  await expectState(page, 'result')
  await expect(page.locator('.next')).toBeFocused()
  await expect(cornerZoom).toBeHidden()
  await expect(bandZoom).toBeVisible()
  await expect(bandZoom).toHaveAccessibleName('Enlarge the scene')
  await expect(page.locator('.result .primary')).toHaveCount(1)
  await page.keyboard.press('Shift+Tab')
  await expect(bandZoom).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Scene' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(bandZoom).toBeFocused()

  // Landscape keeps the zoom in the scene's corner, also in the result.
  await page.setViewportSize({ width: 812, height: 375 })
  await expect(cornerZoom).toBeVisible()
  await expect(bandZoom).toBeHidden()
  await page.setViewportSize({ width: 375, height: 812 })
  await page.locator('.next').click()
  await expectState(page, 'question')
  await expect(cornerZoom).toBeVisible()
  await expect(bandZoom).toBeHidden()
})

test('Home in the scene zoom saves the run paused and goes to the title like Home elsewhere in the game', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  await page.clock.runFor(4_000)
  await page.getByRole('button', { name: 'Enlarge the scene' }).click()
  const dialog = page.getByRole('dialog', { name: 'Scene' })
  await expect(dialog.locator('.window-bar').getByRole('button', { name: 'Close' })).toBeVisible()
  await dialog.locator('.window-bar').getByRole('button', { name: 'Home' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
  await expect(continueButton).toBeFocused()
  expect((await recordedEvents(page)).filter((event) => event.name === 'route_left')).toEqual([
    { name: 'route_left', cityId: 'paris', mode: 'city', index: 1, reason: 'paused' },
  ])
  const saved = await savedSection<{ run: { phase: string; stopIndex: number; remainingMs: number } }>(page, 'active-run')
  expect([saved.run.phase, saved.run.stopIndex, saved.run.remainingMs]).toEqual(['question', 0, 21_000])

  await continueButton.click()
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
  await expect(timer(page)).toHaveText('21 s')
})

test('pause by button and Escape holds the time and offers Continue, Settings and Home', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  await page.getByRole('button', { name: 'Pause' }).click()
  const pause = page.getByRole('dialog', { name: 'Paused' })
  await expect(pause).toBeVisible()
  await expect(pause.getByRole('button', { name: 'Continue' })).toBeFocused()
  for (const name of ['Close', 'Home', 'Settings']) await expect(pause.getByRole('button', { name })).toBeVisible()
  await expect(pause.getByRole('button', { name: /video/i })).toHaveCount(0)
  await page.clock.runFor(5_000)
  await pause.getByRole('button', { name: 'Continue' }).click()
  await expect(pause).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused()
  await expect(timer(page)).toHaveText('25 s')

  await page.keyboard.press('Escape')
  await expect(pause).toBeVisible()
  await page.clock.runFor(5_000)
  await page.keyboard.press('Escape')
  await expect(pause).toHaveCount(0)
  await expect(timer(page)).toHaveText('25 s')

  await page.keyboard.press('Escape')
  await pause.getByRole('button', { name: 'Close' }).click()
  await expect(pause).toHaveCount(0)
  await page.clock.runFor(1_000)
  await expect(timer(page)).toHaveText('24 s')
})

test('settings open over the pause, × returns to it and Čeština translates the question in the same order', async ({ page }) => {
  await startParis(page)
  const stop = paris.stops[0]
  const englishOrder = await choiceLabels(page)
  const order = englishOrder.map((label) => stop.choices.find((choice) => choice.label.en === label)?.id)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: 'Close' }).click()
  await expect(settings).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' })).toBeFocused()

  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Čeština' }).click()
  await page.getByRole('dialog', { name: 'Nastavení' }).getByRole('button', { name: 'Zavřít' }).click()
  const pause = page.getByRole('dialog', { name: 'Pauza' })
  await expect(pause.getByRole('button', { name: 'Pokračovat' })).toBeVisible()
  await pause.getByRole('button', { name: 'Pokračovat' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(stop.question.cs)
  expect(await choiceLabels(page)).toEqual(order.map((id) => stop.choices.find((choice) => choice.id === id)?.label.cs))
  await expect(page.locator('.play-title')).toHaveText('Paříž · 1/10')
})

test('× saves the run, the title offers Continue, and Continue restores the stop, lifelines, time and order in the pause', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  await page.locator('[data-lifeline="fifty"]').click()
  await page.clock.runFor(3_000)
  await expect(timer(page)).toHaveText('22 s')
  const order = await choiceLabels(page)
  await page.getByRole('button', { name: 'Save and go to Home' }).click()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0)
  expect((await recordedEvents(page)).at(-1)).toEqual({ name: 'route_left', cityId: 'paris', mode: 'city', index: 1, reason: 'paused' })

  await page.getByRole('button', { name: 'Continue' }).click()
  const pause = page.getByRole('dialog', { name: 'Paused' })
  await expect(pause).toBeVisible()
  expect((await recordedEvents(page)).at(-1)).toEqual({ name: 'route_started', cityId: 'paris', mode: 'city', resumed: true })
  expect(await choiceLabels(page)).toEqual(order)
  await expect(page.locator('.choice.is-removed')).toHaveCount(2)
  await expect(page.locator('[data-lifeline="fifty"]')).toHaveClass(/is-used/)
  await expect(timer(page)).toHaveText('22 s')
  await page.clock.runFor(5_000)
  await expect(timer(page)).toHaveText('22 s')
  await pause.getByRole('button', { name: 'Continue' }).click()
  await page.clock.runFor(1_000)
  await expect(timer(page)).toHaveText('21 s')

  // Home in the pause during the result also saves; the result comes back as it was.
  const wrong = await wrongChoice(page, paris.stops[0])
  await wrong.click()
  await page.keyboard.press('Escape')
  await pause.getByRole('button', { name: 'Home' }).click()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(pause).toBeVisible()
  await expectState(page, 'result')
  await expect(wrong).toHaveClass(/is-wrong/)
  await expect(verdict(page)).toHaveText('Not quite')
  await pause.getByRole('button', { name: 'Continue' }).click()
  await page.locator('.next').click()
  await expect(page.locator('.play-title')).toHaveText('Paris · 2/10')
})

test('Home on the game screen and in the settings over the pause both save and return to the title', async ({ page }) => {
  await startParis(page)
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Home' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
  expect((await recordedEvents(page)).filter((event) => event.name === 'route_left')).toHaveLength(1)
})

test('a reload during the question and during the result restores the same state in the pause', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  await page.clock.runFor(3_000)
  const order = await choiceLabels(page)
  await page.reload()
  await page.getByRole('button', { name: 'Continue' }).click()
  const pause = page.getByRole('dialog', { name: 'Paused' })
  await expect(pause).toBeVisible()
  await expectState(page, 'question')
  expect(await choiceLabels(page)).toEqual(order)
  await expect(timer(page)).toHaveText('22 s')
  await pause.getByRole('button', { name: 'Continue' }).click()

  const wrong = await wrongChoice(page, paris.stops[0])
  await wrong.click()
  await page.reload()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(pause).toBeVisible()
  await expectState(page, 'result')
  expect(await choiceLabels(page)).toEqual(order)
  await expect(wrong).toHaveClass(/is-wrong/)
  const resumed = (await recordedEvents(page)).filter((event) => event.name === 'route_started')
  expect(resumed).toEqual([{ name: 'route_started', cityId: 'paris', mode: 'city', resumed: true }])
})

test('hiding the page pauses the question at once and saves it; back on the page the pause waits', async ({ page }) => {
  await startParis(page, { pausedClock: true })
  const setVisibility = (state: 'hidden' | 'visible') =>
    page.evaluate((visibility) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)
  await page.clock.runFor(2_000)
  await setVisibility('hidden')
  const saved = await savedSection<{ run: RunState }>(page, 'active-run')
  expect(saved.run.paused).toBe(true)
  expect(saved.run.remainingMs).toBeGreaterThan(22_000)
  expect(saved.run.remainingMs).toBeLessThanOrEqual(23_000)
  await page.clock.runFor(10_000)
  await setVisibility('visible')
  const pause = page.getByRole('dialog', { name: 'Paused' })
  await expect(pause).toBeVisible()
  await expect(timer(page)).toHaveText('23 s')
  await pause.getByRole('button', { name: 'Continue' }).click()
  await expectState(page, 'question')
})

test('a run in progress is played through to the end with every event once', async ({ page }) => {
  await startParis(page)
  for (const [index, stop] of paris.stops.entries()) {
    await expectState(page, 'question')
    await (index % 2 === 0 ? correctChoice(page, stop) : await wrongChoice(page, stop)).click()
    await page.locator('.next').click()
  }
  await expect(page.getByRole('heading', { name: 'Route complete' })).toBeVisible()
  const events = await recordedEvents(page)
  expect(events).toEqual([
    { name: 'route_started', cityId: 'paris', mode: 'city', resumed: false },
    ...paris.stops.map((_stop, index) => ({ name: 'question_resolved', cityId: 'paris', index: index + 1, mode: 'city', outcome: index % 2 === 0 ? 'correct' : 'wrong' })),
    { name: 'route_completed', cityId: 'paris', mode: 'city', correct: 5, stars: 1 },
    { name: 'postcard_unlocked', cityId: 'paris' },
  ])
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^1\/60 ★/, '1 postcard'])
})

test('Paris with no correct answer unlocks London and gives one postcard', async ({ page }) => {
  await startParis(page)
  await playStops(page, paris.stops, 'wrong')
  await expect(page.getByRole('heading', { name: 'Route complete' })).toBeVisible()
  await page.getByRole('button', { name: 'Home' }).click()
  await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^0\/60 ★/, '1 postcard'])
  expect(await savedSection(page, 'active-run')).toBeNull()
  const events = await recordedEvents(page)
  expect(events.slice(-2)).toEqual([
    { name: 'route_completed', cityId: 'paris', mode: 'city', correct: 0, stars: 0 },
    { name: 'postcard_unlocked', cityId: 'paris' },
  ])
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.play-title')).toHaveText('London · 1/10')
})

test.describe('sound', () => {
  test.beforeEach(async ({ page }) => {
    // Web Audio is the platform's external API; the fake counts the tones the game schedules.
    await page.addInitScript(() => {
      const log = { oscillators: [] as number[] }
      Object.assign(window, { audioLog: log })
      class FakeAudioContext {
        state = 'running'
        currentTime = 0
        destination = {}
        createGain() {
          return { connect() {}, gain: { setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} } }
        }
        createOscillator() {
          return { type: 'sine', frequency: { setValueAtTime: (hz: number) => log.oscillators.push(hz) }, connect() {}, start() {}, stop() {} }
        }
        resume() {
          return Promise.resolve()
        }
      }
      Object.assign(window, { AudioContext: FakeAudioContext })
    })
  })

  test('a choice plays the click and then the verdict tones', async ({ page }) => {
    await startParis(page)
    const tones = () => page.evaluate(() => (window as unknown as { audioLog: { oscillators: number[] } }).audioLog.oscillators)
    expect(await tones()).toEqual([])
    await correctChoice(page, paris.stops[0]).click()
    // choice 660 Hz, then correct C5 and G5
    expect(await tones()).toEqual([660, 523.25, 783.99])
    await page.locator('.next').click()
    await expectState(page, 'question')
    await (await wrongChoice(page, paris.stops[1])).click()
    expect((await tones()).slice(3)).toEqual([660, 196])
  })
})
