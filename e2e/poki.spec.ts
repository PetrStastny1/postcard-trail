import { expect, test, type Frame, type Page } from '@playwright/test'
import { paris, seedStorage } from './game.ts'

// Brief §12, D1: on Poki the game runs in a 16:9 frame inside a portal page taller than the window. The game fills the
// frame without scrollbars, and playing it by keyboard or wheel never scrolls the portal page.

const frames = [
  { width: 640, height: 360 },
  { width: 836, height: 470 },
  { width: 1031, height: 580 },
] as const

/** A portal page served on the game's origin: a header, the frame and a long page below it, so it can scroll. */
function portalPage(size: { width: number; height: number }) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Portal</title>
<style>body{margin:0;font-family:sans-serif}header{height:80px}iframe{display:block;margin:0 auto;border:0}footer{height:3000px}</style>
</head><body><header>Portal</header><iframe title="Postcard Trail" src="/" width="${size.width}" height="${size.height}"></iframe><footer>More games</footer></body></html>`
}

async function openInPortal(page: Page, size: { width: number; height: number }): Promise<Frame> {
  await page.route('**/portal.html', (route) => route.fulfill({ contentType: 'text/html', body: portalPage(size) }))
  await page.goto('/portal.html')
  const frame = page.frame({ url: (url) => url.pathname === '/' })
  if (!frame) throw new Error('The game frame did not load.')
  await expect(frame.locator('[data-focus-id="title-play"]')).toBeVisible()
  return frame
}

/** The game document fills the frame exactly and shows no scrollbar. */
async function expectFilledFrame(frame: Frame, size: { width: number; height: number }) {
  const box = await frame.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement
    const app = document.querySelector('#app')?.getBoundingClientRect()
    return { innerWidth, innerHeight, scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight, clientWidth: root.clientWidth, clientHeight: root.clientHeight, app: app && { width: app.width, height: app.height } }
  })
  expect(box).toEqual({ innerWidth: size.width, innerHeight: size.height, scrollWidth: size.width, scrollHeight: size.height, clientWidth: size.width, clientHeight: size.height, app: { width: size.width, height: size.height } })
}

/**
 * The highest `scrollY` the portal page reaches over the next ten frames. A key or wheel scroll may be smooth and
 * start a frame or two later, so one read at once could miss it or blame the next key.
 */
const portalScrollSettled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((done) => {
        let highest = scrollY
        let frames = 10
        const sample = () => {
          highest = Math.max(highest, scrollY)
          if (--frames === 0) done(highest)
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }),
  )

type WheelCount = { portalWheels?: number }

/**
 * The wheel over the game first, while the screen or window under test is still open, then every key the game knows:
 * the portal page must stay at the top. The game counts the wheel events it receives, so the test knows they arrived
 * before it watches the portal page.
 */
async function expectPortalStill(page: Page, frame: Frame, where: string) {
  const box = await page.locator('iframe').boundingBox()
  if (!box) throw new Error('The frame has no box.')
  await frame.evaluate(() => {
    const counted = globalThis as WheelCount
    if (counted.portalWheels === undefined) addEventListener('wheel', () => (counted.portalWheels = (counted.portalWheels ?? 0) + 1), { capture: true, passive: true })
    counted.portalWheels = 0
  })
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 600)
  await page.mouse.wheel(0, 600)
  const wheels = () => frame.evaluate(() => (globalThis as WheelCount).portalWheels)
  // Once the portal page has moved, the frame is no longer under the pointer and the game may not get the wheel.
  await expect.poll(async () => (await wheels()) === 2 || (await page.evaluate(() => scrollY)) > 0, `${where}: the wheel arrives`).toBe(true)
  expect(await portalScrollSettled(page), `${where}: wheel`).toBe(0)
  expect(await wheels(), `${where}: the game receives the wheel`).toBe(2)
  // Keys that only move or scroll go first; Space, Enter and Escape may then press a control or close the window.
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'PageDown', 'End', 'Tab', 'Shift+Tab', '1', '2', '3', '4', 'Space', 'Enter', 'Escape']) {
    await page.keyboard.press(key)
    expect(await portalScrollSettled(page), `${where}: ${key}`).toBe(0)
  }
}

for (const size of frames) {
  test.describe(`Poki frame ${size.width} × ${size.height}`, () => {
    test.use({ viewport: { width: 1280, height: 720 } })

    test('the game fills the frame and keys and the wheel never scroll the portal page', async ({ page }) => {
      await seedStorage(page, { settings: { shownHintIds: ['fifty-fifty', 'skip-video'] } })
      const frame = await openInPortal(page, size)
      expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true)
      await expectFilledFrame(frame, size)
      const noWindow = () => expect(frame.locator('dialog[open]')).toHaveCount(0)

      await frame.locator('[data-focus-id="title-settings"]').focus()
      await expectPortalStill(page, frame, 'title')
      await frame.locator('[data-focus-id="title-settings"]').click()
      await expect(frame.getByRole('dialog', { name: 'Settings' })).toBeVisible()
      await expectPortalStill(page, frame, 'settings over the title')
      await noWindow()

      await frame.locator('[data-focus-id="title-map"]').click()
      await expect(frame.locator('.map-point').first()).toBeVisible()
      await expectFilledFrame(frame, size)
      await expectPortalStill(page, frame, 'map')
      await noWindow()

      await frame.locator('[data-focus-id="title-play"]').click()
      await expect(frame.locator('.play')).toHaveAttribute('data-state', /question|result/)
      await expectFilledFrame(frame, size)
      await frame.locator('[data-focus-id="play-pause"]').click()
      await expect(frame.getByRole('dialog', { name: 'Paused' })).toBeVisible()
      await expectPortalStill(page, frame, 'pause')
      await noWindow()

      await frame.locator('.choice:not([disabled])').first().click()
      await expect(frame.locator('.play')).toHaveAttribute('data-state', 'result')
      await frame.locator('[data-focus-id="play-zoom"]').click()
      await expect(frame.locator('dialog.zoom-window')).toBeVisible()
      await expectPortalStill(page, frame, 'zoom')
      await noWindow()

      // The keys above may answer, pause or leave; the page must stay still whatever they did.
      await expectPortalStill(page, frame, 'game')
      await expectFilledFrame(frame, size)
    })

    test('a whole question by keyboard in the frame keeps the portal page still', async ({ page }) => {
      const frame = await openInPortal(page, size)
      await frame.locator('[data-focus-id="title-play"]').click()
      await expect(frame.locator('.play')).toHaveAttribute('data-state', 'question')
      await frame.locator('.question').focus()
      const order = await frame.locator('.choice-label').allTextContents()
      const correct = paris.stops[0].choices.find((choice) => choice.id === paris.stops[0].correctChoiceId)?.label.en ?? ''
      await page.keyboard.press(String(order.indexOf(correct) + 1))
      await expect(frame.locator('.result-word')).toHaveText('Correct!')
      await page.keyboard.press('Space')
      await expect(frame.locator('.play-title')).toHaveText('Paris · 2/10')
      await page.keyboard.press('Escape')
      await expect(frame.getByRole('dialog', { name: 'Paused' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(frame.getByRole('dialog')).toHaveCount(0)
      await expect(frame.locator('.play')).toHaveAttribute('data-state', 'question')
      expect(await portalScrollSettled(page)).toBe(0)
    })
  })
}
