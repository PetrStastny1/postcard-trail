import { expect, test, type Page } from '@playwright/test'
import type { RunState } from '../src/game/logic/run.ts'
import { catalog, expectState, paris, playStops, recordedEvents, savedSection, seedStorage, startParis } from './game.ts'
import { cityRunBeforeLastNext, continueToSummary, dailyRunBeforeLastNext, progressWith } from './screens.ts'

const parisDone = progressWith(1, 0)
const cityNames = catalog.cities.map((city) => city.name.en)
const cityRow = (page: Page, name: string) => page.locator('.city-row').filter({ has: page.locator('.city-name', { hasText: new RegExp(`^${name}$`) }) })
const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name })
const routeChange = (page: Page) => dialog(page, 'Discard your current route?')

async function openMap(page: Page) {
  await page.getByRole('button', { name: 'City map' }).click()
  await expect(page.getByRole('heading', { name: 'City map' })).toBeVisible()
}

/** Every city once among the map targets, whether alone or in a group. */
async function mapCityIds(page: Page): Promise<string[]> {
  return (await page.locator('.map-point').evaluateAll((points) => points.flatMap((point) => (point as HTMLElement).dataset.cityIds?.split(' ') ?? []))).sort()
}

test.describe('route change', () => {
  /** London is being played; Paris is done, so its detail offers Play again. */
  async function withLondonInProgress(page: Page) {
    await seedStorage(page, { progress: parisDone, 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('london', 0) } })
    await page.goto('/')
    await openMap(page)
  }

  test('another city asks first; Keep, × and Escape return to the detail with its focus, Home keeps the run', async ({ page }) => {
    await withLondonInProgress(page)
    const stored = await page.evaluate(() => localStorage.getItem('postcard-trail:active-run'))
    await cityRow(page, 'Paris').click()
    const detail = dialog(page, 'Paris')
    await detail.getByRole('button', { name: 'Play again' }).click()

    await expect(routeChange(page)).toBeVisible()
    await expect(routeChange(page).getByRole('button', { name: 'Keep my route' })).toBeFocused()
    await expect(routeChange(page).getByRole('button', { name: 'Discard and start' })).toBeVisible()
    await routeChange(page).getByRole('button', { name: 'Keep my route' }).click()
    await expect(routeChange(page)).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Play again' })).toBeFocused()

    await detail.getByRole('button', { name: 'Play again' }).click()
    await routeChange(page).getByRole('button', { name: 'Close' }).click()
    await expect(detail.getByRole('button', { name: 'Play again' })).toBeFocused()

    await detail.getByRole('button', { name: 'Play again' }).click()
    await page.keyboard.press('Escape')
    await expect(routeChange(page)).toHaveCount(0)
    await expect(detail).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Play again' })).toBeFocused()

    await detail.getByRole('button', { name: 'Play again' }).click()
    await routeChange(page).getByRole('button', { name: 'Home' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
    expect(await page.evaluate(() => localStorage.getItem('postcard-trail:active-run'))).toBe(stored)
    expect(await recordedEvents(page)).toEqual([])
  })

  test('the list row of the city with the active run says In progress', async ({ page }) => {
    await withLondonInProgress(page)
    await expect(cityRow(page, 'London').locator('.city-state')).toHaveText('In progress')
    await expect(cityRow(page, 'Paris').locator('.city-state')).toHaveText(/^Completed/)
    await expect(cityRow(page, 'Rome').locator('.city-state')).toHaveText('Locked')
  })

  test('a completed city played again says Rozehráno in its row and keeps its best stars', async ({ page }) => {
    const czech = { locale: 'cs', soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: false, untimed: false, shownHintIds: [] }
    await seedStorage(page, { settings: czech, progress: progressWith(1, 2), 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 0) } })
    await page.goto('/')
    await page.getByRole('button', { name: 'Mapa měst' }).click()
    await expect(cityRow(page, 'Paříž').locator('.city-state')).toHaveText(/^Rozehráno★★☆/)
    await expect(cityRow(page, 'Londýn').locator('.city-state')).toHaveText('Odemčené')
    await cityRow(page, 'Paříž').click()
    await expect(dialog(page, 'Paříž').locator('.city-status')).toHaveText('Rozehraná trasa')
  })

  test('the city with the active run offers Continue without asking', async ({ page }) => {
    await withLondonInProgress(page)
    await cityRow(page, 'London').click()
    await expect(dialog(page, 'London').locator('.city-status')).toHaveText('Route in progress')
    await expect(dialog(page, 'London')).not.toContainText('Not played yet')
    await dialog(page, 'London').getByRole('button', { name: 'Continue' }).click()
    await expect(routeChange(page)).toHaveCount(0)
    await expect(dialog(page, 'Paused')).toBeVisible()
    await expect(page.locator('.play-title')).toHaveText('London · 10/10')
    expect(await recordedEvents(page)).toEqual([{ name: 'route_started', cityId: 'london', mode: 'city', resumed: true }])
  })

  test('Discard and start removes only the active run, reports it abandoned and starts the chosen city', async ({ page }) => {
    await withLondonInProgress(page)
    await cityRow(page, 'Paris').click()
    await dialog(page, 'Paris').getByRole('button', { name: 'Play again' }).click()
    await routeChange(page).getByRole('button', { name: 'Discard and start' }).click()
    await expectState(page, 'question')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
    expect(await recordedEvents(page)).toEqual([
      { name: 'route_left', cityId: 'london', mode: 'city', index: 10, reason: 'abandoned' },
      { name: 'route_started', cityId: 'paris', mode: 'city', resumed: false },
    ])
    expect((await savedSection<{ run: RunState }>(page, 'active-run')).run.cityId).toBe('paris')
    expect(await savedSection(page, 'progress')).toEqual(parisDone)
  })
})

