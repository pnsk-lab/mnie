<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
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

const modalHost = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null
const closeFromEscape = (event: KeyboardEvent) => {
  const dialogs = document.querySelectorAll('[role="dialog"]')
  const dialog = modalHost.value?.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog || dialogs[dialogs.length - 1] !== dialog) return
  if (event.key === 'Escape' && props.closeOnEscape) {
    event.preventDefault()
    emit('close')
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'),
  ).filter(
    (element) =>
      !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length > 0,
  )
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first) {
    event.preventDefault()
    dialog.focus()
    return
  }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last?.focus()
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === dialog)
  ) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(() => {
  previousFocus = document.activeElement as HTMLElement | null
  modalHost.value?.querySelector<HTMLElement>('[role="dialog"]')?.focus()
  window.addEventListener('keydown', closeFromEscape)
})
onUnmounted(() => {
  window.removeEventListener('keydown', closeFromEscape)
  if (previousFocus?.isConnected) previousFocus.focus()
})
</script>

<template>
  <div ref="modalHost">
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
        tabindex="-1"
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
  </div>
</template>
