import { createRouter, createWebHistory } from 'vue-router'
import { isAuthenticated } from 'combox-api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('../pages/HomePage.vue'), meta: { requiresAuth: true } },
    { path: '/auth', component: () => import('../pages/AuthPage.vue'), meta: { guestOnly: true } },
    // Lazy: SettingsPage statically pulls 7 settings panels + playlist modal;
    // keeping it out of the initial bundle shrinks main-thread startup work.
    { path: '/settings', component: () => import('../pages/SettingsPage.vue'), meta: { requiresAuth: true } },
    // Shared folder deep link: HomePage renders behind the FolderImportModal
    // mounted in App.vue; works for own and foreign invites while logged in.
    { path: '/folder/:token', component: () => import('../pages/HomePage.vue'), meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !isAuthenticated()) return '/auth'
  if (to.meta.guestOnly && isAuthenticated()) return '/'
  return true
})

export { router }
