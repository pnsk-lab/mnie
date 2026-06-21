<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    label?: string
    size?: 'sm' | 'md' | 'lg'
  }>(),
  {
    label: '読み込み中',
    size: 'md',
  },
)

const sizeClass = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
}
</script>

<template>
  <LoaderCircle
    :class="['inline-block animate-spin text-current', sizeClass[size]]"
    role="status"
    :aria-label="label"
  />
</template>
