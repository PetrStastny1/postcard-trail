import { expect, test, type Page } from '@playwright/test'
import { expectUsableLayout, layoutSizes } from './layout.ts'

const storageKey = (section: string) => `postcard-trail:${section}`

async function seedStorage(page: Page, sections: Record<string, unknown>) {
  await page.addInitScript((entries) => {
    // Seed only once per test, so a reload keeps what the game saved.
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    for (const [key, data] of entries) localStorage.setItem(key, JSON.stringify({ version: 1, data }))
  }, Object.entries(sections).map(([section, data]) => [storageKey(section), data] as const))
}

async function openTitle(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
}

test.describe('title screen', () => {
  test.use({ locale: 'cs-CZ' })

  test('a fresh start shows the English title whatever the browser language', async ({ page }) => {
    await openTitle(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    const logo = page.getByRole('heading', { level: 1, name: 'Postcard Trail' })
    await expect(logo.locator('.logo-line')).toHaveText(['Postcard', 'Trail'])
    await expect(logo.locator('.logo-arc')).toBeVisible()
    const lineTops = await logo.locator('.logo-line').evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().top))
    expect(lineTops[1]).toBeGreaterThan(lineTops[0])

    const play = page.getByRole('button', { name: 'Play' })
    expect((await play.boundingBox())?.height).toBe(56)
    const menu = page.locator('.title-menu button')
    await expect(menu).toHaveText(['City map', 'Settings', 'Collection', /^Daily challenge/])
    const playBox = await play.boundingBox()
    const menuBox = await page.locator('.title-menu').boundingBox()
    expect(menuBox!.y).toBeGreaterThan(playBox!.y)
    await expect(page.getByRole('button', { name: 'Daily challenge' })).toHaveAccessibleDescription('Finish your first city to unlock')
    await expect(page.locator('.title-progress li')).toHaveText(['0/20 cities', /^0\/60 ★/, '0 postcards'])
  })

  test('the progress comes from the saved progress', async ({ page }) => {
    await seedStorage(page, {
      progress: {
        completedCityIds: ['london', 'paris', 'rome'],
        bestStars: { london: 2, paris: 3, rome: 2 },
        postcardCityIds: ['london', 'paris', 'rome'],
      },
    })
    await openTitle(page)
    await expect(page.locator('.title-progress li')).toHaveText(['3/20 cities', /^7\/60 ★/, '3 postcards'])
    await expect(page.locator('.title-progress')).toContainText('7 of 60 stars')
    await expect(page.locator('.title-daily-condition')).toHaveCount(0)
  })

  test('the animation loops in 8 s and never names the river', async ({ page }) => {
    await openTitle(page)
    const boat = page.locator('.title-boat')
    await expect(boat).toHaveCSS('animation-duration', '8s')
    await expect(boat).toHaveCSS('animation-iteration-count', 'infinite')
    await expect(page.locator('.title-shimmer').first()).not.toHaveCSS('animation-name', 'none')
    await expect(page.getByRole('img', { name: /boat/ })).toBeVisible()
    const named = await page.evaluate(() =>
      [document.body.innerText, ...[...document.querySelectorAll('[alt], [aria-label], title')].map((node) => node.getAttribute('alt') ?? node.getAttribute('aria-label') ?? node.textContent)].join(' '),
    )
    expect(named).not.toMatch(/sein/i)
  })

  test('in landscape the scene is left of the controls, in portrait above them', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await openTitle(page)
    let scene = (await page.locator('.title-scene').boundingBox())!
    let play = (await page.getByRole('button', { name: 'Play' }).boundingBox())!
    expect(scene.x + scene.width).toBeLessThanOrEqual(play.x)

    await page.setViewportSize({ width: 390, height: 844 })
    scene = (await page.locator('.title-scene').boundingBox())!
    play = (await page.getByRole('button', { name: 'Play' }).boundingBox())!
    expect(scene.y + scene.height).toBeLessThanOrEqual(play.y)
  })
})

test.describe('reduced motion from the system', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the title animation stands still', async ({ page }) => {
    await openTitle(page)
    for (const animated of await page.locator('.title-boat, .title-boat-bob, .title-shimmer').all()) {
      await expect(animated).toHaveCSS('animation-name', 'none')
    }
  })
})

test('the "Reduce motion" setting stops the title animation and survives a reload', async ({ page }) => {
  await openTitle(page)
  await expect(page.locator('.title-boat')).toHaveCSS('animation-name', 'title-boat')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Reduce motion' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  for (const animated of await page.locator('.title-boat, .title-boat-bob, .title-shimmer').all()) {
    await expect(animated).toHaveCSS('animation-name', 'none')
  }
  await page.reload()
  await expect(page.locator('.title-boat')).toHaveCSS('animation-name', 'none')
})

