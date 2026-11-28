import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import type { Stop } from '../src/content/types.ts'
import type { RunState } from '../src/game/logic/run.ts'
import { correctChoice, expectState, inspectPlayLayout, installClock, paris, pauseClock, savedSection, wrongChoice } from './game.ts'

// K3: the whole first route through the real UI, from an empty storage to London unlocked and Rome locked.

type Press = (target: Locator) => Promise<void>
type Size = { width: number; height: number }

const timer = (page: Page) => page.locator('.timer-value')
const pause = (page: Page, name = 'Paused') => page.getByRole('dialog', { name })
const choiceLabels = (page: Page) => page.locator('.choice-label').allTextContents()
const savedRun = async (page: Page) => (await savedSection<{ run: RunState }>(page, 'active-run')).run

/** The labels of the shown order in the other language, found by choice ID, so the order is compared, not the words. */
function labelsIn(stop: Stop, labels: string[], from: 'en' | 'cs', to: 'en' | 'cs'): string[] {
  return labels.map((label) => stop.choices.find((choice) => choice.label[from] === label)?.label[to] ?? `missing ${label}`)
}

async function expectPlayLayout(page: Page, what: string) {
  expect((await inspectPlayLayout(page)).problems, what).toEqual([])
}

interface FlowOptions {
  press: Press
  /** Mobile only: the portrait size whose landscape twin the question is turned to and back. */
  turn?: Size
}

/** Reload on the question screen and continue from the title; the run comes back in the pause. */
async function reloadAndContinue(page: Page, press: Press) {
  await page.reload()
  await press(page.getByRole('button', { name: 'Continue', exact: true }))
  await expect(pause(page)).toBeVisible()
}

