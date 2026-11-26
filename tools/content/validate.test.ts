import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { constants, cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import type { Catalog, Route, Stop } from '../../src/content/types.ts'
import { readContent } from './import.ts'
import { countryQuestionStopIds, validateContent } from './validate.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const validateScript = path.join(repoRoot, 'tools/content/validate.ts')
const routesDir = 'src/content/routes'
const catalogPath = 'src/content/catalog.json'
const scenesDir = 'public/scenes'
const placeholdersPath = 'public/scenes/placeholders.json'

const temporaryRoots: string[] = []
after(() => temporaryRoots.forEach((root) => rmSync(root, { recursive: true, force: true })))

/** A copy of everything the validator reads, without src/i18n. */
function copyContent(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'content-validate-'))
  temporaryRoots.push(root)
  for (const relativePath of ['docs/game', routesDir, catalogPath, 'tools/content/city-coordinates.json', scenesDir]) {
    // Copy-on-write clones where the file system supports them keep the 200 scenes cheap to copy.
    cpSync(path.join(repoRoot, relativePath), path.join(root, relativePath), { recursive: true, mode: constants.COPYFILE_FICLONE })
  }
  return root
}

function readJson<T>(root: string, relativePath: string): T {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as T
}

function writeJson(root: string, relativePath: string, value: unknown) {
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true })
  writeFileSync(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`)
}

function editRoute(root: string, cityId: string, edit: (route: Route) => void) {
  const route = readJson<Route>(root, `${routesDir}/${cityId}.json`)
  edit(route)
  writeJson(root, `${routesDir}/${cityId}.json`, route)
}

function editStop(root: string, cityId: string, stopId: string, edit: (stop: Stop) => void) {
  editRoute(root, cityId, (route) => edit(route.stops.find((stop) => stop.id === stopId) as Stop))
}

function editCatalog(root: string, edit: (catalog: Catalog) => void) {
  const catalog = readJson<Catalog>(root, catalogPath)
  edit(catalog)
  writeJson(root, catalogPath, catalog)
}

/** Problems after the edit, without the reminders that committed data no longer match the city files. */
function factProblems(root: string): string[] {
  return validateContent(root).filter((problem) => !problem.endsWith('run npm run content:import'))
}

function scenePath(root: string, stopId: string): string {
  return path.join(root, scenesDir, `${stopId}.webp`)
}

/** A file made of `RIFF`, its size, `WEBP` and the given chunks, so the RIFF header always matches the length. */
function riffWebp(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks])
  const header = Buffer.alloc(8)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

function riffChunk(name: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(name, 0, 'latin1')
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

/** The header of a lossy VP8 frame: frame tag, start code 9d 01 2a, then 14-bit width and height. */
function vp8Header(width: number, height: number, startCode = [0x9d, 0x01, 0x2a]): Buffer {
  const payload = Buffer.alloc(10)
  Buffer.from(startCode).copy(payload, 3)
  payload.writeUInt16LE(width, 6)
  payload.writeUInt16LE(height, 8)
  return riffChunk('VP8 ', payload)
}

/** The header of a lossless VP8L frame: signature 0x2f, then width − 1 and height − 1 in 14 bits each. */
function vp8lHeader(width: number, height: number, signature = 0x2f): Buffer {
  const payload = Buffer.alloc(5)
  payload[0] = signature
  payload.writeUInt32LE((width - 1) | ((height - 1) << 14), 1)
  return riffChunk('VP8L', payload)
}

function runValidator(root: string) {
  return spawnSync(process.execPath, [validateScript, '--root', root], { encoding: 'utf8' })
}

describe('the validator as a process', () => {
  test('passes an untouched copy of the content with exit code 0', () => {
    const result = runValidator(copyContent())
    assert.equal(result.stderr, '')
    assert.equal(result.status, 0)
  })

  test('fails broken content with exit code 1, one problem per line and no stack trace', () => {
    const root = copyContent()
    editRoute(root, 'paris', (route) => {
      route.stops.pop()
    })
    writeFileSync(path.join(root, routesDir, 'rome.json'), '{ "id": "rome", ')
    const result = runValidator(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /^Content validation failed:\n/)
    assert.match(result.stderr, /^src\/content\/routes\/rome\.json: invalid JSON \(.+\)$/m)
    assert.doesNotMatch(result.stderr, /^\s+at /m)
  })

  test('reports a catalog that is a directory without a stack trace', () => {
    const root = copyContent()
    rmSync(path.join(root, catalogPath))
    mkdirSync(path.join(root, catalogPath))
    const result = runValidator(root)
    assert.equal(result.status, 1)
    assert.equal(result.stderr, 'Content validation failed:\nsrc/content/catalog.json: cannot read (EISDIR)\n')
  })

  test('reports a missing data folder without a stack trace', () => {
    const result = runValidator(path.join(copyContent(), 'missing'))
    assert.equal(result.status, 1)
    assert.equal(
      result.stderr,
      'Content validation failed:\nsrc/content/catalog.json: file not found\nsrc/content/routes: directory not found\n',
    )
  })

  test('fails a broken scene with exit code 1 and the stop ID and size, without a stack trace', () => {
    const root = copyContent()
    writeFileSync(scenePath(root, 'PAR01'), riffWebp(vp8Header(1280, 720)))
    const result = runValidator(root)
    assert.equal(result.status, 1)
    assert.equal(
      result.stderr,
      'Content validation failed:\nparis PAR01: scene public/scenes/PAR01.webp is 1280 × 720, expected 1280 × 1280\n',
    )
  })
})

describe('the committed content', () => {
  test('has no problems', () => {
    assert.deepEqual(validateContent(), [])
  })

  test('asks about a country or a flag only in PAR02 and P01', () => {
    assert.deepEqual(countryQuestionStopIds(readContent().routes), ['PAR02', 'P01'])
  })
})

describe('structure', () => {
  test('invalid JSON in the catalog is reported', () => {
    const root = copyContent()
    writeFileSync(path.join(root, catalogPath), '[')
    assert.match(validateContent(root).join('\n'), /^src\/content\/catalog\.json: invalid JSON \(.+\)$/)
  })

  test('wrong field types are reported before and instead of the fact checks', () => {
    const root = copyContent()
    editRoute(root, 'paris', (route) => {
      Object.assign(route, { coordinates: { lat: '48.8', lon: 2.3 } })
      Object.assign(route.stops[0], { question: { en: 'Where?' }, choices: route.stops[0].choices.slice(0, 3) })
      Object.assign(route.stops[1], { sourceUrls: 'https://example.org', distinguishingFeature: 3 })
      Object.assign(route.stops[2].choices[1], { label: 'Seine' })
      route.stops.push('PAR11' as unknown as Stop)
    })
    editCatalog(root, (catalog) => Object.assign(catalog.versions[0], { orderedCityIds: 'paris' }))
    assert.deepEqual(validateContent(root), [
      'catalog versions[0]: "orderedCityIds" must be an array of strings',
      'paris: "coordinates" must be an object with numeric "lat" and "lon"',
      'paris PAR01: "question.cs" must be a string',
      'paris PAR01: "choices" must be an array of exactly 4 choices',
      'paris PAR02: "sourceUrls" must be an array of strings',
      'paris PAR02: "distinguishingFeature" must be a string',
      'paris PAR03: "choices[1].label" must be an object with "en" and "cs" strings',
      'paris stops[10]: stop must be an object',
    ])
  })

  test('a routes path that is a file is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, routesDir), { recursive: true })
    writeFileSync(path.join(root, routesDir), '')
    assert.deepEqual(validateContent(root), ['src/content/routes: cannot read (ENOTDIR)'])
  })

  test('a catalog without cities is reported', () => {
    const root = copyContent()
    writeJson(root, catalogPath, { versions: [] })
    assert.deepEqual(validateContent(root), ['catalog: "cities" must be an array'])
  })
})

describe('route files', () => {
  test('a missing routes folder is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, routesDir), { recursive: true })
    assert.deepEqual(validateContent(root), ['src/content/routes: directory not found'])
  })

  test('a missing route file is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, routesDir, 'oslo.json'))
    const problems = factProblems(root)
    assert.ok(problems.includes('src/content/routes: found 19 routes, the catalog lists 20 cities'))
    assert.ok(problems.includes('oslo: catalog city has no file src/content/routes/oslo.json'))
  })

  test('a route file outside the catalog is reported', () => {
    const root = copyContent()
    const tallinn = readJson<Route>(root, `${routesDir}/oslo.json`)
    tallinn.id = 'tallinn'
    tallinn.postcardQuestionId = tallinn.postcardQuestionId.replace('OSL', 'TAL')
    tallinn.stops.forEach((stop) => {
      stop.id = stop.id.replace('OSL', 'TAL')
      stop.sceneAsset = `scenes/${stop.id}.webp`
    })
    writeJson(root, `${routesDir}/tallinn.json`, tallinn)
    const problems = factProblems(root)
    assert.ok(problems.includes('src/content/routes: found 21 routes, the catalog lists 20 cities'))
    assert.ok(problems.includes('tallinn: route file is not a city of the catalog'))
  })

  test('a file name different from the route id is reported', () => {
    const root = copyContent()
    renameSync(path.join(root, routesDir, 'oslo.json'), path.join(root, routesDir, 'osl.json'))
    const problems = factProblems(root)
    assert.ok(problems.includes('osl: route id "oslo" differs from its file name'))
    assert.ok(problems.includes('oslo: catalog city has no file src/content/routes/oslo.json'))
  })
})

describe('catalog', () => {
  test('cities out of the BRIEF §5 order are reported', () => {
    const root = copyContent()
    editCatalog(root, (catalog) => {
      catalog.cities.reverse()
    })
    const problems = validateContent(root)
    assert.ok(problems.some((problem) => problem.startsWith('catalog: cities must be paris, london, rome, ')))
    assert.ok(problems.includes('catalog: the latest version must list the catalog cities in the same order'))
  })

  test('a catalog without 20 cities is reported', () => {
    const root = copyContent()
    editCatalog(root, (catalog) => {
      catalog.cities.pop()
      catalog.versions[0].orderedCityIds.pop()
    })
    rmSync(path.join(root, routesDir, 'reykjavik.json'))
    assert.ok(validateContent(root).includes('catalog: expected 20 cities, found 19'))
  })

  test('versions out of date order, with an invalid date or not only adding cities are reported', () => {
    const root = copyContent()
    editCatalog(root, (catalog) => {
      const cityIds = catalog.versions[0].orderedCityIds
      catalog.versions = [
        { effectiveUtcDate: '2026-02-30', orderedCityIds: cityIds.slice(0, 2) },
        { effectiveUtcDate: '2026-01-01', orderedCityIds: [cityIds[1], cityIds[0], cityIds[2]] },
        { effectiveUtcDate: '2026-03-01', orderedCityIds: cityIds.slice(0, 19) },
      ]
    })
    assert.deepEqual(factProblems(root), [
      'catalog versions[0]: effectiveUtcDate "2026-02-30" is not a valid YYYY-MM-DD date',
      'catalog versions[1]: effectiveUtcDate must be after 2026-02-30',
      'catalog versions[1]: must keep versions[0] and only add cities at the end',
      'catalog versions[2]: must keep versions[1] and only add cities at the end',
      'catalog: the latest version must list the catalog cities in the same order',
    ])
  })

  test('a catalog without versions is reported', () => {
    const root = copyContent()
    editCatalog(root, (catalog) => {
      catalog.versions = []
    })
    assert.deepEqual(factProblems(root), ['catalog: "versions" must contain at least one version'])
  })

  test('a postcard that does not match the postcard stop is reported', () => {
    const root = copyContent()
    editCatalog(root, (catalog) => {
      const [paris, london, rome] = catalog.cities
      paris.postcard.stopId = 'PAR02'
      london.postcard.sceneAsset = 'scenes/LON01.webp'
      rome.postcard.sentence = { ...rome.postcard.sentence, cs: 'Jiná věta.' }
    })
    assert.deepEqual(factProblems(root), [
      'catalog paris: postcard stop PAR02 differs from postcardQuestionId PAR01',
      'catalog london: postcard sceneAsset differs from stop LON10',
      'catalog rome: postcard sentence differs from the feedback of stop ROM01',
    ])
  })

  test('coordinates outside Europe and a name different from the route are reported', () => {
    const root = copyContent()
    editCatalog(root, (catalog) => {
      catalog.cities[0].coordinates = { lat: 33.9, lon: 2.35 }
      catalog.cities[1].coordinates = { lat: 51.5, lon: 50.1 }
      catalog.cities[2].name = { en: 'Roma', cs: 'Řím' }
    })
    assert.deepEqual(factProblems(root), [
      'catalog paris: coordinates 33.9, 2.35 lie outside Europe (lat 34–72, lon −25–50)',
      'catalog london: coordinates 51.5, 50.1 lie outside Europe (lat 34–72, lon −25–50)',
      'catalog rome: name differs from the route',
    ])
  })
})

describe('routes and stops', () => {
  test('a route without ten stops is reported', () => {
    const root = copyContent()
    editRoute(root, 'rome', (route) => {
      route.stops.pop()
    })
    assert.deepEqual(factProblems(root), [
      'rome: expected 10 stops, found 9',
      'public/scenes/ROM10.webp: not the scene of a catalog stop',
      'public/scenes/placeholders.json: ROM10 is not a catalog stop',
    ])
  })

  test('a stop ID used twice across routes or not matching the pattern is reported', () => {
    const root = copyContent()
    editStop(root, 'rome', 'ROM05', (stop) => {
      stop.id = 'PAR05'
      stop.sceneAsset = 'scenes/PAR05.webp'
    })
    editStop(root, 'rome', 'ROM06', (stop) => {
      stop.id = 'rom6'
      stop.sceneAsset = 'scenes/rom6.webp'
    })
    assert.deepEqual(factProblems(root), [
      'rome PAR05: duplicate stop ID',
      'rome rom6: stop ID must match /^[A-Z]+[0-9]{2}$/',
      'rome rom6: scene public/scenes/rom6.webp not found',
      'public/scenes/ROM05.webp: not the scene of a catalog stop',
      'public/scenes/ROM06.webp: not the scene of a catalog stop',
      'public/scenes/placeholders.json: ROM05 is not a catalog stop',
      'public/scenes/placeholders.json: ROM06 is not a catalog stop',
    ])
  })

  test('a postcard question outside the route is reported', () => {
    const root = copyContent()
    editRoute(root, 'rome', (route) => {
      route.postcardQuestionId = 'PAR01'
    })
    assert.deepEqual(factProblems(root), ['rome: postcardQuestionId PAR01 is not a stop of this route'])
  })

  test('difficulty out of route order and an expert stop without a distinguishing feature are reported', () => {
    const root = copyContent()
    editStop(root, 'rome', 'ROM04', (stop) => {
      stop.difficulty = 'hard'
    })
    editStop(root, 'rome', 'ROM09', (stop) => {
      stop.distinguishingFeature = ' '
    })
    editStop(root, 'rome', 'ROM10', (stop) => {
      delete stop.distinguishingFeature
    })
    assert.deepEqual(factProblems(root), [
      'rome ROM04: stop 4 must be "easy", found "hard"',
      'rome ROM09: expert stop needs a non-empty distinguishingFeature',
      'rome ROM10: expert stop needs a non-empty distinguishingFeature',
    ])
  })

  test('duplicate choice IDs, duplicate or empty labels and a correct choice outside the choices are reported', () => {
    const root = copyContent()
    editStop(root, 'rome', 'ROM02', (stop) => {
      stop.choices[1].id = stop.choices[0].id
    })
    editStop(root, 'rome', 'ROM03', (stop) => {
      stop.choices[1].label.en = stop.choices[0].label.en
      stop.choices[2].label.cs = ' '
    })
    editStop(root, 'rome', 'ROM05', (stop) => {
      stop.correctChoiceId = 'z'
    })
    assert.deepEqual(factProblems(root), [
      'rome ROM02: choice IDs must be four distinct values',
      'rome ROM03: en choice labels must be four distinct values',
      'rome ROM03: cs choice labels must not be empty',
      'rome ROM05: correct choice "z" is not among the choices',
    ])
  })

  test('a wrong scene path, missing or non-https sources, an invalid date and a wrong stability are reported', () => {
    const root = copyContent()
    editStop(root, 'rome', 'ROM02', (stop) => {
      stop.sceneAsset = 'scenes/ROM02.png'
      stop.sourceUrls = []
      stop.photoReferenceUrls = ['http://example.org/photo']
    })
    editStop(root, 'rome', 'ROM03', (stop) => {
      stop.verifiedOn = '2026-11-31'
      Object.assign(stop, { stability: 'fixed' })
    })
    editStop(root, 'rome', 'ROM05', (stop) => {
      stop.stability = 'changeable'
    })
    editStop(root, 'rome', 'ROM06', (stop) => {
      stop.changeableFact = 'opening hours'
    })
    assert.deepEqual(factProblems(root), [
      'rome ROM02: sceneAsset must be "scenes/ROM02.webp", found "scenes/ROM02.png"',
      'rome ROM02: sourceUrls must contain at least one https:// address',
      'rome ROM02: photoReferenceUrls entry "http://example.org/photo" is not an https:// address',
      'rome ROM03: verifiedOn "2026-11-31" is not a valid YYYY-MM-DD date',
      'rome ROM03: stability must be "stable" or "changeable", found "fixed"',
      'rome ROM05: changeable stop needs a non-empty changeableFact',
      'rome ROM06: changeableFact is allowed only on a changeable stop',
    ])
  })
})

describe('B09', () => {
  test('a different question, choice order or correct line is reported', () => {
    const root = copyContent()
    editStop(root, 'budapest', 'B09', (stop) => {
      stop.question.cs = 'Na kterou linku metra čekáš?'
      stop.choices.reverse()
    })
    assert.deepEqual(factProblems(root), [
      'budapest B09: en choices must be M1, M2, M3, M4 in this order',
      'budapest B09: question.cs must be exactly "Na kterou linku metra právě čekáš?"',
      'budapest B09: cs choices must be M1, M2, M3, M4 in this order',
      'budapest B09: the correct choice must be M1',
    ])
  })

  test('a missing B09 is reported', () => {
    const root = copyContent()
    editStop(root, 'budapest', 'B09', (stop) => {
      stop.id = 'B11'
      stop.sceneAsset = 'scenes/B11.webp'
    })
    assert.deepEqual(factProblems(root), [
      'B09: stop not found',
      'budapest B11: scene public/scenes/B11.webp not found',
      'public/scenes/B09.webp: not the scene of a catalog stop',
      'public/scenes/placeholders.json: B09 is not a catalog stop',
    ])
  })
})

describe('country and flag questions', () => {
  test('a flag question outside PAR02 and P01 is reported in either language', () => {
    const root = copyContent()
    editStop(root, 'rome', 'ROM02', (stop) => {
      stop.question.en = 'Which flag flies above the gate?'
    })
    editStop(root, 'rome', 'ROM03', (stop) => {
      stop.question.cs = 'Ve kterém státě stojíš?'
    })
    editStop(root, 'rome', 'ROM04', (stop) => {
      stop.question.cs = 'V kolika státech platí tahle mince?'
    })
    assert.deepEqual(factProblems(root), [
      'rome ROM02: asks about a country or a flag, only PAR02 and P01 may',
      'rome ROM03: asks about a country or a flag, only PAR02 and P01 may',
      'rome ROM04: asks about a country or a flag, only PAR02 and P01 may',
    ])
  })

  test('every case form of vlajka counts, including the genitive plural vlajek', () => {
    const forms = ['vlajka', 'vlajky', 'vlajce', 'vlajku', 'vlajko', 'vlajkou', 'vlajek', 'vlajkám', 'vlajkách', 'vlajkami']
    const route = structuredClone(readContent().routes.find((candidate) => candidate.id === 'rome'))
    assert.ok(route)
    route.stops = forms.map((form, index) => ({ ...route.stops[index], question: { en: 'Which gate is this?', cs: `Kolik ${form}?` } }))
    assert.deepEqual(countryQuestionStopIds([route]), route.stops.map((stop) => stop.id))
  })

  test('a question about the number of flags in Czech is reported', () => {
    const root = copyContent()
    editStop(root, 'rome', 'ROM02', (stop) => {
      stop.question.cs = 'Kolik vlajek visí nad branou?'
    })
    assert.deepEqual(factProblems(root), ['rome ROM02: asks about a country or a flag, only PAR02 and P01 may'])
  })
})

describe('answer leaks (K7)', () => {
  test('a correct label in the question or scene description is found regardless of case and diacritics', () => {
    const root = copyContent()
    editStop(root, 'budapest', 'B02', (stop) => {
      stop.question.en = 'Which funicular is the SIKLO?'
      stop.sceneAlt.cs = 'Vůz lanovky sikló u řeky'
    })
    assert.deepEqual(factProblems(root), [
      'budapest B02: question.en reveals the correct choice "Sikló"',
      'budapest B02: sceneAlt.cs reveals the correct choice "Sikló"',
    ])
  })

  test('the place caption is not checked', () => {
    const root = copyContent()
    editStop(root, 'budapest', 'B02', (stop) => {
      stop.place.en = 'At the Sikló'
    })
    assert.deepEqual(factProblems(root), [])
  })

  test('a correct label as a whole word in any nested i18n string is found', () => {
    const root = copyContent()
    writeJson(root, 'src/i18n/en.json', {
      title: 'Postcard Trail',
      hints: { transport: ['Take the siklo up the hill', 'Harpatic is not a hall'] },
    })
    writeJson(root, 'src/i18n/cs.json', { map: { river: 'Řeka Dunaj teče městem' } })
    assert.deepEqual(validateContent(root), [
      'src/i18n/cs.json map.river: reveals "Dunaj", the correct choice of stop BRA02',
      'src/i18n/cs.json map.river: reveals "Dunaj", the correct choice of stop B04',
      'src/i18n/en.json hints.transport[0]: reveals "Sikló", the correct choice of stop B02',
    ])
  })

  test('a leak in an i18n file whose root is a string is reported at (root)', () => {
    const root = copyContent()
    writeJson(root, 'src/i18n/en.json', 'Take the siklo up the hill')
    assert.deepEqual(validateContent(root), [
      'src/i18n/en.json (root): reveals "Sikló", the correct choice of stop B02',
    ])
  })

  test('an i18n path that is a file is reported', () => {
    const root = copyContent()
    mkdirSync(path.join(root, 'src'), { recursive: true })
    writeFileSync(path.join(root, 'src/i18n'), '')
    assert.deepEqual(validateContent(root), ['src/i18n: cannot read (ENOTDIR)'])
  })

  test('invalid JSON in i18n is reported', () => {
    const root = copyContent()
    mkdirSync(path.join(root, 'src/i18n'), { recursive: true })
    writeFileSync(path.join(root, 'src/i18n/en.json'), '{')
    assert.match(validateContent(root).join('\n'), /^src\/i18n\/en\.json: invalid JSON \(.+\)$/)
  })
})

describe('source match', () => {
  test('committed data that differ from the city files are reported with the import command', () => {
    const root = copyContent()
    const parisFile = path.join(root, 'docs/game/cities/paris.md')
    const source = readFileSync(parisFile, 'utf8')
    const edited = source.replace('Z Martova pole se díváš', 'Z Martova pole vidíš')
    assert.notEqual(edited, source)
    writeFileSync(parisFile, edited)
    assert.deepEqual(validateContent(root), [
      'paris: route differs from docs/game/cities/paris.md, run npm run content:import',
      'catalog paris: city differs from docs/game/cities/paris.md, run npm run content:import',
    ])
  })

  test('a coordinates row for a city that is not released is reported', () => {
    const root = copyContent()
    const coordinatesPath = 'tools/content/city-coordinates.json'
    const table = readJson<Record<string, unknown>>(root, coordinatesPath)
    writeJson(root, coordinatesPath, { ...table, tallinn: { lat: 59.437, lon: 24.7454, source: 'Wikidata Q1770' } })
    assert.deepEqual(validateContent(root), [
      'tools/content/city-coordinates.json: tallinn is not a released city',
    ])
  })

  test('a city file that is a directory is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, 'docs/game/cities/oslo.md'))
    mkdirSync(path.join(root, 'docs/game/cities/oslo.md'))
    assert.deepEqual(validateContent(root), ['source: cannot read (EISDIR)'])
  })

  test('city files the importer cannot read are reported without a stack trace', () => {
    const root = copyContent()
    rmSync(path.join(root, 'docs/game/cities/oslo.md'))
    assert.deepEqual(validateContent(root), [
      'source docs/game/cities/oslo.md: file not found (listed in docs/game/BRIEF.md §5)',
    ])
  })
})

describe('scenes', () => {
  test('a missing scene is reported with its stop', () => {
    const root = copyContent()
    rmSync(scenePath(root, 'B09'))
    assert.deepEqual(validateContent(root), ['budapest B09: scene public/scenes/B09.webp not found'])
  })

  test('VP8, VP8L and VP8X scenes of 1280 × 1280 pass', () => {
    const root = copyContent()
    writeFileSync(scenePath(root, 'PAR01'), riffWebp(vp8Header(1280, 1280)))
    writeFileSync(scenePath(root, 'PAR02'), riffWebp(vp8lHeader(1280, 1280)))
    assert.equal(readFileSync(scenePath(root, 'PAR03')).toString('latin1', 12, 16), 'VP8X')
    assert.deepEqual(validateContent(root), [])
  })

  test('scenes of another size are reported with the measured size', () => {
    const root = copyContent()
    const vp8x = readFileSync(scenePath(root, 'PAR03'))
    vp8x.writeUIntLE(1279 - 1, 24, 3)
    writeFileSync(scenePath(root, 'PAR03'), vp8x)
    writeFileSync(scenePath(root, 'PAR01'), riffWebp(vp8Header(640, 1280)))
    writeFileSync(scenePath(root, 'PAR02'), riffWebp(vp8lHeader(1280, 1281)))
    assert.deepEqual(validateContent(root), [
      'paris PAR01: scene public/scenes/PAR01.webp is 640 × 1280, expected 1280 × 1280',
      'paris PAR02: scene public/scenes/PAR02.webp is 1280 × 1281, expected 1280 × 1280',
      'paris PAR03: scene public/scenes/PAR03.webp is 1279 × 1280, expected 1280 × 1280',
    ])
  })

  test('a scene above 150 000 bytes is reported with its size', () => {
    const root = copyContent()
    const scene = readFileSync(scenePath(root, 'PAR01'))
    const padding = riffChunk('JUNK', Buffer.alloc(150_000 - scene.length))
    const padded = riffWebp(scene.subarray(12), padding)
    writeFileSync(scenePath(root, 'PAR01'), padded)
    assert.deepEqual(validateContent(root), [
      `paris PAR01: scene public/scenes/PAR01.webp has ${padded.length} bytes, at most 150000 allowed`,
    ])
  })

  test('a scene of exactly 150 000 bytes passes', () => {
    const root = copyContent()
    const scene = readFileSync(scenePath(root, 'PAR01'))
    const padded = riffWebp(scene.subarray(12), riffChunk('JUNK', Buffer.alloc(150_000 - scene.length - 8)))
    assert.equal(padded.length, 150_000)
    writeFileSync(scenePath(root, 'PAR01'), padded)
    assert.deepEqual(validateContent(root), [])
  })

  test('another format and damaged or truncated headers are reported with the stop', () => {
    const root = copyContent()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])
    const vp8x = readFileSync(scenePath(root, 'PAR06'))
    writeFileSync(scenePath(root, 'PAR01'), png)
    writeFileSync(scenePath(root, 'PAR02'), 'RIFF')
    writeFileSync(scenePath(root, 'PAR03'), vp8x.subarray(0, 1000))
    writeFileSync(scenePath(root, 'PAR04'), riffWebp(Buffer.from('VP8X', 'latin1'), Buffer.alloc(4)))
    writeFileSync(scenePath(root, 'PAR05'), riffWebp(vp8Header(1280, 1280, [0, 0, 0])))
    writeFileSync(scenePath(root, 'PAR06'), riffWebp(vp8lHeader(1280, 1280, 0)))
    writeFileSync(scenePath(root, 'PAR07'), riffWebp(riffChunk('ALPH', Buffer.alloc(10))))
    const shortVp8 = riffWebp(vp8Header(1280, 1280))
    shortVp8.writeUInt32LE(9, 16)
    writeFileSync(scenePath(root, 'PAR08'), shortVp8)
    const shortVp8x = readFileSync(scenePath(root, 'PAR09'))
    shortVp8x.writeUInt32LE(0, 16)
    writeFileSync(scenePath(root, 'PAR09'), shortVp8x)
    const shortVp8l = riffWebp(vp8lHeader(1280, 1280))
    shortVp8l.writeUInt32LE(4, 16)
    writeFileSync(scenePath(root, 'PAR10'), shortVp8l)
    assert.deepEqual(validateContent(root), [
      'paris PAR01: scene public/scenes/PAR01.webp is not a valid WebP (no RIFF/WEBP signature, the file starts with 89 50 4e 47 0d 0a 1a 0a 00 00 00 0d)',
      'paris PAR02: scene public/scenes/PAR02.webp is not a valid WebP (truncated header, the file has only 4 bytes)',
      `paris PAR03: scene public/scenes/PAR03.webp is not a valid WebP (the RIFF header declares ${vp8x.length} bytes, the file has 1000)`,
      'paris PAR04: scene public/scenes/PAR04.webp is not a valid WebP (truncated VP8X header, the file has 20 bytes, at least 30 needed)',
      'paris PAR05: scene public/scenes/PAR05.webp is not a valid WebP (damaged VP8 header, the frame start code is 00 00 00 instead of 9d 01 2a)',
      'paris PAR06: scene public/scenes/PAR06.webp is not a valid WebP (damaged VP8L header, the signature byte is 00 instead of 2f)',
      'paris PAR07: scene public/scenes/PAR07.webp is not a valid WebP (unknown first chunk "ALPH", expected VP8, VP8L or VP8X)',
      'paris PAR08: scene public/scenes/PAR08.webp is not a valid WebP (the VP8 chunk declares 9 bytes, at least 10 needed)',
      'paris PAR09: scene public/scenes/PAR09.webp is not a valid WebP (the VP8X chunk declares 0 bytes, at least 10 needed)',
      'paris PAR10: scene public/scenes/PAR10.webp is not a valid WebP (the VP8L chunk declares 4 bytes, at least 5 needed)',
    ])
  })

  test('a scene that cannot be read is reported with its path', () => {
    const root = copyContent()
    rmSync(scenePath(root, 'PAR01'))
    mkdirSync(scenePath(root, 'PAR01'))
    assert.deepEqual(validateContent(root), ['public/scenes/PAR01.webp: cannot read (EISDIR)'])
  })

  test('files without a catalog stop are reported, hidden files are ignored', () => {
    const root = copyContent()
    writeFileSync(path.join(root, scenesDir, 'PAR11.webp'), readFileSync(scenePath(root, 'PAR01')))
    writeFileSync(path.join(root, scenesDir, 'PAR01.png'), 'png')
    writeFileSync(path.join(root, scenesDir, 'notes.txt'), 'notes')
    mkdirSync(path.join(root, scenesDir, 'drafts'))
    writeFileSync(path.join(root, scenesDir, '.DS_Store'), 'finder metadata')
    writeFileSync(path.join(root, scenesDir, '.PAR01.webp.swp'), 'editor swap')
    assert.deepEqual(validateContent(root), [
      'public/scenes/PAR01.png: not the scene of a catalog stop',
      'public/scenes/PAR11.webp: not the scene of a catalog stop',
      'public/scenes/drafts: not the scene of a catalog stop',
      'public/scenes/notes.txt: not the scene of a catalog stop',
    ])
  })

  test('a missing scenes folder is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, scenesDir), { recursive: true })
    assert.deepEqual(validateContent(root), ['public/scenes: directory not found'])
  })

  test('a scenes path that is a file is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, scenesDir), { recursive: true })
    writeFileSync(path.join(root, scenesDir), '')
    assert.deepEqual(validateContent(root), ['public/scenes: cannot read (ENOTDIR)'])
  })

  test('scene checks wait until the catalog and route structure is valid', () => {
    const root = copyContent()
    rmSync(path.join(root, scenesDir), { recursive: true })
    writeFileSync(path.join(root, routesDir, 'rome.json'), '{')
    assert.deepEqual(validateContent(root).map((problem) => problem.replace(/ \(.+\)$/, '')), [
      'src/content/routes/rome.json: invalid JSON',
    ])
  })
})

describe('placeholder list', () => {
  test('a missing list is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, placeholdersPath))
    assert.deepEqual(validateContent(root), ['public/scenes/placeholders.json: file not found'])
  })

  test('a list that cannot be read is reported', () => {
    const root = copyContent()
    rmSync(path.join(root, placeholdersPath))
    mkdirSync(path.join(root, placeholdersPath))
    assert.deepEqual(validateContent(root), ['public/scenes/placeholders.json: cannot read (EISDIR)'])
  })

  test('invalid JSON is reported', () => {
    const root = copyContent()
    writeFileSync(path.join(root, placeholdersPath), '{ "stopIds": [')
    assert.match(validateContent(root).join('\n'), /^public\/scenes\/placeholders\.json: invalid JSON \(.+\)$/)
  })

  for (const [label, listing, problem] of [
    ['an array root', [], 'must be an object with "stopIds"'],
    ['no stopIds', {}, '"stopIds" must be an array of strings'],
    ['stopIds of numbers', { stopIds: ['PAR01', 1] }, '"stopIds" must be an array of strings'],
    ['stopIds as a string', { stopIds: 'PAR01' }, '"stopIds" must be an array of strings'],
  ] as const) {
    test(`a list with ${label} is reported`, () => {
      const root = copyContent()
      writeJson(root, placeholdersPath, listing)
      assert.deepEqual(validateContent(root), [`public/scenes/placeholders.json: ${problem}`])
    })
  }

  test('duplicate and unknown IDs are reported once each', () => {
    const root = copyContent()
    writeJson(root, placeholdersPath, { stopIds: ['PAR01', 'XYZ01', 'PAR01', 'PAR02', 'XYZ01', 'PAR01'] })
    assert.deepEqual(validateContent(root), [
      'public/scenes/placeholders.json: PAR01 is listed more than once',
      'public/scenes/placeholders.json: XYZ01 is listed more than once',
      'public/scenes/placeholders.json: XYZ01 is not a catalog stop',
    ])
  })

  test('a subset of the catalog passes, because a delivered final scene leaves the list', () => {
    const root = copyContent()
    writeJson(root, placeholdersPath, { stopIds: ['PAR02', 'B09'] })
    assert.deepEqual(validateContent(root), [])
    writeJson(root, placeholdersPath, { stopIds: [] })
    assert.deepEqual(validateContent(root), [])
  })
})
