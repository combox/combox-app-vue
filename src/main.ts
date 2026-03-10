import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import vuetify, { syncVuetifyTheme } from './plugins/vuetify'
import { initTheme, onThemeChange, resolveAccentHex, resolveEffectiveTheme } from './theme/theme'
import './index.css'
import './components/core/core.css'

const initialPrefs = initTheme()
syncVuetifyTheme(initialPrefs.mode, resolveEffectiveTheme(initialPrefs.mode), resolveAccentHex(initialPrefs))
onThemeChange((prefs, effective) => {
  syncVuetifyTheme(prefs.mode, effective, resolveAccentHex(prefs))
})

createApp(App).use(vuetify).use(router).mount('#app')
