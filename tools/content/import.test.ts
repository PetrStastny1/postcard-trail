import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import type { Catalog, Route } from '../../src/content/types.ts'
import { ContentImportError, importContent, readContent } from './import.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const importScript = path.join(repoRoot, 'tools/content/import.ts')
const committedCatalog = JSON.parse(readFileSync(path.join(repoRoot, 'src/content/catalog.json'), 'utf8')) as Catalog
const releasedCityIds = [
  'paris', 'london', 'rome', 'berlin', 'madrid', 'amsterdam', 'athens', 'bratislava', 'vienna', 'prague',
  'lisbon', 'dublin', 'copenhagen', 'stockholm', 'brussels', 'budapest', 'warsaw', 'oslo', 'helsinki', 'reykjavik',
]

const temporaryRoots: string[] = []
after(() => temporaryRoots.forEach((root) => rmSync(root, { recursive: true, force: true })))

/** A copy of the import sources; the catalog is copied only when asked, routes never. */
function copySources(options: { withCatalog: boolean }): string {
  const root = mkdtempSync(path.join(tmpdir(), 'content-import-'))
  temporaryRoots.push(root)
  cpSync(path.join(repoRoot, 'docs/game'), path.join(root, 'docs/game'), { recursive: true })
  cpSync(path.join(repoRoot, 'tools/content/city-coordinates.json'), path.join(root, 'tools/content/city-coordinates.json'))
  if (options.withCatalog) {
    cpSync(path.join(repoRoot, 'src/content/catalog.json'), path.join(root, 'src/content/catalog.json'))
  }
  return root
}

function runImport(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [importScript, '--root', root, ...args], { encoding: 'utf8' })
}

function editFile(root: string, relativePath: string, edit: (source: string) => string) {
  const file = path.join(root, relativePath)
  const source = readFileSync(file, 'utf8')
  const edited = edit(source)
  assert.notEqual(edited, source, `edit of ${relativePath} must change the file`)
  writeFileSync(file, edited)
}

function readCatalog(root: string): Catalog {
  return JSON.parse(readFileSync(path.join(root, 'src/content/catalog.json'), 'utf8')) as Catalog
}

