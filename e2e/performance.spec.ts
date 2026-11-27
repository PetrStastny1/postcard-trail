import { expect, test, type Page, type Response } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build, preview, type PreviewServer, type Rolldown } from 'vite'
import { catalog, correctChoice, paris, readRoute, seedStorage } from './game.ts'
import { dailyPlanOn, progressWith } from './screens.ts'

// D4, brief §14: the production build served by `vite preview`, as a portal or GitHub Pages would serve it.

const repoRoot = path.resolve(import.meta.dirname, '..')
const maxStartBytes = 700_000
const maxBuildBytes = 36_000_000
// The preview takes the port after the dev server's, so worktrees with their own E2E_PORT never meet.
const previewPort = Number(process.env.E2E_PORT ?? '43301') + 1
const origin = `http://127.0.0.1:${previewPort}`
const base = '/postcard-trail/'

let outDir = ''
let server: PreviewServer | undefined
/** Built file names of the route chunks, by city ID. */
const routeChunks = new Map<string, string>()

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(120_000)
  outDir = mkdtempSync(path.join(tmpdir(), 'postcard-trail-dist-'))
  const result = (await build({ root: repoRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } })) as Rolldown.RolldownOutput
  for (const city of catalog.cities) {
    const routeModule = path.join(repoRoot, 'src/content/routes', `${city.id}.json`)
    const chunk = result.output.find((file): file is Rolldown.OutputChunk => file.type === 'chunk' && file.moduleIds.includes(routeModule))
    if (!chunk) throw new Error(`No chunk holds the ${city.id} route.`)
    routeChunks.set(city.id, chunk.fileName)
  }
  server = await preview({ root: repoRoot, logLevel: 'silent', build: { outDir }, preview: { host: '127.0.0.1', port: previewPort, strictPort: true } })
})

test.afterAll(async () => {
  await server?.close()
  if (outDir) rmSync(outDir, { recursive: true, force: true })
})

/** Measurements go to the test output and the report. */
function report(line: string) {
  test.info().annotations.push({ type: 'performance', description: line })
  process.stdout.write(`${line}\n`)
}

