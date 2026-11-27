import { loadRoute } from '../content/index.ts'
import type { Catalog, CatalogCity, Route } from '../content/types.ts'
import { routeErrorScreen } from '../game/render/playScreen.ts'
import { dailyPlan, dailyStreak, dailyUnlocked, hasDailyResult, startDailyRun, utcDateOf } from '../game/logic/daily.ts'
import { nextCityToPlay, progressTotals } from '../game/logic/progress.ts'
import { startCityRun, type RunState } from '../game/logic/run.ts'
import { setLocale } from '../i18n/index.ts'
import { citySummaryScreen } from '../ui/citySummary.ts'
import { collectionScreen, postcardTitleId, postcardWindow } from '../ui/collection.ts'
import { dailyScreen, dailySummaryScreen, type DailyOverviewState } from '../ui/daily.ts'
import { openDialog, topDialog, type OpenDialog } from '../ui/dialog.ts'
import { element } from '../ui/element.ts'
import { cityDetailTitleId, cityDetailWindow, mapCities, mapScreen } from '../ui/map.ts'
import { markMoreContent } from '../ui/moreContent.ts'
import { routeChangeTitleId, routeChangeWindow } from '../ui/routeChange.ts'
import { settingsTitleId, settingsWindow } from '../ui/settings.ts'
import { storageNotice } from '../ui/storageNotice.ts'
import { titleScreen } from '../ui/title.ts'
import { activeRunStorageKey, loadPlaceholderSceneIds, startPlay, type PlaySession } from './play.ts'
import type { RunCompletion } from './runController.ts'
import { completeFinishedRun, runMatchesRoute } from './runs.ts'
import { changeSettings, type SettingsChange } from './settings.ts'
import type { GameSession } from './start.ts'

/** Bars above the screen; each shows at most once per session. */
const notices = {
  storage: { message: 'storage.notice', focusId: 'storage-dismiss' },
  runRemoved: { message: 'storage.runRemoved', focusId: 'run-removed-dismiss' },
} as const
type Notice = keyof typeof notices

/** What a route start shows once the route has loaded: the run to play, or another screen when the run cannot begin. */
type RouteStart = RunState | (() => void)

/**
 * Screens switch in memory without touching the URL, because the game runs inside a portal frame.
 * Each screen is a render function, so a language change can draw the current one again.
 */
