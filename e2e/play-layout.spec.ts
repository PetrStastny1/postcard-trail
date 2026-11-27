import { expect, test, type Browser, type Page } from '@playwright/test'
import { correctChoice, expectState, inspectPlayLayout, installClock, paris, pauseClock, seedStorage, startParis, wrongChoice } from './game.ts'

// The states and sizes of docs/design/check-layout.mjs, checked on the real game screen at the first Paris stop.

type PlayLayoutState = 'question' | 'result' | 'result-correct' | 'result-timeout' | 'result-skipped' | 'loading' | 'error' | 'fifty' | 'untimed'
type Size = { width: number; height: number }

const sizes: Size[] = [
  { width: 375, height: 812 },
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
  { width: 640, height: 360 },
  { width: 836, height: 470 },
  { width: 1031, height: 580 },
  { width: 1440, height: 900 },
]

const allStates: PlayLayoutState[] = ['question', 'result', 'result-correct', 'result-timeout', 'result-skipped', 'loading', 'error', 'fifty', 'untimed']

// D1: every state in both languages on the minimum and Poki sizes; the other design sizes in English.
const runs: { lang: 'en' | 'cs'; size: Size; states: PlayLayoutState[] }[] = [
  ...sizes.map((size) => ({ lang: 'en' as const, size, states: allStates })),
  ...sizes.filter((size) => [320, 568, 640, 836, 1031].includes(size.width)).map((size) => ({ lang: 'cs' as const, size, states: allStates })),
]

async function openState(browser: Browser, baseURL: string, size: Size, lang: 'en' | 'cs', state: PlayLayoutState): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: size })
  const page = await context.newPage()
  await seedStorage(page, { settings: { locale: lang, untimed: state === 'untimed' } })
  if (state === 'loading') await page.route('**/scenes/PAR01.webp', () => undefined)
  if (state === 'error') await page.route('**/scenes/PAR01.webp', (route) => route.abort())
  const clocked = state === 'result-timeout' || state === 'result-skipped'
  if (clocked) await installClock(page)
  await page.goto(state === 'result-skipped' ? '/?ad=completed' : '/')
  if (clocked) await pauseClock(page)
  await page.getByRole('button', { name: lang === 'en' ? 'Play' : 'Hrát', exact: true }).click()
  if (state === 'loading' || state === 'error') {
    await expectState(page, state)
    return page
  }
  await expectState(page, 'question')
  const stop = paris.stops[0]
  if (state === 'result') await (await wrongChoice(page, stop, lang)).click()
  if (state === 'result-correct') await correctChoice(page, stop, lang).click()
  if (state === 'result-timeout') await page.clock.runFor(25_000)
  if (state === 'result-skipped') {
    // The skip is offered from the third stop on; the local spot completes after 500 ms.
    for (const answered of paris.stops.slice(0, 2)) {
      await correctChoice(page, answered, lang).click()
      await page.locator('.next').click()
      await expectState(page, 'question')
    }
    await page.keyboard.press('Escape')
    await page.locator('[data-focus-id="pause-skip"]').click()
    await page.locator('dialog[open] .skip-play').click()
    await page.clock.runFor(600)
    await expect(page.locator('.result-word')).toHaveText(lang === 'en' ? 'Skipped' : 'Přeskočeno')
  }
  if (state === 'fifty') {
    await page.locator('[data-lifeline="fifty"]').click()
    await expect(page.locator('.choice.is-removed')).toHaveCount(2)
  }
  if (state.startsWith('result')) await expectState(page, 'result')
  return page
}

for (const { lang, size, states } of runs) {
  test(`game screen layout at ${size.width} × ${size.height} in ${lang}`, async ({ browser, baseURL }) => {
    const sceneSizes = new Set<number>()
    for (const state of states) {
      const page = await openState(browser, baseURL ?? '', size, lang, state)
      const layout = await inspectPlayLayout(page)
      expect(layout.problems, `${state} ${lang} ${size.width}x${size.height}`).toEqual([])
      if (state !== 'error') sceneSizes.add(layout.scene)
      if (size.width >= 375 && size.height >= 812) expect(layout.scene).toBeGreaterThanOrEqual(304)
      await page.context().close()
    }
    expect([...sceneSizes], 'the scene keeps its size in every state').toHaveLength(1)
  })
}

// Every Paris stop, so the longest scene caption, the longest result sentence and the 50:50 hint on stop 2 are all checked.
for (const lang of ['en', 'cs'] as const) {
  for (const size of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
    test(`every Paris stop keeps the layout at ${size.width} × ${size.height} in ${lang}`, async ({ page }) => {
      await page.setViewportSize(size)
      await seedStorage(page, { settings: { locale: lang } })
      // The paused clock keeps the 50:50 hint on screen while it is checked.
      await startParis(page, { playName: lang === 'en' ? 'Play' : 'Hrát', pausedClock: true })
      const sceneSizes = new Set<number>()
      for (const [index, stop] of paris.stops.entries()) {
        await expectState(page, 'question')
        if (index === 1) await expect(page.locator('.lifeline-hint')).toBeVisible()
        const question = await inspectPlayLayout(page)
        expect(question.problems, `${stop.id} question`).toEqual([])
        if (index === 1) {
          await page.clock.runFor(1_500)
          await expect(page.locator('.lifeline-hint')).toBeHidden()
          expect((await inspectPlayLayout(page)).actionRowHeight, 'the hint leaves the action row height alone').toBe(question.actionRowHeight)
        }
        sceneSizes.add(question.scene)
        await (index % 2 ? correctChoice(page, stop, lang) : await wrongChoice(page, stop, lang)).click()
        await expectState(page, 'result')
        const result = await inspectPlayLayout(page)
        expect(result.problems, `${stop.id} result`).toEqual([])
        sceneSizes.add(result.scene)
        await page.locator('.next').click()
      }
      expect([...sceneSizes], 'the scene keeps its size on every stop').toHaveLength(1)
    })
  }
}
