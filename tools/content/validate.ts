import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Route } from '../../src/content/types.ts'

const routesDir = path.resolve(import.meta.dirname, '../../src/content/routes')

export function routeProblems(routes: Route[]): string[] {
  const problems: string[] = []
  const seenStopIds = new Set<string>()
  for (const route of routes) {
    if (route.stops.length !== 10) problems.push(`${route.id}: expected 10 stops, found ${route.stops.length}`)
    for (const stop of route.stops) {
      if (seenStopIds.has(stop.id)) problems.push(`${stop.id}: duplicate stop ID`)
      seenStopIds.add(stop.id)
      const choiceIds = new Set(stop.choices.map((choice) => choice.id))
      if (choiceIds.size !== 4) problems.push(`${stop.id}: choice IDs must be four distinct values`)
      if (!choiceIds.has(stop.correctChoiceId)) problems.push(`${stop.id}: correct choice is not among the choices`)
    }
  }
  return problems
}

function readRoutes(): Route[] {
  if (!existsSync(routesDir)) return []
  return readdirSync(routesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(path.join(routesDir, file), 'utf8')) as Route)
}

if (import.meta.main) {
  const problems = routeProblems(readRoutes())
  if (problems.length > 0) {
    process.stderr.write(`Content validation failed:\n${problems.join('\n')}\n`)
    process.exit(1)
  }
}
