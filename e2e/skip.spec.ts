import { expect, test, type Page } from '@playwright/test'
import type { Locale, Route, Stop } from '../src/content/types.ts'
import { dailyPlan, startDailyRun } from '../src/game/logic/daily.ts'
import { reduceRun, startCityRun, type RunState } from '../src/game/logic/run.ts'
import type { AnalyticsEvent } from '../src/platform/types.ts'
import { catalog, correctChoice, expectState, installClock, paris, pauseClock, readRoute, recordedEvents, savedSection, seedStorage } from './game.ts'
import { expectUsableLayout, layoutSizes } from './layout.ts'

// Skip for a video (brief §3, §10, §12) through the local adapter's `?ad` modes and the real pause.

const texts = {
  en: {
    continue: 'Continue',
    paused: 'Paused',
    skip: 'Skip with a video',
    back: 'Back to the answer',
    play: 'Play the video',
    confirm: 'You’ll skip this question and keep your streak. The correct answer won’t count.',
    loading: 'Loading the video…',
  },
  cs: {
    continue: 'Pokračovat',
    paused: 'Pauza',
    skip: 'Přeskočit za video',
    back: 'Zpět k odpovědi',
    play: 'Pustit video',
    confirm: 'Přeskočíš tuto otázku a zachováš sérii. Správná odpověď se nepřičte.',
    loading: 'Načítám video…',
  },
} as const

/** 7.6 s of the third stop's 25 s are gone when the run is saved, so its time shows 18 s. */
const savedRemainingMs = 17_400

/** The run as the rules build it: the stops before `stopIndex` answered correctly, then that stop's question begun. */
function runAt(start: RunState, stopIndex: number, phase: 'question' | 'feedback' = 'question'): RunState {
  let run = start
  for (let index = 0; index < stopIndex; index++) {
    run = reduceRun(run, { type: 'sceneReady', round: run.round })
    run = reduceRun(run, { type: 'choose', round: run.round, choiceId: run.stops[index].correctChoiceId, elapsedMs: 1_000 })
    run = reduceRun(run, { type: 'next', round: run.round })
  }
  run = reduceRun(run, { type: 'sceneReady', round: run.round })
  run = reduceRun(run, { type: 'tick', round: run.round, elapsedMs: run.remainingMs - savedRemainingMs })
  if (phase === 'feedback') run = reduceRun(run, { type: 'choose', round: run.round, choiceId: run.stops[stopIndex].correctChoiceId, elapsedMs: 1_000 })
  return run
}

const parisRun = () => startCityRun({ route: paris, runId: 'skip-run', untimed: false, random: () => 0.5 })

function dailyRun(): { route: Route; run: RunState } {
  const plan = dailyPlan(catalog, '2026-12-05')
  if (!plan) throw new Error('The catalog offers no daily challenge on 2026-12-05.')
  const route = readRoute(plan.cityId)
  return { route, run: startDailyRun({ route, plan, runId: 'daily-skip-run', untimed: false }) }
}

const stopOf = (route: Route, run: RunState): Stop => route.stops.find((stop) => stop.id === run.stops[run.stopIndex].stopId) as Stop

interface OpenOptions {
  search?: string
  locale?: Locale
  shownHintIds?: string[]
}

/** Seeds the run, continues it from the title with a stopped clock and waits in the pause it opens in. */
async function continueRun(page: Page, run: RunState, { search = '', locale = 'en', shownHintIds = [] }: OpenOptions = {}) {
  await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run }, settings: { locale, shownHintIds } })
  await installClock(page)
  await page.goto(`/${search}`)
  await pauseClock(page)
  await page.getByRole('button', { name: texts[locale].continue, exact: true }).click()
  await expect(pauseWindow(page, locale)).toBeVisible()
}

const pauseWindow = (page: Page, locale: Locale = 'en') => page.getByRole('dialog', { name: texts[locale].paused })
const skipWindow = (page: Page, locale: Locale = 'en') => page.getByRole('dialog', { name: texts[locale].skip })
const timer = (page: Page) => page.locator('.timer-value')
const savedRun = async (page: Page) => (await savedSection<{ run: RunState }>(page, 'active-run')).run

