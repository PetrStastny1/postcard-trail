import { createLocalAdapter } from './local.ts'
import type { PlatformAdapter } from './types.ts'

export function createPlatform(): PlatformAdapter {
  return createLocalAdapter({
    development: import.meta.env.DEV,
    search: location.search,
    openStorage: () => localStorage,
  })
}