test.describe('map', () => {
  test('the schematic Europe has a target for every city, groups zoom in and Zoom out shows the whole map', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await seedStorage(page, { progress: parisDone })
    await page.goto('/')
    await openMap(page)
    await expect(page.getByRole('img', { name: 'Map of Europe' })).toBeVisible()
    await expect.poll(() => mapCityIds(page)).toEqual(catalog.cities.map((city) => city.id).sort())
    await expect(page.locator('.map-point[data-state="completed"]')).toHaveAccessibleName('Paris, Completed, 0 of 3 stars')

    const group = page.locator('.map-cluster').filter({ has: page.locator('.map-dot', { hasText: /^\d+$/ }) }).first()
    const groupIds = ((await group.getAttribute('data-city-ids')) ?? '').split(' ')
    expect(groupIds.length).toBeGreaterThan(1)
    await expect(group).toHaveAccessibleName(new RegExp(`^${groupIds.length} cities: .+\\. Zoom in$`))
    const pointsBefore = await page.locator('.map-point').count()
    await group.click()
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible()
    // The first city of the group keeps the focus in its new, smaller target.
    await expect(page.locator('.map-point:focus')).toHaveAttribute('data-city-ids', new RegExp(`(^| )${groupIds[0]}( |$)`))
    const shownIds = await mapCityIds(page)
    for (const cityId of groupIds) expect(shownIds).toContain(cityId)
    expect(shownIds.length).toBeLessThan(catalog.cities.length)

    await page.getByRole('button', { name: 'Zoom out' }).click()
    await expect(page.getByRole('button', { name: 'Zoom out' })).toHaveCount(0)
    await expect.poll(() => page.locator('.map-point').count()).toBe(pointsBefore)
  })

  test('the list shows all cities in catalog order with their state in words and stars', async ({ page }) => {
    await seedStorage(page, { progress: { completedCityIds: ['london', 'paris'], bestStars: { london: 2, paris: 3 }, postcardCityIds: ['london', 'paris'] } })
    await page.goto('/')
    await openMap(page)
    await expect(page.locator('.city-name')).toHaveText(cityNames)
    await expect(cityRow(page, 'Paris').locator('.city-state')).toHaveText(/^Completed★★★3 of 3 stars$/)
    await expect(cityRow(page, 'London').locator('.city-state')).toHaveText(/^Completed★★☆2 of 3 stars$/)
    await expect(cityRow(page, 'Rome').locator('.city-state')).toHaveText('Unlocked')
    await expect(cityRow(page, 'Berlin').locator('.city-state')).toHaveText('Locked')
  })

  test('a locked city shows its condition without Play; × returns to the list row', async ({ page }) => {
    await seedStorage(page, { progress: parisDone })
    await page.goto('/')
    await openMap(page)
    await cityRow(page, 'Rome').click()
    const detail = dialog(page, 'Rome')
    await expect(detail).toContainText('Finish London to unlock')
    await expect(detail.locator('.window-body button')).toHaveCount(0)
    await expect(detail.locator('img')).toHaveCount(0)
    await detail.getByRole('button', { name: 'Close' }).click()
    await expect(detail).toHaveCount(0)
    await expect(cityRow(page, 'Rome')).toBeFocused()
  })

  test('an unlocked city opens from the keyboard with its postcard scene and Play; Escape returns', async ({ page }) => {
    await seedStorage(page, { progress: parisDone })
    await page.goto('/')
    await openMap(page)
    await cityRow(page, 'London').focus()
    await page.keyboard.press('Enter')
    const detail = dialog(page, 'London')
    const london = catalog.cities[1]
    await expect(detail.getByRole('img', { name: 'London', exact: true })).toHaveAttribute('src', `/${london.postcard.sceneAsset}`)
    await expect(detail).toContainText('Not played yet')
    await expect(detail.getByRole('button', { name: 'Play', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await expect(cityRow(page, 'London')).toBeFocused()

    await cityRow(page, 'Paris').click()
    await expect(dialog(page, 'Paris').locator('.city-best')).toHaveText(/^Best☆☆☆0\/30 of 3 stars$/)
    await dialog(page, 'Paris').getByRole('button', { name: 'Play again' }).click()
    await expectState(page, 'question')
    await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
    // No window stays over the game, so the question can be answered.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('.choice').first().click()
    await expectState(page, 'result')
  })

  test('Play in the detail of a new city starts it with no window left over the game', async ({ page }) => {
    await seedStorage(page, { progress: parisDone })
    await page.goto('/')
    await openMap(page)
    await cityRow(page, 'London').click()
    await dialog(page, 'London').getByRole('button', { name: 'Play', exact: true }).click()
    await expectState(page, 'question')
    await expect(page.locator('.play-title')).toHaveText('London · 1/10')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.locator('.choice').first().click()
    await expectState(page, 'result')
  })

  test('a route that fails to load from the detail shows its error screen with no window over it', async ({ page }) => {
    await seedStorage(page, { progress: parisDone })
    await page.route('**/src/content/routes/london.json*', (route) => route.abort())
    await page.goto('/')
    await openMap(page)
    await cityRow(page, 'London').click()
    await dialog(page, 'London').getByRole('button', { name: 'Play', exact: true }).click()
    await expectState(page, 'error')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Home' }).click()
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
  })

  test('the map × returns to City map on the title and Home to Play', async ({ page }) => {
    await page.goto('/')
    await openMap(page)
    await expect(page.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'City map' })).toBeFocused()
    await openMap(page)
    await page.getByRole('button', { name: 'Home' }).click()
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
  })

  test.describe('touch', () => {
    test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true })

    test('a city opens by tap from the list and from the map', async ({ page }) => {
      await seedStorage(page, { progress: parisDone })
      await page.goto('/')
      await page.getByRole('button', { name: 'City map' }).tap()
      await cityRow(page, 'London').tap()
      await expect(dialog(page, 'London')).toBeVisible()
      await dialog(page, 'London').getByRole('button', { name: 'Close' }).tap()
      // A group zooms in until Paris has its own target, which opens the detail.
      for (let taps = 0; taps < 4 && !(await dialog(page, 'Paris').isVisible()); taps++) {
        await page.locator('.map-point[data-city-ids~="paris"]').tap()
      }
      await expect(dialog(page, 'Paris')).toBeVisible()
    })
  })
})

