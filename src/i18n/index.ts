import type { Locale } from '../content/types.ts'
import cs from './cs.json'
import en from './en.json'

export type MessageKey = keyof typeof en

/** Message families with the plural forms `one`, `few` and `other`, chosen by `Intl.PluralRules`. */
export type PluralKey = { [Key in MessageKey]: Key extends `${infer Family}.other` ? Family : never }[MessageKey]

type Params = Record<string, string | number>

const messages: Record<Locale, Record<MessageKey, string>> = { en, cs }

let currentLocale: Locale = 'en'
let pluralRules = new Intl.PluralRules(currentLocale)

export function setLocale(next: Locale): void {
  currentLocale = next
  pluralRules = new Intl.PluralRules(next)
}

export function t(key: MessageKey, params: Params = {}): string {
  return messages[currentLocale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  )
}

export function plural(family: PluralKey, count: number, params: Params = {}): string {
  const category = pluralRules.select(count)
  const form = category === 'one' || category === 'few' ? category : 'other'
  return t(`${family}.${form}`, { count, ...params })
}