async function openConfirm(page: Page, locale: Locale = 'en') {
  await pauseWindow(page, locale).getByRole('button', { name: texts[locale].skip }).click()
  await expect(skipWindow(page, locale)).toContainText(texts[locale].confirm)
  await expect(pauseWindow(page, locale)).toHaveCount(0)
}

/** Plays the video and lets the local spot (500 ms, a late result 2 s later) run out. */
async function playVideo(page: Page, ms = 600) {
  await skipWindow(page).getByRole('button', { name: 'Play the video' }).click()
  await page.clock.runFor(ms)
}

const eventsNamed = async (page: Page, name: AnalyticsEvent['name']) => (await recordedEvents(page)).filter((event) => event.name === name)

async function expectQuestionBackWithLifeline(page: Page) {
  await expect(skipWindow(page)).toHaveCount(0)
  await expectState(page, 'question')
  await expect(timer(page)).toHaveText('18 s')
  expect((await savedRun(page)).remainingMs).toBe(savedRemainingMs)
  await page.clock.runFor(1_000)
  await expect(timer(page)).toHaveText('17 s')
  const run = await savedRun(page)
  expect(run.usedLifelines).not.toContain('skipVideo')
  expect(run.skipAttemptId).toBeNull()
  await page.keyboard.press('Escape')
  await expect(pauseWindow(page).getByRole('button', { name: 'Skip with a video' })).toBeVisible()
}

test('the pause offers the skip from the third stop of a city run only', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 1))
  await expect(pauseWindow(page).getByRole('button', { name: 'Skip with a video' })).toHaveCount(0)
  await pauseWindow(page).getByRole('button', { name: 'Continue' }).click()
  await correctChoice(page, paris.stops[1]).click()
  await page.locator('.next').click()
  await expectState(page, 'question')
  await page.getByRole('button', { name: 'Pause' }).click()
  const skip = pauseWindow(page).getByRole('button', { name: 'Skip with a video' })
  await expect(skip).toBeVisible()
  await expect(skip.locator('svg')).toHaveCount(1)
  await expect(pauseWindow(page).getByRole('button')).toHaveText(['', 'Home', 'Continue', 'Skip with a video', 'Settings'])
})

test('the pause in a result offers no skip', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2, 'feedback'))
  await expectState(page, 'result')
  await expect(pauseWindow(page).getByRole('button', { name: 'Skip with a video' })).toHaveCount(0)
})

test('with ?ads=none the pause never offers the skip, also on the third stop', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2), { search: '?ads=none' })
  await expectState(page, 'question')
  await expect(pauseWindow(page).getByRole('button', { name: /video/i })).toHaveCount(0)
})

test('the confirmation holds the time; × and Escape return to the pause, Back to the answer to the question', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2))
  await openConfirm(page)
  const confirm = skipWindow(page)
  const back = confirm.getByRole('button', { name: 'Back to the answer' })
  const play = confirm.getByRole('button', { name: 'Play the video' })
  await expect(back).toBeFocused()
  await expect(play.locator('svg')).toHaveCount(1)
  await page.clock.runFor(10_000)

  await confirm.getByRole('button', { name: 'Close' }).click()
  await expect(pauseWindow(page)).toBeVisible()
  await expect(pauseWindow(page).getByRole('button', { name: 'Skip with a video' })).toBeFocused()
  await openConfirm(page)
  await page.keyboard.press('Escape')
  await expect(pauseWindow(page)).toBeVisible()
  await expect(timer(page)).toHaveText('18 s')

  await openConfirm(page)
  await page.clock.runFor(10_000)
  await back.click()
  await expectQuestionBackWithLifeline(page)
  expect(await eventsNamed(page, 'rewarded_ad_outcome')).toEqual([])
})

