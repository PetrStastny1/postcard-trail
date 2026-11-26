import type { Feedback, FeedbackSettings } from '../game/feedback/index.ts'
import { GameStorage } from '../game/storage/gameStorage.ts'
import type { Settings } from '../game/storage/schema.ts'
import type { PlatformAdapter } from '../platform/types.ts'

/** Everything the screens share for one page load. */
export interface GameSession {
  adapter: PlatformAdapter
  storage: GameStorage
  feedback: Feedback
  settings: Settings
}

export interface StartOptions {
  adapter: PlatformAdapter
  /** Created once per page load, so a reload is a new tab owner. */
  tabId: string
  createFeedback(settings: FeedbackSettings): Feedback
  /** Renders the title screen; loading is reported finished right after it returns. */
  showTitle(session: GameSession): void
}

export async function startGame({ adapter, tabId, createFeedback, showTitle }: StartOptions): Promise<GameSession> {
  adapter.loadingStarted()
  await adapter.init()
  const storage = new GameStorage(adapter.store, tabId)
  const settings = storage.loadSettings()
  const feedback = createFeedback({ sound: settings.soundEnabled, vibration: settings.vibrationEnabled })
  feedback.setPortalMuted(adapter.portalAudioMuted())
  adapter.onPortalAudioMutedChange((muted) => feedback.setPortalMuted(muted))
  const session: GameSession = { adapter, storage, feedback, settings }
  showTitle(session)
  adapter.loadingFinished()
  return session
}
