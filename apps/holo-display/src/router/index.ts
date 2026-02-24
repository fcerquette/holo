import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'display',
      component: () => import('../views/HoloDisplay.vue'),
    },
    {
      path: '/control',
      name: 'control',
      component: () => import('../views/ControlPanel.vue'),
    },
  ],
});

export default router;
