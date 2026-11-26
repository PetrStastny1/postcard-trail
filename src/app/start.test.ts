import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Feedback, FeedbackSettings } from '../game/feedback/index.ts'
import { createRun } from '../game/logic/run.ts'
import { ownsActiveRun, storageKeys } from '../game/storage/schema.ts'
import type { KeyValueStore, PlatformAdapter } from '../platform/types.ts'
import { changeSettings } from './settings.ts'
import { startGame, type GameSession } from './start.ts'

// The adapter and the feedback are the platform area's boundary; fakes record what the app asks of them.

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return { values, read: (key) => values.get(key) ?? null, write: (key, value) => void values.set(key, value) }
}

function fakeAdapter(calls: string[], store: KeyValueStore, portalMuted = false) {
  let initDone = false
  const muteListeners: ((muted: boolean) => void)[] = []
  const adapter: PlatformAdapter = {
    name: 'local',
    store,
    init: () =>
      new Promise((resolve) => {
        calls.push('init')
        setTimeout(() => {
          initDone = true
          calls.push('init resolved')
          resolve()
        }, 5)
      }),
    loadingStarted: () => calls.push('loadingStarted'),
    loadingFinished: () => calls.push('loadingFinished'),
    gameplayStart: () => calls.push('gameplayStart'),
    gameplayStop: () => calls.push('gameplayStop'),
    rewardedAdsOffered: () => false,
    requestRewardedAd: () => calls.push('requestRewardedAd'),
    track: () => calls.push('track'),
    recordedEvents: () => [],
    portalAudioMuted: () => {
      assert.ok(initDone, 'portalAudioMuted is read only after init')
      calls.push('portalAudioMuted')
      return portalMuted
    },
    onPortalAudioMutedChange: (listener) => {
      calls.push('onPortalAudioMutedChange')
      muteListeners.push(listener)
    },
  }
  return { adapter, changePortalMute: (muted: boolean) => muteListeners.forEach((listener) => listener(muted)) }
}

function fakeFeedback(calls: string[]) {
  const created: FeedbackSettings[] = []
  const create = (settings: FeedbackSettings): Feedback => {
    created.push(settings)
    calls.push('createFeedback')
    return {
      unlock: () => calls.push('unlock'),
      play: (cue) => calls.push(`play ${cue}`),
      setSoundEnabled: (enabled) => calls.push(`setSoundEnabled ${enabled}`),
      setVibrationEnabled: (enabled) => calls.push(`setVibrationEnabled ${enabled}`),
      muteForAd: () => calls.push('muteForAd'),
      restoreAfterAd: () => calls.push('restoreAfterAd'),
      setPortalMuted: (muted) => calls.push(`setPortalMuted ${muted}`),
    }
  }
  return { create, created }
}

const savedSettings = (fields: Record<string, unknown>) => JSON.stringify({ version: 1, data: fields })

test('start reports loading, initialises, wires the portal mute and finishes loading after the title', async () => {
  const calls: string[] = []
  const { adapter } = fakeAdapter(calls, memoryStore(), true)
  const feedback = fakeFeedback(calls)
  await startGame({ adapter, tabId: 'tab-1', createFeedback: feedback.create, showTitle: () => calls.push('showTitle') })
  assert.deepEqual(calls, [
    'loadingStarted',
    'init',
    'init resolved',
    'createFeedback',
    'portalAudioMuted',
    'setPortalMuted true',
    'onPortalAudioMutedChange',
    'showTitle',
    'loadingFinished',
  ])
})

test('a portal mute change reaches the feedback', async () => {
  const calls: string[] = []
  const { adapter, changePortalMute } = fakeAdapter(calls, memoryStore())
  await startGame({ adapter, tabId: 'tab-1', createFeedback: fakeFeedback(calls).create, showTitle: () => undefined })
  calls.length = 0
  changePortalMute(true)
  changePortalMute(false)
  assert.deepEqual(calls, ['setPortalMuted true', 'setPortalMuted false'])
})

test('the feedback starts from the settings saved in the adapter store', async () => {
  const calls: string[] = []
  const store = memoryStore({ [storageKeys.settings]: savedSettings({ soundEnabled: false, vibrationEnabled: false, locale: 'cs' }) })
  const feedback = fakeFeedback(calls)
  let shown: GameSession | undefined
  await startGame({ adapter: fakeAdapter(calls, store).adapter, tabId: 'tab-1', createFeedback: feedback.create, showTitle: (session) => (shown = session) })
  assert.deepEqual(feedback.created, [{ sound: false, vibration: false }])
  assert.equal(shown?.settings.locale, 'cs')
})

test('the storage writes through the adapter store as the given tab', async () => {
  const calls: string[] = []
  const store = memoryStore()
  const session = await startGame({ adapter: fakeAdapter(calls, store).adapter, tabId: 'tab-7', createFeedback: fakeFeedback(calls).create, showTitle: () => undefined })
  const stop = { stopId: 'PAR01', routeStopNumber: 1, timeLimitMs: 25_000, choiceIds: ['a', 'b', 'c', 'd'], correctChoiceId: 'a' }
  const stops = Array.from({ length: 10 }, (_unused, index) => ({ ...stop, stopId: `PAR0${index}`, routeStopNumber: index + 1 }))
  session.storage.startRun(createRun({ runId: 'run-1', mode: 'city', cityId: 'paris', untimed: false, stops }))
  const storedRun = store.values.get(storageKeys.activeRun) ?? null
  assert.ok(ownsActiveRun(storedRun, 'tab-7'))
  assert.ok(!ownsActiveRun(storedRun, 'tab-1'))
})

test('a settings change is saved at once and only changed sound or vibration reach the feedback', async () => {
  const calls: string[] = []
  const store = memoryStore()
  const session = await startGame({ adapter: fakeAdapter(calls, store).adapter, tabId: 'tab-1', createFeedback: fakeFeedback(calls).create, showTitle: () => undefined })
  calls.length = 0
  changeSettings(session, { soundEnabled: false })
  changeSettings(session, { vibrationEnabled: false })
  changeSettings(session, { locale: 'cs', reducedMotion: true, untimed: true })
  assert.deepEqual(calls, ['setSoundEnabled false', 'setVibrationEnabled false'])
  assert.deepEqual(session.storage.loadSettings(), {
    ...session.settings,
    soundEnabled: false,
    vibrationEnabled: false,
    locale: 'cs',
    reducedMotion: true,
    untimed: true,
  })
  assert.equal(JSON.parse(store.values.get(storageKeys.settings) ?? '{}').data.untimed, true)
})