describe('real city files', () => {
  const { routes, cities } = readContent()
  const stops = routes.flatMap((route) => route.stops)
  const stopById = new Map(stops.map((stop) => [stop.id, stop]))

  test('give 20 routes of 10 stops with 200 unique IDs in BRIEF §5 order', () => {
    assert.deepEqual(
      routes.map((route) => route.id),
      releasedCityIds,
    )
    assert.ok(routes.every((route) => route.stops.length === 10))
    assert.equal(new Set(stops.map((stop) => stop.id)).size, 200)
  })

  test('B09 asks for the metro line with M1 to M4 in source order and M1 correct', () => {
    const stop = stopById.get('B09')
    assert.ok(stop)
    assert.deepEqual(stop.question, { en: 'Which metro line are you waiting for?', cs: 'Na kterou linku metra právě čekáš?' })
    assert.deepEqual(
      stop.choices.map((choice) => choice.label),
      ['M1', 'M2', 'M3', 'M4'].map((line) => ({ en: line, cs: line })),
    )
    assert.equal(stop.choices.find((choice) => choice.id === stop.correctChoiceId)?.label.en, 'M1')
  })

  test('only B09 and LIS03 are changeable and only they carry a changeable fact', () => {
    const changeable = stops.filter((stop) => stop.stability === 'changeable')
    assert.deepEqual(changeable.map((stop) => stop.id).sort(), ['B09', 'LIS03'])
    assert.ok(changeable.every((stop) => typeof stop.changeableFact === 'string' && stop.changeableFact !== ''))
    const stable = stops.filter((stop) => stop.stability === 'stable')
    assert.equal(stable.length, 198)
    assert.ok(stable.every((stop) => !('changeableFact' in stop)))
  })

  test('PAR01 matches docs/game/cities/paris.md', () => {
    assert.deepEqual(stopById.get('PAR01'), {
      id: 'PAR01',
      place: { en: 'On the Champ de Mars', cs: 'Na Martově poli' },
      difficulty: 'easy',
      sceneAsset: 'scenes/PAR01.webp',
      sceneAlt: {
        en: 'An iron lattice tower with four splayed legs',
        cs: 'Železná příhradová věž se čtyřmi rozkročenými nohami',
      },
      question: { en: 'Which tower is in front of you?', cs: 'Kterou věž máš před sebou?' },
      choices: [
        { id: 'a', label: { en: 'Leaning Tower of Pisa', cs: 'Pisa' } },
        { id: 'b', label: { en: 'Eiffel Tower', cs: 'Eiffelova věž' } },
        { id: 'c', label: { en: 'CN Tower', cs: 'CN Tower' } },
        { id: 'd', label: { en: 'Petřín Lookout Tower', cs: 'Petřínská rozhledna' } },
      ],
      correctChoiceId: 'b',
      feedback: {
        en: 'From the Champ de Mars, you can see the four lattice legs of the Eiffel Tower.',
        cs: 'Z Martova pole se díváš na čtyři příhradové nohy Eiffelovy věže.',
      },
      sourceUrls: ['https://en.wikipedia.org/wiki/Eiffel_Tower'],
      photoReferenceUrls: ['https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons_(cropped).jpg'],
      verifiedOn: '2026-11-26',
      stability: 'stable',
    })
  })

  test('route names, postcard IDs, verification dates and expert notes come from the files', () => {
    const paris = routes[0]
    assert.deepEqual(paris.name, { en: 'Paris', cs: 'Paříž' })
    assert.deepEqual(routes.find((route) => route.id === 'amsterdam')?.name, { en: 'Amsterdam', cs: 'Amsterdam' })
    assert.equal(routes.find((route) => route.id === 'prague')?.postcardQuestionId, 'P04')
    assert.ok(stops.every((stop) => stop.verifiedOn === '2026-11-26'))
    const experts = stops.filter((stop) => stop.difficulty === 'expert')
    assert.equal(experts.length, 40)
    assert.ok(experts.every((stop) => typeof stop.distinguishingFeature === 'string'))
    assert.ok(stops.filter((stop) => stop.difficulty !== 'expert').every((stop) => !('distinguishingFeature' in stop)))
  })

  test('links are split into photo references and sources by link text', () => {
    const stop = stopById.get('LIS10')
    assert.deepEqual(stop?.sourceUrls, [
      'https://en.wikipedia.org/wiki/Gl%C3%B3ria_Funicular',
      'https://www.carris.pt/en/discover/fleet/funiculars/',
    ])
    assert.deepEqual(stop?.photoReferenceUrls, [
      'https://commons.wikimedia.org/wiki/File:Elevador_da_Glória,_Lisszabon_(2,_20250815)_4.jpg',
    ])
  })

  test('catalog cities carry the name, coordinates and postcard of each route', () => {
    assert.deepEqual(
      cities.map((city) => city.id),
      releasedCityIds,
    )
    for (const [index, city] of cities.entries()) {
      const route = routes[index] as Route
      const postcardStop = route.stops.find((stop) => stop.id === route.postcardQuestionId)
      assert.deepEqual(city, {
        id: route.id,
        name: route.name,
        coordinates: route.coordinates,
        postcard: { stopId: route.postcardQuestionId, sceneAsset: postcardStop?.sceneAsset, sentence: postcardStop?.feedback },
      })
    }
  })

  test('the committed files equal the in-memory import', () => {
    for (const route of routes) {
      const committed = readFileSync(path.join(repoRoot, `src/content/routes/${route.id}.json`), 'utf8')
      assert.equal(committed, `${JSON.stringify(route, null, 2)}\n`)
    }
    assert.deepEqual(committedCatalog.cities, cities)
    assert.deepEqual(
      readdirSync(path.join(repoRoot, 'src/content/routes')).sort(),
      releasedCityIds.map((cityId) => `${cityId}.json`).sort(),
    )
  })

  test('the committed catalog has one version with all 20 cities in order', () => {
    assert.equal(committedCatalog.versions.length, 1)
    assert.match(committedCatalog.versions[0].effectiveUtcDate, /^\d{4}-\d{2}-\d{2}$/)
    assert.deepEqual(committedCatalog.versions[0].orderedCityIds, releasedCityIds)
  })

  test('every city has WGS84 coordinates with four decimals and a source', () => {
    const table = JSON.parse(readFileSync(path.join(repoRoot, 'tools/content/city-coordinates.json'), 'utf8')) as Record<
      string,
      { lat: number; lon: number; source: string }
    >
    assert.deepEqual(Object.keys(table).sort(), [...releasedCityIds].sort())
    for (const row of Object.values(table)) {
      assert.equal(Math.round(row.lat * 1e4) / 1e4, row.lat)
      assert.equal(Math.round(row.lon * 1e4) / 1e4, row.lon)
      assert.match(row.source, /Wikidata Q\d+.*P625/)
    }
  })
})

