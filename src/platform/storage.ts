import type { KeyValueStore } from './types.ts'

const KEY_PREFIX = 'postcard-trail:'

/**
 * `openStorage` runs on every call because merely reading `window.localStorage` throws
 * when site data is blocked; creating the store must not.
 */
export function createLocalStorageStore(openStorage: () => Storage): KeyValueStore {
  return {
    read: (key) => openStorage().getItem(KEY_PREFIX + key),
    write: (key, value) => openStorage().setItem(KEY_PREFIX + key, value),
  }
}
