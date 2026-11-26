import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog, Locale, Route, Stop } from '../src/content/types.ts'
import type { AnalyticsEvent } from '../src/platform/types.ts'

export const storageKey = (section: string) => `postcard-trail:${section}`

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

export const readRoute = (cityId: string) => readJson(`../src/content/routes/${cityId}.json`) as Route
export const catalog = readJson('../src/content/catalog.json') as Catalog
export const paris = readRoute('paris')

/** Writes saved sections before the first load only, so a reload keeps what the game saved since. */
export async function seedStorage(page: Page, sections: Record<string, unknown>) {
  await page.addInitScript((entries) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    for (const [key, data] of entries) localStorage.setItem(key, JSON.stringify({ version: 1, data }))
  }, Object.entries(sections).map(([section, data]) => [storageKey(section), data] as const))
}

export const playState = (page: Page) => page.locator('.play')

export async function expectState(page: Page, state: 'loading' | 'error' | 'question' | 'result') {
  await expect(playState(page)).toHaveAttribute('data-state', state)
}

const clockStart = new Date('2026-12-05T08:00:00Z').getTime()

/** A fake clock that moves only by `page.clock.runFor`, so the countdown is exact. Call before the first navigation. */
export async function installClock(page: Page) {
  await page.clock.install({ time: clockStart })
}

/** Stops the installed clock; the time then moves only by `runFor`. Call once the page has loaded. */
export async function pauseClock(page: Page) {
  await page.clock.pauseAt(clockStart + 60_000)
}

export async function startParis(page: Page, { playName = 'Play', pausedClock = false } = {}) {
  if (pausedClock) await installClock(page)
  await page.goto('/')
  const play = page.getByRole('button', { name: playName, exact: true })
  await expect(play).toBeVisible()
  if (pausedClock) await pauseClock(page)
  await play.click()
  await expectState(page, 'question')
}

export const correctLabel = (stop: Stop, locale: Locale = 'en') =>
  stop.choices.find((choice) => choice.id === stop.correctChoiceId)?.label[locale] ?? ''

/** The choice button with this name, found by its label so the test never reads the answer from the page. */
export const choiceNamed = (page: Page, label: string): Locator =>
  page.locator('.choice').filter({ has: page.locator('.choice-label').getByText(label, { exact: true }) })

export const correctChoice = (page: Page, stop: Stop, locale: Locale = 'en') => choiceNamed(page, correctLabel(stop, locale))

/** A wrong choice that is still shown, also after 50:50. */
export async function wrongChoice(page: Page, stop: Stop, locale: Locale = 'en'): Promise<Locator> {
  for (const choice of stop.choices) {
    if (choice.id === stop.correctChoiceId) continue
    const button = choiceNamed(page, choice.label[locale])
    if (!(await button.evaluate((node) => node.classList.contains('is-removed')))) return button
  }
  throw new Error(`No wrong choice is shown for ${stop.id}.`)
}

export async function recordedEvents(page: Page): Promise<AnalyticsEvent[]> {
  return page.evaluate(() => (window as unknown as { __postcardTrail: { recordedEvents(): AnalyticsEvent[] } }).__postcardTrail.recordedEvents())
}

export async function savedSection<T>(page: Page, section: string): Promise<T> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.data, storageKey(section))
}

/** Plays every remaining stop of the route with the given outcome and clicks Next after each. */
export async function playStops(page: Page, stops: Stop[], outcome: 'correct' | 'wrong', locale: Locale = 'en') {
  for (const stop of stops) {
    await expectState(page, 'question')
    await (outcome === 'correct' ? correctChoice(page, stop, locale) : await wrongChoice(page, stop, locale)).click()
    await expectState(page, 'result')
    await page.locator('.next').click()
  }
}

/**
 * The checks of docs/design/check-layout.mjs over the real game screen: every target reachable and on top, the time,
 * lifelines, Next, verdict and zoom button in view without scrolling, no word broken inside a choice name, the
 * `has-more` signal when choices are cut, 44 px targets and no horizontal scrolling. The prototype's `markMore()` is
 * the game's scroll listener here.
 */
