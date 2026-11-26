import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import {
  type SceneComposition,
  maxSceneBytes,
  planScenes,
  readPalette,
  readStopIds,
  sceneComposition,
  sceneSize,
} from './placeholders.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const generatorScript = path.join(repoRoot, 'tools/content/placeholders.ts')
const scenesDirectory = path.join(repoRoot, 'public/scenes')
const palette = readPalette()
const stopIds = readStopIds()

const temporaryDirectories: string[] = []
after(() => temporaryDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

/** Generator inputs with a one-city catalog; the generator reads only city and stop IDs. */
function generatorRoot(): string {
  const root = temporaryDirectory('content-placeholders-')
  cpSync(path.join(repoRoot, 'src/styles/tokens.css'), path.join(root, 'src/styles/tokens.css'))
  mkdirSync(path.join(root, 'src/content/routes'), { recursive: true })
  writeFileSync(path.join(root, 'src/content/catalog.json'), JSON.stringify({ cities: [{ id: 'testville' }], versions: [] }))
  writeFileSync(
    path.join(root, 'src/content/routes/testville.json'),
    JSON.stringify({ id: 'testville', stops: [{ id: 'TST01' }, { id: 'TST02' }] }),
  )
  mkdirSync(path.join(root, 'public/scenes'), { recursive: true })
  return root
}

/** Runs the CLI with an empty Playwright browser folder, so a test can never start Chromium. */
function runGenerator(root: string) {
  return spawnSync(process.execPath, [generatorScript, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: temporaryDirectory('no-browsers-') },
  })
}

function textsOf(composition: SceneComposition): string[] {
  return composition.shapes.flatMap((shape) => (shape.kind === 'text' ? [shape.text] : []))
}

function coloursOf(composition: SceneComposition): string[] {
  return composition.shapes.flatMap((shape) => (shape.kind === 'gradient' ? [shape.from, shape.to] : [shape.color]))
}

function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => (key === 'kind' ? [] : stringsOf(nested)))
  }
  return []
}

