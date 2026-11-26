import { expect, test, type Browser, type Page } from '@playwright/test'
import { correctChoice, expectState, inspectPlayLayout, installClock, paris, pauseClock, seedStorage, wrongChoice } from './game.ts'

// The states and sizes of docs/design/check-layout.mjs, checked on the real game screen at the first Paris stop.

type PlayLayoutState = 'question' | 'result' | 'result-correct' | 'result-timeout' | 'loading' | 'error' | 'fifty' | 'untimed'
type Size = { width: number; height: number }

const sizes: Size[] = [
  { width: 375, height: 812 },
  { width: 320, height: 568 },
  { width: 568, height: 320 },
  { width: 844, height: 390 },
  { width: 640, height: 360 },
  { width: 1440, height: 900 },
]

const runs: { lang: 'en' | 'cs'; size: Size; states: PlayLayoutState[] }[] = [
  ...sizes.map((size) => ({
    lang: 'en' as const,
    size,
    states: [
      'question',
      'result',
      'loading',
      'error',
      'fifty',
      'untimed',
      ...([375, 568, 1440].includes(size.width) ? (['result-correct', 'result-timeout'] as const) : []),
    ] satisfies PlayLayoutState[],
  })),
  ...sizes
    .filter((size) => [320, 568, 640].includes(size.width))
    .map((size) => ({ lang: 'cs' as const, size, states: ['question', 'result'] satisfies PlayLayoutState[] })),
]

async function openState(browser: Browser, baseURL: string, size: Size, lang: 'en' | 'cs', state: PlayLayoutState): Promise<Page> {
  const context = await browser.newContext({ baseURL, viewport: size })
  const page = await context.newPage()
  await seedStorage(page, { settings: { locale: lang, untimed: state === 'untimed' } })
  if (state === 'loading') await page.route('**/scenes/PAR01.webp', () => undefined)
  if (state === 'error') await page.route('**/scenes/PAR01.webp', (route) => route.abort())
  if (state === 'result-timeout') await installClock(page)
  await page.goto('/')
  if (state === 'result-timeout') await pauseClock(page)
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