test('Home in the confirmation saves the run and goes to the title', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2))
  await openConfirm(page)
  await skipWindow(page).getByRole('button', { name: 'Home' }).click()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  const run = await savedRun(page)
  expect(run).toMatchObject({ stopIndex: 2, phase: 'question', paused: true, remainingMs: savedRemainingMs, skipAttemptId: null })
  expect(await eventsNamed(page, 'route_left')).toEqual([{ name: 'route_left', cityId: 'paris', mode: 'city', index: 3, reason: 'paused' }])
})

test('?ad=completed: input is blocked during the spot, then the question is skipped with the streak and score kept', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2), { search: '?ad=completed' })
  await expect(page.locator('.streak')).toHaveText('Streak 2')
  await openConfirm(page)
  await skipWindow(page).getByRole('button', { name: 'Play the video' }).click()
  const wait = skipWindow(page)
  await expect(wait).toContainText('Loading the video…')
  await expect(wait.getByRole('button')).toHaveCount(0)
  expect((await savedRun(page)).skipAttemptId).toMatch(/^[0-9a-f-]{36}$/)
  for (const key of ['1', 'Escape', 'Tab', 'Shift+Tab']) await page.keyboard.press(key)
  await page.mouse.click(5, 5)
  await expect(wait).toContainText('Loading the video…')
  await expectState(page, 'question')

  await page.clock.runFor(600)
  await expect(skipWindow(page)).toHaveCount(0)
  await expectState(page, 'result')
  await expect(page.locator('.play')).toHaveAttribute('data-verdict', 'skipped')
  await expect(page.locator('.result-word')).toHaveText('Skipped')
  await expect(page.locator('.result-icon svg')).toHaveCount(1)
  await expect(page.locator('.result-sentence')).toHaveText(paris.stops[2].feedback.en)
  await expect(page.locator('.next')).toBeFocused()
  await expect(correctChoice(page, paris.stops[2])).toHaveClass(/is-correct/)
  await expect(page.locator('.choice.is-wrong')).toHaveCount(0)
  await expect(page.locator('.streak')).toHaveText('Streak 2')
  const run = await savedRun(page)
  expect(run).toMatchObject({ correct: 2, streak: 2, usedLifelines: ['skipVideo'], skipAttemptId: null })
  expect(run.results.at(-1)).toMatchObject({ outcome: 'skipped', chosenChoiceId: null })
  const events = await recordedEvents(page)
  expect(events.filter((event) => ['rewarded_ad_outcome', 'lifeline_used', 'question_resolved'].includes(event.name))).toEqual([
    { name: 'rewarded_ad_outcome', outcome: 'completed' },
    { name: 'question_resolved', cityId: 'paris', index: 3, mode: 'city', outcome: 'skipped' },
    { name: 'lifeline_used', lifeline: 'skipVideo', mode: 'city' },
  ])

  await page.locator('.next').click()
  await expectState(page, 'question')
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(pauseWindow(page)).toBeVisible()
  await expect(pauseWindow(page).getByRole('button', { name: /video/i })).toHaveCount(0)
})

for (const { search, outcome, sentence } of [
  { search: '?ad=cancelled', outcome: 'cancelled', sentence: 'The video didn’t finish, so the question wasn’t skipped.' },
  { search: '?ad=unavailable', outcome: 'unavailable', sentence: 'The video isn’t available right now.' },
  { search: '', outcome: 'unavailable', sentence: 'The video isn’t available right now.' },
] as const) {
  test(`${search || 'no ?ad'}: the window says ${outcome}, × returns to the pause and Back to the answer to the question`, async ({ page }) => {
    await continueRun(page, runAt(parisRun(), 2), { search })
    await openConfirm(page)
    await playVideo(page)
    const outcomeWindow = skipWindow(page)
    await expect(outcomeWindow.locator('.skip-text')).toHaveText(sentence)
    await expect(outcomeWindow).not.toContainText(/block/i)
    await expect(outcomeWindow.getByRole('button', { name: 'Back to the answer' })).toBeFocused()
    expect(await eventsNamed(page, 'rewarded_ad_outcome')).toEqual([{ name: 'rewarded_ad_outcome', outcome }])
    await outcomeWindow.getByRole('button', { name: 'Close' }).click()
    await expect(pauseWindow(page)).toBeVisible()

    await openConfirm(page)
    await playVideo(page)
    await page.clock.runFor(10_000)
    await skipWindow(page).getByRole('button', { name: 'Back to the answer' }).click()
    await expectQuestionBackWithLifeline(page)
    expect(await eventsNamed(page, 'question_resolved')).toEqual([])
    expect(await eventsNamed(page, 'rewarded_ad_outcome')).toHaveLength(2)
  })
}

