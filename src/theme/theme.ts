export type ThemeMode = 'system' | 'light' | 'dark'

export type WallpaperId =
  | 'paper'
  | 'sky'
  | 'mint'
  | 'lavender'
  | 'peach'
  | 'graphite'
  | 'midnight'
  | 'custom'

export type AccentId = 'telegram' | 'blue' | 'mint' | 'violet' | 'orange' | 'pink' | 'custom'

export type EffectiveTheme = 'light' | 'dark'

export type ThemePrefs = {
  mode: ThemeMode
  wallpaperLight: WallpaperId
  wallpaperDark: WallpaperId
  accent: AccentId
  customAccent?: string
  customWallpaperBaseLight?: string
  customWallpaperBaseDark?: string
}

const STORAGE_KEY = 'combox.theme.v1'

let systemListenerAttached = false
type ThemeChangeListener = (prefs: ThemePrefs, effective: EffectiveTheme) => void
const listeners = new Set<ThemeChangeListener>()

export function onThemeChange(listener: ThemeChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const accentPresets: ReadonlyArray<{ id: AccentId; hex: string }> = [
  { id: 'telegram', hex: '#4a90d9' },
  { id: 'blue', hex: '#2563eb' },
  { id: 'mint', hex: '#10b981' },
  { id: 'violet', hex: '#7c3aed' },
  { id: 'orange', hex: '#f97316' },
  { id: 'pink', hex: '#ec4899' },
  { id: 'custom', hex: '#4a90d9' },
]

export const wallpaperPresets: ReadonlyArray<{ id: WallpaperId; base: string }> = [
  { id: 'paper', base: '#e9eef7' },
  { id: 'sky', base: '#cfe7ff' },
  { id: 'mint', base: '#c9f2e2' },
  { id: 'lavender', base: '#e6ddff' },
  { id: 'peach', base: '#ffe1d1' },
  { id: 'graphite', base: '#cfd6e1' },
  { id: 'midnight', base: '#1f2937' },
  { id: 'custom', base: '#dbeafe' },
]

export function initTheme(): ThemePrefs {
  const prefs = loadThemePrefs()
  applyTheme(prefs)

  if (!systemListenerAttached && typeof window !== 'undefined') {
    systemListenerAttached = true
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', () => {
      const latest = loadThemePrefs()
      if (latest.mode === 'system') applyTheme(latest)
    })
  }

  return prefs
}

export function loadThemePrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPrefs()
    const parsed = JSON.parse(raw) as Partial<ThemePrefs>
    return normalizePrefs(parsed)
  } catch {
    return defaultPrefs()
  }
}

export function saveThemePrefs(prefs: ThemePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Ignore storage failures (private mode, quota, etc).
  }
}

export function applyTheme(prefs: ThemePrefs): void {
  const root = document.documentElement
  const effective = resolveEffectiveTheme(prefs.mode)

  root.dataset.theme = effective
  const accent = resolveAccentHex(prefs)
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-strong', deriveAccentStrong(accent))
  root.style.setProperty('--accent-soft', `rgba(${hexToRgb(accent).join(',')}, 0.14)`)
  root.style.setProperty('--avatar-fallback', deriveAvatarFallback(accent))
  root.style.setProperty('--chat-wallpaper', resolveWallpaperCss(prefs, effective))

  for (const l of listeners) {
    try {
      l(prefs, effective)
    } catch {
      // ignore listener errors
    }
  }
}

export function resolveEffectiveTheme(mode: ThemeMode): EffectiveTheme {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
  return prefersDark ? 'dark' : 'light'
}

export function resolveAccentHex(prefs: ThemePrefs): string {
  if (prefs.accent === 'custom') return sanitizeHex(prefs.customAccent || '#4a90d9')
  return accentPresets.find((a) => a.id === prefs.accent)?.hex || '#4a90d9'
}

export function resolveWallpaperCss(prefs: ThemePrefs, effective: EffectiveTheme): string {
  const wallpaperId = effective === 'dark' ? prefs.wallpaperDark : prefs.wallpaperLight
  const customBase = effective === 'dark' ? prefs.customWallpaperBaseDark : prefs.customWallpaperBaseLight

  const base =
    wallpaperId === 'custom'
      ? (customBase || (effective === 'dark' ? '#111827' : '#dbeafe'))
      : (wallpaperPresets.find((w) => w.id === wallpaperId)?.base || (effective === 'dark' ? '#111827' : '#e9eef7'))

  return makeWallpaper(base, effective)
}


function defaultPrefs(): ThemePrefs {
  return {
    mode: 'system',
    wallpaperLight: 'paper',
    wallpaperDark: 'midnight',
    accent: 'telegram',
    customAccent: '#4a90d9',
    customWallpaperBaseLight: '#dbeafe',
    customWallpaperBaseDark: '#111827',
  }
}