test('the loading screen offers "Try again" when the entry script fails and reloads into the title', async ({ page }) => {
  await page.route('**/src/main.ts', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Postcard Trail' })).toBeVisible()
  await expect(page.getByText('The game could not load. Check your connection and try again.')).toBeVisible()
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()

  await page.unroute('**/src/main.ts')
  await retry.click()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(retry).toHaveCount(0)
})

test.describe('settings', () => {
  test('settings has ×, Home and every option, and × returns focus to Settings', async ({ page }) => {
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Home' })).toBeVisible()
    await expect(dialog.getByRole('group', { name: 'Language' }).getByRole('button')).toHaveText(['English', 'Čeština'])
    await expect(dialog.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    for (const name of ['Sound', 'Vibration']) await expect(dialog.getByRole('switch', { name })).toBeChecked()
    for (const name of ['Reduce motion', 'Untimed']) await expect(dialog.getByRole('switch', { name })).not.toBeChecked()
    await expect(dialog.getByRole('switch', { name: 'Untimed' })).toHaveAccessibleDescription('Applies from your next new route.')

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused()
  })

  test('Home closes settings onto the title', async ({ page }) => {
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Home' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused()
  })

  test('every change is saved and survives a reload', async ({ page }) => {
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    for (const name of ['Sound', 'Vibration', 'Reduce motion', 'Untimed']) {
      const toggle = page.getByRole('switch', { name })
      const before = await toggle.getAttribute('aria-checked')
      await toggle.click()
      await expect(page.getByRole('switch', { name })).not.toHaveAttribute('aria-checked', before!)
      await expect(page.getByRole('switch', { name })).toBeFocused()
    }
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), storageKey('settings'))
    expect(saved.data).toMatchObject({ soundEnabled: false, vibrationEnabled: false, reducedMotion: true, untimed: true })

    await page.reload()
    await page.getByRole('button', { name: 'Settings' }).click()
    for (const name of ['Sound', 'Vibration']) await expect(page.getByRole('switch', { name })).not.toBeChecked()
    for (const name of ['Reduce motion', 'Untimed']) await expect(page.getByRole('switch', { name })).toBeChecked()
  })

  test('Čeština translates the title and settings at once and stays after a reload', async ({ page }) => {
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Čeština' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs')
    const dialog = page.getByRole('dialog', { name: 'Nastavení' })
    await expect(dialog.getByRole('button', { name: 'Čeština' })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('button', { name: 'Čeština' })).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Zavřít' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Úvod' })).toBeVisible()
    for (const name of ['Zvuk', 'Vibrace', 'Bez animací', 'Bez časového limitu']) await expect(dialog.getByRole('switch', { name })).toBeVisible()
    await expect(dialog.getByRole('switch', { name: 'Bez časového limitu' })).toHaveAccessibleDescription('Platí od příští nové trasy.')

    await dialog.getByRole('button', { name: 'Zavřít' }).click()
    await expect(page.getByRole('button', { name: 'Nastavení' })).toBeFocused()
    await expect(page.locator('.title-menu button')).toHaveText(['Mapa měst', 'Nastavení', 'Sbírka', /^Denní výzva/])
    await expect(page.getByRole('button', { name: 'Hrát' })).toBeVisible()
    await expect(page.locator('.title-progress li')).toHaveText(['0/20 měst', /^0\/60 ★/, '0 pohlednic'])

    await page.reload()
    await expect(page.getByRole('button', { name: 'Hrát' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'cs')
  })

  test('the settings dialog keeps focus inside with Tab and Shift+Tab and closes on Escape', async ({ page }) => {
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    const close = dialog.getByRole('button', { name: 'Close' })
    const untimed = dialog.getByRole('switch', { name: 'Untimed' })
    await expect(close).toBeFocused()

    await page.keyboard.press('Shift+Tab')
    await expect(untimed).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    for (let step = 0; step < 16; step += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused()
  })
})

