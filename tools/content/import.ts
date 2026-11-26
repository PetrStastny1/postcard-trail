import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type {
  Catalog,
  CatalogCity,
  CatalogVersion,
  Choice,
  Difficulty,
  Localized,
  Route,
  Stop,
} from '../../src/content/types.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')

const briefPath = 'docs/game/BRIEF.md'
const citiesDir = 'docs/game/cities'
const coordinatesPath = 'tools/content/city-coordinates.json'
const routesDir = 'src/content/routes'
const catalogPath = 'src/content/catalog.json'

const difficulties: Record<string, Difficulty> = { Lehká: 'easy', Těžká: 'hard', Expert: 'expert' }

const stopFieldLabels = [
  'Místo CS / EN',
  'Scéna',
  'Popis scény CS / EN',
  'CS',
  'EN',
  'Po odpovědi CS',
  'After answering EN',
  'Rozlišovací znak',
] as const

type StopFieldLabel = (typeof stopFieldLabels)[number]

const requiredStopFields: StopFieldLabel[] = [
  'Místo CS / EN',
  'Popis scény CS / EN',
  'CS',
  'EN',
  'Po odpovědi CS',
  'After answering EN',
]

const photoReferenceLinkText = 'fotografický podklad'

/** Problems in the content sources. The CLI prints them without a stack trace. */
export class ContentImportError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`Content import failed:\n${problems.join('\n')}`)
    this.problems = problems
  }
}

export interface ImportedContent {
  routes: Route[]
  cities: CatalogCity[]
}

interface CityCoordinates {
  lat: number
  lon: number
  source: string
}

interface ParsedQuestion {
  question: string
  labels: string[]
  correctIndex: number
}

function parseJson(relativePath: string, source: string): unknown {
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new ContentImportError([`${relativePath}: invalid JSON (${(error as Error).message})`])
  }
}

function readSource(root: string, relativePath: string): string {
  const absolutePath = path.join(root, relativePath)
  if (!existsSync(absolutePath)) throw new ContentImportError([`${relativePath}: file not found`])
  return readFileSync(absolutePath, 'utf8')
}

/** City IDs in unlock order from the release table in BRIEF §5. */
function readReleasedCityIds(root: string): string[] {
  const brief = readSource(root, briefPath)
  const section = brief.match(/^## 5\.[^\n]*\n([\s\S]*?)(?=^## )/m)?.[1]
  if (!section) throw new ContentImportError([`${briefPath}: section "## 5." not found`])
  const cityIdsByRank = new Map<number, string>()
  for (const [, rank, cityId] of section.matchAll(/\|\s*(\d+)\s*\|\s*\[[^\]]+\]\(cities\/([a-z-]+)\.md\)/g)) {
    cityIdsByRank.set(Number(rank), cityId)
  }
  const cityIds = Array.from({ length: cityIdsByRank.size }, (_, index) => cityIdsByRank.get(index + 1))
  if (cityIds.length === 0 || cityIds.some((cityId) => cityId === undefined)) {
    throw new ContentImportError([`${briefPath}: §5 release table must number cities 1..n without gaps`])
  }
  return cityIds as string[]
}

function readCoordinates(root: string): Record<string, CityCoordinates> {
  const table = parseJson(coordinatesPath, readSource(root, coordinatesPath)) as Record<string, CityCoordinates>
  const problems: string[] = []
  for (const [cityId, row] of Object.entries(table)) {
    const valid =
      Number.isFinite(row.lat) && Number.isFinite(row.lon) && typeof row.source === 'string' && row.source !== ''
    if (!valid) problems.push(`${coordinatesPath}: ${cityId} needs numeric lat, lon and a non-empty source`)
  }
  if (problems.length > 0) throw new ContentImportError(problems)
  return table
}

/** Splits `CS text / EN text.` and drops the list item's closing full stop. */
function parsePair(value: string): Localized | undefined {
  const parts = value.replace(/\.$/, '').split(' / ')
  if (parts.length !== 2) return undefined
  return { en: parts[1], cs: parts[0] }
}

