import type { Catalog, Route, Stop } from '../content/types.ts'
import { elsewhereTitleId, elsewhereWindow, pauseTitleId, pauseWindow, zoomTitleId, zoomWindow } from '../game/render/playDialogs.ts'
import { createPlayScreen, type PlayScene } from '../game/render/playScreen.ts'
import { canUseSkip, currentStop, type RunState, type RunStop } from '../game/logic/run.ts'
import { ownsActiveRun, storageKeys } from '../game/storage/schema.ts'
import { openDialog, topDialog, type OpenDialog } from '../ui/dialog.ts'
import { createRunController, type RunCompletion } from './runController.ts'
import { rememberHint } from './settings.ts'
import { openSkip, type SkipWindow } from './skip.ts'
import type { GameSession } from './start.ts'

/** The adapter's key for the active run, as `storage` events name it. */
const activeRunStorageKey = `postcard-trail:${storageKeys.activeRun}`
const fiftyFiftyHintId = 'fifty-fifty'
const hintMs = 1500
const skipHintId = 'skip-video'
const skipHintMs = 3000
const choiceKeys = ['1', '2', '3', '4']

export interface PlayOptions {
  session: GameSession
  catalog: Catalog
  route: Route
  /** Stop IDs from `public/scenes/placeholders.json`, loaded with the route so the caption band is there from the start. */
  placeholderSceneIds: ReadonlySet<string>
  /** A new run, or a restored one, which is always paused. */
  run: RunState
  /** Puts the game screen into the app's screen slot. */
  mount(screen: HTMLElement): void
  /** Opens settings over the pause; `returnFocusId` is the control focused when settings close. */
  openSettings(returnFocusId: string): void
  /** Back to the title: the app first calls `leave()` and then `dispose()`. */
  goHome(): void
  /** The run is completed: the app disposes the game screen and shows the summary. */
  finished(completion: RunCompletion): void
}

export interface PlaySession {
  /** Draws the screen and the open game windows again in the current language. */
  redraw(): void
  /** × and Home: saves the run paused and reports `route_left`; nothing happens after a finish or a takeover. */
  leave(): void
  dispose(): void
}

let placeholderIds: Promise<ReadonlySet<string>> | undefined

/** Fetched once per page; a failed fetch is tried again with the next route. */
export function loadPlaceholderSceneIds(): Promise<ReadonlySet<string>> {
  if (placeholderIds) return placeholderIds
  const loading = fetch(`${import.meta.env.BASE_URL}scenes/placeholders.json`).then(async (response) => {
    if (!response.ok) throw new Error(`placeholders.json answered ${response.status}`)
    const list: { stopIds: string[] } = await response.json()
    return new Set(list.stopIds)
  })
  placeholderIds = loading
  loading.catch(() => {
    placeholderIds = undefined
  })
  return loading
}

function sceneUrl(stop: Stop): string {
  return `${import.meta.env.BASE_URL}${stop.sceneAsset}`
}

/**
 * The game screen of one run: loads the scenes, turns input, time, page visibility and `storage` events into
 * controller calls, and opens the pause, zoom and "continues in another tab" windows.
 */
