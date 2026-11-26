/// <reference types="node" />
// Temporary: tsconfig.json has no Node types and this directive adds them to the whole tsconfig.json program,
// not just this file. Remove it once the director changes the tsconfig setup.
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { createFeedback, type FeedbackCue } from './index.ts'

// Fakes stand in only for the browser APIs AudioContext and navigator.vibrate.

interface ParamEvent {
  kind: 'set' | 'ramp' | 'cancel'
  value: number
  time: number
}

class FakeParam {
  events: ParamEvent[] = []
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time })
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'ramp', value, time })
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', value: Number.NaN, time })
  }
  lastValue(): number | undefined {
    return this.events.filter((event) => event.kind !== 'cancel').at(-1)?.value
  }
}

class FakeGain {
  gain = new FakeParam()
  target: unknown
  connect(target: unknown) {
    this.target = target
  }
}

class FakeOscillator {
  type = 'sine'
  frequency = new FakeParam()
  target: FakeGain | undefined
  startTime: number | undefined
  stopTime: number | undefined
  connect(target: FakeGain) {
    this.target = target
  }
  start(time: number) {
    this.startTime = time
  }
  stop(time: number) {
    this.stopTime = time
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static initialState: 'suspended' | 'running' = 'running'
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = FakeAudioContext.initialState
  currentTime = 10
  destination = { kind: 'destination' }
  resumeCalls = 0
  gains: FakeGain[] = []
  oscillators: FakeOscillator[] = []
  constructor() {
    FakeAudioContext.instances.push(this)
  }
  createGain() {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  createOscillator() {
    const oscillator = new FakeOscillator()
    this.oscillators.push(oscillator)
    return oscillator
  }
  resume() {
    this.resumeCalls += 1
    this.state = 'running'
    return Promise.resolve()
  }
  master(): FakeGain {
    const master = this.gains.find((gain) => gain.target === this.destination)
    assert.ok(master, 'master gain is connected to the destination')
    return master
  }
}

let vibrations: number[] = []
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function installAudioContext() {
  Object.defineProperty(globalThis, 'AudioContext', { value: FakeAudioContext, configurable: true, writable: true })
}

function installNavigator(withVibrate: boolean) {
  const fakeNavigator = withVibrate
    ? {
        vibrate(this: unknown, pattern: number) {
          assert.equal(this, fakeNavigator, 'vibrate is called as a navigator method')
          vibrations.push(pattern)
          return true
        },
      }
    : {}
  Object.defineProperty(globalThis, 'navigator', { value: fakeNavigator, configurable: true, writable: true })
}

function onlyContext(): FakeAudioContext {
  assert.equal(FakeAudioContext.instances.length, 1)
  const context = FakeAudioContext.instances[0]
  assert.ok(context)
  return context
}

beforeEach(() => {
  FakeAudioContext.instances = []
  FakeAudioContext.initialState = 'running'
  vibrations = []
  installAudioContext()
  installNavigator(true)
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'AudioContext')
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
})

const allOn = { sound: true, vibration: true }

test('creating feedback touches no browser API', () => {
  Reflect.deleteProperty(globalThis, 'AudioContext')
  Reflect.deleteProperty(globalThis, 'navigator')
  assert.doesNotThrow(() => createFeedback(allOn))
})

test('S8.1 before unlock there is no audio context and play makes no sound', () => {
  const feedback = createFeedback(allOn)
  feedback.play('choice')
  feedback.play('postcard')
  assert.equal(FakeAudioContext.instances.length, 0)
})

test('S8.1 unlock creates one context with master volume 0.6', () => {
  const feedback = createFeedback(allOn)
  feedback.unlock()
  const context = onlyContext()
  assert.equal(context.master().gain.lastValue(), 0.6)
  feedback.unlock()
  assert.equal(FakeAudioContext.instances.length, 1)
})

test('S8.1 unlock resumes a suspended context, also on a repeated call', () => {
  FakeAudioContext.initialState = 'suspended'
  const feedback = createFeedback(allOn)
  feedback.unlock()
  const context = onlyContext()
  assert.equal(context.resumeCalls, 1)
  feedback.unlock()
  assert.equal(context.resumeCalls, 1, 'a running context is not resumed again')
  context.state = 'suspended'
  feedback.unlock()
  assert.equal(context.resumeCalls, 2)
  assert.equal(FakeAudioContext.instances.length, 1)
})

test('S8.1 unlock resumes an interrupted context but not a closed one', () => {
  const feedback = createFeedback(allOn)
  feedback.unlock()
  const context = onlyContext()
  context.state = 'interrupted'
  feedback.unlock()
  assert.equal(context.resumeCalls, 1)
  context.state = 'closed'
  feedback.unlock()
  assert.equal(context.resumeCalls, 1, 'a closed context cannot be resumed')
  assert.equal(FakeAudioContext.instances.length, 1)
})

test('S8.1 S9.2 without Web Audio unlock and play do not throw and vibration still works', () => {
  Reflect.deleteProperty(globalThis, 'AudioContext')
  const feedback = createFeedback(allOn)
  assert.doesNotThrow(() => feedback.unlock())
  assert.doesNotThrow(() => feedback.play('correct'))
  assert.doesNotThrow(() => feedback.setSoundEnabled(false))
  assert.doesNotThrow(() => feedback.muteForAd())
  assert.doesNotThrow(() => feedback.restoreAfterAd())
  feedback.play('postcard')
  assert.deepEqual(vibrations, [25, 35])
})

function playedTones(cue: FeedbackCue) {
  const feedback = createFeedback(allOn)
  feedback.unlock()
  const context = onlyContext()
  feedback.play(cue)
  return { context, oscillators: context.oscillators }
}

function assertSilentEnvelope(context: FakeAudioContext, oscillator: FakeOscillator) {
  const envelope = oscillator.target
  assert.ok(envelope, 'oscillator goes through an envelope gain')
  assert.equal(envelope.target, context.master(), 'envelope feeds the master gain')
  const first = envelope.gain.events[0]
  const last = envelope.gain.events.at(-1)
  assert.deepEqual(first, { kind: 'set', value: 0, time: oscillator.startTime })
  assert.deepEqual(last, { kind: 'ramp', value: 0, time: oscillator.stopTime })
  assert.ok(envelope.gain.events.some((event) => event.value > 0), 'envelope rises above zero')
}

function durationOf(oscillator: FakeOscillator): number {
  assert.ok(oscillator.startTime !== undefined && oscillator.stopTime !== undefined)
  return oscillator.stopTime - oscillator.startTime
}

function frequencyOf(oscillator: FakeOscillator): number {
  const frequency = oscillator.frequency.lastValue()
  assert.ok(frequency !== undefined)
  return frequency
}

test('S8.2 choice is one tone of at most 40 ms', () => {
  const { context, oscillators } = playedTones('choice')
  assert.equal(oscillators.length, 1)
  const [click] = oscillators
  assert.ok(click)
  assert.equal(click.startTime, context.currentTime)
  assert.ok(durationOf(click) <= 0.04)
  assertSilentEnvelope(context, click)
})

test('S8.2 correct is two rising tones one after another', () => {
  const { context, oscillators } = playedTones('correct')
  assert.equal(oscillators.length, 2)
  const [low, high] = oscillators
  assert.ok(low && high && low.stopTime !== undefined && high.startTime !== undefined)
  assert.ok(frequencyOf(high) > frequencyOf(low))
  assert.ok(high.startTime >= low.stopTime, 'second tone starts after the first ends')
  for (const tone of oscillators) assertSilentEnvelope(context, tone)
})

test('S8.2 wrong is one low tone', () => {
  const { context, oscillators } = playedTones('wrong')
  assert.equal(oscillators.length, 1)
  const [tone] = oscillators
  assert.ok(tone)
  assert.ok(frequencyOf(tone) < 300)
  assertSilentEnvelope(context, tone)
})

test('S8.2 postcard is three simultaneous tones within 600 ms', () => {
  const { context, oscillators } = playedTones('postcard')
  assert.equal(oscillators.length, 3)
  const frequencies = new Set(oscillators.map(frequencyOf))
  assert.equal(frequencies.size, 3)
  for (const tone of oscillators) {
    assert.equal(tone.startTime, context.currentTime)
    assert.ok(durationOf(tone) <= 0.6)
    assertSilentEnvelope(context, tone)
  }
})

test('S8.3 turning sound off mutes at the current time and stops new tones', () => {
  const feedback = createFeedback(allOn)
  feedback.unlock()
  const context = onlyContext()
  feedback.play('postcard')
  context.currentTime = 10.2
  feedback.setSoundEnabled(false)
  const masterEvents = context.master().gain.events
  assert.deepEqual(masterEvents.slice(-2), [
    { kind: 'cancel', value: Number.NaN, time: 10.2 },
    { kind: 'set', value: 0, time: 10.2 },
  ])
  const before = context.oscillators.length
  feedback.play('choice')
  feedback.play('correct')
  assert.equal(context.oscillators.length, before)

  feedback.setSoundEnabled(true)
  assert.equal(context.master().gain.lastValue(), 0.6)
  feedback.play('choice')
  assert.equal(context.oscillators.length, before + 1)
})

test('S8.3 sound off before unlock starts the context silent', () => {
  const feedback = createFeedback({ sound: false, vibration: true })
  feedback.unlock()
  const context = onlyContext()
  assert.equal(context.master().gain.lastValue(), 0)
  feedback.play('choice')
  assert.equal(context.oscillators.length, 0)
})

test('S8.4 S9.2 an ad mutes at once and play makes no sound or vibration', () => {
  const feedback = createFeedback(allOn)
  feedback.unlock()
  const context = onlyContext()
  context.currentTime = 12
  feedback.muteForAd()
  assert.deepEqual(context.master().gain.events.at(-1), { kind: 'set', value: 0, time: 12 })
  feedback.play('correct')
  feedback.play('postcard')
  assert.equal(context.oscillators.length, 0)
  assert.deepEqual(vibrations, [])

  feedback.restoreAfterAd()
  assert.equal(context.master().gain.lastValue(), 0.6)
  feedback.play('correct')
  assert.equal(context.oscillators.length, 2)
  assert.deepEqual(vibrations, [25])
})

test('S8.4 restoring after an ad keeps silence when sound is off', () => {
  const feedback = createFeedback({ sound: false, vibration: true })
  feedback.unlock()
  const context = onlyContext()
  feedback.muteForAd()
  feedback.restoreAfterAd()
  assert.equal(context.master().gain.lastValue(), 0)
})

test('S8.4 turning sound on during an ad takes effect only after restore', () => {
  const feedback = createFeedback({ sound: false, vibration: true })
  feedback.unlock()
  const context = onlyContext()
  feedback.muteForAd()
  feedback.setSoundEnabled(true)
  assert.equal(context.master().gain.lastValue(), 0)
  feedback.play('choice')
  assert.equal(context.oscillators.length, 0)
  feedback.restoreAfterAd()
  assert.equal(context.master().gain.lastValue(), 0.6)
})

test('S8.4 turning sound off during an ad keeps silence after restore', () => {
  const feedback = createFeedback(allOn)
  feedback.unlock()
  const context = onlyContext()
  feedback.muteForAd()
  feedback.setSoundEnabled(false)
  feedback.restoreAfterAd()
  assert.equal(context.master().gain.lastValue(), 0)
})

test('S9.1 S9.2 correct vibrates 25 ms and postcard 35 ms without sound or unlock', () => {
  const feedback = createFeedback({ sound: false, vibration: true })
  feedback.play('choice')
  feedback.play('correct')
  feedback.play('wrong')
  feedback.play('postcard')
  assert.deepEqual(vibrations, [25, 35])
  assert.equal(FakeAudioContext.instances.length, 0)
})

test('S9.3 vibration off means no vibrate call', () => {
  const feedback = createFeedback({ sound: true, vibration: false })
  feedback.play('correct')
  feedback.setVibrationEnabled(true)
  feedback.play('postcard')
  feedback.setVibrationEnabled(false)
  feedback.play('correct')
  assert.deepEqual(vibrations, [35])
})

test('S9.3 without navigator.vibrate nothing throws', () => {
  installNavigator(false)
  const feedback = createFeedback(allOn)
  assert.doesNotThrow(() => feedback.play('correct'))
  Reflect.deleteProperty(globalThis, 'navigator')
  assert.doesNotThrow(() => feedback.play('postcard'))
})