function parseQuestion(value: string): ParsedQuestion | string {
  const questionEnd = value.lastIndexOf('?')
  if (questionEnd === -1) return 'question must end with "?"'
  const choicesText = value
    .slice(questionEnd + 1)
    .trim()
    .replace(/\.$/, '')
  const rawChoices = choicesText.split(choicesText.includes(' · ') ? ' · ' : ' / ')
  if (rawChoices.length !== 4) return `found ${rawChoices.length} choices, expected 4`
  const boldIndexes = rawChoices.flatMap((choice, index) => (/^\*\*.+\*\*$/.test(choice) ? [index] : []))
  if (boldIndexes.length !== 1) return `found ${boldIndexes.length} bold choices, expected exactly 1`
  const labels = rawChoices.map((choice) => choice.replace(/^\*\*(.+)\*\*$/, '$1'))
  if (labels.some((label) => label.includes('**'))) return 'bold marks must wrap a whole choice'
  return { question: value.slice(0, questionEnd + 1), labels, correctIndex: boldIndexes[0] }
}

function parseVerifiedOn(value: string): string | undefined {
  const match = value.match(/^(\d{1,2})\. (\d{1,2})\. (\d{4})\./)
  if (!match) return undefined
  const [day, month, year] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return date.toISOString().slice(0, 10)
}

function parseStop(file: string, section: string, verifiedOn: string, problems: string[]): Stop | undefined {
  const [heading, ...lines] = section.split('\n')
  const headingMatch = heading.match(/^## ([A-Z]+[0-9]{2}) · (.+)$/)
  if (!headingMatch) {
    problems.push(`${file}: stop heading "${heading}" must be "## <ID> · Lehká|Těžká|Expert"`)
    return undefined
  }
  const [, stopId, difficultyName] = headingMatch
  const stopProblems: string[] = []
  const difficulty = difficulties[difficultyName]
  if (!difficulty) stopProblems.push(`unknown difficulty "${difficultyName}"`)

  const fields = new Map<StopFieldLabel, string>()
  const links: { text: string; url: string }[] = []
  let stability: { changeableFact?: string } | undefined
  for (const line of lines) {
    if (line.trim() === '') continue
    const stabilityMatch = line.match(/^- \*\*(Stabilní|Může se změnit \((.+)\))\*\*/)
    // A bullet with links only continues the source list of the stability line (LIS10).
    if (stabilityMatch || line.startsWith('- [')) {
      if (stabilityMatch) {
        if (stability) stopProblems.push('stability line appears twice')
        stability = stabilityMatch[2] === undefined ? {} : { changeableFact: stabilityMatch[2] }
      }
      for (const [, text, url] of line.matchAll(/\[([^\]]+)\]\(<([^>]+)>\)/g)) links.push({ text, url })
      continue
    }
    const fieldMatch = line.match(/^- \*\*(.+?)\*\* — (.+)$/)
    const label = fieldMatch?.[1]
    if (!fieldMatch || !stopFieldLabels.includes(label as StopFieldLabel)) {
      stopProblems.push(`unexpected line "${line}"`)
      continue
    }
    if (fields.has(label as StopFieldLabel)) stopProblems.push(`field "${label}" appears twice`)
    fields.set(label as StopFieldLabel, fieldMatch[2])
  }
  for (const label of requiredStopFields) {
    if (!fields.has(label)) stopProblems.push(`missing field "${label}"`)
  }
  if (!stability) stopProblems.push('missing stability line "Stabilní" or "Může se změnit (…)"')

  const place = fields.has('Místo CS / EN') ? parsePair(fields.get('Místo CS / EN') as string) : undefined
  if (fields.has('Místo CS / EN') && !place) stopProblems.push('"Místo CS / EN" must be "<CS> / <EN>"')
  const sceneAlt = fields.has('Popis scény CS / EN') ? parsePair(fields.get('Popis scény CS / EN') as string) : undefined
  if (fields.has('Popis scény CS / EN') && !sceneAlt) stopProblems.push('"Popis scény CS / EN" must be "<CS> / <EN>"')

  const questions: Partial<Record<'CS' | 'EN', ParsedQuestion>> = {}
  for (const language of ['CS', 'EN'] as const) {
    const value = fields.get(language)
    if (value === undefined) continue
    const parsed = parseQuestion(value)
    if (typeof parsed === 'string') stopProblems.push(`${language}: ${parsed}`)
    else questions[language] = parsed
  }
  const { CS: questionCs, EN: questionEn } = questions
  if (questionCs && questionEn && questionCs.correctIndex !== questionEn.correctIndex) {
    stopProblems.push(
      `CS marks choice ${questionCs.correctIndex + 1} and EN marks choice ${questionEn.correctIndex + 1} as correct`,
    )
  }

  if (stopProblems.length > 0 || !place || !sceneAlt || !questionCs || !questionEn || !stability) {
    problems.push(...stopProblems.map((problem) => `${file} ${stopId}: ${problem}`))
    return undefined
  }

  const choiceIds = ['a', 'b', 'c', 'd']
  const choices = choiceIds.map(
    (id, index): Choice => ({ id, label: { en: questionEn.labels[index], cs: questionCs.labels[index] } }),
  ) as Stop['choices']
  const stop: Stop = {
    id: stopId,
    place,
    difficulty,
    sceneAsset: `scenes/${stopId}.webp`,
    sceneAlt,
    question: { en: questionEn.question, cs: questionCs.question },
    choices,
    correctChoiceId: choiceIds[questionCs.correctIndex],
    feedback: { en: fields.get('After answering EN') as string, cs: fields.get('Po odpovědi CS') as string },
    sourceUrls: links.filter((link) => !link.text.startsWith(photoReferenceLinkText)).map((link) => link.url),
    photoReferenceUrls: links.filter((link) => link.text.startsWith(photoReferenceLinkText)).map((link) => link.url),
    verifiedOn,
    stability: stability.changeableFact === undefined ? 'stable' : 'changeable',
  }
  if (stability.changeableFact !== undefined) stop.changeableFact = stability.changeableFact
  const distinguishingFeature = fields.get('Rozlišovací znak')
  if (distinguishingFeature !== undefined) stop.distinguishingFeature = distinguishingFeature
  return stop
}

