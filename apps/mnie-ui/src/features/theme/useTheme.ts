import { computed, ref } from 'vue'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'mnie-theme'

const theme = ref<Theme>('dark')
let initialized = false

const applyTheme = (value: Theme) => {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(value)
  localStorage.setItem(STORAGE_KEY, value)
}

export const initTheme = () => {
  if (initialized) return
  initialized = true
  const stored = localStorage.getItem(STORAGE_KEY)
  theme.value = stored === 'light' || stored === 'dark' ? stored : 'dark'
  applyTheme(theme.value)
}

export const useTheme = () => {
  const isDark = computed(() => theme.value === 'dark')
  const isLight = computed(() => theme.value === 'light')

  const setTheme = (value: Theme) => {
    theme.value = value
    applyTheme(value)
  }

  const toggleTheme = () => {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return {
    theme,
    isDark,
    isLight,
    setTheme,
    toggleTheme,
  }
}

/** Resolve a CSS custom property for imperative canvas/chart code. */
export const themeColor = (name: string, fallback = '') => {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}
