import { createRouter, createWebHistory } from 'vue-router'

const RouteStub = { template: '<span />' }

export const routeNames = ['portfolio', 'trade', 'history', 'settings'] as const
export type RouteName = (typeof routeNames)[number]

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/portfolio' },
    { path: '/portfolio', name: 'portfolio', component: RouteStub },
    { path: '/trade', name: 'trade', component: RouteStub },
    { path: '/history', name: 'history', component: RouteStub },
    { path: '/api-keys', redirect: '/settings' },
    { path: '/settings', name: 'settings', component: RouteStub },
    { path: '/oauth/authorize', name: 'oauthAuthorize', component: RouteStub },
    { path: '/:pathMatch(.*)*', redirect: '/portfolio' },
  ],
})