describe('content:import command', () => {
  test('reproduces the committed files and changes nothing on a second run', () => {
    const root = copySources({ withCatalog: true })
    assert.equal(runImport(root).status, 0)
    const written = ['src/content/catalog.json', ...releasedCityIds.map((cityId) => `src/content/routes/${cityId}.json`)]
    const firstRun = written.map((file) => readFileSync(path.join(root, file), 'utf8'))
    assert.deepEqual(
      firstRun,
      written.map((file) => readFileSync(path.join(repoRoot, file), 'utf8')),
    )
    assert.equal(runImport(root).status, 0)
    assert.deepEqual(
      written.map((file) => readFileSync(path.join(root, file), 'utf8')),
      firstRun,
    )
  })

  test('without a catalog it needs an effective date and then creates the first version', () => {
    const root = copySources({ withCatalog: false })
    const refused = runImport(root)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /--effective-date=YYYY-MM-DD/)
    assert.equal(existsSync(path.join(root, 'src')), false)

    assert.equal(runImport(root, '--effective-date=2027-03-01').status, 0)
    assert.deepEqual(readCatalog(root).versions, [{ effectiveUtcDate: '2027-03-01', orderedCityIds: releasedCityIds }])
  })

  test('keeps existing versions and appends a version only with an explicit date', () => {
    const root = copySources({ withCatalog: true })
    const earlier = { effectiveUtcDate: '2026-12-01', orderedCityIds: releasedCityIds.slice(0, 19) }
    const catalogFile = path.join(root, 'src/content/catalog.json')
    writeFileSync(catalogFile, JSON.stringify({ cities: [], versions: [earlier] }))
    const catalogBefore = readFileSync(catalogFile, 'utf8')

    const refused = runImport(root)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /differ from the latest catalog version from 2026-12-01/)
    assert.equal(readFileSync(catalogFile, 'utf8'), catalogBefore)
    assert.equal(existsSync(path.join(root, 'src/content/routes')), false)

    const tooEarly = runImport(root, '--effective-date=2026-12-01')
    assert.equal(tooEarly.status, 1)
    assert.match(tooEarly.stderr, /must be after 2026-12-01/)

    assert.equal(runImport(root, '--effective-date=2027-01-15').status, 0)
    assert.deepEqual(readCatalog(root).versions, [
      earlier,
      { effectiveUtcDate: '2027-01-15', orderedCityIds: releasedCityIds },
    ])
    assert.equal(runImport(root).status, 0, 'a later plain run accepts the appended version')
  })

  test('refuses a version that does not only append cities', () => {
    const root = copySources({ withCatalog: true })
    const reordered = [releasedCityIds[1], releasedCityIds[0], ...releasedCityIds.slice(2)]
    writeFileSync(
      path.join(root, 'src/content/catalog.json'),
      JSON.stringify({ cities: [], versions: [{ effectiveUtcDate: '2026-12-01', orderedCityIds: reordered }] }),
    )
    const result = runImport(root, '--effective-date=2027-01-15')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /may only add cities after/)
  })

  test('refuses an effective date when the city list has not changed', () => {
    const result = runImport(copySources({ withCatalog: true }), '--effective-date=2027-01-15')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /there is no version to add/)
  })

  for (const invalidDate of ['2027-02-30', '2027-13-01', '2027-01-32', '27-01-01']) {
    test(`refuses the invalid effective date ${invalidDate}`, () => {
      const root = copySources({ withCatalog: false })
      const result = runImport(root, `--effective-date=${invalidDate}`)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /--effective-date must be a valid YYYY-MM-DD date/)
      assert.doesNotMatch(result.stderr, /^\s+at /m, 'no stack trace')
      assert.equal(existsSync(path.join(root, 'src')), false)
    })
  }

  test('the exported importContent also refuses an invalid effective date', () => {
    const root = copySources({ withCatalog: false })
    assert.throws(() => importContent({ root, effectiveDate: '2027-13-01' }), ContentImportError)
    assert.equal(existsSync(path.join(root, 'src')), false)
  })
})