test.describe('city summary', () => {
  test('Paris with no correct answer: the summary with 0 stars, the new postcard and London, then Next city starts London', async ({ page }) => {
    await startParis(page)
    await playStops(page, paris.stops, 'wrong')
    await expect(page.getByRole('heading', { name: 'Route complete' })).toBeVisible()
    const summary = page.locator('.summary')
    await expect(summary.locator('.summary-city')).toHaveText('Paris')
    await expect(summary.locator('.summary-stats > div')).toHaveText([/^Score0\/10$/, /^Best streak0$/, /^Stars☆☆☆0\/30 of 3 stars$/])
    const postcard = summary.locator('.summary-postcard')
    await expect(postcard).toHaveAttribute('data-new', '')
    await expect(postcard.locator('figcaption')).toHaveText('New postcard')
    await expect(postcard).toHaveCSS('animation-duration', '0.55s')
    await expect(postcard).toHaveCSS('animation-name', 'postcard-in')
    await expect(postcard.getByRole('img', { name: 'Paris', exact: true })).toBeVisible()
    await expect(summary.locator('.summary-unlocked')).toHaveText('London is unlocked')
    // News, not a control: no fill, no rounded edge and no border around it.
    expect(
      await summary.locator('.summary-unlocked').evaluate((node) => {
        const style = getComputedStyle(node)
        return [style.backgroundColor, style.borderRadius, style.borderLeftStyle, style.borderRightStyle, style.borderBottomStyle, node.tagName]
      }),
    ).toEqual(['rgba(0, 0, 0, 0)', '0px', 'none', 'none', 'none', 'P'])
    await expect(page.getByRole('button', { name: 'Next city' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible()

    await page.getByRole('button', { name: 'Next city' }).click()
    await expectState(page, 'question')
    await expect(page.locator('.play-title')).toHaveText('London · 1/10')
    expect((await recordedEvents(page)).slice(-3)).toEqual([
      { name: 'route_completed', cityId: 'paris', mode: 'city', correct: 0, stars: 0 },
      { name: 'postcard_unlocked', cityId: 'paris' },
      { name: 'route_started', cityId: 'london', mode: 'city', resumed: false },
    ])

    await page.locator('.play-bar').getByRole('button', { name: 'Save and go to Home' }).click()
    await openMap(page)
    await expect(cityRow(page, 'London').locator('.city-state')).toHaveText('In progress')
    await cityRow(page, 'Rome').click()
    await expect(dialog(page, 'Rome')).toContainText('Finish London to unlock')
    await dialog(page, 'Rome').getByRole('button', { name: 'Home' }).click()

    await page.getByRole('button', { name: 'Collection' }).click()
    await expect(page.locator('.collection-count')).toHaveText('1/20 postcards')
    await expect(page.locator('.postcard-card')).toHaveCount(1)
    await expect(page.locator('.postcard-card .postcard-name')).toHaveText('Paris')
  })

  test('a repeat without a new postcard shows it still, without sliding in; Play again starts the city without asking', async ({ page }) => {
    await seedStorage(page, { progress: progressWith(2, 1), 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 9) } })
    await page.goto('/')
    await continueToSummary(page)
    await expect(page.locator('.summary-stats > div')).toHaveText([/^Score9\/10$/, /^Best streak9$/, /^Stars★★★3\/33 of 3 stars$/])
    const postcard = page.locator('.summary-postcard')
    await expect(postcard).not.toHaveAttribute('data-new')
    await expect(postcard).toHaveCSS('animation-name', 'none')
    await expect(postcard.locator('figcaption')).toHaveText('Postcard')
    await expect(page.locator('.summary-unlocked')).toHaveCount(0)
    expect((await recordedEvents(page)).filter((event) => event.name === 'postcard_unlocked')).toEqual([])

    await page.getByRole('button', { name: 'Play again' }).click()
    await expect(routeChange(page)).toHaveCount(0)
    await expectState(page, 'question')
    await expect(page.locator('.play-title')).toHaveText('Paris · 1/10')
  })

  test('after the last city the primary action is Map; × leads to the title', async ({ page }) => {
    await seedStorage(page, { progress: progressWith(19, 2), 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('reykjavik', 3) } })
    await page.goto('/')
    await continueToSummary(page)
    await expect(page.locator('.summary-stats > div').last()).toHaveText(/^Stars☆☆☆0\/30 of 3 stars$/)
    await expect(page.getByRole('button', { name: 'Next city' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'City map' })).toBeVisible()
    await expect(cityRow(page, 'Reykjavík').locator('.city-state')).toHaveText(/^Completed/)

    await page.goto('/')
    await expect(page.locator('.title-progress li')).toHaveText(['20/20 cities', /^38\/60 ★/, '20 postcards'])
  })

  for (const [leave, loaded] of [
    ['Escape', 'loads'],
    ['×', 'loads'],
    ['Home', 'fails'],
  ] as const) {
    test(`${leave} while Next city loads its route stays on the title and starts no run when the route ${loaded}`, async ({ page }) => {
      let releaseRoute = () => undefined as void
      const routeRequested = new Promise<void>((requested) => {
        void page.route('**/src/content/routes/london.json*', (route) => {
          requested()
          releaseRoute = () => void (loaded === 'loads' ? route.continue() : route.abort())
        })
      })
      await seedStorage(page, { progress: parisDone, 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 4) } })
      await page.goto('/')
      await continueToSummary(page)
      await page.getByRole('button', { name: 'Next city' }).click()
      await routeRequested
      await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true')
      if (leave === 'Escape') await page.keyboard.press('Escape')
      else await page.getByRole('button', { name: leave === '×' ? 'Close' : 'Home' }).click()
      await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
      // Nobody waits for the cancelled load, so the title is not busy, while the load itself is still open.
      await expect(page.locator('#app')).not.toHaveAttribute('aria-busy')
      await expect(page.locator('#app')).toHaveAttribute('data-route-loading')

      releaseRoute()
      // The app marks the load until it has handled it, so once it does not, the cancelled start has been decided.
      await expect(page.locator('#app')).not.toHaveAttribute('data-route-loading')
      await expect(page.locator('.play')).toHaveCount(0)
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
      expect(await savedSection(page, 'active-run')).toBeNull()
      expect((await recordedEvents(page)).filter((event) => event.name === 'route_started' && event.cityId === 'london')).toEqual([])
    })
  }

  test('× on the summary goes to the title, which no longer offers Continue', async ({ page }) => {
    await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 4) } })
    await page.goto('/')
    await continueToSummary(page)
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
    await expect(page.locator('.title-progress li')).toHaveText(['1/20 cities', /^1\/60 ★/, '1 postcard'])
  })

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' })

    test('a new postcard appears without sliding in', async ({ page }) => {
      await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 0) } })
      await page.goto('/')
      await continueToSummary(page)
      await expect(page.locator('.summary-postcard')).toHaveAttribute('data-new', '')
      await expect(page.locator('.summary-postcard')).toHaveCSS('animation-name', 'none')
    })
  })

  test('the Reduce motion setting stops the postcard too', async ({ page }) => {
    await seedStorage(page, {
      settings: { locale: 'en', soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: true, untimed: false, shownHintIds: [] },
      'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 0) },
    })
    await page.goto('/')
    await continueToSummary(page)
    await expect(page.locator('.summary-postcard')).toHaveCSS('animation-name', 'none')
  })
})