export function mountApp(root: HTMLElement, session: GameSession, catalog: Catalog): void {
  const screenSlot = element('div', { class: 'screen' })
  const noticeSlot = element('div', { class: 'notice-slot' })
  const renderTitle = () => {
    const hasActiveRun = session.storage.loadActiveRun() !== null
    titleShowsActiveRun = hasActiveRun
    const progress = session.storage.loadProgress()
    return titleScreen({
      totals: progressTotals(progress, catalog),
      dailyUnlocked: dailyUnlocked(progress),
      hasActiveRun,
      onPlay: playNextCity,
      onContinue: continueRun,
      onOpenSettings: () => openSettings('title-settings'),
      onOpenMap: openMap,
      onOpenCollection: openCollection,
      onOpenDaily: openDaily,
    })
  }
  let renderScreen = renderTitle
  // Whether the title on screen offers Continue, so a run started or finished in another tab redraws it only then.
  let titleShowsActiveRun = false
  let settingsDialog: OpenDialog | null = null
  let settingsClosedWaiters: (() => void)[] = []
  const openNotices = new Set<Notice>()
  let runRemovedNoticeShown = false
  let activePlay: PlaySession | null = null
  // Counts the screens shown, so a route that finishes loading after the player has left does not start its run.
  let shownScreens = 0
  // Routes still loading, cancelled ones included; the app is busy until each has been handled.
  let loadingRoutes = 0
  markMoreContent(screenSlot)

  // Capturing on window runs before any other handler, so a cue played by that handler can already sound, and the
  // handler already works with the stored state settled.
  for (const input of ['click', 'keydown'] as const) {
    window.addEventListener(
      input,
      () => {
        session.feedback.unlock()
        completeRunFinishedElsewhere()
      },
      { capture: true },
    )
  }
  // Escape works like × on a window screen and on the route load error as well; a dialog closes itself on Escape and
  // the game has its own keys.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || activePlay || topDialog()) return
    screenSlot
      .querySelector<HTMLElement>('.window-screen > .window-bar [data-focus-id="window-close"], .route-error-screen > .play-bar [data-focus-id="play-leave"]')
      ?.click()
  })

  /**
   * The one place where a run left in its summary phase is completed (A11): its tab, this page before a reload or
   * another tab, failed to store the rewards. It runs whenever the stored state can have changed under this tab: at
   * start, on a `storage` event, before every click and key, and when a route has loaded. Everything else then reads
   * the stored run, progress and daily results as they are, and never offers a finished run to continue or to discard.
   */
  function completeRunFinishedElsewhere(): boolean {
    // The tab that owns the stored run plays it and completes it itself. A tab whose run another tab took over (the
    // "Route paused" window) does not own it, so it completes a run the other tab left finished.
    if (session.storage.isActiveRunOwner()) return false
    return completeFinishedRun(session.storage, catalog)
  }

  // A run another tab finished or started changes what this tab shows. The title redraws only when its Continue
  // changes, since another tab saves its run every second.
  window.addEventListener('storage', (event) => {
    if (event.key !== activeRunStorageKey) return
    const completed = completeRunFinishedElsewhere()
    const titleChanged = renderScreen === renderTitle && (session.storage.loadActiveRun() !== null) !== titleShowsActiveRun
    if (completed || titleChanged) redraw()
  })

  function applySettings(): void {
    setLocale(session.settings.locale)
    document.documentElement.lang = session.settings.locale
    document.documentElement.dataset.reducedMotion = String(session.settings.reducedMotion)
  }

  function showScreen(render: () => HTMLElement): void {
    renderScreen = render
    shownScreens++
    // A route still loading for the screen the player has left is no longer awaited.
    root.removeAttribute('aria-busy')
    screenSlot.replaceChildren(render())
  }

  /** Draws everything again in the current language and keeps focus on the same control. */
  function redraw(): void {
    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusId : undefined
    if (activePlay) activePlay.redraw()
    else screenSlot.replaceChildren(renderScreen())
    if (openNotices.size > 0) renderNotices()
    settingsDialog?.replaceContent(settingsContent())
    // Windows share the IDs of their bar buttons, so the control is looked up in the window that has focus.
    const layer: ParentNode = topDialog() ?? root
    if (focusId) layer.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`)?.focus()
  }

  function renderNotices(): void {
    noticeSlot.replaceChildren(
      ...[...openNotices].map((notice) =>
        storageNotice(notices[notice].message, notices[notice].focusId, () => {
          openNotices.delete(notice)
          renderNotices()
          screenSlot.querySelector<HTMLElement>('button')?.focus()
        }),
      ),
    )
  }

  function showStorageNoticeOnce(): void {
    // `takeUnavailableNotice` answers true once per session, so the notice never comes back after it is closed.
    if (!session.storage.takeUnavailableNotice()) return
    openNotices.add('storage')
    renderNotices()
  }

  function showRunRemovedNoticeOnce(): void {
    if (runRemovedNoticeShown) return
    runRemovedNoticeShown = true
    openNotices.add('runRemoved')
    renderNotices()
  }

  function settingsContent(): HTMLElement[] {
    return settingsWindow({
      settings: session.settings,
      onChange: updateSettings,
      onClose: () => settingsDialog?.close(),
      onHome: () => {
        settingsDialog?.close()
        goHome()
      },
    })
  }

  function updateSettings(change: SettingsChange): void {
    changeSettings(session, change)
    applySettings()
    redraw()
    showStorageNoticeOnce()
  }

  /** Settings open over the title or over the pause; `returnFocusId` is the opener in that parent. */
  function openSettings(returnFocusId: string): void {
    settingsDialog = openDialog({
      labelledBy: settingsTitleId,
      content: settingsContent(),
      returnFocusId,
      onClosed: () => {
        settingsDialog = null
        for (const settingsClosed of settingsClosedWaiters) settingsClosed()
        settingsClosedWaiters = []
      },
    })
  }

  /** Brief §3: open settings hold the time, so a run whose route loads under them waits until they close. */
  function settingsClosed(): Promise<void> {
    return new Promise((closed) => settingsClosedWaiters.push(closed))
  }

  /** A window screen takes the focus on its first control, so the keyboard continues where the eye goes. */
  function showWindow(render: () => HTMLElement, focusIds: string[]): void {
    showScreen(render)
    for (const focusId of focusIds) {
      const control = screenSlot.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`)
      if (control) return control.focus()
    }
  }

  function showTitle(focusId?: string): void {
    activePlay?.dispose()
    activePlay = null
    showScreen(renderTitle)
    if (focusId) screenSlot.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`)?.focus()
  }

  // `close()` takes the `open` state away at once, so the next window below is found right away.
  function closeDialogs(): void {
    for (let open = topDialog(); open; open = topDialog()) open.close()
  }

  /** Home in a window over a screen: the windows close and the title shows; a saved run stays. */
  function homeFromDialog(): void {
    closeDialogs()
    goHome()
  }

  /** Leaving the game saves the run first; the title then offers "Continue". */
  function goHome(): void {
    activePlay?.leave()
    showTitle()
    screenSlot.querySelector<HTMLElement>('[data-focus-id="title-play"]')?.focus()
  }

  function playNextCity(): void {
    const cityId = nextCityToPlay(session.storage.loadProgress(), catalog)
    // With every released city done, Play opens the map.
    if (cityId === null) return openMap()
    startCity(cityId, null)
  }

  /**
   * Brief §3: the device keeps one active run. Choosing another one asks first; Keep and × return to the window the
   * choice came from (`returnFocusId` is its control). `start` gets the ID of the run the player agreed to discard,
   * so a run another tab starts meanwhile is never discarded with it.
   */
  function changeRun(returnFocusId: string, start: (discardRunId: string | null) => void): void {
    const confirmedRun = session.storage.loadActiveRun()
    if (confirmedRun === null) return start(null)
    const dialog = openDialog({
      labelledBy: routeChangeTitleId,
      className: 'window-narrow',
      content: routeChangeWindow({
        onKeep: () => dialog.close(),
        onDiscard: () => {
          closeDialogs()
          start(confirmedRun.runId)
        },
        onHome: homeFromDialog,
      }),
      returnFocusId,
      onClosed: () => undefined,
    })
  }

  /** Removes only the active run; rewards stay. The run is taken over first, since only its owner tab may remove it. */
  function removeActiveRun(): RunState | null {
    const run = session.storage.resumeRun()
    if (run !== null) session.storage.discardRun(run.runId)
    return run
  }

  /**
   * Called once the new route has loaded, right before the new run is saved. Only the run the player agreed to discard
   * goes; another tab may have started a different one while the route loaded, and that run stays (the title then
   * offers "Continue"). Returns whether the new run may begin.
   */
  function makeRoomForNewRun(discardRunId: string | null): boolean {
    const active = session.storage.loadActiveRun()
    if (active === null) return true
    if (active.runId !== discardRunId) return false
    const run = removeActiveRun()
    if (run !== null) session.adapter.track({ name: 'route_left', cityId: run.cityId, mode: run.mode, index: run.stopIndex + 1, reason: 'abandoned' })
    return true
  }

  const titleOnPlay = () => showTitle('title-play')

  // The old run goes only once the new route has loaded, so a failed load leaves it saved.
  function startCity(cityId: string, discardRunId: string | null): void {
    void openRoute(cityId, (route) => {
      if (!makeRoomForNewRun(discardRunId)) return titleOnPlay
      const run = startCityRun({ route, runId: crypto.randomUUID(), untimed: session.settings.untimed, random: Math.random })
      session.storage.startRun(run)
      session.adapter.track({ name: 'route_started', cityId: run.cityId, mode: run.mode, resumed: false })
      return run
    })
  }

  function startDaily(discardRunId: string | null): void {
    const plan = dailyPlan(catalog, utcDateOf(Date.now()))
    // Another tab may have finished today's challenge since the overview was drawn, or while the route loads.
    const doneToday = () => plan !== null && hasDailyResult(session.storage.loadDailyResults(), plan.utcDate)
    if (plan === null || doneToday()) return openDaily()
    void openRoute(plan.cityId, (route) => {
      if (doneToday()) return openDaily
      if (!makeRoomForNewRun(discardRunId)) return titleOnPlay
      const run = startDailyRun({ route, plan, runId: crypto.randomUUID(), untimed: session.settings.untimed })
      session.storage.startRun(run)
      session.adapter.track({ name: 'route_started', cityId: run.cityId, mode: run.mode, resumed: false })
      return run
    })
  }

  function activeCityRunCityId(): string | null {
    const active = session.storage.loadActiveRun()
    return active?.mode === 'city' ? active.cityId : null
  }

  function openMap(): void {
    showWindow(renderMap, ['window-close'])
  }

  function renderMap(): HTMLElement {
    return mapScreen({
      cities: mapCities(session.storage.loadProgress(), catalog, activeCityRunCityId()),
      locale: session.settings.locale,
      onOpenCity: openCityDetail,
      onClose: () => showTitle('title-map'),
      onHome: goHome,
    })
  }

  function openCityDetail(cityId: string, returnFocusId: string): void {
    const entry = mapCities(session.storage.loadProgress(), catalog, activeCityRunCityId()).find(({ city }) => city.id === cityId)
    if (!entry) return
    const dialog = openDialog({
      labelledBy: cityDetailTitleId,
      content: cityDetailWindow({
        entry,
        locale: session.settings.locale,
        onPlay: () => changeRun('city-play', (discardRunId) => startCity(cityId, discardRunId)),
        onContinue: () => {
          closeDialogs()
          continueRun()
        },
        onClose: () => dialog.close(),
        onHome: homeFromDialog,
      }),
      returnFocusId,
      onClosed: () => undefined,
    })
  }

  function openCollection(): void {
    showWindow(renderCollection, ['window-close'])
  }

  function renderCollection(): HTMLElement {
    return collectionScreen({
      catalog,
      postcardCityIds: session.storage.loadProgress().postcardCityIds,
      locale: session.settings.locale,
      onOpenCard: openPostcard,
      onClose: () => showTitle('title-collection'),
      onHome: goHome,
    })
  }

  function openPostcard(cityId: string, returnFocusId: string): void {
    const city = catalog.cities.find((candidate) => candidate.id === cityId)
    if (!city) return
    const dialog = openDialog({
      labelledBy: postcardTitleId,
      content: postcardWindow({ city, locale: session.settings.locale, onClose: () => dialog.close(), onHome: homeFromDialog }),
      returnFocusId,
      onClosed: () => undefined,
    })
  }

  function openDaily(): void {
    showWindow(renderDaily, ['daily-start', 'window-close'])
  }

  /** The UTC date is taken when the overview is drawn and again at Start. */
  function renderDaily(): HTMLElement {
    const utcDate = utcDateOf(Date.now())
    const results = session.storage.loadDailyResults()
    const plan = dailyPlan(catalog, utcDate)
    const city = plan && catalog.cities.find((candidate) => candidate.id === plan.cityId)
    const active = session.storage.loadActiveRun()
    // A daily run belongs to the day it started, so its city can differ from today's.
    const activeDailyCity = active?.mode === 'daily' ? catalog.cities.find((candidate) => candidate.id === active.cityId) : undefined
    let state: DailyOverviewState
    if (!city) state = { status: 'notOffered', firstUtcDate: catalog.versions[0].effectiveUtcDate }
    else if (activeDailyCity) state = { status: 'inProgress', city: activeDailyCity }
    else if (hasDailyResult(results, utcDate)) state = { status: 'done', city, correct: results[utcDate].correct }
    else state = { status: 'available', city }
    return dailyScreen({
      utcDate,
      state,
      streak: dailyStreak(results, utcDate),
      locale: session.settings.locale,
      onStart: () => changeRun('daily-start', startDaily),
      onContinue: continueRun,
      onClose: () => showTitle('title-daily'),
      onHome: goHome,
    })
  }

  /** The end of a run: the game screen goes and the city or daily summary shows what the completion saved. */
  function finishRun(completion: RunCompletion): void {
    activePlay?.dispose()
    activePlay = null
    if (completion.mode === 'city') showWindow(() => renderCitySummary(completion), ['summary-next'])
    else showWindow(() => renderDailySummary(completion), ['daily-summary-overview'])
    // Rewards that did not reach the store are kept for this session only, so the player hears about it here (A3).
    showStorageNoticeOnce()
  }

  function renderCitySummary({ run, summary }: Extract<RunCompletion, { mode: 'city' }>): HTMLElement {
    const index = catalog.cities.findIndex((city) => city.id === run.cityId)
    return citySummaryScreen({
      city: catalog.cities[index],
      run,
      summary,
      unlockedCity: catalog.cities.find((city) => city.id === summary.newlyUnlockedCityId) ?? null,
      nextCity: catalog.cities.at(index + 1) ?? null,
      locale: session.settings.locale,
      onPlayCity: (cityId, returnFocusId) => changeRun(returnFocusId, (discardRunId) => startCity(cityId, discardRunId)),
      onMap: openMap,
      onClose: () => showTitle('title-play'),
      onHome: goHome,
    })
  }

  function renderDailySummary({ run, utcDate, dailyResults }: Extract<RunCompletion, { mode: 'daily' }>): HTMLElement {
    // A result another tab saved first for the same date wins (brief §3), so the summary shows the stored one.
    return dailySummaryScreen({
      city: catalog.cities.find((city) => city.id === run.cityId) as CatalogCity,
      locale: session.settings.locale,
      correct: dailyResults[utcDate].correct,
      streak: dailyStreak(dailyResults, utcDateOf(Date.now())),
      onOverview: openDaily,
      onClose: () => showTitle('title-play'),
      onHome: goHome,
    })
  }

  function continueRun(): void {
    const stored = session.storage.loadActiveRun()
    if (stored === null) return showTitle('title-play')
    if (!catalog.cities.some((city) => city.id === stored.cityId)) return removeMismatchedRun()
    void openRoute(stored.cityId, (route) => {
      // While the route loaded, the run may have been finished, discarded or replaced in another tab.
      const active = session.storage.loadActiveRun()
      if (active?.runId !== stored.runId) return titleOnPlay
      if (!runMatchesRoute(active, route)) return removeMismatchedRun
      const run = session.storage.resumeRun()
      if (run === null) return titleOnPlay
      session.adapter.track({ name: 'route_started', cityId: run.cityId, mode: run.mode, resumed: true })
      return run
    })
  }

  /**
   * A saved run that names a city, stop or choice this build does not have cannot be played. Only that run goes, without
   * `route_left`, since the player never left it; progress and daily results stay, and the player hears why once.
   */
  function removeMismatchedRun(): void {
    removeActiveRun()
    showTitle('title-play')
    showRunRemovedNoticeOnce()
  }

  /**
   * Routes load only when a run starts or continues, so the title never downloads one. Leaving the screen while the
   * route loads (×, Escape, Home) cancels the start. Of two starts made while loading, the first to load shows its screen
   * and so cancels the other, so only one run begins.
   */
  async function openRoute(cityId: string, begin: (route: Route) => RouteStart): Promise<void> {
    // The game or the error screen replaces the screen below, so no window may stay open over it.
    closeDialogs()
    const shownBefore = shownScreens
    let route: Route
    let placeholderSceneIds: ReadonlySet<string>
    setRouteLoading(1)
    try {
      ;[route, placeholderSceneIds] = await Promise.all([loadRoute(cityId), loadPlaceholderSceneIds()])
    } catch {
      setRouteLoading(-1)
      if (shownScreens !== shownBefore) return
      // The player sees the failure and can try again; the run, if any, stays saved as it was.
      showScreen(() => routeErrorScreen({ onRetry: () => void openRoute(cityId, begin), onHome: goHome }))
      screenSlot.querySelector<HTMLElement>('[data-focus-id="route-retry"]')?.focus()
      return
    }
    // Settings opened over the title while the route loaded; Home there leaves the screen and so cancels the start.
    if (settingsDialog) await settingsClosed()
    setRouteLoading(-1)
    if (shownScreens !== shownBefore) return
    // Another tab may have left a finished run while the route loaded; it is completed, never discarded or continued.
    completeRunFinishedElsewhere()
    const start = begin(route)
    showStorageNoticeOnce()
    if (typeof start === 'function') return start()
    activePlay = startPlay({
      session,
      catalog,
      route,
      placeholderSceneIds,
      run: start,
      mount: (screen) => showScreen(() => screen),
      openSettings,
      goHome,
      finished: finishRun,
    })
  }

  /**
   * `aria-busy` tells assistive technology that the screen waits for a route; leaving the screen ends that. Tests see
   * from `data-route-loading` when every started load, cancelled ones included, has been handled.
   */
  function setRouteLoading(change: 1 | -1): void {
    loadingRoutes += change
    root.toggleAttribute('data-route-loading', loadingRoutes > 0)
    if (change === 1) root.setAttribute('aria-busy', 'true')
    else if (loadingRoutes === 0) root.removeAttribute('aria-busy')
  }

  completeRunFinishedElsewhere()
  applySettings()
  root.replaceChildren(noticeSlot, screenSlot)
  showTitle()
  showStorageNoticeOnce()
}
