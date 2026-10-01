import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import vuetify, { syncVuetifyTheme } from './plugins/vuetify'
import { initTheme, onThemeChange, resolveAccentHex, resolveEffectiveTheme } from './theme/theme'
import { flushOutbox } from './lib/offline/outbox'
import { vLongContext } from './directives/longContext'
import './index.css'
import './components/core/core.css'
import { applyInterfaceScale, applyPowerSaving, loadInterfaceScale, loadPowerSaving } from './components/settings/settingsEffects'

// Apply scale + power-saving classes on first paint (before App mounts),
// otherwise the first frame flashes unscaled/animated.
applyInterfaceScale(loadInterfaceScale())
applyPowerSaving(loadPowerSaving())

const initialPrefs = initTheme()
syncVuetifyTheme(initialPrefs.mode, resolveEffectiveTheme(initialPrefs.mode), resolveAccentHex(initialPrefs))
onThemeChange((prefs, effective) => {
  syncVuetifyTheme(prefs.mode, effective, resolveAccentHex(prefs))
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
    void flushOutbox()
  })

  window.addEventListener('online', () => {
    const sw = navigator.serviceWorker.controller
    if (sw) sw.postMessage({ type: 'FLUSH_OUTBOX' })
    void flushOutbox()
  })
}

createApp(App).directive('longContext', vLongContext).use(vuetify).use(router).mount('#app')