test.describe('collection', () => {
  test('one place per city; an earned card opens its illustration, city and sentence, a missing one shows only the name', async ({ page }) => {
    await seedStorage(page, { progress: progressWith(2, 1) })
    await page.goto('/')
    await page.getByRole('button', { name: 'Collection' }).click()
    await expect(page.getByRole('heading', { name: 'Collection' })).toBeVisible()
    await expect(page.locator('.collection-count')).toHaveText('2/20 postcards')
    await expect(page.locator('.postcard-slot')).toHaveCount(20)
    await expect(page.locator('.postcard-slot .postcard-name')).toHaveText(cityNames.map((name, index) => (index < 2 ? name : `${name}, not collected yet`)))
    const rome = page.locator('.postcard-slot').nth(2)
    await expect(rome.locator('img, button')).toHaveCount(0)
    await expect(rome).not.toContainText(catalog.cities[2].postcard.sentence.en)

    const londonCard = page.locator('.postcard-card').nth(1)
    await expect(londonCard.locator('img')).toHaveAttribute('src', `/${catalog.cities[1].postcard.sceneAsset}`)
    await londonCard.click()
    const detail = dialog(page, 'London')
    await expect(detail.getByRole('img', { name: 'London', exact: true })).toBeVisible()
    await expect(detail.locator('.postcard-sentence')).toHaveText(catalog.cities[1].postcard.sentence.en)
    await detail.getByRole('button', { name: 'Close' }).click()
    await expect(londonCard).toBeFocused()

    await londonCard.click()
    await page.keyboard.press('Escape')
    await expect(londonCard).toBeFocused()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('button', { name: 'Collection' })).toBeFocused()
  })

  test('the card sentence follows the language', async ({ page }) => {
    await seedStorage(page, {
      progress: progressWith(1, 0),
      settings: { locale: 'cs', soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: false, untimed: false, shownHintIds: [] },
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Sbírka' }).click()
    await expect(page.locator('.collection-count')).toHaveText('1/20 pohlednic')
    await page.locator('.postcard-card').click()
    await expect(dialog(page, 'Paříž').locator('.postcard-sentence')).toHaveText(catalog.cities[0].postcard.sentence.cs)
    await dialog(page, 'Paříž').getByRole('button', { name: 'Úvod' }).click()
    await expect(page.getByRole('button', { name: 'Hrát' })).toBeFocused()
  })
})

for (const [locale, title, count, sentence] of [
  ['en', 'Collection', '0/20 postcards', 'Finish a city route to earn its postcard.'],
  ['cs', 'Sbírka', '0/20 pohlednic', 'Dokonči trasu města a získáš jeho pohlednici.'],
] as const) {
  test(`an empty collection says under the count how to earn a postcard in ${locale}`, async ({ page }) => {
    await seedStorage(page, { settings: { locale, soundEnabled: true, volume: 0.6, vibrationEnabled: true, reducedMotion: false, untimed: false, shownHintIds: [] } })
    await page.goto('/')
    await page.getByRole('button', { name: title }).click()
    await expect(page.locator('.collection-count')).toHaveText(count)
    await expect(page.locator('.collection-count + .collection-empty')).toHaveText(sentence)
  })
}

test('a collection with a postcard has no sentence on how to earn one', async ({ page }) => {
  await seedStorage(page, { progress: progressWith(1, 0) })
  await page.goto('/')
  await page.getByRole('button', { name: 'Collection' }).click()
  await expect(page.locator('.collection-count')).toHaveText('1/20 postcards')
  await expect(page.locator('.collection-empty')).toHaveCount(0)
})

test('with all 20 cities done the collection has 20 postcards, the title 20/20 and 60 stars at most, and Play opens the map', async ({ page }) => {
  await seedStorage(page, { progress: progressWith(20, 3) })
  await page.goto('/')
  await expect(page.locator('.title-progress li')).toHaveText(['20/20 cities', /^60\/60 ★/, '20 postcards'])
  await page.getByRole('button', { name: 'Collection' }).click()
  await expect(page.locator('.collection-count')).toHaveText('20/20 postcards')
  await expect(page.locator('.postcard-card img')).toHaveCount(20)
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('heading', { name: 'City map' })).toBeVisible()
  await expect(page.locator('.city-state')).toHaveText(Array.from({ length: 20 }, () => /^Completed★★★/))
})

