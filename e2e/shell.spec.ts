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
    const daily = page.getByRole('button', { name: 'Daily challenge', exact: true })
    await expect(daily).toHaveAccessibleName('Daily challenge')
    await expect(daily).toHaveAccessibleDescription('Unlocks after your first city')
    await expect(daily).toHaveAttribute('data-locked', '')
    await expect(page.locator('.title-progress li')).toHaveText(['0/20 cities', /^0\/60 ★/, '0 postcards'])
  })

  test('the locked daily tile keeps its place in the 2 × 2 menu and its condition is one line under the menu', async ({ page }) => {
    for (const size of [
      { width: 375, height: 812 },
      { width: 568, height: 320 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size)
      await openTitle(page)
      const daily = page.locator('.title-daily')
      await expect(daily).toHaveCSS('border-top-style', 'dashed')
      await expect(daily).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(daily).toHaveCSS('color', 'rgb(58, 67, 102)')
      const tiles = await page.locator('.title-menu button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON() as DOMRect))
      const [, , collection, dailyTile] = tiles
      expect(Math.abs(dailyTile.top - collection.top)).toBeLessThan(1)
      expect(dailyTile.left).toBeGreaterThan(collection.right)
      expect(new Set(tiles.map((tile) => Math.round(tile.height))).size).toBe(1)
      expect(new Set(tiles.map((tile) => Math.round(tile.width))).size).toBe(1)

      const condition = page.locator('.title-daily-condition')
      await expect(condition).toHaveCSS('text-wrap', 'balance')
      await expect(condition).toHaveCSS('font-size', '14px')
      await expect(condition).toHaveCSS('color', 'rgb(58, 67, 102)')
      const conditionBox = (await condition.boundingBox())!
      const menuBox = (await page.locator('.title-menu').boundingBox())!
      expect(conditionBox.y).toBeGreaterThanOrEqual(menuBox.y + menuBox.height)
      const lineHeight = await condition.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight))
      expect(conditionBox.height).toBeLessThan(lineHeight * 1.5)
    }
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
    await expect(page.locator('.title-daily')).not.toHaveAttribute('data-locked')
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

  test('on a desktop the scene takes the free width and the controls are centred in their column', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openTitle(page)
    const scene = (await page.locator('.title-scene').boundingBox())!
    const panel = (await page.locator('.title-panel').boundingBox())!
    const logo = (await page.locator('.title .logo').boundingBox())!
    expect(scene.width).toBeGreaterThan(720)
    expect(Math.abs(logo.x + logo.width / 2 - (panel.x + panel.width / 2))).toBeLessThan(2)
  })

  test('in portrait the title is centred in the height', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openTitle(page)
    const logo = (await page.locator('.title .logo').boundingBox())!
    const progress = (await page.locator('.title-progress').boundingBox())!
    const above = logo.y
    const below = 812 - (progress.y + progress.height)
    expect(Math.abs(above - below)).toBeLessThan(4)
  })

  test('Play keeps its amber on hover', async ({ page }) => {
    await openTitle(page)
    const play = page.getByRole('button', { name: 'Play' })
    const amber = await play.evaluate((node) => getComputedStyle(node).backgroundColor)
    await play.hover()
    await expect(play).toHaveCSS('background-color', amber)
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

test('a portal script blocked while the game starts does not show the load error', async ({ page }) => {
  // An ad blocker stops a portal SDK the adapter loads during init; the game runs on without it.
  await page.route('**/blocked-sdk.js', (route) => route.abort())
  await page.addInitScript(() => {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return
      const sdk = document.createElement('script')
      sdk.src = '/blocked-sdk.js'
      sdk.addEventListener('error', () => {
        Object.assign(window, { bootStateAfterBlockedSdk: document.getElementById('boot')?.dataset.state })
      })
      document.head.append(sdk)
    })
  })
  // The entry script waits until the SDK has failed, so the failure lands while the loading screen is up.
  await page.route('**/src/main.ts', async (route) => {
    await page.waitForFunction(() => 'bootStateAfterBlockedSdk' in window)
    await route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { bootStateAfterBlockedSdk: string }).bootStateAfterBlockedSdk)).toBe('loading')
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
    // The collection opened by that click; its × leads back to the silent title.
    await page.getByRole('button', { name: 'Close' }).click()
    expect((await audioLog(page)).resumes).toBe(3)
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
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

  test('the open notice follows a switch to Čeština', async ({ page }) => {
    await openTitle(page)
    await expect(page.getByText('This browser is not saving the game.')).toBeVisible()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Čeština' }).click()
    await page.getByRole('button', { name: 'Zavřít', exact: true }).click()
    const notice = page.getByRole('status').filter({ hasText: 'Prohlížeč hru neukládá.' })
    await expect(notice).toBeVisible()
    await expect(page.getByText('This browser is not saving the game.')).toHaveCount(0)
    await notice.getByRole('button', { name: 'Zavřít upozornění' }).click()
    await expect(notice).toHaveCount(0)
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

/** True when the whole box lies inside the viewport and inside every clipping ancestor, without scrolling. */
async function wholeInView(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      let clip = { top: 0, left: 0, bottom: innerHeight, right: innerWidth }
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowY === 'visible') continue
        const rect = parent.getBoundingClientRect()
        clip = { top: Math.max(clip.top, rect.top), left: Math.max(clip.left, rect.left), bottom: Math.min(clip.bottom, rect.bottom), right: Math.min(clip.right, rect.right) }
      }
      const inside = box.top >= clip.top - 0.5 && box.left >= clip.left - 0.5 && box.bottom <= clip.bottom + 0.5 && box.right <= clip.right + 0.5
      return inside ? 'whole' : `${node.className} "${node.textContent?.trim().slice(0, 30)}" is cut`
    }),
  )
}

