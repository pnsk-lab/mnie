<script setup lang="ts">
withDefaults(
  defineProps<{
    padded?: boolean
  }>(),
  {
    padded: true,
  },
)
</script>

<template>
  <article :class="['rounded-3xl border border-border bg-transparent', padded && 'p-6']">
    <slot />
  </article>
</template>
