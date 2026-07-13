<script setup lang="ts">
import { Activity } from 'lucide-vue-next'
import { computed } from 'vue'
import { sidebarItems } from '../../constants/nav'
import { profileColor } from '../../constants/provider'
import { ui } from '../../styles/ui'
import type { RouteName } from '../../router'
import type { AccountProfile, ProviderDefinition } from '../../api'

const props = defineProps<{
  activeTab: RouteName
  profiles: AccountProfile[]
  providerDefinitions: ProviderDefinition[]
  selectedProfileId: string
}>()

const emit = defineEmits<{
  navigate: [name: RouteName]
  selectProfile: [profileId: string]
}>()

const items = sidebarItems
const providerNames = computed(
  () => new Map(props.providerDefinitions.map((provider) => [provider.id, provider.name])),
)
const tradingProfiles = computed(() => {
  const brokerageProviders = new Set(
    props.providerDefinitions
      .filter((provider) => provider.kind === 'brokerage')
      .map((provider) => provider.id),
  )
  return props.profiles.filter((profile) => brokerageProviders.has(profile.provider))
})
</script>

<template>
  <aside :class="ui.sidebar">
    <div :class="ui.brandMark" aria-label="MNIE">
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
    <section
      v-if="activeTab === 'trade' && tradingProfiles.length"
      class="mt-8 hidden w-full min-h-0 gap-2 px-2 lg:grid"
      aria-label="取引プロバイダ"
    >
      <p class="px-2 text-[0.65rem] font-black tracking-[0.14em] text-[#8f949d] uppercase">
        Broker
      </p>
      <button
        v-for="profile in tradingProfiles"
        :key="profile.id"
        class="grid min-w-0 gap-0.5 rounded-2xl border px-2.5 py-2 text-left transition"
        :class="
          selectedProfileId === profile.id
            ? 'border-[#6f8fbd] bg-[#263141] text-[#e3e3e9]'
            : 'border-transparent text-[#aeb4bd] hover:border-[#343a43] hover:bg-[#22272e]'
        "
        type="button"
        :aria-pressed="selectedProfileId === profile.id"
        :title="`${profile.label} — ${providerNames.get(profile.provider) ?? profile.provider}`"
        @click="emit('selectProfile', profile.id)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <i
            class="size-2.5 shrink-0 rounded-full"
            :style="{ backgroundColor: profileColor(profile) }"
            aria-hidden="true"
          ></i>
          <strong class="truncate text-xs">{{ profile.label }}</strong>
        </span>
        <small class="truncate pl-[1.125rem] text-[0.625rem] text-[#8f949d]">
          {{ providerNames.get(profile.provider) ?? profile.provider }}
        </small>
      </button>
    </section>
    <div class="flex-1"></div>
  </aside>
</template>