const kilobytes = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`

function directoryBytes(directory: string): number {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map((file) => statSync(path.join(directory, file)))
    .filter((stats) => stats.isFile())
    .reduce((total, stats) => total + stats.size, 0)
}

/** Every request the page makes, by path below the base. */
function recordRequests(page: Page): string[] {
  const paths: string[] = []
  page.on('request', (request) => paths.push(new URL(request.url()).pathname.replace(base, '')))
  return paths
}

const routeRequests = (paths: string[]) => [...routeChunks].filter(([, file]) => paths.includes(file)).map(([cityId]) => cityId)
const sceneRequests = (paths: string[]) => [...new Set(paths.filter((file) => file.startsWith('scenes/') && file.endsWith('.webp')).map((file) => path.basename(file, '.webp')))].sort()

test('the start payload of the title stays within 700 kB gzip, the build within 36 MB, and no route or scene loads', async ({ page }) => {
  const responses: Response[] = []
  page.on('response', (response) => responses.push(response))
  const paths = recordRequests(page)
  await page.goto(`${origin}${base}`)
  await expect(page.locator('[data-focus-id="title-play"]')).toBeVisible()
  await page.waitForLoadState('networkidle')

  // Everything the title fetched, each body gzipped as a static host would send it.
  let startBytes = 0
  for (const response of responses) {
    const body = await response.body()
    const gzipped = gzipSync(body).length
    startBytes += gzipped
    report(`  ${new URL(response.url()).pathname}: ${kilobytes(body.length)}, gzip ${kilobytes(gzipped)}`)
  }
  report(`start payload: ${responses.length} files, gzip ${kilobytes(startBytes)} of ${kilobytes(maxStartBytes)}`)
  expect(startBytes).toBeLessThanOrEqual(maxStartBytes)
  expect(routeRequests(paths)).toEqual([])
  expect(sceneRequests(paths)).toEqual([])
  expect(paths.filter((file) => file.includes('placeholders.json'))).toEqual([])

  const buildBytes = directoryBytes(outDir)
  report(`whole build: ${kilobytes(buildBytes)} of ${kilobytes(maxBuildBytes)}`)
  expect(buildBytes).toBeLessThanOrEqual(maxBuildBytes)

  // The entry module the HTML names carries the catalog (with each city's postcard sentence) but no question.
  const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
  const entry = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1]
  expect(entry).toBeDefined()
  const entryCode = readFileSync(path.join(outDir, (entry ?? '').replace(base, '')), 'utf8')
  expect(entryCode).toContain(catalog.cities[0].name.en)
  for (const cityId of ['paris', 'budapest', 'madrid']) {
    for (const stop of readRoute(cityId).stops) {
      for (const text of [stop.question.en, stop.question.cs]) expect(entryCode.includes(text), `the entry chunk contains "${text}"`).toBe(false)
    }
  }
})

test('the route loads only when the run starts, and each stop has fetched exactly the next scene', async ({ page }) => {
  const paths = recordRequests(page)
  await page.goto(`${origin}${base}`)
  await page.locator('[data-focus-id="title-play"]').click()
  for (const [index, stop] of paris.stops.slice(0, 4).entries()) {
    await expect(page.locator('.play')).toHaveAttribute('data-state', 'question')
    await expect(page.locator('.play-title')).toHaveText(`Paris · ${index + 1}/10`)
    const expected = paris.stops.slice(0, index + 2).map((each) => each.id).sort()
    await expect.poll(() => sceneRequests(paths), `scenes during stop ${index + 1}`).toEqual(expected)
    await correctChoice(page, stop).click()
    await page.locator('.next').click()
  }
  expect(routeRequests(paths)).toEqual(['paris'])
})

test('the daily challenge loads its route at Start and preloads only its own next stop', async ({ page }) => {
  const today = '2026-12-05'
  const { plan, stops } = dailyPlanOn(today)
  await seedStorage(page, { progress: progressWith(1, 0) })
  await page.clock.install({ time: new Date(`${today}T08:00:00Z`) })
  const paths = recordRequests(page)
  await page.goto(`${origin}${base}`)
  await page.locator('[data-focus-id="title-daily"]').click()
  await expect(page.locator('[data-focus-id="daily-start"]')).toBeVisible()
  expect(routeRequests(paths)).toEqual([])
  await page.locator('[data-focus-id="daily-start"]').click()
  for (const [index, stop] of stops.entries()) {
    await expect(page.locator('.play')).toHaveAttribute('data-state', 'question')
    await expect(page.locator('.play-title')).toHaveText(new RegExp(`· ${index + 1}/3$`))
    // The third question has no next stop in the challenge, so nothing more is fetched.
    const expected = stops.slice(0, Math.min(index + 2, stops.length)).map((each) => each.id).sort()
    await expect.poll(() => sceneRequests(paths), `scenes during question ${index + 1}`).toEqual(expected)
    await correctChoice(page, stop).click()
    await page.locator('.next').click()
  }
  expect(routeRequests(paths)).toEqual([plan.cityId])
})

test('at 5 Mb/s with 100 ms round trips the title is interactive within 3 s', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 5_000_000 / 8, uploadThroughput: 5_000_000 / 8 })
  const requests = recordRequests(page)
  await page.goto(`${origin}${base}`, { waitUntil: 'commit' })
  // Measured in the page from the start of the navigation to the first frame with Play enabled and the boot screen gone.
  const interactiveMs = await page.waitForFunction(
    () => {
      const play = document.querySelector<HTMLButtonElement>('[data-focus-id="title-play"]')
      return play !== null && !play.disabled && document.getElementById('boot') === null ? performance.now() : null
    },
    undefined,
    { polling: 'raf', timeout: 15_000 },
  )
  const elapsed = Math.round(Number(await interactiveMs.jsonValue()))
  report(`interactive title at 5 Mb/s, 100 ms RTT: ${elapsed} ms after navigation start, ${requests.length} requests`)
  expect(elapsed).toBeLessThanOrEqual(3_000)
})
