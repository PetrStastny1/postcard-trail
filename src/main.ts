import { mountApp } from './app/app.ts'
import { startGame } from './app/start.ts'
import { catalog } from './content/catalog.ts'
import { createFeedback } from './game/feedback/index.ts'
import type { AnalyticsEvent } from './platform/types.ts'
import { createPlatform } from './platform/index.ts'

declare global {
  interface Window {
    /** Development builds only: lets Playwright read the tracked events. */
    __postcardTrail?: { recordedEvents(): readonly AnalyticsEvent[] }
  }
}

// A rejected start stays unhandled on purpose: the player sees the error state, the console and portals get the error.
void startGame({
  createAdapter: () => {
    const adapter = createPlatform()
    // Vite replaces import.meta.env.DEV with false in production builds, so the export is dropped there.
    if (import.meta.env.DEV) window.__postcardTrail = { recordedEvents: () => adapter.recordedEvents() }
    return adapter
  },
  createTabId: () => crypto.randomUUID(),
  createFeedback,
  showTitle: (session) => {
    const root = document.querySelector<HTMLElement>('#app')
    if (!root) throw new Error('The page has no #app element.')
    mountApp(root, session, catalog)
  },
  showLoadError: () => document.querySelector('#boot')?.setAttribute('data-state', 'error'),
})
