import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import type { Catalog, Locale, Route, Stop } from '../../src/content/types.ts'
import { ContentImportError, readContent } from './import.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')

const routesDir = 'src/content/routes'
const catalogPath = 'src/content/catalog.json'
const i18nDir = 'src/i18n'

const locales: Locale[] = ['en', 'cs']
const releasedCityCount = 20
const stopsPerRoute = 10
const stopIdPattern = /^[A-Z]+[0-9]{2}$/
const countryQuestionStops = ['PAR02', 'P01']
const metroStop = {
  id: 'B09',
  question: { en: 'Which metro line are you waiting for?', cs: 'Na kterou linku metra právě čekáš?' },
  lines: ['M1', 'M2', 'M3', 'M4'],
}

// Word forms are matched on folded text, so `zemekouli` (globe) or `statue` do not count.
const countryQuestionWords: Record<Locale, RegExp> = {
  en: /\b(flags?|country|countries|states?)\b/,
  cs: /\b(vlajk\w*|vlajce|stat|statu|state|statem|staty|statni\w*|zem|zeme|zemi|zemim|zemich|zememi)\b/,
}

/** Lines prefixed with the route, stop or file they belong to. */
type Problems = string[]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Case- and diacritics-insensitive form for the answer leak checks. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = fold(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(fold(text))
}


function checkString(value: unknown, field: string, problems: Problems) {
  if (typeof value !== 'string') problems.push(`"${field}" must be a string`)
}

function checkLocalized(value: unknown, field: string, problems: Problems) {
  if (!isObject(value)) {
    problems.push(`"${field}" must be an object with "en" and "cs" strings`)
    return
  }
  for (const locale of locales) checkString(value[locale], `${field}.${locale}`, problems)
}

function checkCoordinates(value: unknown, problems: Problems) {
  const valid = isObject(value) && Number.isFinite(value.lat) && Number.isFinite(value.lon)
  if (!valid) problems.push('"coordinates" must be an object with numeric "lat" and "lon"')
}

function checkStringArray(value: unknown, field: string, problems: Problems) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    problems.push(`"${field}" must be an array of strings`)
  }
}

function stopStructureProblems(stop: unknown): Problems {
  if (!isObject(stop)) return ['stop must be an object']
  const problems: Problems = []
  for (const field of ['id', 'difficulty', 'sceneAsset', 'correctChoiceId', 'verifiedOn', 'stability']) {
    checkString(stop[field], field, problems)
  }
  for (const field of ['place', 'sceneAlt', 'question', 'feedback']) checkLocalized(stop[field], field, problems)
  for (const field of ['sourceUrls', 'photoReferenceUrls']) checkStringArray(stop[field], field, problems)
  for (const field of ['changeableFact', 'distinguishingFeature']) {
    if (field in stop) checkString(stop[field], field, problems)
  }
  if (!Array.isArray(stop.choices) || stop.choices.length !== 4) {
    problems.push('"choices" must be an array of exactly 4 choices')
  } else {
    stop.choices.forEach((choice: unknown, index) => {
      if (!isObject(choice)) {
        problems.push(`"choices[${index}]" must be an object with "id" and "label"`)
        return
      }
      checkString(choice.id, `choices[${index}].id`, problems)
      checkLocalized(choice.label, `choices[${index}].label`, problems)
    })
  }
  return problems
}

function routeStructureProblems(fileCityId: string, route: unknown): Problems {
  if (!isObject(route)) return [`${fileCityId}: route must be an object`]
  const problems: Problems = []
  checkString(route.id, 'id', problems)
  checkLocalized(route.name, 'name', problems)
  checkCoordinates(route.coordinates, problems)
  checkString(route.postcardQuestionId, 'postcardQuestionId', problems)
  const routeProblems = problems.map((problem) => `${fileCityId}: ${problem}`)
  if (!Array.isArray(route.stops)) return [...routeProblems, `${fileCityId}: "stops" must be an array`]
  route.stops.forEach((stop: unknown, index) => {
    const stopLabel = isObject(stop) && typeof stop.id === 'string' ? stop.id : `stops[${index}]`
    routeProblems.push(...stopStructureProblems(stop).map((problem) => `${fileCityId} ${stopLabel}: ${problem}`))
  })
  return routeProblems
}