async function playParisThroughTheUi(page: Page, { press, turn }: FlowOptions) {
  await installClock(page)
  await page.goto('/')
  await expect(page.locator('.title-progress li')).toHaveText(['0/20 cities', /^0\/60 ★/, '0 postcards'])
  await pauseClock(page)
  await press(page.getByRole('button', { name: 'Play', exact: true }))
  const [s1, s2, s3, , s5, s6, s7, s8, s9, s10] = paris.stops
  const next = () => press(page.locator('.next'))

  // 1: correct.
  await expectState(page, 'question')
  await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
  await press(correctChoice(page, s1))
  await expect(page.locator('.result-word')).toHaveText('Correct!')
  await next()

  // 2: 50:50, then a wrong answer among the two left.
  await expectState(page, 'question')
  await press(page.locator('[data-lifeline="fifty"]'))
  await expect(page.locator('.choice.is-removed')).toHaveCount(2)
  await press(await wrongChoice(page, s2))
  await expect(page.locator('.result-word')).toHaveText('Not quite')
  await next()

  // 3: +10 s adds ten seconds to the limit, then correct.
  await expectState(page, 'question')
  const limit3 = (await savedRun(page)).stops[2].timeLimitMs / 1000
  await expect(timer(page)).toHaveText(`${limit3} s`)
  await press(page.locator('[data-lifeline="time"]'))
  await expect(timer(page)).toHaveText(`${limit3 + 10} s`)
  await press(correctChoice(page, s3))
  await next()

  // 4: the controlled clock runs the whole time out.
  await expectState(page, 'question')
  await page.clock.runFor((await savedRun(page)).remainingMs)
  await expectState(page, 'result')
  await expect(page.locator('.result-word')).toHaveText('Time’s up')
  await next()

  // 5: the question survives a turn of the phone, a reload and a language switch in the pause.
  await expectState(page, 'question')
  await page.clock.runFor(3_000)
  const limit5 = (await savedRun(page)).stops[4].timeLimitMs / 1000
  await expect(timer(page)).toHaveText(`${limit5 - 3} s`)
  const order = await choiceLabels(page)
  if (turn) {
    await expectPlayLayout(page, 'portrait question')
    await page.setViewportSize({ width: turn.height, height: turn.width })
    await expect(page.locator('.play-main')).toHaveCSS('display', 'grid')
    await expectState(page, 'question')
    await expect(timer(page)).toHaveText(`${limit5 - 3} s`)
    expect(await choiceLabels(page)).toEqual(order)
    await expectPlayLayout(page, 'landscape question')
    // The time keeps running after the turn.
    await page.clock.runFor(1_000)
    await expect(timer(page)).toHaveText(`${limit5 - 4} s`)
    await page.setViewportSize(turn)
    await expect(page.locator('.play-main')).not.toHaveCSS('display', 'grid')
    await expectState(page, 'question')
    await expect(timer(page)).toHaveText(`${limit5 - 4} s`)
    expect(await choiceLabels(page)).toEqual(order)
    await expectPlayLayout(page, 'portrait question after the turn')
  }
  const remaining5 = (await savedRun(page)).remainingMs
  await reloadAndContinue(page, press)
  await expectState(page, 'question')
  await expect(page.locator('.play-title')).toHaveText('Paris · 5/10')
  await expect(page.locator('.question')).toHaveText(s5.question.en)
  expect(await choiceLabels(page)).toEqual(order)
  await expect(timer(page)).toHaveText(`${remaining5 / 1000} s`)
  expect((await savedRun(page)).remainingMs).toBe(remaining5)

  await press(pause(page).getByRole('button', { name: 'Settings' }))
  await press(page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Čeština' }))
  await press(page.getByRole('dialog', { name: 'Nastavení' }).getByRole('button', { name: 'Zavřít', exact: true }))
  await expect(pause(page, 'Pauza')).toBeVisible()
  await expect(page.locator('.question')).toHaveText(s5.question.cs)
  expect(await choiceLabels(page)).toEqual(labelsIn(s5, order, 'en', 'cs'))
  await expect(page.locator('.play-title')).toHaveText('Paříž · 5/10')
  await press(pause(page, 'Pauza').getByRole('button', { name: 'Nastavení' }))
  await press(page.getByRole('dialog', { name: 'Nastavení' }).getByRole('button', { name: 'English' }))
  await press(page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close', exact: true }))
  expect(await choiceLabels(page)).toEqual(order)
  await press(pause(page).getByRole('button', { name: 'Continue' }))
  await expect(timer(page)).toHaveText(`${remaining5 / 1000} s`)
  await press(correctChoice(page, s5))
  await next()

  // 6: the result survives a reload: the same verdict, sentence, marked choices and order.
  await expectState(page, 'question')
  const order6 = await choiceLabels(page)
  const wrong6 = await wrongChoice(page, s6)
  await press(wrong6)
  await expectState(page, 'result')
  await reloadAndContinue(page, press)
  await expectState(page, 'result')
  expect(await choiceLabels(page)).toEqual(order6)
  await expect(page.locator('.result-word')).toHaveText('Not quite')
  await expect(page.locator('.result-sentence')).toHaveText(s6.feedback.en)
  await expect(wrong6).toHaveClass(/is-wrong/)
  await expect(correctChoice(page, s6)).toHaveClass(/is-correct/)
  await press(pause(page).getByRole('button', { name: 'Continue' }))
  await expect(page.locator('.next')).toBeVisible()
  await next()

  // 7–10: a mix, the last one ends the route.
  for (const [stop, correct] of [[s7, true], [s8, false], [s9, true], [s10, true]] as const) {
    await expectState(page, 'question')
    await press(correct ? correctChoice(page, stop) : await wrongChoice(page, stop))
    await expectState(page, 'result')
    await next()
  }

  // Correct at stops 1, 3, 5, 7, 9 and 10.
  await expect(page.getByRole('heading', { name: 'Route complete' })).toBeVisible()
  await expect(page.locator('.summary-stats > div').first()).toHaveText(/^Score6\/10$/)
  await expect(page.locator('.summary-postcard figcaption')).toHaveText('New postcard')
  await expect(page.locator('.summary-unlocked')).toHaveText('London is unlocked')
  expect(await savedSection(page, 'active-run')).toBeNull()

  await press(page.locator('.window-screen [data-focus-id="window-home"]'))
  await expect(page.locator('.title-progress li').first()).toHaveText('1/20 cities')
  await press(page.getByRole('button', { name: 'City map' }))
  const cityRow = (name: string) => page.locator('.city-row').filter({ has: page.getByText(name, { exact: true }).and(page.locator('.city-name')) })
  await expect(cityRow('Paris').locator('.city-state')).toHaveText(/^Completed/)
  await expect(cityRow('London').locator('.city-state')).toHaveText('Unlocked')
  await expect(cityRow('Rome').locator('.city-state')).toHaveText('Locked')
  await press(cityRow('Rome'))
  const rome = page.getByRole('dialog', { name: 'Rome' })
  await expect(rome).toContainText('Finish London to unlock')
  await expect(rome.locator('.window-body button')).toHaveCount(0)
  await press(rome.getByRole('button', { name: 'Home' }))

  await press(page.getByRole('button', { name: 'Collection' }))
  await expect(page.locator('.collection-count')).toHaveText('1/20 postcards')
  await expect(page.locator('.postcard-card .postcard-name')).toHaveText('Paris')
}

test.describe('desktop 1440 × 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Paris from an empty storage by mouse: reloads, language, summary, London unlocked, Rome locked, 1/20 postcards', async ({ page }) => {
    await playParisThroughTheUi(page, { press: (target) => target.click() })
  })
})

const pixel7 = devices['Pixel 7']

for (const size of [
  { width: 412, height: 915 },
  { width: 320, height: 568 },
]) {
  test.describe(`touch phone ${size.width} × ${size.height}`, () => {
    test.use({ userAgent: pixel7.userAgent, deviceScaleFactor: pixel7.deviceScaleFactor, isMobile: true, hasTouch: true, viewport: size, screen: size })

    test('Paris by tap, turned to landscape and back in the middle of a question', async ({ page }) => {
      await playParisThroughTheUi(page, { press: (target) => target.tap(), turn: size })
    })
  })
}