describe('content:import on a broken source', () => {
  const paris = 'docs/game/cities/paris.md'
  const brokenSources: { name: string; file?: string; edit: (source: string) => string; message: RegExp }[] = [
    {
      name: 'CS and EN bold different positions',
      edit: (source) => source.replace('Pisa · **Eiffelova věž**', '**Pisa** · Eiffelova věž'),
      message: /paris\.md PAR01: CS marks choice 1 and EN marks choice 2 as correct/,
    },
    {
      name: 'no bold choice',
      edit: (source) => source.replace('**Eiffelova věž**', 'Eiffelova věž'),
      message: /paris\.md PAR01: CS: found 0 bold choices, expected exactly 1/,
    },
    {
      name: 'two bold choices',
      edit: (source) => source.replace('· CN Tower · Petřínská', '· **CN Tower** · Petřínská'),
      message: /paris\.md PAR01: CS: found 2 bold choices, expected exactly 1/,
    },
    {
      name: 'three choices',
      edit: (source) => source.replace(' · Petřín Lookout Tower.', '.'),
      message: /paris\.md PAR01: EN: found 3 choices, expected 4/,
    },
    {
      name: 'five choices',
      edit: (source) => source.replace('Petřín Lookout Tower.', 'Petřín Lookout Tower · Big Ben.'),
      message: /paris\.md PAR01: EN: found 5 choices, expected 4/,
    },
    {
      name: 'a missing required field',
      edit: (source) => source.replace(/^- \*\*After answering EN\*\* — From the Champ.*\n/m, ''),
      message: /paris\.md PAR01: missing field "After answering EN"/,
    },
    {
      name: 'a missing stability line',
      edit: (source) => source.replace(/^- \*\*Stabilní\*\* · \[Popis místa nebo znaku\]\(<https:\/\/en\.wikipedia\.org\/wiki\/Eiffel_Tower>\).*\n/m, ''),
      message: /paris\.md PAR01: missing stability line/,
    },
    {
      name: 'an unknown difficulty',
      edit: (source) => source.replace('## PAR01 · Lehká', '## PAR01 · Střední'),
      message: /paris\.md PAR01: unknown difficulty "Střední"/,
    },
    {
      name: 'an unknown field',
      edit: (source) => source.replace('- **Scéna** — Železná', '- **Poznámka** — Železná'),
      message: /paris\.md PAR01: unexpected line "- \*\*Poznámka\*\*/,
    },
    {
      name: 'a missing postcard line',
      edit: (source) => source.replace('**Pohlednice** — scéna PAR01.\n', ''),
      message: /paris\.md: missing line "\*\*Pohlednice\*\* — scéna <ID>\."/,
    },
    {
      name: 'a postcard stop outside the route',
      edit: (source) => source.replace('scéna PAR01.', 'scéna ROM01.'),
      message: /paris\.md: postcard stop ROM01 is not a stop of this route/,
    },
    {
      name: 'an invalid verification date',
      edit: (source) => source.replace('**Ověřeno** — 26. 11. 2026.', '**Ověřeno** — 31. 2. 2026.'),
      message: /paris\.md: "Ověřeno" must start with a valid date "D\. M\. RRRR\.", found "31\. 2\. 2026\./,
    },
    {
      name: 'a missing coordinates row',
      file: 'tools/content/city-coordinates.json',
      edit: (source) => {
        const table = JSON.parse(source) as Record<string, unknown>
        delete table.oslo
        return JSON.stringify(table)
      },
      message: /city-coordinates\.json: missing row for city "oslo"/,
    },
  ]

  for (const broken of brokenSources) {
    test(`stops on ${broken.name} without writing files`, () => {
      const root = copySources({ withCatalog: true })
      const catalogBefore = readFileSync(path.join(root, 'src/content/catalog.json'), 'utf8')
      editFile(root, broken.file ?? paris, broken.edit)

      const result = runImport(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /^Content import failed:\n/)
      assert.match(result.stderr, broken.message)
      assert.doesNotMatch(result.stderr, /^\s+at /m, 'no stack trace')
      assert.equal(existsSync(path.join(root, 'src/content/routes')), false)
      assert.equal(readFileSync(path.join(root, 'src/content/catalog.json'), 'utf8'), catalogBefore)
    })
  }

  test('stops on a city file listed in BRIEF §5 that does not exist', () => {
    const root = copySources({ withCatalog: false })
    rmSync(path.join(root, 'docs/game/cities/oslo.md'))
    const result = runImport(root, '--effective-date=2027-01-15')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /docs\/game\/cities\/oslo\.md: file not found \(listed in docs\/game\/BRIEF\.md §5\)/)
    assert.equal(existsSync(path.join(root, 'src')), false)
  })

  const brokenFiles: { name: string; file: string; content: (source: string) => string; message: RegExp }[] = [
    {
      name: 'a null coordinates table',
      file: 'tools/content/city-coordinates.json',
      content: () => 'null',
      message: /city-coordinates\.json: must be an object keyed by city ID/,
    },
    {
      name: 'a null coordinates row',
      file: 'tools/content/city-coordinates.json',
      content: (source) => JSON.stringify({ ...JSON.parse(source), oslo: null }),
      message: /city-coordinates\.json: oslo needs numeric lat, lon and a non-empty source/,
    },
    {
      name: 'a null catalog',
      file: 'src/content/catalog.json',
      content: () => 'null',
      message: /catalog\.json: "versions" must be an array/,
    },
    {
      name: 'a catalog version without orderedCityIds',
      file: 'src/content/catalog.json',
      content: () => JSON.stringify({ cities: [], versions: [{ effectiveUtcDate: '2026-12-01' }] }),
      message: /catalog\.json: versions\[0\] needs "effectiveUtcDate" \(YYYY-MM-DD\) and "orderedCityIds"/,
    },
    {
      name: 'a catalog version with a numeric effectiveUtcDate',
      file: 'src/content/catalog.json',
      content: () => JSON.stringify({ cities: [], versions: [{ effectiveUtcDate: 20261201, orderedCityIds: releasedCityIds }] }),
      message: /catalog\.json: versions\[0\] needs "effectiveUtcDate"/,
    },
    {
      name: 'a rank used twice in BRIEF §5',
      file: 'docs/game/BRIEF.md',
      content: (source) => source.replace('| 11 | [Lisabon]', '| 1 | [Lisabon]'),
      message: /BRIEF\.md: §5 release table uses rank 1 twice/,
    },
    {
      name: 'a city listed twice in BRIEF §5',
      file: 'docs/game/BRIEF.md',
      content: (source) => source.replace('[Lisabon](cities/lisbon.md)', '[Lisabon](cities/paris.md)'),
      message: /BRIEF\.md: §5 release table lists paris twice/,
    },
  ]

  for (const broken of brokenFiles) {
    test(`stops on ${broken.name} without writing files`, () => {
      const root = copySources({ withCatalog: true })
      editFile(root, broken.file, broken.content)
      const editedCatalog = readFileSync(path.join(root, 'src/content/catalog.json'), 'utf8')

      const result = runImport(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, broken.message)
      assert.doesNotMatch(result.stderr, /^\s+at /m, 'no stack trace')
      assert.equal(existsSync(path.join(root, 'src/content/routes')), false)
      assert.equal(readFileSync(path.join(root, 'src/content/catalog.json'), 'utf8'), editedCatalog)
    })
  }
})

test('a link without angle brackets is imported as a source', () => {
  const root = copySources({ withCatalog: true })
  editFile(root, 'docs/game/cities/paris.md', (source) =>
    source.replace('(<https://en.wikipedia.org/wiki/Eiffel_Tower>)', '(https://en.wikipedia.org/wiki/Eiffel_Tower)'),
  )
  const paris = readContent(root).routes[0]
  assert.deepEqual(paris.stops[0].sourceUrls, ['https://en.wikipedia.org/wiki/Eiffel_Tower'])
  assert.deepEqual(paris.stops[0].photoReferenceUrls, [
    'https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons_(cropped).jpg',
  ])
})

test('a link without angle brackets keeps parentheses in its address', () => {
  const root = copySources({ withCatalog: true })
  editFile(root, 'docs/game/cities/paris.md', (source) =>
    source.replace(
      '(<https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons_(cropped).jpg>)',
      '(https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons_(cropped).jpg)',
    ),
  )
  assert.deepEqual(readContent(root).routes[0].stops[0].photoReferenceUrls, [
    'https://commons.wikimedia.org/wiki/File:Tour_Eiffel_Wikimedia_Commons_(cropped).jpg',
  ])
})
