import type { Route } from './types.ts'

// Lazy glob: Vite emits every route as its own chunk, so the entry chunk carries no route texts.
const routeLoaders = import.meta.glob<Route>('./routes/*.json', { import: 'default' })

export function loadRoute(cityId: string): Promise<Route> {
  const load = routeLoaders[`./routes/${cityId}.json`]
  if (!load) return Promise.reject(new Error(`Unknown route "${cityId}"`))
  return load()
}