test('?ad=duplicate skips once', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2), { search: '?ad=duplicate' })
  await openConfirm(page)
  await playVideo(page, 3_000)
  await expectState(page, 'result')
  await expect(page.locator('.streak')).toHaveText('Streak 2')
  expect(await eventsNamed(page, 'question_resolved')).toEqual([{ name: 'question_resolved', cityId: 'paris', index: 3, mode: 'city', outcome: 'skipped' }])
  expect(await eventsNamed(page, 'rewarded_ad_outcome')).toEqual([{ name: 'rewarded_ad_outcome', outcome: 'completed' }])
  expect(await eventsNamed(page, 'lifeline_used')).toHaveLength(1)
})

test('?ad=late: a completed after the cancelled result does not skip the question it returned to', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2), { search: '?ad=late' })
  await openConfirm(page)
  await playVideo(page)
  await expect(skipWindow(page).locator('.skip-text')).toHaveText('The video didn’t finish, so the question wasn’t skipped.')
  await skipWindow(page).getByRole('button', { name: 'Back to the answer' }).click()
  await expectState(page, 'question')
  await page.clock.runFor(2_500)
  await expectState(page, 'question')
  expect(await eventsNamed(page, 'question_resolved')).toEqual([])
  expect(await eventsNamed(page, 'rewarded_ad_outcome')).toEqual([{ name: 'rewarded_ad_outcome', outcome: 'cancelled' }])
  expect((await savedRun(page)).usedLifelines).not.toContain('skipVideo')
})

test('?ad=interrupted: Back to the answer appears only 90 s after the spot started and gives the attempt up', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2), { search: '?ad=interrupted' })
  await openConfirm(page)
  await playVideo(page, 100)
  const wait = skipWindow(page)
  await page.clock.runFor(89_000)
  await page.keyboard.press('Escape')
  await expect(wait).toContainText('Loading the video…')
  await expect(wait.getByRole('button')).toHaveCount(0)
  await page.clock.runFor(1_000)
  const back = wait.getByRole('button', { name: 'Back to the answer' })
  await expect(back).toBeVisible()
  await expect(back).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(back).toBeVisible()
  await back.click()
  await expectQuestionBackWithLifeline(page)
  expect(await eventsNamed(page, 'rewarded_ad_outcome')).toEqual([])
})

test('a reload during the blocked spot comes back in the pause with the lifeline and no attempt', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2), { search: '?ad=interrupted' })
  await openConfirm(page)
  await playVideo(page, 100)
  await expect(skipWindow(page)).toContainText('Loading the video…')
  await page.reload()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(pauseWindow(page)).toBeVisible()
  await expectState(page, 'question')
  await expect(timer(page)).toHaveText('18 s')
  const run = await savedRun(page)
  expect(run.skipAttemptId).toBeNull()
  expect(run.usedLifelines).not.toContain('skipVideo')
  await openConfirm(page)
  await skipWindow(page).getByRole('button', { name: 'Play the video' }).click()
  await expect(skipWindow(page)).toContainText('Loading the video…')
})

