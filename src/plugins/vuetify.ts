import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import {
  VAlert,
  VApp,
  VAvatar,
  VBtn,
  VCard,
  VCardText,
  VCol,
  VContainer,
  VDialog,
  VDivider,
  VIcon,
  VList,
  VListItem,
  VListSubheader,
  VNavigationDrawer,
  VProgressCircular,
  VProgressLinear,
  VRadio,
  VRow,
  VSheet,
  VSkeletonLoader,
  VSwitch,
  VTextField,
} from 'vuetify/components'
import { Ripple } from 'vuetify/directives'

const vuetify = createVuetify({
  components: {
    VAlert,
    VApp,
    VAvatar,
    VBtn,
    VCard,
    VCardText,
    VCol,
    VContainer,
    VDialog,
    VDivider,
    VIcon,
    VList,
    VListItem,
    VListSubheader,
    VNavigationDrawer,
    VProgressCircular,
    VProgressLinear,
    VRadio,
    VRow,
    VSheet,
    VSkeletonLoader,
    VSwitch,
    VTextField,
  },
  directives: {
    Ripple,
  },
  theme: {
    // Use system theme by default; we can override it from our own theme prefs at runtime.
    defaultTheme: 'system',
    themes: {
      light: {
        dark: false,
        colors: {
          background: '#eef2f7',
          surface: '#ffffff',
          primary: '#4a90d9',
        },
      },
      dark: {
        dark: true,
        colors: {
          background: '#0b0b0c',
          surface: '#18181b',
          primary: '#4a90d9',
        },
      },
    },
  },
})

export function syncVuetifyTheme(mode: 'system' | 'light' | 'dark', effective: 'light' | 'dark', accentHex?: string) {
  try {
    // Vuetify has a built-in `system` theme name which tracks prefers-color-scheme.
    const name = mode === 'system' ? 'system' : effective === 'dark' ? 'dark' : 'light'
    // Vuetify 3: theme.global.name is a ref.
    // If API shape differs, fail silently: app still uses our CSS variables.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (vuetify as any)?.theme
    if (t?.global?.name?.value) t.global.name.value = name
    const targetThemes = name === 'system' ? ['light', 'dark'] : [name]
    for (const themeName of targetThemes) {
      if (accentHex && t?.themes?.value?.[themeName]?.colors) {
        t.themes.value[themeName].colors.primary = accentHex
      }
    }
  } catch {
    // ignore
  }
}

export default vuetify
