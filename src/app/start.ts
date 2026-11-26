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
  createAdapter(): PlatformAdapter
  /** Called once per page load, so a reload is a new tab owner. */
  createTabId(): string
  createFeedback(settings: FeedbackSettings): Feedback
  /** Renders the title screen; loading is reported finished right after it returns. */
  showTitle(session: GameSession): void
  /** Turns the static loading screen into its error state with "Try again". */
  showLoadError(): void
}

/** Every step runs inside the promise, so a failure anywhere, even a synchronous one, ends in the error state. */
export async function startGame(options: StartOptions): Promise<GameSession> {
  try {
    return await launch(options)
  } catch (error) {
    options.showLoadError()
    throw error
  }
}

async function launch({ createAdapter, createTabId, createFeedback, showTitle }: StartOptions): Promise<GameSession> {
  const adapter = createAdapter()
  adapter.loadingStarted()
  await adapter.init()
  const storage = new GameStorage(adapter.store, createTabId())
  const settings = storage.loadSettings()
  const feedback = createFeedback({ sound: settings.soundEnabled, vibration: settings.vibrationEnabled })
  feedback.setPortalMuted(adapter.portalAudioMuted())
  adapter.onPortalAudioMutedChange((muted) => feedback.setPortalMuted(muted))
  const session: GameSession = { adapter, storage, feedback, settings }
  showTitle(session)
  adapter.loadingFinished()
  return session
}