function catalogStructureProblems(catalog: unknown): Problems {
  if (!isObject(catalog)) return ['catalog: must be an object with "cities" and "versions"']
  const problems: Problems = []
  if (!Array.isArray(catalog.cities)) problems.push('catalog: "cities" must be an array')
  else {
    catalog.cities.forEach((city: unknown, index) => {
      const cityLabel = isObject(city) && typeof city.id === 'string' ? city.id : `cities[${index}]`
      if (!isObject(city)) {
        problems.push(`catalog ${cityLabel}: city must be an object`)
        return
      }
      const cityProblems: Problems = []
      checkString(city.id, 'id', cityProblems)
      checkLocalized(city.name, 'name', cityProblems)
      checkCoordinates(city.coordinates, cityProblems)
      if (!isObject(city.postcard)) cityProblems.push('"postcard" must be an object')
      else {
        checkString(city.postcard.stopId, 'postcard.stopId', cityProblems)
        checkString(city.postcard.sceneAsset, 'postcard.sceneAsset', cityProblems)
        checkLocalized(city.postcard.sentence, 'postcard.sentence', cityProblems)
      }
      problems.push(...cityProblems.map((problem) => `catalog ${cityLabel}: ${problem}`))
    })
  }
  if (!Array.isArray(catalog.versions)) problems.push('catalog: "versions" must be an array')
  else {
    catalog.versions.forEach((version: unknown, index) => {
      const versionProblems: Problems = []
      if (!isObject(version)) versionProblems.push('version must be an object')
      else {
        checkString(version.effectiveUtcDate, 'effectiveUtcDate', versionProblems)
        checkStringArray(version.orderedCityIds, 'orderedCityIds', versionProblems)
      }
      problems.push(...versionProblems.map((problem) => `catalog versions[${index}]: ${problem}`))
    })
  }
  return problems
}

function readJson(root: string, relativePath: string, problems: Problems): unknown {
  try {
    return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    problems.push(`${relativePath}: invalid JSON (${error.message})`)
    return undefined
  }
}

interface CommittedContent {
  catalog: Catalog
  /** Keyed by the file name without `.json`. */
  routesByFile: Map<string, Route>
}

function readCommittedContent(root: string, problems: Problems): CommittedContent | undefined {
  const problemCount = problems.length
  let catalog: unknown
  if (!existsSync(path.join(root, catalogPath))) problems.push(`${catalogPath}: file not found`)
  else {
    catalog = readJson(root, catalogPath, problems)
    if (problems.length === problemCount) problems.push(...catalogStructureProblems(catalog))
  }
  const routesByFile = new Map<string, Route>()
  if (!existsSync(path.join(root, routesDir))) problems.push(`${routesDir}: directory not found`)
  else {
    for (const file of readdirSync(path.join(root, routesDir)).filter((name) => name.endsWith('.json')).sort()) {
      const fileCityId = file.slice(0, -'.json'.length)
      const fileProblemCount = problems.length
      const route = readJson(root, `${routesDir}/${file}`, problems)
      if (problems.length > fileProblemCount) continue
      const structureProblems = routeStructureProblems(fileCityId, route)
      problems.push(...structureProblems)
      if (structureProblems.length === 0) routesByFile.set(fileCityId, route as Route)
    }
  }
  if (problems.length > problemCount) return undefined
  return { catalog: catalog as Catalog, routesByFile }
}


function routeFileProblems({ catalog, routesByFile }: CommittedContent): Problems {
  const problems: Problems = []
  const catalogIds = catalog.cities.map((city) => city.id)
  if (routesByFile.size !== catalogIds.length) {
    problems.push(`${routesDir}: found ${routesByFile.size} routes, the catalog lists ${catalogIds.length} cities`)
  }
  for (const cityId of catalogIds) {
    if (!routesByFile.has(cityId)) problems.push(`${cityId}: catalog city has no file ${routesDir}/${cityId}.json`)
  }
  for (const [fileCityId, route] of routesByFile) {
    if (!catalogIds.includes(fileCityId)) problems.push(`${fileCityId}: route file is not a city of the catalog`)
    if (route.id !== fileCityId) problems.push(`${fileCityId}: route id "${route.id}" differs from its file name`)
  }
  return problems
}

