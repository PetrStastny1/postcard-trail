import type { Catalog } from '../content/types.ts'
import { dailyUnlocked } from '../game/logic/daily.ts'
import { progressTotals } from '../game/logic/progress.ts'
import { setLocale } from '../i18n/index.ts'
import { openDialog, topDialog, type OpenDialog } from '../ui/dialog.ts'
import { element } from '../ui/element.ts'
import { markMoreContent } from '../ui/moreContent.ts'
import { settingsTitleId, settingsWindow } from '../ui/settings.ts'
import { storageNotice } from '../ui/storageNotice.ts'
import { titleScreen } from '../ui/title.ts'
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
    return titleScreen({ totals: progressTotals(progress, catalog), dailyUnlocked: dailyUnlocked(progress), onOpenSettings: openSettings })
  }
  let renderScreen = renderTitle
  let settingsDialog: OpenDialog | null = null
  let storageNoticeOpen = false
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
    screenSlot.replaceChildren(renderScreen())
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
        showTitle()
      },
    })
  }

  function updateSettings(change: SettingsChange): void {
    changeSettings(session, change)
    applySettings()
    redraw()
    showStorageNoticeOnce()
  }

  function openSettings(): void {
    settingsDialog = openDialog({
      labelledBy: settingsTitleId,
      content: settingsContent(),
      returnFocusId: 'title-settings',
      onClosed: () => {
        settingsDialog = null
      },
    })
  }

  function showTitle(): void {
    showScreen(renderTitle)
  }

  applySettings()
  root.replaceChildren(noticeSlot, screenSlot)
  showTitle()
  showStorageNoticeOnce()
}
