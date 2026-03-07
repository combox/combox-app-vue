import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import vuetify from './plugins/vuetify'
import './index.css'
import './components/core/core.css'

createApp(App).use(vuetify).use(router).mount('#app')
