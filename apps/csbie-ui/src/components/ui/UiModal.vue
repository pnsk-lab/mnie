<script setup lang="ts">
defineProps<{
  title: string
  eyebrow?: string
}>()
</script>

<template>
  <div class="fixed inset-0 z-20 grid place-items-center bg-[#101418]/75 backdrop-blur-sm">
    <section
      class="grid w-[28rem] gap-4 rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-6 shadow-2xl shadow-black/35"
    >
      <p v-if="eyebrow" class="text-xs font-black uppercase text-[#9aa0a9]">{{ eyebrow }}</p>
      <h2 class="text-lg font-bold text-[#e3e3e9]">{{ title }}</h2>
      <slot />
    </section>
  </div>
</template>
