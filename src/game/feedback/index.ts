export type FeedbackCue = 'choice' | 'correct' | 'wrong' | 'postcard'

export interface FeedbackSettings {
  sound: boolean
  vibration: boolean
}

export interface Feedback {
  /**
   * Call from the handler of every player input (pointerdown, keydown), not only the first: a resume the browser
   * refused, or an iOS interruption, is retried only on the next call. Creates or resumes the audio context;
   * cheap and idempotent.
   */
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

const C5_HZ = 523.25
const E5_HZ = 659.25
const G5_HZ = 783.99

const CHOICE_CLICK: Tone = { frequencyHz: 660, startSeconds: 0, durationSeconds: 0.03, peakGain: 0.25, waveform: 'triangle' }
const CORRECT_LOW: Tone = { frequencyHz: C5_HZ, startSeconds: 0, durationSeconds: 0.09, peakGain: 0.3, waveform: 'sine' }
const CORRECT_HIGH: Tone = {
  frequencyHz: G5_HZ,
  startSeconds: CORRECT_LOW.startSeconds + CORRECT_LOW.durationSeconds,
  durationSeconds: 0.14,
  peakGain: 0.3,
  waveform: 'sine',
}
const WRONG_LOW: Tone = { frequencyHz: 196, startSeconds: 0, durationSeconds: 0.22, peakGain: 0.3, waveform: 'triangle' }
const POSTCARD_CHORD_SECONDS = 0.5
// Three voices sum below 1 so the chord does not clip at full master volume.
const POSTCARD_VOICE_GAIN = 0.18

const CUE_TONES: Readonly<Record<FeedbackCue, readonly Tone[]>> = {
  choice: [CHOICE_CLICK],
  correct: [CORRECT_LOW, CORRECT_HIGH],
  wrong: [WRONG_LOW],
  postcard: [C5_HZ, E5_HZ, G5_HZ].map((frequencyHz) => ({
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
  let audioUnavailable = false
  // A new or resumed context reaches 'running' only asynchronously; a cue played in the same input handler must still sound.
  let pendingResume: Promise<void> | undefined

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

  // iOS Safari reports 'interrupted' after a call or Siri, so anything short of running is resumed.
  function resumeIfHalted(context: AudioContext): void {
    if (pendingResume || context.state === 'running' || context.state === 'closed') return
    const resume = context.resume()
    pendingResume = resume
    // A rejected resume only means the browser does not allow sound yet; the next player input tries again.
    resume.catch(() => undefined).finally(() => {
      pendingResume = undefined
    })
  }

  function vibrate(durationMs: number): void {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    navigator.vibrate(durationMs)
  }

  return {
    unlock() {
      if (audio) {
        resumeIfHalted(audio.context)
        return
      }
      if (audioUnavailable || typeof AudioContext === 'undefined') return
      let context: AudioContext
      try {
        context = new AudioContext()
      } catch {
        // The API can exist and still refuse a context (NotSupportedError); the game then runs without sound.
        audioUnavailable = true
        return
      }
      const master = context.createGain()
      master.connect(context.destination)
      audio = { context, master }
      applyMasterLevel()
      resumeIfHalted(context)
    },

    play(cue) {
      if (mutedForAd) return
      const vibrationMs = CUE_VIBRATION_MS[cue]
      if (vibrationEnabled && vibrationMs !== undefined) vibrate(vibrationMs)
      // A halted context keeps its clock still, so tones scheduled during a long pause would all sound at once on resume.
      if (!audio || !soundEnabled || (audio.context.state !== 'running' && !pendingResume)) return
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
