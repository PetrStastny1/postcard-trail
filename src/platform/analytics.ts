import type { AnalyticsEvent } from './types.ts'

/** Production builds keep nothing, so no session data piles up in memory. */
export function createAnalyticsRecorder(development: boolean) {
  const events: AnalyticsEvent[] = []
  return {
    record(event: AnalyticsEvent) {
      if (development) events.push(event)
    },
    recordedEvents: (): readonly AnalyticsEvent[] => [...events],
  }
}
