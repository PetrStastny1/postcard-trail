import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { maxSceneBytes, sceneSize } from './scene-limits.ts'

const repoRoot = path.resolve(import.meta.dirname, '../..')

const catalogPath = 'src/content/catalog.json'
const routesDir = 'src/content/routes'
const tokensPath = 'src/styles/tokens.css'
const scenesDir = 'public/scenes'
const placeholdersPath = 'public/scenes/placeholders.json'

// Flat shapes compress well, so the first quality is usually far below the limit; lower ones are a fallback.
const webpQualities = [0.85, 0.7, 0.55, 0.4]

const paletteNames = [
  'stone',
  'cream',
  'light',
  'navy',
  'violet',
  'ochre',
  'water',
  'reflection',
  'dusk',
  'leaf',
  'underground-yellow',
  'underground-green',
  'underground-ivory',
] as const

export type ScenePalette = Record<(typeof paletteNames)[number], string>

export type SceneShape =
  | { kind: 'gradient'; y: number; height: number; from: string; to: string }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; color: string }
  | { kind: 'roundedRect'; x: number; y: number; width: number; height: number; radius: number; color: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string }
  | { kind: 'upperHalfCircle'; cx: number; cy: number; r: number; color: string }
  | { kind: 'polygon'; points: [number, number][]; color: string }
  | { kind: 'text'; text: string; x: number; y: number; fontSize: number; color: string }

/** What the browser draws, in painting order. Pure data, so tests can inspect every colour and text. */
export interface SceneComposition {
  size: number
  shapes: SceneShape[]
}

/** Problems that stop the generator. The CLI prints them without a stack trace. */
export class PlaceholderError extends Error {
  constructor(problems: string[]) {
    super(`Placeholder scenes failed:\n${problems.join('\n')}`)
  }
}

