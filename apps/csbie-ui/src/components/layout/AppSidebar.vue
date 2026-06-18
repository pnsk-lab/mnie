<script setup lang="ts">
import { Activity } from 'lucide-vue-next'
import { sidebarItems } from '../../constants/nav'
import { ui } from '../../styles/ui'
import type { RouteName } from '../../router'

defineProps<{
  activeTab: RouteName
}>()

const emit = defineEmits<{
  navigate: [name: RouteName]
}>()

const items = sidebarItems
</script>

<template>
  <aside :class="ui.sidebar">
    <div :class="ui.brandMark" aria-label="CSBIE">
      <Activity class="h-8 w-8" :stroke-width="2.75" aria-hidden="true" />
    </div>
    <nav :class="ui.navStack" aria-label="Main">
      <button
        v-for="item in items"
        :key="item.name"
        :class="[ui.navButton, activeTab === item.name && ui.navButtonActive]"
        type="button"
        @click="emit('navigate', item.name)"
      >
        <span :class="[ui.navIcon, activeTab === item.name && ui.navIconActive]">
          <component :is="item.icon" class="h-5 w-5" :stroke-width="2.4" aria-hidden="true" />
        </span>
        <span>{{ item.label }}</span>
      </button>
    </nav>
    <div class="flex-1"></div>
  </aside>
</template>
