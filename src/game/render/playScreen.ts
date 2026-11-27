import type { Locale, Route, Stop } from '../../content/types.ts'
import { t } from '../../i18n/index.ts'
import { element, icon, iconButton, icons } from '../../ui/element.ts'
import { markMoreContent } from '../../ui/moreContent.ts'
import { currentStop, type RunState } from '../logic/run.ts'

export type SceneStatus = 'loading' | 'ready' | 'error'

export interface PlayScene {
  status: SceneStatus
  /** The decoded scene of the current stop, `null` until it is ready. */
  image: HTMLImageElement | null
  /** Listed in `public/scenes/placeholders.json`: the scene description is shown under the image. */
  placeholder: boolean
}

export interface PlayView {
  locale: Locale
  route: Route
  run: RunState
  /** The route stop of the run's current stop. */
  stop: Stop
  scene: PlayScene
  remainingMs: number
  /** The one-time "Removes two choices" label next to 50:50 (brief §6). */
  fiftyFiftyHint: boolean
}

export interface PlayHandlers {
  onLeave(): void
  onPause(): void
  onZoom(): void
  onRetry(): void
  onChoose(choiceId: string): void
  onFiftyFifty(): void
  onExtraTime(): void
  onNext(): void
}

export interface PlayScreen {
  element: HTMLElement
  show(view: PlayView): void
}

type PlayState = 'loading' | 'error' | 'question' | 'result'

/**
 * The question and result screen with the class names of docs/design/prototype, so its layout checks apply.
 * The skeleton stays for the whole run; a new stop or language rebuilds the parts with text, and every other
 * change only updates states in place, so a press on a choice is never lost to a re-render.
 */