export async function inspectPlayLayout(page: Page) {
  return page.evaluate(() => {
    const shown = (el: Element) => {
      const s = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]')
    }
    const covered = (el: Element) => {
      const r = el.getBoundingClientRect()
      const fx = (f: number) => r.left + r.width * f
      const fy = (f: number) => r.top + r.height * f
      const points = [[fx(0.2), fy(0.25)], [fx(0.8), fy(0.25)], [fx(0.2), fy(0.75)], [fx(0.8), fy(0.75)], [fx(0.5), fy(0.5)], [fx(0.5), r.top + 1.5], [fx(0.5), r.bottom - 1.5]]
      return points.some(([x, y]) => {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true
        const hit = document.elementFromPoint(x, y)
        return !(hit && (el.contains(hit) || hit.closest('.choice-mark')?.parentElement === el))
      })
    }
    const className = (el: Element) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') ?? '')
    const targets = [...document.querySelectorAll('.choice, .lifeline, .timer, .next, .scene-error button, .icon-button, .zoom-button, .question, .result-verdict, .result-sentence')].filter(shown)
    const scrollers = [...document.querySelectorAll<HTMLElement>('.play-main, .panel')]
    const reachable = (el: Element) => {
      if (!covered(el)) return true
      for (const block of ['nearest', 'center', 'start', 'end'] as const) {
        el.scrollIntoView({ block })
        if (!covered(el)) return true
      }
      for (const position of [0, 1e6]) {
        scrollers.forEach((s) => s.scrollTo(0, position))
        if (!covered(el)) return true
      }
      return false
    }
    const hidden = targets.filter((el) => !reachable(el)).map(className)
    scrollers.forEach((el) => el.scrollTo(0, 0))
    const play = document.querySelector<HTMLElement>('.play')
    if (play?.dataset.state === 'result') {
      if (matchMedia('(orientation: landscape)').matches) document.querySelector('.choices')?.scrollIntoView({ block: 'start' })
      else document.querySelector('.action-row')?.scrollIntoView({ block: 'end' })
    }
    scrollers.forEach((el) => el.dispatchEvent(new Event('scroll')))
    const mustSee = [...document.querySelectorAll('.timer, .lifeline, .next, .result-verdict, .zoom-button')].filter(shown)
    const notInView = mustSee.filter(covered).map(className)
    const brokenWords: string[] = []
    for (const label of document.querySelectorAll('.choice-label')) {
      if (!shown(label)) continue
      const node = label.firstChild
      if (!node) continue
      const text = node.textContent ?? ''
      let start = 0
      for (const word of text.split(/(?=[\s-])|(?<=[\s-])/)) {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + word.length)
        start += word.length
        if (word.trim() && new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) brokenWords.push(word)
      }
      if (label.scrollWidth > label.clientWidth + 1) brokenWords.push('overflow:' + text)
    }
    const choicesOut = [...document.querySelectorAll('.choice')].filter(shown).filter(covered).length
    const unsignalled = play?.dataset.state !== 'result' && choicesOut > 0 && !document.querySelector('.action-row')?.classList.contains('has-more')
    const small = [...document.querySelectorAll('button')]
      .filter(shown)
      .filter((b) => {
        const r = b.getBoundingClientRect()
        return r.width < 44 || r.height < 44
      })
      .map(className)
    return {
      scene: Math.round(document.querySelector('.scene-frame')?.getBoundingClientRect().width ?? 0),
      problems: [
        ...hidden.map((name) => `hidden ${name}`),
        ...notInView.map((name) => `not in view ${name}`),
        ...brokenWords.map((word) => `broken ${word}`),
        ...small.map((name) => `small ${name}`),
        ...(document.documentElement.scrollWidth > innerWidth ? ['scrolls horizontally'] : []),
        ...(unsignalled ? ['hidden choices without the has-more signal'] : []),
      ],
    }
  })
}
