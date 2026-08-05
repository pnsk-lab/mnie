<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { motion } from 'motion-v'
import { uiMotion } from '../../constants/motion'

const props = withDefaults(
  defineProps<{
    title: string
    eyebrow?: string
    size?: 'sm' | 'lg'
    closeOnBackdrop?: boolean
    closeOnEscape?: boolean
  }>(),
  {
    size: 'sm',
    closeOnBackdrop: true,
    closeOnEscape: true,
  },
)

const emit = defineEmits<{
  close: []
}>()

const overlayTransition = uiMotion.modal.openExpressiveSpatial
const sheetTransition = uiMotion.modal.sheetOpenExpressive

const sheetClass = computed(() => [
  'grid max-h-[calc(100dvh-2rem)] w-full gap-5 overflow-y-auto rounded-[28px] border border-border bg-surface p-6 shadow-2xl shadow-black/35 outline-none',
  props.size === 'lg' ? 'max-w-5xl' : 'max-w-[28rem]',
])

const closeFromBackdrop = () => {
  if (props.closeOnBackdrop) emit('close')
}

const closeFromEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.closeOnEscape) emit('close')
}

onMounted(() => window.addEventListener('keydown', closeFromEscape))
onUnmounted(() => window.removeEventListener('keydown', closeFromEscape))
</script>

<template>
  <motion.div
    class="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-overlay p-4 backdrop-blur-sm"
    :initial="{ opacity: 0 }"
    :animate="{ opacity: 1 }"
    :exit="{ opacity: 0 }"
    :transition="overlayTransition"
    @click.self="closeFromBackdrop"
  >
    <motion.section
      :class="sheetClass"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      :initial="{ opacity: 0, y: 18, scale: 0.96 }"
      :animate="{ opacity: 1, y: 0, scale: 1 }"
      :exit="{ opacity: 0, y: 12, scale: 0.97 }"
      :transition="sheetTransition"
    >
      <header
        v-if="title || eyebrow || $slots.actions"
        class="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4"
      >
        <div class="grid min-w-0 gap-1">
          <p v-if="eyebrow" class="text-xs font-black uppercase text-fg-muted">{{ eyebrow }}</p>
          <h2 class="truncate text-xl font-black text-fg">{{ title }}</h2>
        </div>
        <div v-if="$slots.actions" class="flex flex-wrap gap-2">
          <slot name="actions" />
        </div>
      </header>

      <slot />
    </motion.section>
  </motion.div>
</template>
