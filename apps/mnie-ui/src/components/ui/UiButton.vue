<script setup lang="ts">
import Spinner from './Spinner.vue'
withDefaults(
  defineProps<{
    loading?: boolean
    disabled?: boolean
    variant?: 'primary' | 'danger' | 'ghost' | 'plain'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
  },
)

const variantClass = {
  primary: 'bg-primary text-on-primary hover:bg-primary-soft active:bg-primary-muted',
  danger: 'bg-danger text-on-danger hover:bg-danger-hover active:bg-danger-active',
  ghost:
    'border border-border-strong bg-transparent text-primary-soft hover:bg-primary-container active:bg-primary-container-hover',
  plain: 'bg-transparent text-fg-secondary hover:bg-hover hover:text-fg',
}

const sizeClass = {
  sm: 'min-h-8 px-4 text-xs',
  md: 'min-h-10 px-5 text-sm',
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading"
    :class="[
      'rounded-full font-extrabold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition disabled:cursor-not-allowed disabled:opacity-50',
      'inline-flex items-center justify-center gap-2',
      variantClass[variant],
      sizeClass[size],
    ]"
  >
    <Spinner v-if="loading" size="sm" aria-hidden="true" />
    <slot />
  </button>
</template>