const titleParts = '.title-play, .title-menu button, .title-progress'

test.describe('short landscape screens show the whole title and settings without scrolling', () => {
  for (const locale of ['en', 'cs'] as const) {
    for (const size of [
      { width: 568, height: 320 },
      { width: 640, height: 360 },
    ]) {
      test(`title at ${size.width} × ${size.height} in ${locale}`, async ({ page }) => {
        await seedStorage(page, { settings: { locale } })
        await page.setViewportSize(size)
        await page.goto('/')
        await expect(page.locator('.title-play')).toBeVisible()
        for (const state of await wholeInView(page, titleParts)) expect(state).toBe('whole')
      })
    }

    test(`settings at 568 × 320 in ${locale}`, async ({ page }) => {
      await seedStorage(page, { settings: { locale } })
      await page.setViewportSize({ width: 568, height: 320 })
      await page.goto('/')
      await page.locator('[data-focus-id="title-settings"]').click()
      await expect(page.getByRole('dialog')).toBeVisible()
      for (const state of await wholeInView(page, 'dialog button, .setting-note')) expect(state).toBe('whole')
    })
  }

  test.describe('with the storage notice', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('Storage is blocked.', 'SecurityError')
          },
        })
      })
    })

    for (const size of [
      { width: 568, height: 320 },
      { width: 640, height: 360 },
    ]) {
      test(`title at ${size.width} × ${size.height}`, async ({ page }) => {
        await page.setViewportSize(size)
        await openTitle(page)
        await expect(page.getByText('This browser is not saving the game.')).toBeVisible()
        for (const state of await wholeInView(page, `${titleParts}, .title-daily-condition`)) expect(state).toBe('whole')
        await expect(page.locator('.title-panel')).not.toHaveClass(/has-more/)
      })
    }
  })
})

test.describe('the has-more signal on the title panel with the storage notice', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Storage is blocked.', 'SecurityError')
        },
      })
    })
  })

  test('title at 568 × 320 with 200 % text fades the panel edge exactly while content is cut below it', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 })
    await openTitle(page)
    await expect(page.getByText('This browser is not saving the game.')).toBeVisible()
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
    const panel = page.locator('.title-panel')
    const contentCut = () =>
      panel.evaluate((node) => {
        const visibleBottom = node.getBoundingClientRect().top + node.clientTop + node.clientHeight
        return [...node.children].some((child) => child.getBoundingClientRect().bottom - visibleBottom > 1)
      })
    expect(await contentCut()).toBe(true)
    await expect(panel).toHaveClass(/has-more/)
    await expectUsableLayout(page)

    await panel.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(panel).not.toHaveClass(/has-more/)
    for (const state of await wholeInView(page, '.title-progress')) expect(state).toBe('whole')
  })

  test('overflow made only of the panel padding does not fade the edge', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 })
    await openTitle(page)
    const panel = page.locator('.title-panel')
    await expect(panel).not.toHaveClass(/has-more/)
    await page.addStyleTag({ content: '.title-panel { padding-bottom: 20rem; }' })
    await expect.poll(() => panel.evaluate((node) => node.scrollHeight > node.clientHeight + 1)).toBe(true)
    for (const state of await wholeInView(page, titleParts)) expect(state).toBe('whole')
    await expect(panel).not.toHaveClass(/has-more/)
    await expectUsableLayout(page)
  })

  test('the layout check still demands the signal when content is cut', async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 })
    await openTitle(page)
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
    const panel = page.locator('.title-panel')
    await expect(panel).toHaveClass(/has-more/)
    await panel.evaluate((node) => node.classList.remove('has-more'))
    await expect(expectUsableLayout(page)).rejects.toThrow(/hides content below without the has-more signal/)
  })
})

test('settings float as a rounded window over the Poki 836 × 470 frame', async ({ page }) => {
  await page.setViewportSize({ width: 836, height: 470 })
  await openTitle(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCSS('border-top-left-radius', '20px')
  const box = (await dialog.boundingBox())!
  expect(box.height).toBeLessThan(470)
  expect(box.y).toBeGreaterThan(0)
})

for (const size of [
  { width: 1031, height: 580 },
  { width: 1440, height: 900 },
]) {
  test(`settings content starts at the × in the sheet bar at ${size.width} × ${size.height}`, async ({ page }) => {
    await page.setViewportSize(size)
    await openTitle(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveCSS('border-top-left-radius', '20px')
    const closeLeft = (await dialog.getByRole('button', { name: 'Close' }).boundingBox())!.x
    const contentLefts = await dialog.locator('.setting-heading, .setting-choices, .setting-list').evaluateAll((parts) => parts.map((part) => part.getBoundingClientRect().left))
    for (const left of contentLefts) expect(Math.abs(left - closeLeft)).toBeLessThanOrEqual(2)
  })
}

test.describe('large text', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('at 200 % text the menu stacks so no label spills out of its tile, and the cut edge shows more below', async ({ page }) => {
    await openTitle(page)
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'))
    await expect
      .poll(() => page.locator('.title-menu button').evaluateAll((buttons) => buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).length))
      .toBe(0)
    const columns = await page.locator('.title-menu').evaluate((menu) => getComputedStyle(menu).gridTemplateColumns.split(' ').length)
    expect(columns).toBe(1)
    await expect(page.locator('.screen')).toHaveClass(/has-more/)
    await expectUsableLayout(page)
  })
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