test.describe('sound', () => {
  test.beforeEach(async ({ page }) => {
    // Web Audio is the platform's external API; the fake records what the game asks of it.
    await page.addInitScript(() => {
      const log = { created: 0, resumes: 0, masterLevels: [] as number[], oscillators: 0 }
      Object.assign(window, { audioLog: log })
      class FakeAudioContext {
        state = 'suspended'
        currentTime = 0
        destination = {}
        constructor() {
          log.created += 1
        }
        createGain() {
          return {
            connect() {},
            gain: { setValueAtTime: (value: number) => log.masterLevels.push(value), cancelScheduledValues() {}, linearRampToValueAtTime() {} },
          }
        }
        createOscillator() {
          log.oscillators += 1
          return { type: 'sine', frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }
        }
        resume() {
          log.resumes += 1
          return Promise.resolve()
        }
      }
      Object.assign(window, { AudioContext: FakeAudioContext })
    })
  })

  type AudioLog = { created: number; resumes: number; masterLevels: number[]; oscillators: number }
  const audioLog = (page: Page) => page.evaluate(() => (window as unknown as { audioLog: AudioLog }).audioLog)

  test('audio unlocks on every click and keydown, not on pointerdown, and the title stays silent', async ({ page }) => {
    await openTitle(page)
    const collection = (await page.getByRole('button', { name: 'Collection' }).boundingBox())!
    await page.mouse.move(collection.x + collection.width / 2, collection.y + collection.height / 2)
    await page.mouse.down()
    expect(await audioLog(page)).toMatchObject({ created: 0, resumes: 0 })
    await page.mouse.up()
    expect(await audioLog(page)).toMatchObject({ created: 1, resumes: 1 })
    await page.keyboard.press('Shift')
    expect((await audioLog(page)).resumes).toBe(2)
    await page.getByRole('button', { name: 'Play' }).click()
    expect((await audioLog(page)).resumes).toBe(3)
    expect((await audioLog(page)).oscillators).toBe(0)
  })

  test('turning the sound off reaches the feedback at once', async ({ page }) => {
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    expect((await audioLog(page)).masterLevels.at(-1)).toBeGreaterThan(0)
    await page.getByRole('switch', { name: 'Sound' }).click()
    expect((await audioLog(page)).masterLevels.at(-1)).toBe(0)
    await page.getByRole('switch', { name: 'Sound' }).click()
    expect((await audioLog(page)).masterLevels.at(-1)).toBeGreaterThan(0)
    expect((await audioLog(page)).oscillators).toBe(0)
  })
})

test('the development build exposes the recorded events for tests', async ({ page }) => {
  await openTitle(page)
  const events = await page.evaluate(() => (window as unknown as { __postcardTrail: { recordedEvents(): unknown[] } }).__postcardTrail.recordedEvents())
  expect(events).toEqual([])
})

test.describe('unavailable storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage is blocked.', 'SecurityError')
        },
      })
    })
  })

  test('the game runs and shows the notice once, above the controls', async ({ page }) => {
    await openTitle(page)
    const notice = page.getByRole('status').filter({ hasText: 'This browser is not saving the game.' })
    await expect(notice).toBeVisible()
    await expectUsableLayout(page)
    const noticeBox = (await notice.boundingBox())!
    const sceneBox = (await page.locator('.title').boundingBox())!
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(sceneBox.y)

    await notice.getByRole('button', { name: 'Close the notice' }).click()
    await expect(notice).toHaveCount(0)

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('switch', { name: 'Sound' }).click()
    await expect(page.getByRole('switch', { name: 'Sound' })).not.toBeChecked()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByText('This browser is not saving the game.')).toHaveCount(0)
  })
})

test('a focused button shows an ink outline on a paper halo', async ({ page }) => {
  await openTitle(page)
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus')
  await expect(focused).toHaveCSS('outline-style', 'solid')
  await expect(focused).toHaveCSS('outline-color', 'rgb(21, 31, 68)')
  await expect(focused).toHaveCSS('outline-width', '3px')
  await expect(focused).toHaveCSS('box-shadow', 'rgb(255, 244, 224) 0px 0px 0px 6px')
})

for (const locale of ['en', 'cs'] as const) {
  for (const size of layoutSizes) {
    test(`title and settings fit ${size.width} × ${size.height} in ${locale}`, async ({ page }) => {
      await seedStorage(page, { settings: { locale } })
      await page.setViewportSize(size)
      await page.goto('/')
      const settings = page.getByRole('button', { name: locale === 'en' ? 'Settings' : 'Nastavení' })
      await expect(settings).toBeVisible()
      await expectUsableLayout(page)
      await settings.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expectUsableLayout(page)
    })
  }
}

test.describe('touch phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('settings open and close by tap', async ({ page }) => {
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).tap()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectUsableLayout(page)
    await page.getByRole('button', { name: 'Close' }).tap()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