test.describe('Escape works like × on every window screen, with the focus on the page', () => {
  async function escapeWithoutFocus(page: Page) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Escape')
  }

  test('map, collection and daily overview return to their title button', async ({ page }) => {
    await seedStorage(page, { progress: parisDone })
    await page.goto('/')
    for (const [opener, heading] of [
      ['City map', 'City map'],
      ['Collection', 'Collection'],
      ['Daily challenge', 'Daily challenge'],
    ]) {
      await page.getByRole('button', { name: opener }).click()
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      await escapeWithoutFocus(page)
      await expect(page.getByRole('heading', { name: heading })).toHaveCount(0)
      await expect(page.getByRole('button', { name: opener })).toBeFocused()
    }
  })

  test('Escape in a city detail closes only the detail, and the map then closes on the next Escape', async ({ page }) => {
    await seedStorage(page, { progress: parisDone })
    await page.goto('/')
    await openMap(page)
    await cityRow(page, 'London').click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'City map' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'City map' })).toBeFocused()
  })

  test('the city summary goes to the title', async ({ page }) => {
    await seedStorage(page, { 'active-run': { ownerTabId: 'closed-tab', run: cityRunBeforeLastNext('paris', 4) } })
    await page.goto('/')
    await continueToSummary(page)
    await expect(page.getByRole('heading', { name: 'Route complete' })).toBeVisible()
    await escapeWithoutFocus(page)
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
  })

  test('the daily summary goes to the title', async ({ page }) => {
    await seedStorage(page, { progress: parisDone, 'active-run': { ownerTabId: 'closed-tab', run: dailyRunBeforeLastNext('2026-12-05', 1) } })
    await page.clock.install({ time: new Date('2026-12-05T08:00:00Z') })
    await page.goto('/')
    await continueToSummary(page)
    await expect(page.getByRole('heading', { name: 'Daily challenge done' })).toBeVisible()
    await escapeWithoutFocus(page)
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
  })
})