export function createPlayScreen(handlers: PlayHandlers): PlayScreen {
  const leave = iconButton('close', '', { 'data-focus-id': 'play-leave' })
  leave.addEventListener('click', handlers.onLeave)
  const pause = iconButton('pause', '', { class: 'icon-button pause-button', 'data-focus-id': 'play-pause' })
  pause.addEventListener('click', handlers.onPause)
  const title = element('p', { class: 'play-title' })
  const bar = element('header', { class: 'play-bar' }, leave, title, pause)

  const trail = element('ol', { class: 'trail' })
  const difficulty = element('p', { class: 'difficulty' })
  const streakCount = element('span', { class: 'streak-count' })
  const streakWord = element('span')
  const streak = element('p', { class: 'streak' }, streakWord, ' ', streakCount)
  const trailRow = element('div', { class: 'trail-row' }, trail, difficulty, streak)

  const loadingText = element('span')
  const loading = element('div', { class: 'scene-loading', role: 'status' }, element('span', { class: 'scene-loading-bar', 'aria-hidden': 'true' }), loadingText)
  const errorText = element('p')
  const retry = element('button', { class: 'primary', type: 'button', 'data-focus-id': 'scene-retry' })
  retry.addEventListener('click', handlers.onRetry)
  const errorHome = element('button', { class: 'secondary', type: 'button', 'data-focus-id': 'scene-home' })
  errorHome.addEventListener('click', handlers.onLeave)
  const sceneError = element('div', { class: 'scene-error', role: 'alert' }, errorText, element('div', { class: 'scene-error-actions' }, retry, errorHome))
  const zoom = element('button', { class: 'zoom-button', type: 'button', 'data-focus-id': 'play-zoom' })
  zoom.innerHTML = icons.enlarge
  zoom.addEventListener('click', handlers.onZoom)
  // The zoom button sits in the scene's corner, so a caption of any length below the scene stays clear.
  const frame = element('figure', { class: 'scene-frame' }, loading, sceneError, zoom)
  const sceneBox = element('div', { class: 'scene-box' }, frame)
  const scene = element('section', { class: 'scene' }, sceneBox)

  // Focused when a new stop is drawn, so keyboard and screen reader users start at the new question.
  const question = element('h1', { id: 'question', class: 'question', tabindex: '-1' })
  const choices = element('ol', { class: 'choices' })
  const timerValue = element('span', { class: 'timer-value' })
  const timerFill = element('span', { class: 'timer-fill' })
  const timer = element(
    'div',
    { class: 'timer', role: 'timer' },
    icon('clock', { class: 'timer-icon' }),
    timerValue,
    element('span', { class: 'timer-track', 'aria-hidden': 'true' }, timerFill),
  )
  const fiftyFifty = element('button', { class: 'lifeline', type: 'button', 'data-lifeline': 'fifty', 'data-focus-id': 'lifeline-fifty' }, '50:50')
  fiftyFifty.addEventListener('click', handlers.onFiftyFifty)
  const extraTime = element('button', { class: 'lifeline', type: 'button', 'data-lifeline': 'time', 'data-focus-id': 'lifeline-time' }, '+10 s')
  extraTime.addEventListener('click', handlers.onExtraTime)
  // The name of 50:50 already says what it does, so the visible hint is hidden from screen readers.
  const fiftyFiftyHint = element('span', { class: 'lifeline-hint', 'aria-hidden': 'true' })
  const lifelines = element('div', { class: 'lifelines', role: 'group' }, fiftyFiftyHint, fiftyFifty, extraTime)
  const result = element('div', { class: 'result', role: 'status' })
  const actionRow = element('div', { class: 'action-row' }, timer, lifelines, result)
  const panel = element('section', { class: 'panel' }, question, choices, actionRow)

  const main = element('main', { class: 'play-main', 'aria-labelledby': 'question' }, trailRow, scene, panel)
  const root = element('div', { class: 'play', 'data-state': 'loading' }, bar, main)

  let builtKey = ''
  let choiceButtons: { choiceId: string; button: HTMLButtonElement; mark: HTMLElement }[] = []
  let caption: HTMLElement | null = null

  /** A choice name never breaks inside a word: when one does not fit two columns, the grid stacks. */
  function fitChoices(): void {
    choices.classList.remove('is-stacked')
    const overflowing = [...choices.querySelectorAll<HTMLElement>('.choice-label')].some((label) => label.scrollWidth > label.clientWidth + 1)
    choices.classList.toggle('is-stacked', overflowing)
  }

  /** A shadow above the pinned action row while content continues below it. */
  function markActionRow(): void {
    const scroller = [panel, main].find((node) => node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY === 'auto')
    actionRow.classList.toggle('has-more', scroller !== undefined && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1)
  }

  new ResizeObserver(() => {
    fitChoices()
    markActionRow()
  }).observe(root)
  for (const scroller of [main, panel]) {
    markMoreContent(scroller)
    scroller.addEventListener('scroll', markActionRow, { passive: true })
  }

  function build(view: PlayView): void {
    const { run, locale, route, stop } = view
    // The previous stop's Next goes away with its result, so focus would otherwise fall back to the page.
    const focusWasOnScreen = document.activeElement === document.body || root.contains(document.activeElement)
    const stopNumber = run.stopIndex + 1
    const total = run.stops.length
    leave.setAttribute('aria-label', t('play.leave'))
    pause.setAttribute('aria-label', t('play.pause'))
    title.textContent = t('play.position', { city: route.name[locale], stop: stopNumber, total })

    trail.setAttribute('aria-label', t('play.trail', { stop: stopNumber, total }))
    trail.replaceChildren(
      ...run.stops.map((_stop, index) =>
        element('li', { class: index < run.stopIndex ? 'done' : index === run.stopIndex ? 'current' : undefined, 'aria-current': index === run.stopIndex ? 'step' : undefined }),
      ),
    )
    // Brief §6: the third stop shows how the marker moves along the route.
    trail.toggleAttribute('data-advance', run.stopIndex === 2)
    difficulty.textContent = t(`play.difficulty.${stop.difficulty}`)
    streakWord.textContent = t('play.streak')

    scene.setAttribute('aria-label', t('play.scene'))
    loadingText.textContent = t('play.sceneLoading')
    errorText.textContent = t('play.sceneError', { stop: stopNumber })
    retry.textContent = t('play.retry')
    errorHome.textContent = t('window.home')
    zoom.setAttribute('aria-label', t('play.zoom'))
    caption?.remove()
    // Shown visually only: the image's alt text carries the same description for screen readers.
    caption = view.scene.placeholder
      ? element('p', { class: 'scene-caption', 'aria-hidden': 'true' }, element('span', { class: 'scene-caption-text' }, stop.sceneAlt[locale]))
      : null
    if (caption) frame.after(caption)

    question.textContent = stop.question[locale]
    const shownOrder = currentStop(run).choiceIds
    const shownChoices = stop.choices.toSorted((a, b) => shownOrder.indexOf(a.id) - shownOrder.indexOf(b.id))
    choiceButtons = shownChoices.map((choice, index) => {
      const mark = element('span', { class: 'choice-mark' })
      const button = element(
        'button',
        { class: 'choice', type: 'button', 'data-focus-id': `choice-${index + 1}` },
        element('span', { class: 'choice-key', 'aria-hidden': 'true' }, String(index + 1)),
        element('span', { class: 'choice-label' }, choice.label[locale]),
        mark,
      )
      button.addEventListener('click', () => handlers.onChoose(choice.id))
      return { choiceId: choice.id, button, mark }
    })
    choices.replaceChildren(...choiceButtons.map(({ button }) => element('li', {}, button)))

    timer.setAttribute('aria-label', t('play.timer'))
    lifelines.setAttribute('aria-label', t('play.lifelines'))
    fiftyFifty.setAttribute('aria-label', t('play.fiftyFifty'))
    fiftyFiftyHint.textContent = t('play.fiftyFiftyHint')
    extraTime.setAttribute('aria-label', t('play.extraTime'))
    result.replaceChildren()
    main.scrollTo(0, 0)
    panel.scrollTo(0, 0)
    if (focusWasOnScreen) question.focus({ preventScroll: true })
  }

  function showResult(view: PlayView): void {
    const { run, locale, stop } = view
    const stopResult = run.results[run.stopIndex]
    const verdictIcon = stopResult.outcome === 'correct' ? 'check' : stopResult.outcome === 'timeout' ? 'clock' : 'close'
    const verdictKey = stopResult.outcome === 'correct' ? 'play.verdict.correct' : stopResult.outcome === 'timeout' ? 'play.verdict.timeout' : 'play.verdict.wrong'
    root.dataset.verdict = stopResult.outcome
    const next = element('button', { class: 'primary next', type: 'button', 'data-focus-id': 'play-next' }, t('play.next'))
    next.addEventListener('click', handlers.onNext)
    result.replaceChildren(
      element('p', { class: 'result-verdict' }, icon(verdictIcon, { class: 'result-icon' }), element('span', { class: 'result-word' }, t(verdictKey))),
      element('p', { class: 'result-sentence' }, stop.feedback[locale]),
      next,
    )
  }

  function markChoices(view: PlayView, state: PlayState): void {
    const { run } = view
    const runStop = currentStop(run)
    const stopResult = state === 'result' ? run.results[run.stopIndex] : undefined
    choiceButtons.forEach(({ choiceId, button, mark }, index) => {
      const removed = run.hiddenChoiceIds.includes(choiceId)
      const correct = stopResult !== undefined && choiceId === runStop.correctChoiceId
      const wrong = stopResult !== undefined && choiceId === stopResult.chosenChoiceId && !correct
      button.disabled = state !== 'question' || removed
      button.classList.toggle('is-removed', removed)
      button.classList.toggle('is-correct', correct)
      button.classList.toggle('is-wrong', wrong)
      if (removed) {
        button.setAttribute('aria-hidden', 'true')
        button.removeAttribute('aria-keyshortcuts')
      } else {
        button.removeAttribute('aria-hidden')
        button.setAttribute('aria-keyshortcuts', String(index + 1))
      }
      if (!correct && !wrong) {
        mark.replaceChildren()
        return
      }
      const label = correct && stopResult?.chosenChoiceId !== choiceId ? t('play.correctChoice') : t('play.yourChoice')
      mark.innerHTML = correct ? icons.check : icons.close
      mark.append(element('span', { class: 'visually-hidden' }, label))
    })
  }

  function show(view: PlayView): void {
    const { run, stop, scene: sceneState } = view
    const key = `${run.runId}:${run.round}:${view.locale}:${sceneState.placeholder}`
    const rebuilt = key !== builtKey
    if (rebuilt) {
      build(view)
      builtKey = key
    }

    const state: PlayState =
      sceneState.status !== 'ready' ? sceneState.status : run.phase === 'feedback' ? 'result' : run.phase === 'question' ? 'question' : 'loading'
    const enteringResult = state === 'result' && (root.dataset.state !== 'result' || rebuilt)
    root.dataset.state = state
    root.dataset.untimed = String(run.untimed)
    if (state !== 'result') delete root.dataset.verdict

    if (!sceneState.image) {
      frame.querySelector('.scene-art')?.remove()
    } else if (sceneState.image.parentElement !== frame) {
      frame.querySelector('.scene-art')?.remove()
      sceneState.image.className = 'scene-art'
      sceneState.image.alt = stop.sceneAlt[view.locale]
      frame.prepend(sceneState.image)
    } else {
      sceneState.image.alt = stop.sceneAlt[view.locale]
    }

    streak.hidden = run.streak < 2
    streakCount.textContent = String(run.streak)
    markChoices(view, state)

    const seconds = Math.ceil(view.remainingMs / 1000)
    timerValue.textContent = t('play.seconds', { seconds })
    timerFill.style.width = `${Math.min(100, (view.remainingMs / currentStop(run).timeLimitMs) * 100)}%`
    const fiftyUsed = run.usedLifelines.includes('fiftyFifty')
    const extraUsed = run.usedLifelines.includes('extraTime')
    fiftyFifty.disabled = state !== 'question' || fiftyUsed
    fiftyFifty.classList.toggle('is-used', fiftyUsed)
    extraTime.disabled = state !== 'question' || extraUsed
    extraTime.classList.toggle('is-used', extraUsed)
    fiftyFiftyHint.hidden = !view.fiftyFiftyHint
    if (view.fiftyFiftyHint) {
      // The label may cover the time bar but not the seconds; without the time it has the row up to its start.
      const rowStyle = getComputedStyle(actionRow)
      const start = run.untimed ? actionRow.getBoundingClientRect().left + parseFloat(rowStyle.paddingLeft) : timerValue.getBoundingClientRect().right
      lifelines.style.setProperty('--hint-room', `${lifelines.getBoundingClientRect().left - start - 1.5 * parseFloat(rowStyle.columnGap)}px`)
    }

    if (state !== 'result') result.replaceChildren()
    if (enteringResult) {
      showResult(view)
      // The scrollers end with the result, so it comes into view whole and right under the choices.
      for (const scroller of [main, panel]) scroller.scrollTo(0, scroller.scrollHeight)
      result.querySelector<HTMLElement>('.next')?.focus({ preventScroll: true })
    }
    fitChoices()
    markActionRow()
  }

  return { element: root, show }
}

/** Shown when the route itself could not load, before any stop exists. */
export function routeErrorScreen({ onRetry, onHome }: { onRetry(): void; onHome(): void }): HTMLElement {
  const close = iconButton('close', t('window.close'), { 'data-focus-id': 'play-leave' })
  close.addEventListener('click', onHome)
  const retry = element('button', { class: 'primary', type: 'button', 'data-focus-id': 'route-retry' }, t('play.retry'))
  retry.addEventListener('click', onRetry)
  const home = element('button', { class: 'secondary', type: 'button', 'data-focus-id': 'route-home' }, t('window.home'))
  home.addEventListener('click', onHome)
  return element(
    'div',
    { class: 'play', 'data-state': 'error' },
    element('header', { class: 'play-bar' }, close, element('p', { class: 'play-title' }, 'Postcard Trail')),
    element('main', { class: 'route-error', role: 'alert' }, element('p', {}, t('play.routeError')), element('div', { class: 'scene-error-actions' }, retry, home)),
  )
}
