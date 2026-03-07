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

export default createVuetify({
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
    defaultTheme: 'light',
    themes: {
      light: { dark: false },
    },
  },
})