function normalizePrefs(p: Partial<ThemePrefs>): ThemePrefs {
  const d = defaultPrefs()
  const mode: ThemeMode = p.mode === 'light' || p.mode === 'dark' || p.mode === 'system' ? p.mode : d.mode
  const legacyWallpaper = isWallpaperId((p as { wallpaper?: unknown }).wallpaper) ? ((p as { wallpaper?: WallpaperId }).wallpaper as WallpaperId) : undefined
  const wallpaperLight: WallpaperId = isWallpaperId(p.wallpaperLight) ? p.wallpaperLight : legacyWallpaper || d.wallpaperLight
  const wallpaperDark: WallpaperId = isWallpaperId(p.wallpaperDark) ? p.wallpaperDark : (legacyWallpaper === 'midnight' ? 'midnight' : d.wallpaperDark)
  const accent: AccentId = isAccentId(p.accent) ? p.accent : d.accent

  return {
    mode,
    wallpaperLight,
    wallpaperDark,
    accent,
    customAccent: sanitizeHex(p.customAccent || d.customAccent!),
    customWallpaperBaseLight: sanitizeHex((p as { customWallpaperBaseLight?: string }).customWallpaperBaseLight || (p as { customWallpaperBase?: string }).customWallpaperBase || d.customWallpaperBaseLight!),
    customWallpaperBaseDark: sanitizeHex((p as { customWallpaperBaseDark?: string }).customWallpaperBaseDark || d.customWallpaperBaseDark!),
  }
}

function isWallpaperId(value: unknown): value is WallpaperId {
  return wallpaperPresets.some((w) => w.id === value)
}

function isAccentId(value: unknown): value is AccentId {
  return accentPresets.some((a) => a.id === value)
}

function sanitizeHex(input: string): string {
  const s = (input || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  return '#4a90d9'
}

function hexToRgb(hex: string): [number, number, number] {
  const safe = sanitizeHex(hex)
  const r = parseInt(safe.slice(1, 3), 16)
  const g = parseInt(safe.slice(3, 5), 16)
  const b = parseInt(safe.slice(5, 7), 16)
  return [r, g, b]
}

function rgbToHex(rgb: [number, number, number]): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function deriveAccentStrong(hex: string): string {
  const rgb = hexToRgb(hex)
  // Slightly darker, higher contrast.
  return rgbToHex(mix(rgb, [0, 0, 0], 0.22))
}

function deriveAvatarFallback(hex: string): string {
  const rgb = hexToRgb(hex)
  // Softer, more pastel-like.
  return rgbToHex(mix(rgb, [255, 255, 255], 0.32))
}

function makeWallpaper(baseHex: string, effective: EffectiveTheme): string {
  const base = hexToRgb(baseHex)
  const isDark = effective === 'dark'

  const ink: [number, number, number] = isDark ? [15, 23, 42] : [15, 23, 42]
  const overlayA = isDark ? 0.06 : 0.12
  const dotsA = isDark ? 0.0 : 0.16
  const edgeA = isDark ? 0.16 : 0.18

  const top = rgbToHex(mix(base, [255, 255, 255], isDark ? 0.06 : 0.22))
  const bottom = rgbToHex(mix(base, ink, isDark ? 0.26 : 0.10))

  const [r, g, b] = base
  const dotRgb: [number, number, number] = isDark ? [255, 255, 255] : [15, 23, 42]
  const [dr, dg, db] = dotRgb

  // A clean wallpaper: soft glows + subtle grain + base gradient.
  const layers: string[] = isDark
    ? [
        `radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.04) 1px, rgba(0, 0, 0, 0) 1.6px) 0 0 / 24px 24px`,
        `radial-gradient(circle at 18% 12%, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0) 58%)`,
        `radial-gradient(circle at 82% 78%, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0) 62%)`,
        `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`,
      ]
    : [
        `radial-gradient(circle at 16% 12%, rgba(${r}, ${g}, ${b}, ${edgeA}) 0%, rgba(${r}, ${g}, ${b}, 0) 58%)`,
        `radial-gradient(circle at 86% 22%, rgba(${r}, ${g}, ${b}, ${overlayA}) 0%, rgba(${r}, ${g}, ${b}, 0) 52%)`,
        `radial-gradient(circle at 70% 86%, rgba(${r}, ${g}, ${b}, ${overlayA}) 0%, rgba(${r}, ${g}, ${b}, 0) 58%)`,
        `radial-gradient(circle at 28% 72%, rgba(${r}, ${g}, ${b}, ${overlayA}) 0%, rgba(${r}, ${g}, ${b}, 0) 56%)`,
        `radial-gradient(circle at 1px 1px, rgba(${dr}, ${dg}, ${db}, ${dotsA}) 1px, rgba(0, 0, 0, 0) 1.6px) 0 0 / 18px 18px`,
        `linear-gradient(180deg, ${top} 0%, ${bottom} 100%)`,
      ]

  return layers.join(', ')
}
