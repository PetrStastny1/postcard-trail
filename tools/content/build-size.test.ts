import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { type Rolldown, build } from 'vite'
import type { Catalog, Route } from '../../src/content/types.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')
// BRIEF §14 counts the whole first-version build, 200 scenes included, in decimal megabytes.
const maxBuildBytes = 36_000_000

const catalog = JSON.parse(readFileSync(path.join(repoRoot, 'src/content/catalog.json'), 'utf8')) as Catalog
const readRoute = (cityId: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, 'src/content/routes', `${cityId}.json`), 'utf8')) as Route

const workDirectory = mkdtempSync(path.join(tmpdir(), 'content-build-'))
after(() => rmSync(workDirectory, { recursive: true, force: true }))

function directoryBytes(directory: string): number {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map((file) => statSync(path.join(directory, file)))
    .filter((stats) => stats.isFile())
    .reduce((total, stats) => total + stats.size, 0)
}

function kilobytes(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`
}

test('the build splits every route into its own chunk and stays within 36 MB with all scenes', async (t) => {
  const entry = path.join(workDirectory, 'entry.ts')
  const outDir = path.join(workDirectory, 'dist')
  writeFileSync(
    entry,
    [
      `import { catalog } from ${JSON.stringify(path.join(repoRoot, 'src/content/catalog.ts'))}`,
      `import { loadRoute } from ${JSON.stringify(path.join(repoRoot, 'src/content/index.ts'))}`,
      'document.title = catalog.cities[0].name.en',
      'void loadRoute(catalog.cities[0].id).then((route) => { document.body.dataset.stops = String(route.stops.length) })',
    ].join('\n'),
  )

  const result = await build({
    root: repoRoot,
    configFile: false,
    logLevel: 'silent',
    publicDir: path.join(repoRoot, 'public'),
    build: { outDir, emptyOutDir: true, reportCompressedSize: false, rolldownOptions: { input: entry } },
  })
  const output = (result as Rolldown.RolldownOutput).output
  const chunks = output.filter((file): file is Rolldown.OutputChunk => file.type === 'chunk')

  const routeChunks = catalog.cities.map((city) => {
    const routeModule = path.join(repoRoot, 'src/content/routes', `${city.id}.json`)
    const containing = chunks.filter((chunk) => chunk.moduleIds.includes(routeModule))
    assert.equal(containing.length, 1, `${city.id} is in exactly one chunk`)
    assert.equal(containing[0].isEntry, false, `${city.id} is not in the entry chunk`)
    return containing[0].fileName
  })
  assert.equal(new Set(routeChunks).size, 20, 'every route has its own chunk')

  const entryChunks = chunks.filter((chunk) => chunk.isEntry)
  assert.equal(entryChunks.length, 1)
  const entryCode = entryChunks[0].code
  const paris01 = readRoute('paris').stops.find((stop) => stop.id === 'PAR01')
  const budapest09 = readRoute('budapest').stops.find((stop) => stop.id === 'B09')
  assert.ok(paris01 && budapest09)
  for (const routeText of [paris01.question.en, paris01.question.cs, budapest09.question.en, budapest09.question.cs]) {
    assert.ok(entryCode.includes(routeText) === false, `the entry chunk contains "${routeText}"`)
  }
  assert.ok(entryCode.includes(catalog.cities[0].name.en), 'the catalog is in the entry chunk')

  const scenes = readdirSync(path.join(outDir, 'scenes')).filter((file) => file.endsWith('.webp'))
  assert.equal(scenes.length, 200)
  const entryGzipBytes = gzipSync(entryCode).length
  const sceneBytes = directoryBytes(path.join(outDir, 'scenes'))
  const buildBytes = directoryBytes(outDir)
  t.diagnostic(`entry chunk: ${kilobytes(Buffer.byteLength(entryCode))}, gzip ${kilobytes(entryGzipBytes)}`)
  t.diagnostic(`route chunks: ${routeChunks.length}`)
  t.diagnostic(`scenes: ${scenes.length} files, ${kilobytes(sceneBytes)}`)
  t.diagnostic(`whole build: ${kilobytes(buildBytes)} of ${kilobytes(maxBuildBytes)}`)
  assert.ok(buildBytes <= maxBuildBytes, `the build has ${buildBytes} bytes`)
})
