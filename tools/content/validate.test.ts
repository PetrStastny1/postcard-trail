import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

const temporaryRoots: string[] = []
after(() => temporaryRoots.forEach((root) => rmSync(root, { recursive: true, force: true })))

/** A copy of everything the validator reads, without src/i18n. */
function copyContent(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'content-validate-'))
  temporaryRoots.push(root)
  for (const relativePath of ['docs/game', routesDir, catalogPath, 'tools/content/city-coordinates.json']) {
    cpSync(path.join(repoRoot, relativePath), path.join(root, relativePath), { recursive: true })
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

  test('reports a missing data folder without a stack trace', () => {
    const result = runValidator(path.join(copyContent(), 'missing'))
    assert.equal(result.status, 1)
    assert.equal(
      result.stderr,
      'Content validation failed:\nsrc/content/catalog.json: file not found\nsrc/content/routes: directory not found\n',
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
    assert.deepEqual(factProblems(root), ['rome: expected 10 stops, found 9'])
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
    assert.deepEqual(factProblems(root), ['B09: stop not found'])
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
    assert.deepEqual(factProblems(root), [
      'rome ROM02: asks about a country or a flag, only PAR02 and P01 may',
      'rome ROM03: asks about a country or a flag, only PAR02 and P01 may',
    ])
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

  test('city files the importer cannot read are reported without a stack trace', () => {
    const root = copyContent()
    rmSync(path.join(root, 'docs/game/cities/oslo.md'))
    assert.deepEqual(validateContent(root), [
      'source docs/game/cities/oslo.md: file not found (listed in docs/game/BRIEF.md §5)',
    ])
  })
})
