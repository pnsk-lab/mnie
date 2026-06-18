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
  <article
    :class="[
      'rounded-[28px] border border-[#30343a] bg-[#1b1f24] shadow-lg shadow-black/15',
      padded && 'p-6',
    ]"
  >
    <slot />
  </article>
</template>