function catalogProblems(catalog: Catalog, routesByFile: Map<string, Route>): Problems {
  const problems: Problems = []
  const cityIds = catalog.cities.map((city) => city.id)
  if (cityIds.length !== releasedCityCount) {
    problems.push(`catalog: expected ${releasedCityCount} cities, found ${cityIds.length}`)
  }
  for (const city of catalog.cities) {
    const { lat, lon } = city.coordinates
    if (lat < 34 || lat > 72 || lon < -25 || lon > 50) {
      problems.push(`catalog ${city.id}: coordinates ${lat}, ${lon} lie outside Europe (lat 34–72, lon −25–50)`)
    }
    const route = routesByFile.get(city.id)
    if (!route) continue
    if (!isDeepStrictEqual(city.name, route.name)) problems.push(`catalog ${city.id}: name differs from the route`)
    const postcardStop = route.stops.find((stop) => stop.id === route.postcardQuestionId)
    if (!postcardStop) continue
    if (city.postcard.stopId !== postcardStop.id) {
      problems.push(`catalog ${city.id}: postcard stop ${city.postcard.stopId} differs from postcardQuestionId ${postcardStop.id}`)
    }
    if (city.postcard.sceneAsset !== postcardStop.sceneAsset) {
      problems.push(`catalog ${city.id}: postcard sceneAsset differs from stop ${postcardStop.id}`)
    }
    if (!isDeepStrictEqual(city.postcard.sentence, postcardStop.feedback)) {
      problems.push(`catalog ${city.id}: postcard sentence differs from the feedback of stop ${postcardStop.id}`)
    }
  }

  const { versions } = catalog
  if (versions.length === 0) problems.push('catalog: "versions" must contain at least one version')
  versions.forEach((version, index) => {
    if (!isIsoDate(version.effectiveUtcDate)) {
      problems.push(`catalog versions[${index}]: effectiveUtcDate "${version.effectiveUtcDate}" is not a valid YYYY-MM-DD date`)
    }
    const previous = versions[index - 1]
    if (!previous) {
      if (version.orderedCityIds.length === 0) problems.push(`catalog versions[${index}]: orderedCityIds is empty`)
      return
    }
    if (version.effectiveUtcDate <= previous.effectiveUtcDate) {
      problems.push(`catalog versions[${index}]: effectiveUtcDate must be after ${previous.effectiveUtcDate}`)
    }
    const onlyAppends =
      version.orderedCityIds.length > previous.orderedCityIds.length &&
      previous.orderedCityIds.every((cityId, cityIndex) => version.orderedCityIds[cityIndex] === cityId)
    if (!onlyAppends) {
      problems.push(`catalog versions[${index}]: must keep versions[${index - 1}] and only add cities at the end`)
    }
  })
  const latest = versions.at(-1)
  if (latest && !isDeepStrictEqual(latest.orderedCityIds, cityIds)) {
    problems.push('catalog: the latest version must list the catalog cities in the same order')
  }
  return problems
}