test('the daily challenge offers the skip only on its third question, where it works the same and Next ends on the daily summary', async ({ page }) => {
  const { route, run } = dailyRun()
  await continueRun(page, runAt(run, 1), { search: '?ad=completed' })
  await expect(page.locator('.play-title')).toHaveText(`${route.name.en} · 2/3`)
  await expect(pauseWindow(page).getByRole('button', { name: 'Skip with a video' })).toHaveCount(0)
  await pauseWindow(page).getByRole('button', { name: 'Continue' }).click()
  await correctChoice(page, stopOf(route, runAt(run, 1))).click()
  await page.locator('.next').click()
  await expectState(page, 'question')
  await page.getByRole('button', { name: 'Pause' }).click()
  await openConfirm(page)
  await playVideo(page)
  await expectState(page, 'result')
  await expect(page.locator('.result-word')).toHaveText('Skipped')
  expect((await eventsNamed(page, 'question_resolved')).at(-1)).toEqual({ name: 'question_resolved', cityId: route.id, index: 3, mode: 'daily', outcome: 'skipped' })
  expect(await eventsNamed(page, 'lifeline_used')).toEqual([{ name: 'lifeline_used', lifeline: 'skipVideo', mode: 'daily' }])
  expect(await savedRun(page)).toMatchObject({ correct: 2, streak: 2 })

  // The skipped last question counts as not correct, so the day ends with the two answered before it.
  await page.locator('.next').click()
  await expect(page.getByRole('heading', { name: 'Daily challenge done' })).toBeVisible()
  await expect(page.locator('.summary-stats > div').first()).toHaveText(/^Today’s score2\/3$/)
  expect((await recordedEvents(page)).slice(-2)).toEqual([
    { name: 'route_completed', cityId: route.id, mode: 'daily', correct: 2, stars: 0 },
    { name: 'daily_completed', utcDate: '2026-12-05', correct: 2 },
  ])
  expect(await savedSection(page, 'daily-results')).toEqual({ '2026-12-05': { cityId: route.id, correct: 2 } })
})

const hint = (page: Page) => page.locator('.pause-hint')

/** The controls, choices, time and title the hint by the pause button lies over. */
const coveredByHint = (page: Page) =>
  hint(page).evaluate((label) => {
    const box = label.getBoundingClientRect()
    return [...document.querySelectorAll('button, .choice, .timer, .play-title')]
      .filter((control) => {
        const other = control.getBoundingClientRect()
        return Math.min(box.right, other.right) - Math.max(box.left, other.left) > 0 && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 0
      })
      .map((control) => control.getAttribute('aria-label') ?? control.textContent)
  })

