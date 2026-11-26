import type { AnalyticsEvent } from './types.ts'

export interface AnalyticsRecorder {
  record(event: AnalyticsEvent): void
  recordedEvents(): readonly AnalyticsEvent[]
}

/** Production builds keep nothing, so no session data piles up in memory. */
export function createAnalyticsRecorder(development: boolean): AnalyticsRecorder {
  const events: AnalyticsEvent[] = []
  return {
    record(event) {
      if (development) events.push(event)
    },
    recordedEvents: () => [...events],
  }
}