function parseCity(
  file: string,
  cityId: string,
  markdown: string,
  coordinates: CityCoordinates | undefined,
  problems: string[],
): Route | undefined {
  const [header, ...stopSections] = markdown.replace(/\r\n/g, '\n').split(/^(?=## )/m)
  const problemCount = problems.length

  const title = header.match(/^# (.+)$/m)?.[1]
  if (!title) problems.push(`${file}: missing title "# <CS> / <EN>"`)
  const name = title?.includes(' / ') ? parsePair(title) : title ? { en: title, cs: title } : undefined
  if (title && !name) problems.push(`${file}: title must be "# <CS> / <EN>" or "# <name>"`)

  const postcardQuestionId = header.match(/^\*\*Pohlednice\*\* — scéna ([A-Z]+[0-9]{2})\.$/m)?.[1]
  if (!postcardQuestionId) problems.push(`${file}: missing line "**Pohlednice** — scéna <ID>."`)

  const verifiedLine = header.match(/^\*\*Ověřeno\*\* — (.+)$/m)?.[1]
  const verifiedOn = verifiedLine === undefined ? undefined : parseVerifiedOn(verifiedLine)
  if (verifiedLine === undefined) problems.push(`${file}: missing line "**Ověřeno** — D. M. RRRR."`)
  else if (!verifiedOn) problems.push(`${file}: "Ověřeno" must start with a valid date "D. M. RRRR.", found "${verifiedLine}"`)

  if (!coordinates) problems.push(`${coordinatesPath}: missing row for city "${cityId}"`)

  const stops = stopSections.flatMap((section) => {
    const stop = parseStop(file, section.trimEnd(), verifiedOn ?? '', problems)
    return stop ? [stop] : []
  })
  if (postcardQuestionId && !stops.some((stop) => stop.id === postcardQuestionId) && problems.length === problemCount) {
    problems.push(`${file}: postcard stop ${postcardQuestionId} is not a stop of this route`)
  }

  if (problems.length > problemCount || !name || !postcardQuestionId || !coordinates) return undefined
  return { id: cityId, name, coordinates: { lat: coordinates.lat, lon: coordinates.lon }, postcardQuestionId, stops }
}

/** Parses the released city files in memory. Nothing is written. */
export function readContent(root: string = repoRoot): ImportedContent {
  const cityIds = readReleasedCityIds(root)
  const coordinates = readCoordinates(root)
  const problems: string[] = []
  const routes: Route[] = []
  for (const cityId of cityIds) {
    const file = `${citiesDir}/${cityId}.md`
    if (!existsSync(path.join(root, file))) {
      problems.push(`${file}: file not found (listed in ${briefPath} §5)`)
      continue
    }
    const route = parseCity(file, cityId, readFileSync(path.join(root, file), 'utf8'), coordinates[cityId], problems)
    if (route) routes.push(route)
  }
  if (problems.length > 0) throw new ContentImportError(problems)

  const cities = routes.map((route): CatalogCity => {
    const postcardStop = route.stops.find((stop) => stop.id === route.postcardQuestionId) as Stop
    return {
      id: route.id,
      name: route.name,
      coordinates: route.coordinates,
      postcard: { stopId: postcardStop.id, sceneAsset: postcardStop.sceneAsset, sentence: postcardStop.feedback },
    }
  })
  return { routes, cities }
}

function readVersions(root: string): CatalogVersion[] {
  if (!existsSync(path.join(root, catalogPath))) return []
  const catalog = parseJson(catalogPath, readSource(root, catalogPath)) as Partial<Catalog>
  if (!Array.isArray(catalog.versions)) throw new ContentImportError([`${catalogPath}: "versions" must be an array`])
  return catalog.versions
}

function nextVersions(versions: CatalogVersion[], cityIds: string[], effectiveDate: string | undefined) {
  const latest = versions.at(-1)
  const unchanged = latest !== undefined && latest.orderedCityIds.join() === cityIds.join()
  if (unchanged) {
    if (effectiveDate) {
      throw new ContentImportError([
        `--effective-date: released cities match the latest catalog version from ${latest.effectiveUtcDate}, there is no version to add`,
      ])
    }
    return versions
  }
  if (!effectiveDate) {
    const reason = latest
      ? `released cities in ${briefPath} §5 differ from the latest catalog version from ${latest.effectiveUtcDate}`
      : 'the catalog has no version yet'
    throw new ContentImportError([`${catalogPath}: ${reason}. Pass --effective-date=YYYY-MM-DD to add a version.`])
  }
  if (latest) {
    if (latest.orderedCityIds.some((cityId, index) => cityIds[index] !== cityId)) {
      throw new ContentImportError([
        `${briefPath} §5: a new catalog version may only add cities after ${latest.orderedCityIds.join(', ')}`,
      ])
    }
    if (effectiveDate <= latest.effectiveUtcDate) {
      throw new ContentImportError([`--effective-date must be after ${latest.effectiveUtcDate}, found ${effectiveDate}`])
    }
  }
  return [...versions, { effectiveUtcDate: effectiveDate, orderedCityIds: cityIds }]
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Writes the routes and the catalog. Everything is checked before the first file is written. */
export function importContent(options: { root?: string; effectiveDate?: string } = {}): void {
  const root = options.root ?? repoRoot
  const { routes, cities } = readContent(root)
  const catalog: Catalog = {
    cities,
    versions: nextVersions(
      readVersions(root),
      cities.map((city) => city.id),
      options.effectiveDate,
    ),
  }
  mkdirSync(path.join(root, routesDir), { recursive: true })
  for (const route of routes) writeFileSync(path.join(root, routesDir, `${route.id}.json`), serialize(route))
  writeFileSync(path.join(root, catalogPath), serialize(catalog))
}

function parseCommandLine(): { root?: string; effectiveDate?: string } {
  const { values } = parseArgs({
    options: { root: { type: 'string' }, 'effective-date': { type: 'string' } },
    allowPositionals: false,
  })
  const effectiveDate = values['effective-date']
  if (effectiveDate !== undefined) {
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) &&
      new Date(`${effectiveDate}T00:00:00Z`).toISOString().startsWith(effectiveDate)
    if (!valid) throw new ContentImportError([`--effective-date must be a valid YYYY-MM-DD date, found "${effectiveDate}"`])
  }
  return { root: values.root && path.resolve(values.root), effectiveDate }
}

if (import.meta.main) {
  try {
    importContent(parseCommandLine())
  } catch (error) {
    const readable = error instanceof ContentImportError || (error instanceof TypeError && 'code' in error)
    if (!readable) throw error
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
