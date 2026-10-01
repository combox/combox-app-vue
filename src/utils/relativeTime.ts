import { ref, type Ref } from 'vue'
import { useI18n } from '../i18n/i18n'

const JUST_NOW_SECONDS = 45
const TICK_MS = 30_000

const nowMs = ref(Date.now())
let ticker: number | null = null

export function useRelativeClock(): Ref<number> {
  if (ticker === null && typeof window !== 'undefined') {
    ticker = window.setInterval(() => {
      nowMs.value = Date.now()
    }, TICK_MS)
  }
  return nowMs
}

export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  now: number = Date.now(),
  localeOverride?: string,
): string {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const { t, locale } = useI18n()
  const lang = localeOverride || locale.value
  const deltaSeconds = (date.getTime() - now) / 1000
  const abs = Math.abs(deltaSeconds)

  if (abs < JUST_NOW_SECONDS) return t('time.just_now', undefined, 'just now')
  if (abs >= 30 * 86_400) return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(date)

  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'long' })
  if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(deltaSeconds / 3600), 'hour')
  return rtf.format(Math.round(deltaSeconds / 86_400), 'day')
}
