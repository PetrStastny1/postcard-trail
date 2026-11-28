import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { createServer } from 'vite'

const repoRoot = path.resolve(import.meta.dirname, '../..')

describe('loadRoute', async () => {
  // Vite transforms import.meta.glob, so the module runs through a Vite dev server in middleware mode: no port, no browser.
  const server = await createServer({
    root: repoRoot,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, ws: false },
  })
  after(() => server.close())
  const { loadRoute } = (await server.ssrLoadModule('/src/content/index.ts')) as typeof import('../../src/content/index.ts')

  test('returns the route of a known city', async () => {
    const route = await loadRoute('paris')
    assert.equal(route.id, 'paris')
    assert.equal(route.stops.length, 10)
    assert.deepEqual(route, JSON.parse(readFileSync(path.join(repoRoot, 'src/content/routes/paris.json'), 'utf8')))
  })

  test('rejects an unknown city with an error naming its ID', async () => {
    await assert.rejects(loadRoute('nope'), (error: unknown) => error instanceof Error && error.message.includes('nope'))
  })

  // Laziness shows only in the build (build-size.test.ts checks a chunk per route); this guards the glob that makes it.
  test('imports routes through a non-eager glob, so a new route needs no code change', () => {
    const source = readFileSync(path.join(repoRoot, 'src/content/index.ts'), 'utf8')
    assert.match(source, /import\.meta\.glob<Route>\('\.\/routes\/\*\.json'/)
    assert.doesNotMatch(source, /eager/)
    assert.doesNotMatch(source, /from '\.\/routes\//, 'no static route import')
  })
})

test('the first catalog date appears only in src/content/catalog.json and tests', () => {
  const firstDate = JSON.parse(readFileSync(path.join(repoRoot, 'src/content/catalog.json'), 'utf8')).versions[0]
    .effectiveUtcDate as string
  const matches = ['src', 'tools']
    .flatMap((dir) => readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: 'utf8' }).map((file) => path.join(dir, file)))
    .filter((file) => statSync(path.join(repoRoot, file)).isFile() && !file.endsWith('.test.ts'))
    .filter((file) => readFileSync(path.join(repoRoot, file), 'utf8').includes(firstDate))
  assert.deepEqual(matches, ['src/content/catalog.json'])
})
