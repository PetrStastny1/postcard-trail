export type FeedbackCue = 'choice' | 'correct' | 'wrong' | 'postcard'

export interface FeedbackSettings {
  sound: boolean
  vibration: boolean
}

export interface Feedback {
  /** Call from the handler of the first player input (pointerdown, keydown). Creates or resumes the audio context. */
  unlock(): void
  play(cue: FeedbackCue): void
  setSoundEnabled(enabled: boolean): void
  setVibrationEnabled(enabled: boolean): void
  /** Call from `RewardedAdRequest.onStart`. */
  muteForAd(): void
  /** Call when the attempt has a result (or is abandoned). */
  restoreAfterAd(): void
}

interface Tone {
  frequencyHz: number
  startSeconds: number
  durationSeconds: number
  peakGain: number
  waveform: OscillatorType
}

const MASTER_VOLUME = 0.6

// Short linear attack so every tone starts and ends at zero gain without a click.
const ATTACK_SECONDS = 0.004

const CHOICE_CLICK: Tone = { frequencyHz: 660, startSeconds: 0, durationSeconds: 0.03, peakGain: 0.25, waveform: 'triangle' }
const CORRECT_LOW: Tone = { frequencyHz: 523.25, startSeconds: 0, durationSeconds: 0.09, peakGain: 0.3, waveform: 'sine' }
const CORRECT_HIGH: Tone = { frequencyHz: 783.99, startSeconds: 0.09, durationSeconds: 0.14, peakGain: 0.3, waveform: 'sine' }
const WRONG_LOW: Tone = { frequencyHz: 196, startSeconds: 0, durationSeconds: 0.22, peakGain: 0.3, waveform: 'triangle' }
const POSTCARD_CHORD_SECONDS = 0.5
// Three voices sum below 1 so the chord does not clip at full master volume.
const POSTCARD_VOICE_GAIN = 0.18

const CUE_TONES: Readonly<Record<FeedbackCue, readonly Tone[]>> = {
  choice: [CHOICE_CLICK],
  correct: [CORRECT_LOW, CORRECT_HIGH],
  wrong: [WRONG_LOW],
  postcard: [523.25, 659.25, 783.99].map((frequencyHz) => ({
    frequencyHz,
    startSeconds: 0,
    durationSeconds: POSTCARD_CHORD_SECONDS,
    peakGain: POSTCARD_VOICE_GAIN,
    waveform: 'sine' as const,
  })),
}

const CUE_VIBRATION_MS: Readonly<Partial<Record<FeedbackCue, number>>> = {
  correct: 25,
  postcard: 35,
}

export function createFeedback(settings: FeedbackSettings): Feedback {
  let soundEnabled = settings.sound
  let vibrationEnabled = settings.vibration
  let mutedForAd = false
  let audio: { context: AudioContext; master: GainNode } | undefined

  function masterLevel(): number {
    return soundEnabled && !mutedForAd ? MASTER_VOLUME : 0
  }

  function applyMasterLevel(): void {
    if (!audio) return
    const now = audio.context.currentTime
    audio.master.gain.cancelScheduledValues(now)
    audio.master.gain.setValueAtTime(masterLevel(), now)
  }

  function playTone(context: AudioContext, master: GainNode, tone: Tone): void {
    const start = context.currentTime + tone.startSeconds
    const end = start + tone.durationSeconds
    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(tone.peakGain, start + ATTACK_SECONDS)
    envelope.gain.linearRampToValueAtTime(0, end)
    envelope.connect(master)

    const oscillator = context.createOscillator()
    oscillator.type = tone.waveform
    oscillator.frequency.setValueAtTime(tone.frequencyHz, start)
    oscillator.connect(envelope)
    oscillator.start(start)
    oscillator.stop(end)
  }

  function vibrate(durationMs: number): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(durationMs)
  }

  return {
    unlock() {
      if (audio) {
        if (audio.context.state === 'suspended') void audio.context.resume()
        return
      }
      if (typeof AudioContext === 'undefined') return
      const context = new AudioContext()
      const master = context.createGain()
      master.connect(context.destination)
      audio = { context, master }
      applyMasterLevel()
      if (context.state === 'suspended') void context.resume()
    },

    play(cue) {
      if (mutedForAd) return
      const vibrationMs = CUE_VIBRATION_MS[cue]
      if (vibrationEnabled && vibrationMs !== undefined) vibrate(vibrationMs)
      if (!audio || !soundEnabled) return
      for (const tone of CUE_TONES[cue]) playTone(audio.context, audio.master, tone)
    },

    setSoundEnabled(enabled) {
      soundEnabled = enabled
      applyMasterLevel()
    },

    setVibrationEnabled(enabled) {
      vibrationEnabled = enabled
    },

    muteForAd() {
      mutedForAd = true
      applyMasterLevel()
    },

    restoreAfterAd() {
      mutedForAd = false
      applyMasterLevel()
    },
  }
}
