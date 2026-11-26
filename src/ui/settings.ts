import type { SettingsChange } from '../app/settings.ts'
import type { Locale } from '../content/types.ts'
import type { Settings } from '../game/storage/schema.ts'
import { t, type MessageKey } from '../i18n/index.ts'
import { element } from './element.ts'
import { markMoreContent } from './moreContent.ts'
import { windowBar } from './windowBar.ts'

export interface SettingsOptions {
  settings: Settings
  onChange(change: SettingsChange): void
  onClose(): void
  onHome(): void
}

type SwitchSetting = 'soundEnabled' | 'vibrationEnabled' | 'reducedMotion' | 'untimed'

const switches: { setting: SwitchSetting; label: MessageKey; note?: MessageKey }[] = [
  { setting: 'soundEnabled', label: 'settings.sound' },
  { setting: 'vibrationEnabled', label: 'settings.vibration' },
  { setting: 'reducedMotion', label: 'settings.reducedMotion' },
  { setting: 'untimed', label: 'settings.untimed', note: 'settings.untimedNote' },
]

const languages: { locale: Locale; label: MessageKey }[] = [
  { locale: 'en', label: 'settings.english' },
  { locale: 'cs', label: 'settings.czech' },
]

export const settingsTitleId = 'settings-title'

/** The settings window content: the bar and the options. Every control applies its change at once. */
export function settingsWindow({ settings, onChange, onClose, onHome }: SettingsOptions): HTMLElement[] {
  const languageButtons = languages.map(({ locale, label }) => {
    const button = element(
      'button',
      { class: 'setting-choice', type: 'button', lang: locale, 'aria-pressed': String(settings.locale === locale), 'data-focus-id': `settings-language-${locale}` },
      t(label),
    )
    button.addEventListener('click', () => onChange({ locale }))
    return button
  })
  const language = element(
    'div',
    { class: 'setting-language', role: 'group', 'aria-labelledby': 'settings-language' },
    element('h3', { id: 'settings-language', class: 'setting-heading' }, t('settings.language')),
    element('div', { class: 'setting-choices' }, ...languageButtons),
  )

  const switchRows = switches.map(({ setting, label, note }) => {
    const noteId = note && `settings-${setting}-note`
    const toggle = element(
      'button',
      { class: 'setting-switch', type: 'button', role: 'switch', 'aria-checked': String(settings[setting]), 'aria-describedby': noteId, 'data-focus-id': `settings-${setting}` },
      element('span', { class: 'setting-label' }, t(label)),
      element('span', { class: 'switch-track', 'aria-hidden': 'true' }, element('span', { class: 'switch-thumb' })),
    )
    toggle.addEventListener('click', () => onChange({ [setting]: !settings[setting] }))
    return element('li', {}, toggle, ...(note && noteId ? [element('p', { id: noteId, class: 'setting-note' }, t(note))] : []))
  })

  const body = element('div', { class: 'window-body' }, element('div', { class: 'settings' }, language, element('ul', { class: 'setting-list' }, ...switchRows)))
  markMoreContent(body)
  return [windowBar({ titleId: settingsTitleId, title: t('settings.title'), onClose, onHome }), body]
}
