import { computed, ref } from 'vue'
import * as enRaw from './dicts/en.json'
import * as ruRaw from './dicts/ru.json'

type Params = Record<string, string | number>
type Locale = 'en' | 'ru'

function resolveDictionary(input: unknown): Record<string, string> {
  let candidate: unknown = input
  for (let i = 0; i < 6; i += 1) {
    if (!candidate || typeof candidate !== 'object') return {}
    const asRecord = candidate as Record<string, unknown>
    if ('app.name' in asRecord || 'common.language' in asRecord) {
      return asRecord as Record<string, string>
    }
    if ('default' in asRecord) {
      candidate = asRecord.default
      continue
    }
    return asRecord as Record<string, string>
  }
  return {}
}

const dictionariesRaw: Record<Locale, unknown> = {
  en: enRaw,
  ru: ruRaw,
}
const LOCALE_STORAGE_KEY = 'combox_locale_override'

function normalizeLocale(value: string | null | undefined): Locale | null {
  const lang = `${value || ''}`.toLowerCase()
  if (lang.startsWith('ru')) return 'ru'
  if (lang.startsWith('en')) return 'en'
  return null
}

function detectLocale(): Locale {
  const saved = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY))
  if (saved) return saved
  const htmlLang = normalizeLocale(document.documentElement.lang)
  if (htmlLang) return htmlLang
  const lang = `${window.navigator.language || 'en'}`.toLowerCase()
  if (lang.startsWith('ru')) return 'ru'
  return 'en'
}

function applyParams(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
    const value = params[key]
    return value === undefined ? '' : String(value)
  })
}

const locale = ref<Locale>(detectLocale())
document.documentElement.lang = locale.value

function setLocale(next: Locale): void {
  locale.value = next
  document.documentElement.lang = next
  window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
}

function t(key: string, params?: Params, fallback?: string): string {
  const dict = resolveDictionary(dictionariesRaw[locale.value])
  const raw = dict[key] ?? fallback ?? key
  return applyParams(raw, params)
}

export function useI18n() {
  return {
    locale: computed(() => locale.value),
    setLocale,
    t,
  }
}