test.describe('the hint by the pause button', () => {

  test('shows once when a question first runs with a streak of 3, keeps the time running and covers no control', async ({ page }) => {
    await continueRun(page, runAt(parisRun(), 3))
    await expect(hint(page)).toBeHidden()
    await pauseWindow(page).getByRole('button', { name: 'Continue' }).click()
    await expect(hint(page)).toBeVisible()
    await expect(hint(page)).toHaveText('Skip with a video is in the pause')
    await expect(page.getByRole('button', { name: 'Pause' })).toHaveAccessibleDescription('Skip with a video is in the pause')
    expect((await savedSection<{ shownHintIds: string[] }>(page, 'settings')).shownHintIds).toEqual(['skip-video'])
    expect(await coveredByHint(page)).toEqual([])
    await page.clock.runFor(1_000)
    await expect(timer(page)).toHaveText('17 s')
    await page.clock.runFor(2_000)
    await expect(hint(page)).toBeHidden()

    await page.reload()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await pauseWindow(page).getByRole('button', { name: 'Continue' }).click()
    await expectState(page, 'question')
    await page.clock.runFor(100)
    await expect(hint(page)).toBeHidden()
  })

  test('goes away when the pause opens', async ({ page }) => {
    await continueRun(page, runAt(parisRun(), 3))
    await pauseWindow(page).getByRole('button', { name: 'Continue' }).click()
    await expect(hint(page)).toBeVisible()
    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(hint(page)).toBeHidden()
  })

  for (const size of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    test(`looks like the 50:50 hint and keeps to the content column at ${size.width} × ${size.height}`, async ({ page }) => {
      await page.setViewportSize(size)
      await continueRun(page, runAt(parisRun(), 3))
      await pauseWindow(page).getByRole('button', { name: 'Continue' }).click()
      await expect(hint(page)).toBeVisible()
      const look = await hint(page).evaluate((label) => {
        const resolve = (token: string) => {
          const probe = document.createElement('span')
          probe.style.color = `var(${token})`
          document.body.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()
          return color
        }
        const style = getComputedStyle(label)
        const trailRow = document.querySelector('.trail-row') as HTMLElement
        const box = label.getBoundingClientRect()
        const peeking = [...document.querySelectorAll('.difficulty, .streak')].filter((pill) => {
          const other = pill.getBoundingClientRect()
          const under = other.left < box.right && other.right > box.left
          return under && (other.top < box.top - 0.5 || other.bottom > box.bottom + 0.5)
        })
        return {
          peeking: peeking.length,
          background: style.backgroundColor === resolve('--color-ink'),
          color: style.color === resolve('--color-on-ink'),
          border: style.borderTopStyle,
          right: Math.round(label.getBoundingClientRect().right),
          trailRowRight: Math.round(trailRow.getBoundingClientRect().right),
        }
      })
      expect(look).toEqual({ peeking: 0, background: true, color: true, border: 'none', right: look.trailRowRight, trailRowRight: look.trailRowRight })
    })
  }

  test('is not shown when the portal offers no rewarded spots', async ({ page }) => {
    await continueRun(page, runAt(parisRun(), 3), { search: '?ads=none' })
    await pauseWindow(page).getByRole('button', { name: 'Continue' }).click()
    await expectState(page, 'question')
    await expect(hint(page)).toBeHidden()
    expect((await savedSection<{ shownHintIds: string[] }>(page, 'settings')).shownHintIds).toEqual([])
  })
})

async function expectEqualAmberButtons(page: Page) {
  const looks = await page
    .locator('dialog[open] .skip-actions button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect()
        const style = getComputedStyle(button)
        return { width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.top), left: Math.round(box.left), background: style.backgroundColor }
      }),
    )
  const accent = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-accent)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  expect(looks).toHaveLength(2)
  const [back, play] = looks
  expect([back.width, back.height]).toEqual([play.width, play.height])
  expect(back.background).toBe(accent)
  expect(play.background).toBe(accent)
  // Next to it or above it.
  expect(back.top === play.top ? back.left < play.left : back.top < play.top).toBe(true)
}

for (const locale of ['en', 'cs'] as const) {
  for (const size of layoutSizes) {
    test(`the skip windows are usable at ${size.width} × ${size.height} in ${locale}`, async ({ page }) => {
      await page.setViewportSize(size)
      await continueRun(page, runAt(parisRun(), 2), { search: '?ad=cancelled', locale })
      await openConfirm(page, locale)
      await expectUsableLayout(page)
      await expectEqualAmberButtons(page)
      const actions = skipWindow(page, locale).locator('.skip-actions button')
      await expect(actions).toHaveText([texts[locale].back, texts[locale].play])

      await skipWindow(page, locale).getByRole('button', { name: texts[locale].play }).click()
      await expect(skipWindow(page, locale)).toContainText(texts[locale].loading)
      await expectUsableLayout(page)

      await page.clock.runFor(600)
      await expect(skipWindow(page, locale).getByRole('button', { name: texts[locale].back })).toBeVisible()
      await expectUsableLayout(page)
    })

    test(`the window of a hung spot is usable at ${size.width} × ${size.height} in ${locale}, with Back as wide as in the confirmation`, async ({ page }) => {
      await page.setViewportSize(size)
      await continueRun(page, runAt(parisRun(), 2), { search: '?ad=interrupted', locale })
      await openConfirm(page, locale)
      const window = skipWindow(page, locale)
      const back = window.getByRole('button', { name: texts[locale].back })
      const confirmWidth = (await back.boundingBox())?.width
      await window.getByRole('button', { name: texts[locale].play }).click()
      await page.clock.runFor(100)
      await expect(window).toContainText(texts[locale].loading)
      await expectUsableLayout(page)
      const waitHeight = (await window.boundingBox())?.height
      await page.clock.runFor(90_000)
      await expect(back).toBeVisible()
      await expectUsableLayout(page)
      expect((await window.boundingBox())?.height, 'the window keeps its height when Back appears').toBe(waitHeight)
      expect((await back.boundingBox())?.width).toBe(confirmWidth)
    })
  }
}

