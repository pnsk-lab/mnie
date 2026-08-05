<script setup lang="ts">
import { Activity, Moon, Sun } from 'lucide-vue-next'
import { LayoutGroup, motion } from 'motion-v'
import { sidebarItems } from '../../constants/nav'
import { uiMotion } from '../../constants/motion'
import { useTheme } from '../../features/theme/useTheme'
import { ui } from '../../styles/ui'
import type { RouteName } from '../../router'

defineProps<{
  activeTab: RouteName
}>()

const emit = defineEmits<{
  navigate: [name: RouteName]
}>()

const items = sidebarItems
const indicatorTransition = uiMotion.nav.indicator
const { isDark, toggleTheme } = useTheme()
</script>

<template>
  <aside :class="ui.sidebar">
    <div :class="ui.brandMark" aria-label="MNIE">
      <Activity class="h-8 w-8" :stroke-width="2.75" aria-hidden="true" />
    </div>
    <LayoutGroup id="sidebar-nav">
      <nav :class="ui.navStack" aria-label="Main">
        <button
          v-for="item in items"
          :key="item.name"
          :class="[ui.navButton, activeTab === item.name && ui.navButtonActive]"
          type="button"
          @click="emit('navigate', item.name)"
        >
          <span :class="[ui.navIcon, activeTab === item.name && ui.navIconActive]">
            <motion.span
              v-if="activeTab === item.name"
              layout-id="sidebar-nav-indicator"
              :class="ui.navIconIndicator"
              :transition="indicatorTransition"
            />
            <component
              :is="item.icon"
              class="relative z-10 h-5 w-5"
              :stroke-width="2.4"
              aria-hidden="true"
            />
          </span>
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </LayoutGroup>
    <div class="ml-auto shrink-0 lg:ml-0 lg:flex-1"></div>
    <button
      :class="[ui.themeToggle, 'shrink-0']"
      type="button"
      :aria-label="isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'"
      :title="isDark ? 'ライトモード' : 'ダークモード'"
      @click="toggleTheme"
    >
      <Sun v-if="isDark" class="h-5 w-5" :stroke-width="2.4" aria-hidden="true" />
      <Moon v-else class="h-5 w-5" :stroke-width="2.4" aria-hidden="true" />
    </button>
  </aside>
</template>
