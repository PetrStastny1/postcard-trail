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
import { loadPlaceholderSceneIds, startPlay, type PlaySession } from './play.ts'
import type { RunCompletion } from './runController.ts'
import { completeFinishedRun } from './runs.ts'
import { changeSettings, type SettingsChange } from './settings.ts'
import type { GameSession } from './start.ts'

/**
 * Screens switch in memory without touching the URL, because the game runs inside a portal frame.
 * Each screen is a render function, so a language change can draw the current one again.
 */
export function mountApp(root: HTMLElement, session: GameSession, catalog: Catalog): void {
  const screenSlot = element('div', { class: 'screen' })
  const noticeSlot = element('div', { class: 'notice-slot' })
  const renderTitle = () => {
    const progress = session.storage.loadProgress()
    return titleScreen({
      totals: progressTotals(progress, catalog),
      dailyUnlocked: dailyUnlocked(progress),
      hasActiveRun: session.storage.loadActiveRun() !== null,
      onPlay: playNextCity,
      onContinue: continueRun,
      onOpenSettings: () => openSettings('title-settings'),
      onOpenMap: openMap,
      onOpenCollection: openCollection,
      onOpenDaily: openDaily,
    })
  }
  let renderScreen = renderTitle
  let settingsDialog: OpenDialog | null = null
  let storageNoticeOpen = false
  let activePlay: PlaySession | null = null
  let openingRoute = false
  markMoreContent(screenSlot)

  // Capturing on window runs before any other handler, so a cue played by that handler can already sound.
  window.addEventListener('click', () => session.feedback.unlock(), { capture: true })
  window.addEventListener('keydown', () => session.feedback.unlock(), { capture: true })
  // Escape works like × on a window screen as well; a dialog closes itself on Escape and the game has its own keys.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || activePlay || topDialog()) return
    screenSlot.querySelector<HTMLElement>('.window-screen > .window-bar [data-focus-id="window-close"]')?.click()
  })

  function applySettings(): void {
    setLocale(session.settings.locale)
    document.documentElement.lang = session.settings.locale
    document.documentElement.dataset.reducedMotion = String(session.settings.reducedMotion)
  }

  function showScreen(render: () => HTMLElement): void {
    renderScreen = render
    screenSlot.replaceChildren(render())
  }

  /** Draws everything again in the current language and keeps focus on the same control. */
  function redraw(): void {
    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.focusId : undefined
    if (activePlay) activePlay.redraw()
    else screenSlot.replaceChildren(renderScreen())
    if (storageNoticeOpen) renderStorageNotice()
    settingsDialog?.replaceContent(settingsContent())
    // Windows share the IDs of their bar buttons, so the control is looked up in the window that has focus.
    const layer: ParentNode = topDialog() ?? root
    if (focusId) layer.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`)?.focus()
  }

  function renderStorageNotice(): void {
    noticeSlot.replaceChildren(
      storageNotice(() => {
        storageNoticeOpen = false
        noticeSlot.replaceChildren()
        screenSlot.querySelector<HTMLElement>('button')?.focus()
      }),
    )
  }

  function showStorageNoticeOnce(): void {
    // `takeUnavailableNotice` answers true once per session, so the notice never comes back after it is closed.
    if (!session.storage.takeUnavailableNotice()) return
    storageNoticeOpen = true
    renderStorageNotice()
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
      },
    })
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
    startCity(cityId, false)
  }

  /**
   * Brief §3: the device keeps one active run. Choosing another one asks first; Keep and × return to the window the
   * choice came from (`returnFocusId` is its control). `start(true)` replaces the saved run.
   */
  function changeRun(returnFocusId: string, start: (discard: boolean) => void): void {
    if (session.storage.loadActiveRun() === null) return start(false)
    const dialog = openDialog({
      labelledBy: routeChangeTitleId,
      className: 'window-narrow',
      content: routeChangeWindow({
        onKeep: () => dialog.close(),
        onDiscard: () => {
          closeDialogs()
          start(true)
        },
        onHome: homeFromDialog,
      }),
      returnFocusId,
      onClosed: () => undefined,
    })
  }

  /** Removes only the active run; rewards stay. The run is taken over first, since only its owner tab may remove it. */
  function discardActiveRun(): void {
    const run = session.storage.resumeRun()
    if (run === null) return
    session.storage.discardRun(run.runId)
    session.adapter.track({ name: 'route_left', cityId: run.cityId, mode: run.mode, index: run.stopIndex + 1, reason: 'abandoned' })
  }

  // The old run goes only once the new route has loaded, so a failed load leaves it saved.
  function startCity(cityId: string, discard: boolean): void {
    void openRoute(cityId, (route) => {
      if (discard) discardActiveRun()
      const run = startCityRun({ route, runId: crypto.randomUUID(), untimed: session.settings.untimed, random: Math.random })
      session.storage.startRun(run)
      session.adapter.track({ name: 'route_started', cityId: run.cityId, mode: run.mode, resumed: false })
      return run
    })
  }

  function startDaily(discard: boolean): void {
    const plan = dailyPlan(catalog, utcDateOf(Date.now()))
    // Another tab may have finished today's challenge since the overview was drawn.
    if (plan === null || hasDailyResult(session.storage.loadDailyResults(), plan.utcDate)) return openDaily()
    void openRoute(plan.cityId, (route) => {
      if (discard) discardActiveRun()
      const run = startDailyRun({ route, plan, runId: crypto.randomUUID(), untimed: session.settings.untimed })
      session.storage.startRun(run)
      session.adapter.track({ name: 'route_started', cityId: run.cityId, mode: run.mode, resumed: false })
      return run
    })
  }

  function openMap(): void {
    showWindow(renderMap, ['window-close'])
  }

  function renderMap(): HTMLElement {
    return mapScreen({
      cities: mapCities(session.storage.loadProgress(), catalog),
      locale: session.settings.locale,
      onOpenCity: openCityDetail,
      onClose: () => showTitle('title-map'),
      onHome: goHome,
    })
  }

  function openCityDetail(cityId: string, returnFocusId: string): void {
    const entry = mapCities(session.storage.loadProgress(), catalog).find(({ city }) => city.id === cityId)
    if (!entry) return
    const active = session.storage.loadActiveRun()
    const dialog = openDialog({
      labelledBy: cityDetailTitleId,
      content: cityDetailWindow({
        entry,
        locale: session.settings.locale,
        hasActiveRunHere: active?.mode === 'city' && active.cityId === cityId,
        onPlay: () => changeRun('city-play', (discard) => startCity(cityId, discard)),
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
      onPlayCity: (cityId, returnFocusId) => changeRun(returnFocusId, (discard) => startCity(cityId, discard)),
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
    if (stored === null) return showTitle()
    void openRoute(stored.cityId, () => {
      const run = session.storage.resumeRun()
      if (run !== null) session.adapter.track({ name: 'route_started', cityId: run.cityId, mode: run.mode, resumed: true })
      return run
    })
  }

  /** Routes load only when a run starts or continues, so the title never downloads one. */
  async function openRoute(cityId: string, begin: (route: Route) => RunState | null): Promise<void> {
    if (openingRoute) return
    openingRoute = true
    // The game or the error screen replaces the screen below, so no window may stay open over it.
    closeDialogs()
    let route: Route
    let placeholderSceneIds: ReadonlySet<string>
    try {
      ;[route, placeholderSceneIds] = await Promise.all([loadRoute(cityId), loadPlaceholderSceneIds()])
    } catch {
      // The player sees the failure and can try again; the run, if any, stays saved as it was.
      showScreen(() => routeErrorScreen({ onRetry: () => void openRoute(cityId, begin), onHome: goHome }))
      return
    } finally {
      openingRoute = false
    }
    const run = begin(route)
    showStorageNoticeOnce()
    if (run === null) return showTitle()
    activePlay = startPlay({
      session,
      catalog,
      route,
      placeholderSceneIds,
      run,
      mount: (screen) => showScreen(() => screen),
      openSettings,
      goHome,
      finished: finishRun,
    })
  }

  completeFinishedRun(session.storage, catalog)
  applySettings()
  root.replaceChildren(noticeSlot, screenSlot)
  showTitle()
  showStorageNoticeOnce()
}