/** Reads the `--scene-*` colours from tokens.css, the single source of the illustration palette. */
export function readPalette(root = repoRoot): ScenePalette {
  const css = readSource(root, tokensPath)
  const declared = new Map([...css.matchAll(/--scene-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((match) => [match[1], match[2].toLowerCase()]))
  const missing = paletteNames.filter((name) => !declared.has(name))
  if (missing.length > 0) {
    throw new PlaceholderError(missing.map((name) => `${tokensPath}: missing colour --scene-${name}`))
  }
  return Object.fromEntries(paletteNames.map((name) => [name, declared.get(name)])) as ScenePalette
}

function readSource(root: string, relativePath: string): string {
  const absolutePath = path.join(root, relativePath)
  if (!existsSync(absolutePath)) throw new PlaceholderError([`${relativePath}: file not found`])
  return readFileSync(absolutePath, 'utf8')
}

function parseJson(relativePath: string, source: string): unknown {
  try {
    return JSON.parse(source)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new PlaceholderError([`${relativePath}: not valid JSON (${error.message})`])
  }
}

/** The IDs of `listing[key]`, or undefined when it is not a list of objects with a string `id`. */
function idsOf(listing: unknown, key: string): string[] | undefined {
  const entries = typeof listing === 'object' && listing !== null && key in listing ? (listing as Record<string, unknown>)[key] : undefined
  if (!Array.isArray(entries)) return undefined
  const ids = entries.map((entry: unknown) =>
    typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string' ? entry.id : undefined,
  )
  return ids.every((id) => id !== undefined) ? ids : undefined
}

/** Stop IDs in catalog order, then route order. The generator reads only city and stop IDs. */
export function readStopIds(root = repoRoot): string[] {
  const cityIds = idsOf(parseJson(catalogPath, readSource(root, catalogPath)), 'cities')
  if (!cityIds) throw new PlaceholderError([`${catalogPath}: expected { "cities": [{ "id": string }] }`])
  return cityIds.flatMap((cityId) => {
    const routePath = `${routesDir}/${cityId}.json`
    const stopIds = idsOf(parseJson(routePath, readSource(root, routePath)), 'stops')
    if (!stopIds) throw new PlaceholderError([`${routePath}: expected { "stops": [{ "id": string }] }`])
    return stopIds
  })
}

// FNV-1a and mulberry32: a stable seed per stop ID and a small reproducible sequence, so a scene never changes between runs.
function seedFrom(stopId: string): number {
  let hash = 0x811c9dc5
  for (const char of stopId) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function sequence(seed: number) {
  let state = seed
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  return {
    between: (min: number, max: number) => Math.round(min + next() * (max - min)),
    pick: <T>(options: readonly T[]): T => options[Math.floor(next() * options.length)],
  }
}

type Sequence = ReturnType<typeof sequence>

interface StreetMood {
  skyTop: string
  skyBottom: string
  sun: string
  far: string
  middle: string
  near: string
  windows: string
  ground: string
  ripple: string
  plate: string
  label: string
}

/** A backdrop with the label colours that stand out against its ground. */
interface Backdrop {
  shapes: SceneShape[]
  plate: string
  label: string
}

function streetMoods(palette: ScenePalette): StreetMood[] {
  return [
    {
      skyTop: palette.dusk,
      skyBottom: palette.reflection,
      sun: palette.light,
      far: palette.violet,
      middle: palette.ochre,
      near: palette.navy,
      windows: palette.cream,
      ground: palette.water,
      ripple: palette.reflection,
      plate: palette.navy,
      label: palette.light,
    },
    {
      skyTop: palette.water,
      skyBottom: palette.light,
      sun: palette.cream,
      far: palette.leaf,
      middle: palette.stone,
      near: palette.ochre,
      windows: palette.light,
      ground: palette.water,
      ripple: palette.light,
      plate: palette.navy,
      label: palette.light,
    },
    {
      skyTop: palette.navy,
      skyBottom: palette.violet,
      sun: palette.light,
      far: palette.water,
      middle: palette.violet,
      near: palette.navy,
      windows: palette.stone,
      ground: palette.navy,
      ripple: palette.stone,
      plate: palette.cream,
      label: palette.navy,
    },
    {
      skyTop: palette.reflection,
      skyBottom: palette.cream,
      sun: palette.light,
      far: palette.dusk,
      middle: palette.leaf,
      near: palette.violet,
      windows: palette.cream,
      ground: palette.leaf,
      ripple: palette.cream,
      plate: palette.navy,
      label: palette.light,
    },
  ]
}

function skyline(random: Sequence, baseY: number, minHeight: number, maxHeight: number, color: string): SceneShape[] {
  const shapes: SceneShape[] = []
  let x = -random.between(0, 60)
  while (x < sceneSize) {
    const width = random.between(90, 220)
    const height = random.between(minHeight, maxHeight)
    const top = baseY - height
    shapes.push({ kind: 'rect', x, y: top, width, height, color })
    const roof = random.pick(['flat', 'gable', 'dome', 'spire'] as const)
    if (roof === 'gable') {
      shapes.push({ kind: 'polygon', points: [[x, top], [x + width / 2, top - width * 0.4], [x + width, top]], color })
    } else if (roof === 'dome') {
      shapes.push({ kind: 'circle', cx: x + width / 2, cy: top, r: width * 0.35, color })
    } else if (roof === 'spire') {
      const middle = x + width / 2
      shapes.push({ kind: 'polygon', points: [[middle - 20, top], [middle, top - random.between(120, 260)], [middle + 20, top]], color })
    }
    x += width + random.between(-20, 30)
  }
  return shapes
}

function windows(random: Sequence, baseY: number, color: string): SceneShape[] {
  const shapes: SceneShape[] = []
  const columns = random.between(8, 14)
  const rows = random.between(2, 4)
  const spacing = sceneSize / columns
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (random.between(0, 2) === 0) continue
      shapes.push({ kind: 'rect', x: column * spacing + spacing * 0.35, y: baseY - 60 - row * 70, width: 18, height: 34, color })
    }
  }
  return shapes
}

function streetScene(random: Sequence, mood: StreetMood): Backdrop {
  const horizon = random.between(820, 940)
  const shapes: SceneShape[] = [
    { kind: 'gradient', y: 0, height: horizon, from: mood.skyTop, to: mood.skyBottom },
    { kind: 'circle', cx: random.between(220, 1060), cy: random.between(200, 420), r: random.between(70, 140), color: mood.sun },
    ...skyline(random, horizon, 260, 480, mood.far),
    ...skyline(random, horizon, 140, 320, mood.middle),
    ...windows(random, horizon, mood.windows),
    { kind: 'rect', x: 0, y: horizon, width: sceneSize, height: sceneSize - horizon, color: mood.ground },
    ...skyline(random, horizon + 30, 40, 140, mood.near),
  ]
  const ripples = random.between(4, 8)
  for (let index = 0; index < ripples; index++) {
    const width = random.between(80, 260)
    shapes.push({
      kind: 'rect',
      x: random.between(80, sceneSize - 80 - width),
      y: horizon + 60 + index * 40,
      width,
      height: 8,
      color: mood.ripple,
    })
  }
  return { shapes, plate: mood.plate, label: mood.label }
}

function undergroundScene(random: Sequence, palette: ScenePalette): Backdrop {
  const platform = random.between(860, 940)
  const tile = random.between(56, 96)
  const shapes: SceneShape[] = [{ kind: 'rect', x: 0, y: 0, width: sceneSize, height: platform, color: palette['underground-green'] }]
  const firstRow = random.between(380, 460)
  for (let row = 0; firstRow + row * tile < platform - tile / 2; row++) {
    const y = firstRow + row * tile
    for (let x = row % 2 === 0 ? 0 : -tile / 2; x < sceneSize; x += tile) {
      shapes.push({ kind: 'rect', x: x + 3, y: y + 3, width: tile - 6, height: tile - 6, color: palette['underground-ivory'] })
    }
  }
  const arches = random.between(2, 4)
  const archWidth = sceneSize / arches
  for (let index = 0; index < arches; index++) {
    const cx = archWidth * index + archWidth / 2
    shapes.push({ kind: 'upperHalfCircle', cx, cy: 380, r: archWidth * 0.42, color: palette.navy })
    shapes.push({ kind: 'rect', x: cx - archWidth * 0.42, y: 380, width: archWidth * 0.84, height: 60, color: palette.navy })
  }
  const lamps = random.between(3, 6)
  for (let index = 0; index < lamps; index++) {
    const cx = (sceneSize / lamps) * (index + 0.5)
    shapes.push({ kind: 'rect', x: cx - 3, y: 0, width: 6, height: 120, color: palette.navy })
    shapes.push({ kind: 'circle', cx, cy: 140, r: 26, color: palette['underground-yellow'] })
  }
  shapes.push(
    { kind: 'rect', x: 0, y: platform, width: sceneSize, height: sceneSize - platform, color: palette.navy },
    { kind: 'rect', x: 0, y: platform, width: sceneSize, height: 18, color: palette['underground-yellow'] },
  )
  return { shapes, plate: palette['underground-yellow'], label: palette.navy }
}

/** The placeholder scene of one stop. The same ID always gives the same composition. */
export function sceneComposition(stopId: string, palette: ScenePalette): SceneComposition {
  const random = sequence(seedFrom(stopId))
  const drawBackdrop = random.pick([
    ...streetMoods(palette).map((mood) => () => streetScene(random, mood)),
    () => undergroundScene(random, palette),
  ])
  const { shapes, plate, label } = drawBackdrop()
  const plateWidth = 520
  const plateHeight = 160
  const plateX = (sceneSize - plateWidth) / 2
  const plateY = random.between(1040, 1080)
  shapes.push(
    { kind: 'roundedRect', x: plateX, y: plateY, width: plateWidth, height: plateHeight, radius: 32, color: plate },
    { kind: 'text', text: stopId, x: sceneSize / 2, y: plateY + plateHeight / 2, fontSize: 104, color: label },
  )
  return { size: sceneSize, shapes }
}

export interface ScenePlan {
  /** Catalog stops drawn by the generator, in catalog order: no file yet, or a file listed as placeholder. */
  placeholders: string[]
  /** Listed placeholders that no longer belong to a catalog stop. */
  remove: string[]
  /** Files that are neither a catalog stop scene nor a listed placeholder; the generator refuses to touch them. */
  unknownFiles: string[]
}

/**
 * Decides what to draw, keep and delete. A file whose ID is not listed as placeholder is a final scene.
 * Hidden files such as `.DS_Store` come from the file manager, not from the scene workflow, so they are ignored.
 */
export function planScenes(stopIds: string[], listedPlaceholders: string[], directoryFiles: string[]): ScenePlan {
  const sceneFiles = directoryFiles.filter((file) => !file.startsWith('.'))
  const listed = new Set(listedPlaceholders)
  const fileIds = new Set(sceneFiles.filter((file) => file.endsWith('.webp')).map((file) => file.slice(0, -'.webp'.length)))
  const catalogIds = new Set(stopIds)
  const isFinal = (stopId: string) => fileIds.has(stopId) && !listed.has(stopId)
  const strayFiles = sceneFiles.filter((file) => {
    if (file === 'placeholders.json') return false
    if (!file.endsWith('.webp')) return true
    const stopId = file.slice(0, -'.webp'.length)
    return !catalogIds.has(stopId) && !listed.has(stopId)
  })
  const placeholders = stopIds.filter((stopId) => !isFinal(stopId))
  return {
    placeholders,
    remove: [...fileIds].filter((stopId) => !catalogIds.has(stopId) && listed.has(stopId)).sort(),
    unknownFiles: strayFiles.sort(),
  }
}

/**
 * Without the list a final scene cannot be told from a placeholder, so the generator draws from scratch
 * only when there are no scenes either.
 */
function readListedPlaceholders(root: string, sceneFiles: string[]): string[] {
  if (!existsSync(path.join(root, placeholdersPath))) {
    const scenes = sceneFiles.filter((file) => !file.startsWith('.') && file.endsWith('.webp')).sort()
    if (scenes.length === 0) return []
    throw new PlaceholderError([
      `${placeholdersPath}: file not found while ${scenesDir} has scenes, so final scenes cannot be told from placeholders.` +
        ' Restore the list (for example with git checkout) or move these scenes away:',
      ...scenes.map((file) => `${scenesDir}/${file}`),
    ])
  }
  const listing = parseJson(placeholdersPath, readSource(root, placeholdersPath))
  const stopIds = typeof listing === 'object' && listing !== null && 'stopIds' in listing ? listing.stopIds : undefined
  if (!Array.isArray(stopIds) || !stopIds.every((stopId) => typeof stopId === 'string')) {
    throw new PlaceholderError([`${placeholdersPath}: expected { "stopIds": string[] }; fix the file or restore it from git`])
  }
  return stopIds
}

// Runs inside Chromium; it must not reference anything outside its own body.
function drawScene([composition, qualities, maxBytes]: [SceneComposition, number[], number]): string {
  const canvas = document.createElement('canvas')
  canvas.width = composition.size
  canvas.height = composition.size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is not available')
  for (const shape of composition.shapes) {
    context.beginPath()
    if (shape.kind === 'gradient') {
      const gradient = context.createLinearGradient(0, shape.y, 0, shape.y + shape.height)
      gradient.addColorStop(0, shape.from)
      gradient.addColorStop(1, shape.to)
      context.fillStyle = gradient
      context.fillRect(0, shape.y, composition.size, shape.height)
      continue
    }
    context.fillStyle = shape.color
    if (shape.kind === 'rect') context.rect(shape.x, shape.y, shape.width, shape.height)
    if (shape.kind === 'roundedRect') context.roundRect(shape.x, shape.y, shape.width, shape.height, shape.radius)
    if (shape.kind === 'circle') context.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2)
    if (shape.kind === 'upperHalfCircle') context.arc(shape.cx, shape.cy, shape.r, Math.PI, Math.PI * 2)
    if (shape.kind === 'polygon') shape.points.forEach(([x, y]) => context.lineTo(x, y))
    if (shape.kind === 'text') {
      context.font = `700 ${shape.fontSize}px system-ui, sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(shape.text, shape.x, shape.y)
      continue
    }
    context.fill()
  }
  let dataUrl = ''
  for (const quality of qualities) {
    dataUrl = canvas.toDataURL('image/webp', quality)
    if (atob(dataUrl.slice(dataUrl.indexOf(',') + 1)).length <= maxBytes) break
  }
  return dataUrl
}

async function renderScenes(compositions: Map<string, SceneComposition>): Promise<Map<string, Buffer>> {
  const browser = await chromium.launch().catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("Executable doesn't exist")) {
      throw new PlaceholderError([
        'Chromium for Playwright is not installed. Install it with: npx playwright install chromium',
      ])
    }
    throw error
  })
  try {
    const page = await browser.newPage()
    const scenes = new Map<string, Buffer>()
    const problems: string[] = []
    for (const [stopId, composition] of compositions) {
      const dataUrl = await page.evaluate(drawScene, [composition, webpQualities, maxSceneBytes] as [SceneComposition, number[], number])
      if (!dataUrl.startsWith('data:image/webp;base64,')) {
        throw new PlaceholderError(['Chromium did not encode the canvas as WebP'])
      }
      const scene = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      if (scene.length <= maxSceneBytes) scenes.set(stopId, scene)
      else problems.push(`${stopId}: scene stays above ${maxSceneBytes} bytes even at the lowest WebP quality`)
    }
    if (problems.length > 0) throw new PlaceholderError(problems)
    return scenes
  } finally {
    await browser.close()
  }
}

/** Draws the missing and placeholder scenes and rewrites placeholders.json. Nothing is written when a check fails. */
export async function generatePlaceholders(options: { root?: string } = {}): Promise<ScenePlan> {
  const root = options.root ?? repoRoot
  const palette = readPalette(root)
  const stopIds = readStopIds(root)
  const directory = path.join(root, scenesDir)
  const sceneFiles = existsSync(directory) ? readdirSync(directory) : []
  const plan = planScenes(stopIds, readListedPlaceholders(root, sceneFiles), sceneFiles)
  if (plan.unknownFiles.length > 0) {
    throw new PlaceholderError(
      plan.unknownFiles.map((file) => `${scenesDir}/${file}: not a scene of a catalog stop and not a listed placeholder; remove or rename it by hand`),
    )
  }
  const scenes =
    plan.placeholders.length > 0
      ? await renderScenes(new Map(plan.placeholders.map((stopId) => [stopId, sceneComposition(stopId, palette)])))
      : new Map<string, Buffer>()
  mkdirSync(directory, { recursive: true })
  for (const [stopId, scene] of scenes) writeFileSync(path.join(directory, `${stopId}.webp`), scene)
  for (const stopId of plan.remove) rmSync(path.join(directory, `${stopId}.webp`))
  writeFileSync(path.join(root, placeholdersPath), `${JSON.stringify({ stopIds: plan.placeholders }, null, 2)}\n`)
  return plan
}

function parseCommandLine(): { root?: string } {
  const { values } = parseArgs({ options: { root: { type: 'string' } }, allowPositionals: false })
  return { root: values.root && path.resolve(values.root) }
}

if (import.meta.main) {
  try {
    const plan = await generatePlaceholders(parseCommandLine())
    process.stdout.write(
      `Drew ${plan.placeholders.length} placeholder scenes listed in ${placeholdersPath}, removed ${plan.remove.length} outside the catalog\n`,
    )
  } catch (error) {
    const readable = error instanceof PlaceholderError || (error instanceof TypeError && 'code' in error)
    if (!readable) throw error
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  }
}