function stopProblems(route: Route, stop: Stop, index: number): Problems {
  const problems: Problems = []
  const expectedDifficulty = index < 4 ? 'easy' : index < 8 ? 'hard' : 'expert'
  if (stop.difficulty !== expectedDifficulty) {
    problems.push(`stop ${index + 1} must be "${expectedDifficulty}", found "${stop.difficulty}"`)
  }
  if (stop.difficulty === 'expert' && !stop.distinguishingFeature?.trim()) {
    problems.push('expert stop needs a non-empty distinguishingFeature')
  }

  const choiceIds = new Set(stop.choices.map((choice) => choice.id))
  if (choiceIds.size !== 4) problems.push('choice IDs must be four distinct values')
  for (const locale of locales) {
    const labels = stop.choices.map((choice) => choice.label[locale].trim())
    if (labels.some((label) => label === '')) problems.push(`${locale} choice labels must not be empty`)
    else if (new Set(labels).size !== 4) problems.push(`${locale} choice labels must be four distinct values`)
  }
  const correctChoice = stop.choices.find((choice) => choice.id === stop.correctChoiceId)
  if (!correctChoice) problems.push(`correct choice "${stop.correctChoiceId}" is not among the choices`)

  if (stop.sceneAsset !== `scenes/${stop.id}.webp`) {
    problems.push(`sceneAsset must be "scenes/${stop.id}.webp", found "${stop.sceneAsset}"`)
  }
  for (const field of ['sourceUrls', 'photoReferenceUrls'] as const) {
    if (stop[field].length === 0) problems.push(`${field} must contain at least one https:// address`)
    for (const url of stop[field].filter((entry) => !URL.canParse(entry) || !entry.startsWith('https://'))) {
      problems.push(`${field} entry "${url}" is not an https:// address`)
    }
  }
  if (!isIsoDate(stop.verifiedOn)) problems.push(`verifiedOn "${stop.verifiedOn}" is not a valid YYYY-MM-DD date`)
  if (stop.stability !== 'stable' && stop.stability !== 'changeable') {
    problems.push(`stability must be "stable" or "changeable", found "${stop.stability}"`)
  }
  if (stop.stability === 'changeable' && !stop.changeableFact?.trim()) {
    problems.push('changeable stop needs a non-empty changeableFact')
  }
  if (stop.stability !== 'changeable' && stop.changeableFact !== undefined) {
    problems.push('changeableFact is allowed only on a changeable stop')
  }

  if (correctChoice) {
    for (const locale of locales) {
      const label = fold(correctChoice.label[locale])
      for (const field of ['question', 'sceneAlt'] as const) {
        if (fold(stop[field][locale]).includes(label)) {
          problems.push(`${field}.${locale} reveals the correct choice "${correctChoice.label[locale]}"`)
        }
      }
    }
  }
  return problems.map((problem) => `${route.id} ${stop.id}: ${problem}`)
}

function routeProblems(routes: Route[]): Problems {
  const problems: Problems = []
  const seenStopIds = new Set<string>()
  for (const route of routes) {
    if (route.stops.length !== stopsPerRoute) {
      problems.push(`${route.id}: expected ${stopsPerRoute} stops, found ${route.stops.length}`)
    }
    if (!route.stops.some((stop) => stop.id === route.postcardQuestionId)) {
      problems.push(`${route.id}: postcardQuestionId ${route.postcardQuestionId} is not a stop of this route`)
    }
    route.stops.forEach((stop, index) => {
      if (!stopIdPattern.test(stop.id)) problems.push(`${route.id} ${stop.id}: stop ID must match ${stopIdPattern}`)
      if (seenStopIds.has(stop.id)) problems.push(`${route.id} ${stop.id}: duplicate stop ID`)
      seenStopIds.add(stop.id)
      problems.push(...stopProblems(route, stop, index))
    })
  }
  return problems
}

function metroStopProblems(routes: Route[]): Problems {
  const route = routes.find((candidate) => candidate.stops.some((stop) => stop.id === metroStop.id))
  const stop = route?.stops.find((candidate) => candidate.id === metroStop.id)
  if (!route || !stop) return [`${metroStop.id}: stop not found`]
  const problems: Problems = []
  for (const locale of locales) {
    if (stop.question[locale] !== metroStop.question[locale]) {
      problems.push(`question.${locale} must be exactly "${metroStop.question[locale]}"`)
    }
    if (!isDeepStrictEqual(stop.choices.map((choice) => choice.label[locale]), metroStop.lines)) {
      problems.push(`${locale} choices must be ${metroStop.lines.join(', ')} in this order`)
    }
  }
  if (stop.correctChoiceId !== stop.choices[0].id) problems.push(`the correct choice must be ${metroStop.lines[0]}`)
  return problems.map((problem) => `${route.id} ${metroStop.id}: ${problem}`)
}

/** Stops whose question asks for a country or a national flag, by keywords in either language. */
export function countryQuestionStopIds(routes: Route[]): string[] {
  return routes
    .flatMap((route) => route.stops)
    .filter((stop) => locales.some((locale) => countryQuestionWords[locale].test(fold(stop.question[locale]))))
    .map((stop) => stop.id)
}

