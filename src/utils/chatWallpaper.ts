/**
 * Per-chat wallpaper presets, shared by the picker dialog and the workspace so
 * the preview and the painted chat background can never drift apart.
 *
 * Everything is pure CSS (gradients / patterns): no network, no assets.
 * Ids follow the backend rule `[a-z0-9_-]{1,64}`.
 */
export type WallpaperPreset = { id: string; css: string; label: string }

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'midnight',
    css: 'linear-gradient(180deg, #10141c 0%, #1b2230 100%)',
    label: 'Midnight',
  },
  {
    id: 'grid',
    css: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 28px), linear-gradient(180deg, #171b23 0%, #20262f 100%)',
    label: 'Grid',
  },
  {
    id: 'dots',
    css: 'radial-gradient(rgba(255,255,255,0.16) 1.4px, transparent 1.6px) 0 0 / 22px 22px, linear-gradient(180deg, #1b2130 0%, #242c3d 100%)',
    label: 'Dots',
  },
  {
    id: 'waves',
    css: 'repeating-linear-gradient(-12deg, rgba(255,255,255,0.05) 0 14px, transparent 14px 38px), linear-gradient(180deg, #0f1b2d 0%, #17304d 100%)',
    label: 'Waves',
  },
  {
    id: 'sunset',
    css: 'linear-gradient(165deg, #fde68a 0%, #fb923c 38%, #b45309 74%, #7c2d12 100%)',
    label: 'Sunset',
  },
  {
    id: 'ocean',
    css: 'linear-gradient(165deg, #cffafe 0%, #38bdf8 40%, #1d4ed8 78%, #1e3a8a 100%)',
    label: 'Ocean',
  },
  {
    id: 'forest',
    css: 'linear-gradient(165deg, #dcfce7 0%, #4ade80 36%, #15803d 76%, #14532d 100%)',
    label: 'Forest',
  },
  {
    id: 'paper',
    css: 'radial-gradient(rgba(15,23,42,0.07) 1px, transparent 1.2px) 0 0 / 18px 18px, linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
    label: 'Paper',
  },
]

const presetByID = new Map(WALLPAPER_PRESETS.map((preset) => [preset.id, preset]))

/** Only values the backend accepts are ever rendered (`data:`/`http(s):`/`blob:`). */
function isPaintableImage(value: string): boolean {
  return /^(data:image\/|https?:\/\/|blob:)/.test(value)
}

/**
 * CSS declarations for a stored chat wallpaper, or `undefined` when the chat
 * has none — the caller then keeps the app's default theme wallpaper.
 *
 * Returns a `background*` set rather than a single shorthand so images keep
 * `cover` sizing exactly like the picker preview does.
 */
export function wallpaperStyle(kind?: string | null, value?: string | null): Record<string, string> | undefined {
  const normalizedKind = String(kind || 'none')
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) return undefined
  if (normalizedKind === 'preset') {
    const css = presetByID.get(normalizedValue)?.css
    return css ? { background: css } : undefined
  }
  if (normalizedKind === 'image' && isPaintableImage(normalizedValue)) {
    return {
      backgroundImage: `url("${normalizedValue.replace(/"/g, '%22')}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }
  }
  return undefined
}
