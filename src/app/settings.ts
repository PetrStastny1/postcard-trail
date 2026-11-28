import type { Settings } from '../game/storage/schema.ts'
import type { GameSession } from './start.ts'

export type SettingsChange = Partial<Omit<Settings, 'shownHintIds' | 'volume'>>

/** Saves the change at once and hands sound and vibration to the feedback; the screens apply language and motion. */
export function changeSettings(session: GameSession, change: SettingsChange): void {
  const previous = session.settings
  const next: Settings = { ...previous, ...change }
  session.storage.saveSettings(next)
  session.settings = next
  if (next.soundEnabled !== previous.soundEnabled) session.feedback.setSoundEnabled(next.soundEnabled)
  if (next.vibrationEnabled !== previous.vibrationEnabled) session.feedback.setVibrationEnabled(next.vibrationEnabled)
}

/** One-time hints (brief §6) are remembered with the settings, so the player sees each only once. */
export function rememberHint(session: GameSession, hintId: string): void {
  if (session.settings.shownHintIds.includes(hintId)) return
  const next: Settings = { ...session.settings, shownHintIds: [...session.settings.shownHintIds, hintId] }
  session.storage.saveSettings(next)
  session.settings = next
}