function countryQuestionProblems(routes: Route[]): Problems {
  const routeIdByStop = new Map(routes.flatMap((route) => route.stops.map((stop) => [stop.id, route.id])))
  return countryQuestionStopIds(routes)
    .filter((stopId) => !countryQuestionStops.includes(stopId))
    .map(
      (stopId) =>
        `${routeIdByStop.get(stopId)} ${stopId}: asks about a country or a flag, only ${countryQuestionStops.join(' and ')} may`,
    )
}

function textStrings(value: unknown, keyPath: string): { keyPath: string; text: string }[] {
  if (typeof value === 'string') return [{ keyPath, text: value }]
  if (Array.isArray(value)) return value.flatMap((entry, index) => textStrings(entry, `${keyPath}[${index}]`))
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, entry]) => textStrings(entry, keyPath ? `${keyPath}.${key}` : key))
  }
  return []
}

function i18nProblems(root: string, routes: Route[]): Problems {
  if (!existsSync(path.join(root, i18nDir))) return []
  const problems: Problems = []
  const correctChoices = routes.flatMap((route) =>
    route.stops.flatMap((stop) => {
      const choice = stop.choices.find((candidate) => candidate.id === stop.correctChoiceId)
      const labels = choice ? new Set(locales.map((locale) => choice.label[locale])) : []
      return [...labels].map((label) => ({ stopId: stop.id, label }))
    }),
  )
  for (const file of readdirSync(path.join(root, i18nDir)).filter((name) => name.endsWith('.json')).sort()) {
    const relativePath = `${i18nDir}/${file}`
    const messages = readJson(root, relativePath, problems)
    for (const { keyPath, text } of textStrings(messages, '')) {
      const leaks = correctChoices.filter(({ label }) => containsPhrase(text, label))
      for (const { stopId, label } of leaks) {
        problems.push(`${relativePath} ${keyPath}: reveals "${label}", the correct choice of stop ${stopId}`)
      }
    }
  }
  return problems
}

function sourceProblems(root: string, { catalog, routesByFile }: CommittedContent): Problems {
  const hint = 'run npm run content:import'
  let source
  try {
    source = readContent(root)
  } catch (error) {
    if (!(error instanceof ContentImportError)) throw error
    return error.message.split('\n').slice(1).map((problem) => `source ${problem}`)
  }
  const problems: Problems = []
  const sourceCityIds = source.cities.map((city) => city.id)
  const catalogCityIds = catalog.cities.map((city) => city.id)
  if (!isDeepStrictEqual(sourceCityIds, catalogCityIds)) {
    problems.push(`catalog: cities must be ${sourceCityIds.join(', ')} in the order of BRIEF §5, ${hint}`)
  }
  for (const route of source.routes) {
    const committed = routesByFile.get(route.id)
    if (committed && !isDeepStrictEqual(committed, route)) {
      problems.push(`${route.id}: route differs from docs/game/cities/${route.id}.md, ${hint}`)
    }
  }
  for (const city of source.cities) {
    const committed = catalog.cities.find((candidate) => candidate.id === city.id)
    if (committed && !isDeepStrictEqual(committed, city)) {
      problems.push(`catalog ${city.id}: city differs from docs/game/cities/${city.id}.md, ${hint}`)
    }
  }
  return problems
}

/** Every content problem under `root`, one line each. Facts are checked only when the structure is valid. */
export function validateContent(root: string = repoRoot): string[] {
  const problems: Problems = []
  const content = readCommittedContent(root, problems)
  if (!content) return problems
  const routes = [...content.routesByFile.values()]
  return [
    ...routeFileProblems(content),
    ...catalogProblems(content.catalog, content.routesByFile),
    ...routeProblems(routes),
    ...metroStopProblems(routes),
    ...countryQuestionProblems(routes),
    ...i18nProblems(root, routes),
    ...sourceProblems(root, content),
  ]
}

function parseCommandLine(): string {
  const { values } = parseArgs({ options: { root: { type: 'string' } }, allowPositionals: false })
  return values.root ? path.resolve(values.root) : repoRoot
}

if (import.meta.main) {
  let problems: string[]
  try {
    problems = validateContent(parseCommandLine())
  } catch (error) {
    if (!(error instanceof TypeError && 'code' in error)) throw error
    problems = [error.message]
  }
  if (problems.length > 0) {
    process.stderr.write(`Content validation failed:\n${problems.join('\n')}\n`)
    process.exit(1)
  }
}
