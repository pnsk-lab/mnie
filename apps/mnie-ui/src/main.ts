import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { initTheme } from './features/theme/useTheme'
import { router } from './router'

initTheme()
createApp(App).use(router).mount('#app')
