<script setup lang="ts" generic="T extends string">
defineProps<{
  modelValue: T
  options: Array<{ label: string; value: T; tone?: 'buy' | 'sell' }>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()
</script>

<template>
  <div
    class="grid min-h-12 grid-cols-2 gap-1 rounded-full bg-[#111418] p-1 outline outline-1 outline-[#33383f]"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="[
        'min-h-10 rounded-full bg-transparent text-sm font-bold text-[#9aa0a9] transition hover:bg-[#22272e]',
        modelValue === option.value && option.tone === 'buy' && '!bg-[#40dba2] !text-[#003824]',
        modelValue === option.value && option.tone === 'sell' && '!bg-[#ffb4ab] !text-[#690005]',
        modelValue === option.value && !option.tone && '!bg-[#263141] !text-[#d3e3fd]',
      ]"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
