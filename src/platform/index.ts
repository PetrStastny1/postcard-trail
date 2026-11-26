import { createCrazyGamesAdapter, loadCrazyGamesSdk } from './crazygames.ts'
import { createLocalAdapter } from './local.ts'
import { createPokiAdapter, loadPokiSdk } from './poki.ts'
import type { PlatformAdapter } from './types.ts'

// Vite inlines VITE_PLATFORM, so each build keeps only its own branch and SDK address.
export function createPlatform(): PlatformAdapter {
  const development = import.meta.env.DEV
  const openStorage = () => localStorage
  if (import.meta.env.VITE_PLATFORM === 'poki') {
    return createPokiAdapter({ development, openStorage, loadSdk: loadPokiSdk })
  }
  if (import.meta.env.VITE_PLATFORM === 'crazygames') {
    return createCrazyGamesAdapter({ development, openStorage, loadSdk: loadCrazyGamesSdk })
  }
  return createLocalAdapter({ development, search: location.search, openStorage })
}
