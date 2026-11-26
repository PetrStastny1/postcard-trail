import { loadRoute } from '../content/index.ts'
import type { Catalog, Route } from '../content/types.ts'
import { routeErrorScreen } from '../game/render/playScreen.ts'
import { dailyUnlocked } from '../game/logic/daily.ts'
import { nextCityToPlay, progressTotals } from '../game/logic/progress.ts'
import { startCityRun, type RunState } from '../game/logic/run.ts'
import { setLocale } from '../i18n/index.ts'
import { openDialog, topDialog, type OpenDialog } from '../ui/dialog.ts'
import { element } from '../ui/element.ts'
import { markMoreContent } from '../ui/moreContent.ts'
import { settingsTitleId, settingsWindow } from '../ui/settings.ts'
import { storageNotice } from '../ui/storageNotice.ts'
import { titleScreen } from '../ui/title.ts'
import { startPlay, type PlaySession } from './play.ts'
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

  function showTitle(): void {
    activePlay?.dispose()
    activePlay = null
    showScreen(renderTitle)
  }

  /** Leaving the game saves the run first; the title then offers "Continue". */
  function goHome(): void {
    activePlay?.leave()
    showTitle()
    screenSlot.querySelector<HTMLElement>('[data-focus-id="title-play"]')?.focus()
  }

  function playNextCity(): void {
    const cityId = nextCityToPlay(session.storage.loadProgress(), catalog)
    // With every released city done, Play opens the map, which the screens package adds.
    if (cityId === null) return
    void openRoute(cityId, (route) => {
      const run = startCityRun({ route, runId: crypto.randomUUID(), untimed: session.settings.untimed, random: Math.random })
      session.storage.startRun(run)
      session.adapter.track({ name: 'route_started', cityId: run.cityId, mode: run.mode, resumed: false })
      return run
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
    let route: Route
    try {
      route = await loadRoute(cityId)
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
      run,
      mount: (screen) => showScreen(() => screen),
      openSettings,
      goHome,
    })
  }

  completeFinishedRun(session.storage, catalog)
  applySettings()
  root.replaceChildren(noticeSlot, screenSlot)
  showTitle()
  showStorageNoticeOnce()
}