/** Width and height from the VP8, VP8L or VP8X header that follows `RIFF....WEBP`. */
function webpSize(file: Buffer): { width: number; height: number } {
  const chunk = file.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return { width: file.readUIntLE(24, 3) + 1, height: file.readUIntLE(27, 3) + 1 }
  if (chunk === 'VP8 ') return { width: file.readUInt16LE(26) & 0x3fff, height: file.readUInt16LE(28) & 0x3fff }
  if (chunk === 'VP8L') {
    const bits = file.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  throw new Error(`unknown WebP chunk "${chunk}"`)
}

describe('scene composition', () => {
  test('uses exactly the BRIEF §9 illustration palette from tokens.css', () => {
    const brief = readFileSync(path.join(repoRoot, 'docs/game/BRIEF.md'), 'utf8')
    const illustrationSection = brief.slice(brief.indexOf('### Ilustrace'), brief.indexOf('### Rozhraní'))
    const briefColours = [...illustrationSection.matchAll(/#[0-9A-Fa-f]{6}/g)].map((match) => match[0].toLowerCase())
    assert.equal(briefColours.length, 13)
    assert.deepEqual(new Set(Object.values(palette)), new Set(briefColours))
  })

  test('draws only palette colours and only the stop ID as text, for every stop', () => {
    const paletteColours = new Set(Object.values(palette))
    for (const stopId of stopIds) {
      const composition = sceneComposition(stopId, palette)
      assert.equal(composition.size, sceneSize)
      assert.deepEqual(textsOf(composition), [stopId])
      const strings = stringsOf(composition)
      assert.deepEqual(
        strings.filter((value) => value !== stopId && !paletteColours.has(value)),
        [],
        `${stopId} has a string that is neither its ID nor a palette colour`,
      )
      assert.ok(coloursOf(composition).every((colour) => paletteColours.has(colour)))
    }
  })

  test('is the same for the same ID and different for every other ID', () => {
    assert.deepEqual(sceneComposition('PAR01', palette), sceneComposition('PAR01', palette))
    assert.notDeepEqual(sceneComposition('PAR01', palette), sceneComposition('PAR02', palette))
    const distinct = new Set(stopIds.map((stopId) => JSON.stringify(sceneComposition(stopId, palette).shapes.slice(0, -1))))
    assert.equal(distinct.size, stopIds.length, 'every stop has its own backdrop, not only its own label')
  })

  test('puts the label on a plate that stands out from the ground under it', () => {
    for (const stopId of stopIds) {
      const { shapes } = sceneComposition(stopId, palette)
      const plateIndex = shapes.findIndex((shape) => shape.kind === 'roundedRect')
      const plate = shapes[plateIndex]
      const label = shapes[plateIndex + 1]
      const ground = shapes
        .slice(0, plateIndex)
        .findLast((shape) => shape.kind === 'rect' && shape.x === 0 && shape.width === sceneSize && shape.y + shape.height === sceneSize)
      assert.ok(plate.kind === 'roundedRect' && label.kind === 'text' && ground?.kind === 'rect', stopId)
      assert.notEqual(plate.color, ground.color, `${stopId} plate blends into the ground`)
      assert.notEqual(label.color, plate.color, stopId)
    }
  })

  test('does not call Math.random', () => {
    const source = readFileSync(generatorScript, 'utf8')
    assert.doesNotMatch(source, /Math\.random/)
  })
})

describe('scene plan', () => {
  test('draws stops without a file and listed placeholders, keeps final scenes out of the list', () => {
    const plan = planScenes(['A01', 'A02', 'A03'], ['A02'], ['A01.webp', 'A02.webp', 'placeholders.json'])
    assert.deepEqual(plan, { placeholders: ['A02', 'A03'], remove: [], unknownFiles: [] })
  })

  test('removes listed placeholders outside the catalog and reports final or foreign files outside it', () => {
    const plan = planScenes(['A01'], ['A01', 'OLD01'], ['A01.webp', 'OLD01.webp', 'GONE01.webp', 'notes.txt'])
    assert.deepEqual(plan, { placeholders: ['A01'], remove: ['OLD01'], unknownFiles: ['GONE01.webp', 'notes.txt'] })
  })

  test('ignores hidden files such as .DS_Store', () => {
    const plan = planScenes(['A01'], [], ['.DS_Store', '.A01.webp.swp', '.hidden.webp'])
    assert.deepEqual(plan, { placeholders: ['A01'], remove: [], unknownFiles: [] })
  })
})

describe('placeholders CLI', () => {
  test('keeps final scenes, removes stale placeholders and starts no browser when nothing is placeholder', () => {
    const root = generatorRoot()
    const scenes = path.join(root, 'public/scenes')
    writeFileSync(path.join(scenes, 'TST01.webp'), 'final TST01')
    writeFileSync(path.join(scenes, 'TST02.webp'), 'final TST02')
    writeFileSync(path.join(scenes, 'OLD01.webp'), 'stale placeholder')
    writeFileSync(path.join(scenes, 'placeholders.json'), `${JSON.stringify({ stopIds: ['OLD01'] })}\n`)

    const result = runGenerator(root)

    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(path.join(scenes, 'TST01.webp'), 'utf8'), 'final TST01')
    assert.equal(readFileSync(path.join(scenes, 'TST02.webp'), 'utf8'), 'final TST02')
    assert.equal(existsSync(path.join(scenes, 'OLD01.webp')), false)
    assert.equal(readFileSync(path.join(scenes, 'placeholders.json'), 'utf8'), '{\n  "stopIds": []\n}\n')
  })

  test('fails on a final scene outside the catalog, lists it and changes nothing', () => {
    const root = generatorRoot()
    const scenes = path.join(root, 'public/scenes')
    writeFileSync(path.join(scenes, 'GONE01.webp'), 'final scene of a removed stop')

    const result = runGenerator(root)

    assert.equal(result.status, 1)
    assert.match(result.stderr, /public\/scenes\/GONE01\.webp: not a scene of a catalog stop/)
    assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace')
    assert.deepEqual(readdirSync(scenes), ['GONE01.webp'])
  })

  for (const [label, content, message] of [
    ['invalid JSON', '{ "stopIds": [', /placeholders\.json: not valid JSON/],
    ['no stopIds', '{}\n', /placeholders\.json: expected \{ "stopIds": string\[\] \}/],
    ['stopIds of numbers', '{ "stopIds": [1] }\n', /placeholders\.json: expected \{ "stopIds": string\[\] \}/],
  ] as const) {
    test(`fails readably on a placeholders.json with ${label} and changes nothing`, () => {
      const root = generatorRoot()
      const scenes = path.join(root, 'public/scenes')
      writeFileSync(path.join(scenes, 'placeholders.json'), content)

      const result = runGenerator(root)

      assert.equal(result.status, 1)
      assert.match(result.stderr, message)
      assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace')
      assert.deepEqual(readdirSync(scenes), ['placeholders.json'])
      assert.equal(readFileSync(path.join(scenes, 'placeholders.json'), 'utf8'), content)
    })
  }

  test('ignores a .DS_Store in the scenes folder', () => {
    const root = generatorRoot()
    const scenes = path.join(root, 'public/scenes')
    writeFileSync(path.join(scenes, '.DS_Store'), 'finder metadata')
    writeFileSync(path.join(scenes, 'TST01.webp'), 'final TST01')
    writeFileSync(path.join(scenes, 'TST02.webp'), 'final TST02')

    const result = runGenerator(root)

    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(path.join(scenes, '.DS_Store'), 'utf8'), 'finder metadata')
    assert.equal(readFileSync(path.join(scenes, 'placeholders.json'), 'utf8'), '{\n  "stopIds": []\n}\n')
  })

  test('without Chromium fails readably with the install command and writes nothing', () => {
    const root = generatorRoot()

    const result = runGenerator(root)

    assert.equal(result.status, 1)
    assert.match(result.stderr, /npx playwright install chromium/)
    assert.doesNotMatch(result.stderr, /\n\s+at /, 'no stack trace')
    assert.deepEqual(readdirSync(path.join(root, 'public/scenes')), [])
  })
})

describe('committed scenes', () => {
  const listing = readFileSync(path.join(scenesDirectory, 'placeholders.json'), 'utf8')
  const listed = (JSON.parse(listing) as { stopIds: string[] }).stopIds

  // Delivering a final scene removes its ID from the list, so the list is any catalog-ordered subset, not all stops.
  test('list placeholders as catalog stops in catalog order without duplicates and with a final newline', () => {
    assert.equal(stopIds.length, 200)
    assert.equal(new Set(listed).size, listed.length, 'no duplicates')
    const catalogPositions = listed.map((stopId) => stopIds.indexOf(stopId))
    assert.deepEqual(
      listed.filter((_, index) => catalogPositions[index] === -1),
      [],
      'every listed ID is a catalog stop',
    )
    assert.ok(
      catalogPositions.every((position, index) => index === 0 || position > catalogPositions[index - 1]),
      'listed IDs follow catalog order',
    )
    assert.ok(listing.endsWith('\n'))
    assert.ok(!listing.endsWith('\n\n'))
  })

  test('are a 1280 × 1280 WebP of at most 150 kB for every stop and nothing else', () => {
    assert.deepEqual(
      readdirSync(scenesDirectory)
        .filter((file) => !file.startsWith('.'))
        .sort(),
      [...stopIds.map((stopId) => `${stopId}.webp`), 'placeholders.json'].sort(),
    )
    for (const stopId of stopIds) {
      const scene = readFileSync(path.join(scenesDirectory, `${stopId}.webp`))
      assert.equal(scene.toString('ascii', 0, 4), 'RIFF', stopId)
      assert.equal(scene.toString('ascii', 8, 12), 'WEBP', stopId)
      assert.deepEqual(webpSize(scene), { width: sceneSize, height: sceneSize }, stopId)
      assert.ok(scene.length <= maxSceneBytes, `${stopId} has ${scene.length} bytes`)
    }
  })
})
