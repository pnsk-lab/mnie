<script setup lang="ts">
import { computed } from 'vue'
import { pageMeta } from '../../constants/nav'
import { ui } from '../../styles/ui'
import type { RouteName } from '../../router'

const props = defineProps<{
  activeTab: RouteName
}>()

const meta = computed(() => pageMeta[props.activeTab])
</script>

<template>
  <header :class="[ui.topbar, activeTab === 'trade' && ui.tradeTopbar]">
    <div class="flex items-center gap-3">
      <span
        class="grid h-11 w-11 place-items-center rounded-2xl bg-primary-container text-primary"
        aria-hidden="true"
      >
        <component :is="meta.icon" class="h-5 w-5" :stroke-width="2.4" />
      </span>
      <div>
        <h1 class="text-3xl font-black tracking-normal text-fg">
          {{ meta.title }}
        </h1>
      </div>
    </div>
  </header>
</template>