export function startPlay({ session, catalog, route, placeholderSceneIds, run, mount, openSettings, goHome, finished }: PlayOptions): PlaySession {
  const listeners = new AbortController()
  let disposed = false
  let scene: PlayScene = { status: 'loading', image: null, placeholder: false }
  let loadedRound = 0
  let sceneWaitsForVisiblePage = false
  let tickTimer: ReturnType<typeof setTimeout> | undefined
  let hintTimer: ReturnType<typeof setTimeout> | undefined
  let hintVisible = false
  let skipHintTimer: ReturnType<typeof setTimeout> | undefined
  let skipHintVisible = false
  let skipWindow: SkipWindow | null = null
  let pauseDialog: OpenDialog | null = null
  let zoomDialog: OpenDialog | null = null
  let elsewhereDialog: OpenDialog | null = null
  let leaving = false

  // By ID, not by position: a saved run keeps pointing at its own stops even if the route's order changes.
  const stopsById: Record<string, Stop> = Object.fromEntries(route.stops.map((stop) => [stop.id, stop]))
  const routeStop = (runStop: RunStop): Stop => stopsById[runStop.stopId]

  const controller = createRunController({
    run,
    storage: session.storage,
    adapter: session.adapter,
    feedback: session.feedback,
    catalog,
    now: () => performance.now(),
    listener: {
      changed(changedRun) {
        // The label belongs to the open question: an answer, 50:50 or the next stop takes it away at once.
        if (changedRun.phase !== 'question' || changedRun.usedLifelines.includes('fiftyFifty')) hideFiftyFiftyHint()
        showFiftyFiftyHintOnce(changedRun)
        if (changedRun.phase !== 'question' || changedRun.paused) hideSkipHint()
        showSkipHintOnce(changedRun)
        // A new stop starts with its own scene loading, so the previous image is never shown with the new question.
        if (changedRun.round !== loadedRound) void loadScene()
        else render()
      },
      finished,
      ownerLost: showElsewhere,
    },
  })

  const screen = createPlayScreen({
    onLeave: goHome,
    onPause: openPause,
    onZoom: openZoom,
    onRetry: () => void loadScene(),
    onChoose: (choiceId) => controller.choose(choiceId),
    onFiftyFifty: () => controller.useFiftyFifty(),
    onExtraTime: () => controller.useExtraTime(),
    onNext: () => controller.next(),
  })

  function render(): void {
    if (disposed) return
    screen.show({
      locale: session.settings.locale,
      route,
      run: controller.run,
      stop: routeStop(currentStop(controller.run)),
      scene,
      remainingMs: controller.remainingMs(),
      fiftyFiftyHint: hintVisible,
      skipHint: skipHintVisible,
    })
    scheduleTick()
  }

  /** A tick at every whole second of the countdown redraws the time and saves a checkpoint. */
  function scheduleTick(): void {
    clearTimeout(tickTimer)
    const current = controller.run
    if (controller.stopped || current.phase !== 'question' || current.paused || current.untimed) return
    const untilNextSecond = controller.remainingMs() % 1000 || 1000
    tickTimer = setTimeout(() => controller.tick(), untilNextSecond)
  }

  /** Brief §6: on the second stop the label next to 50:50 shows once for 1 500 ms; the time keeps running. */
  function showFiftyFiftyHintOnce(changedRun: RunState): void {
    const shown = session.settings.shownHintIds.includes(fiftyFiftyHintId)
    if (shown || changedRun.stopIndex !== 1 || changedRun.phase !== 'question' || changedRun.paused) return
    if (changedRun.usedLifelines.includes('fiftyFifty')) return
    rememberHint(session, fiftyFiftyHintId)
    hintVisible = true
    hintTimer = setTimeout(() => {
      hintVisible = false
      render()
    }, hintMs)
  }

  function hideFiftyFiftyHint(): void {
    clearTimeout(hintTimer)
    hintVisible = false
  }

  /** Brief §6: the first time a question runs with a streak of 3, the pause button says once that the skip is inside. */
  function showSkipHintOnce(changedRun: RunState): void {
    if (session.settings.shownHintIds.includes(skipHintId) || changedRun.phase !== 'question' || changedRun.paused) return
    if (changedRun.streak < 3 || changedRun.usedLifelines.includes('skipVideo') || !session.adapter.rewardedAdsOffered()) return
    rememberHint(session, skipHintId)
    skipHintVisible = true
    skipHintTimer = setTimeout(() => {
      skipHintVisible = false
      render()
    }, skipHintMs)
  }

  function hideSkipHint(): void {
    clearTimeout(skipHintTimer)
    skipHintVisible = false
  }

  async function loadScene(): Promise<void> {
    const loadingRun = controller.run
    const stop = routeStop(currentStop(loadingRun))
    loadedRound = loadingRun.round
    scene = { status: 'loading', image: null, placeholder: placeholderSceneIds.has(stop.id) }
    render()
    const image = new Image()
    image.src = sceneUrl(stop)
    try {
      await image.decode()
    } catch {
      // A failed scene stops nothing else: the error state offers "Try again" for the same asset.
      if (disposed || controller.run.round !== loadingRun.round) return
      scene = { ...scene, status: 'error' }
      render()
      return
    }
    if (disposed || controller.run.round !== loadingRun.round) return
    scene = { ...scene, status: 'ready', image }
    render()
    if (document.visibilityState === 'hidden') sceneWaitsForVisiblePage = true
    else sceneShown()
  }

  /** The scene is decoded, the choices are drawn and the page is visible. */
  function sceneShown(): void {
    sceneWaitsForVisiblePage = false
    controller.sceneReady()
    const nextRunStop = controller.run.stops[controller.run.stopIndex + 1]
    if (nextRunStop) new Image().src = sceneUrl(routeStop(nextRunStop))
    // A restored run comes back paused and waits in the pause window.
    if (controller.run.paused) openPause()
  }

  // A window's `close` event arrives a task after `close()`, so the game acts at once and the event only covers Escape.
  function openPause(): void {
    if (controller.stopped || topDialog() || scene.status === 'error') return
    controller.pause()
    if (controller.stopped) return
    const dialog: OpenDialog = openDialog({
      labelledBy: pauseTitleId,
      content: pauseContent(),
      returnFocusId: 'play-pause',
      onClosed: () => {
        if (pauseDialog === dialog) continueFromPause()
      },
    })
    pauseDialog = dialog
  }

  function continueFromPause(): void {
    closePauseQuietly()
    controller.resume()
  }

  function closePauseQuietly(): void {
    const dialog = pauseDialog
    pauseDialog = null
    dialog?.close()
  }

  function pauseContent(): HTMLElement[] {
    // The portal may stop offering spots during the session, so the offer is read on every draw.
    const skipOffered = canUseSkip(controller.run) && session.adapter.rewardedAdsOffered()
    return pauseWindow({ onContinue: continueFromPause, onSettings: () => openSettings('pause-settings'), onHome: goHome, onSkip: skipOffered ? openSkipWindow : null })
  }

  /** The skip windows take the place of the pause; × there opens the pause again. */
  function openSkipWindow(): void {
    closePauseQuietly()
    skipWindow = openSkip({
      controller,
      createAttemptId: () => crypto.randomUUID(),
      closed: () => {
        skipWindow = null
      },
      backToPause: () => {
        openPause()
        topDialog()?.querySelector<HTMLElement>('[data-focus-id="pause-skip"]')?.focus()
      },
      goHome,
    })
  }

  function openZoom(): void {
    if (!scene.image || topDialog() || controller.stopped) return
    controller.zoomOpened()
    const dialog: OpenDialog = openDialog({
      labelledBy: zoomTitleId,
      content: zoomContent(scene.image),
      returnFocusId: 'play-zoom',
      className: 'zoom-window',
      onClosed: () => {
        if (zoomDialog === dialog) closeZoom(true)
      },
    })
    zoomDialog = dialog
  }

  /** `resumeQuestion` is false when the page was hidden: the pause then waits for "Continue". */
  function closeZoom(resumeQuestion: boolean): void {
    const dialog = zoomDialog
    zoomDialog = null
    dialog?.close()
    controller.zoomClosed(resumeQuestion)
  }

  function zoomContent(image: HTMLImageElement): HTMLElement[] {
    const stop = routeStop(currentStop(controller.run))
    const caption = scene.placeholder ? stop.sceneAlt[session.settings.locale] : null
    return zoomWindow({ image, caption, onClose: () => closeZoom(true) })
  }

  /** Closes the game windows and settings without resuming the question. */
  function closeWindowsQuietly(): void {
    skipWindow?.close()
    closePauseQuietly()
    if (zoomDialog) closeZoom(false)
    for (let open = topDialog(); open; open = topDialog()) open.close()
  }

  function showElsewhere(): void {
    clearTimeout(tickTimer)
    if (leaving) return
    closeWindowsQuietly()
    render()
    elsewhereDialog = openDialog({
      labelledBy: elsewhereTitleId,
      content: elsewhereWindow({ onHome: () => elsewhereDialog?.close() }),
      returnFocusId: 'play-pause',
      onClosed: () => {
        elsewhereDialog = null
        if (!disposed) goHome()
      },
    })
  }

  window.addEventListener(
    'keydown',
    (event) => {
      if (topDialog() || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'Escape') {
        // Without this the same Escape would close the pause window it has just opened.
        event.preventDefault()
        openPause()
        return
      }
      const index = choiceKeys.indexOf(event.key)
      if (index !== -1) controller.choose(currentStop(controller.run).choiceIds[index])
    },
    { signal: listeners.signal },
  )

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(tickTimer)
        if (zoomDialog) closeZoom(false)
        controller.pageHidden()
        render()
        return
      }
      controller.ownershipChecked(session.storage.isActiveRunOwner())
      if (controller.stopped) return
      if (sceneWaitsForVisiblePage) sceneShown()
      else if (controller.run.paused) openPause()
    },
    { signal: listeners.signal },
  )

  window.addEventListener(
    'storage',
    (event) => {
      if (event.key === activeRunStorageKey) controller.ownershipChecked(ownsActiveRun(event.newValue, session.tabId))
    },
    { signal: listeners.signal },
  )

  mount(screen.element)
  void loadScene()

  return {
    redraw() {
      render()
      pauseDialog?.replaceContent(pauseContent())
      skipWindow?.redraw()
      if (zoomDialog && scene.image) zoomDialog.replaceContent(zoomContent(scene.image))
      elsewhereDialog?.replaceContent(elsewhereWindow({ onHome: () => elsewhereDialog?.close() }))
    },
    leave() {
      if (disposed) return
      leaving = true
      closeWindowsQuietly()
      controller.leave()
    },
    dispose() {
      disposed = true
      clearTimeout(tickTimer)
      clearTimeout(hintTimer)
      clearTimeout(skipHintTimer)
      listeners.abort()
    },
  }
}
