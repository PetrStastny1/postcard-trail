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

const portalScroll = (page: Page) => page.evaluate(() => scrollY)

/** Every key the game knows, then the wheel over the game; the portal page must stay at the top. */
async function expectPortalStill(page: Page, frame: Frame, where: string) {
  for (const key of ['Space', 'Enter', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'PageDown', 'End', 'Tab', 'Shift+Tab', '1', '2', '3', '4']) {
    await page.keyboard.press(key)
    expect(await portalScroll(page), `${where}: ${key}`).toBe(0)
  }
  const box = await page.locator('iframe').boundingBox()
  if (!box) throw new Error('The frame has no box.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 600)
  await page.mouse.wheel(0, 600)
  // Wheel scrolling is applied in a later frame; the game frame's own animation frames come after it.
  await frame.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  expect(await portalScroll(page), `${where}: wheel`).toBe(0)
}

for (const size of frames) {
  test.describe(`Poki frame ${size.width} × ${size.height}`, () => {
    test.use({ viewport: { width: 1280, height: 720 } })

    test('the game fills the frame and keys and the wheel never scroll the portal page', async ({ page }) => {
      await seedStorage(page, { settings: { shownHintIds: ['fifty-fifty', 'skip-video'] } })
      const frame = await openInPortal(page, size)
      expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true)
      await expectFilledFrame(frame, size)

      await frame.locator('[data-focus-id="title-settings"]').focus()
      await expectPortalStill(page, frame, 'title')
      await frame.locator('[data-focus-id="title-map"]').click()
      await expect(frame.locator('.map-point').first()).toBeVisible()
      await expectFilledFrame(frame, size)
      await expectPortalStill(page, frame, 'map')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')

      await frame.locator('[data-focus-id="title-play"]').click()
      await expect(frame.locator('.play')).toHaveAttribute('data-state', /question|result/)
      await expectFilledFrame(frame, size)
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
      expect(await portalScroll(page)).toBe(0)
    })
  })
}
