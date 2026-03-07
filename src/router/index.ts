import { createRouter, createWebHistory } from 'vue-router'
import { isAuthenticated } from 'combox-api'
import SettingsPage from '../pages/SettingsPage.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../pages/HomePage.vue'), meta: { requiresAuth: true } },
    { path: '/auth', component: () => import('../pages/AuthPage.vue'), meta: { guestOnly: true } },
    { path: '/settings', component: SettingsPage, meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isAuthenticated()) return '/auth'
  if (to.meta.guestOnly && isAuthenticated()) return '/'
  return true
})

export { router }