test('Back to the answer is as wide in the unavailable window as in the confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await continueRun(page, runAt(parisRun(), 2), { search: '?ad=unavailable' })
  await openConfirm(page)
  const back = skipWindow(page).getByRole('button', { name: 'Back to the answer' })
  const confirmWidth = (await back.boundingBox())?.width
  await playVideo(page)
  await expect(skipWindow(page)).toContainText('The video isn’t available right now.')
  expect((await back.boundingBox())?.width).toBe(confirmWidth)
})

for (const outcome of ['cancelled', 'unavailable'] as const) {
  for (const size of [{ width: 1440, height: 900 }, { width: 320, height: 568 }]) {
    test(`the sentence and the only Back to the answer of the ${outcome} window are centred, the button as wide as in the confirmation at ${size.width} × ${size.height}`, async ({ page }) => {
      await page.setViewportSize(size)
      await continueRun(page, runAt(parisRun(), 2), { search: `?ad=${outcome}` })
      await openConfirm(page)
      const back = skipWindow(page).getByRole('button', { name: 'Back to the answer' })
      const confirmWidth = (await back.boundingBox())?.width
      await playVideo(page)
      await expect(skipWindow(page).locator('.skip-text')).toHaveText(outcome === 'cancelled' ? 'The video didn’t finish, so the question wasn’t skipped.' : 'The video isn’t available right now.')
      const button = (await back.boundingBox())!
      const row = (await skipWindow(page).locator('.skip-actions').boundingBox())!
      expect(button.width).toBe(confirmWidth)
      expect(Math.abs(button.x + button.width / 2 - (row.x + row.width / 2))).toBeLessThanOrEqual(1)
      // The sentence above is centred too: every line of it sits in the middle of the row.
      const lineOffsets = await skipWindow(page)
        .locator('.skip-text')
        .evaluate((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          const box = node.getBoundingClientRect()
          return [...range.getClientRects()].map((line) => line.left + line.width / 2 - (box.left + box.width / 2))
        })
      for (const offset of lineOffsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1)
    })
  }
}

for (const locale of ['en', 'cs'] as const) {
  for (const size of layoutSizes.slice(0, 2)) {
    test(`the hint by the pause button covers nothing at ${size.width} × ${size.height} in ${locale}`, async ({ page }) => {
      await page.setViewportSize(size)
      await continueRun(page, runAt(parisRun(), 3), { locale })
      await pauseWindow(page, locale).getByRole('button', { name: texts[locale].continue }).click()
      await expect(hint(page)).toBeVisible()
      expect(await coveredByHint(page)).toEqual([])
    })
  }
}

const waitBarAnimation = (page: Page) =>
  skipWindow(page)
    .locator('.scene-loading-bar')
    .evaluate((bar) => getComputedStyle(bar, '::before').animationName)

test('the bar in the wait for the spot moves', async ({ page }) => {
  await continueRun(page, runAt(parisRun(), 2), { search: '?ad=interrupted' })
  await openConfirm(page)
  await playVideo(page, 100)
  await expect(skipWindow(page)).toContainText('Loading the video…')
  expect(await waitBarAnimation(page)).toBe('skip-wait-bar')
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the bar in the wait for the spot stands still', async ({ page }) => {
    await continueRun(page, runAt(parisRun(), 2), { search: '?ad=interrupted' })
    await openConfirm(page)
    await playVideo(page, 100)
    await expect(skipWindow(page)).toContainText('Loading the video…')
    expect(await waitBarAnimation(page)).toBe('none')
  })
})
