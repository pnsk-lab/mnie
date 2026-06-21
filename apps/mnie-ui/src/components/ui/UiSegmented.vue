<script setup lang="ts" generic="T extends string">
import { LayoutGroup, motion } from 'motion-v'
import { uiMotion } from '../../constants/motion'
import { computed } from 'vue'

const props = defineProps<{
  modelValue: T
  options: Array<{ label: string; value: T; tone?: 'buy' | 'sell' }>
}>()

const groupId = `segmented-indicator-${Math.random().toString(36).slice(2)}`
const activeOption = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
)

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

const toneClass = (tone?: 'buy' | 'sell') => {
  if (tone === 'buy') return 'text-[#003824]'
  if (tone === 'sell') return 'text-[#690005]'
  return 'text-[#d3e3fd]'
}
</script>

<template>
  <LayoutGroup :id="groupId">
    <div
      class="relative grid min-h-12 overflow-hidden rounded-full bg-[#111418] p-1 outline outline-1 outline-[#33383f]"
      :style="{ gridTemplateColumns: `repeat(${props.options.length}, minmax(0, 1fr))` }"
    >
      <button
        v-for="option in props.options"
        :key="option.value"
        type="button"
        :class="[
          'relative min-h-10 rounded-full text-sm font-bold transition hover:bg-[#22272e]',
          'text-[#9aa0a9]',
          props.modelValue === option.value && toneClass(option.tone),
        ]"
        @click="emit('update:modelValue', option.value)"
      >
        <motion.span
          v-if="activeOption?.value === option.value"
          :key="`${option.value}:active-indicator`"
          :layout-id="`${groupId}-indicator`"
          :animate="{ scaleX: [1, 1.1, 1], scaleY: [1, 0.92, 1] }"
          :transition="uiMotion.trade.segmentedIndicator"
          class="pointer-events-none absolute inset-0 rounded-full"
          :class="[
            option.tone === 'buy' && 'bg-[#40dba2]',
            option.tone === 'sell' && 'bg-[#ffb4ab]',
            !option.tone && 'bg-[#263141]',
          ]"
        />
        <span class="relative z-10">{{ option.label }}</span>
      </button>
    </div>
  </LayoutGroup>
</template>
