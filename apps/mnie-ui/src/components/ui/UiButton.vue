<script setup lang="ts">
withDefaults(
  defineProps<{
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
  primary:
    'bg-[#a8c7fa] text-[#102033] shadow-sm shadow-black/20 hover:bg-[#d3e3fd] active:bg-[#c2d7f4]',
  danger:
    'bg-[#ffb4ab] text-[#690005] shadow-sm shadow-black/20 hover:bg-[#ffd8d3] active:bg-[#ffc9c2]',
  ghost:
    'border border-[#4a5058] bg-transparent text-[#d3e3fd] hover:bg-[#263141] active:bg-[#303b4d]',
  plain: 'bg-transparent text-[#c3c7cf] hover:bg-[#22272e] hover:text-[#e3e3e9]',
}

const sizeClass = {
  sm: 'min-h-8 px-4 text-xs',
  md: 'min-h-10 px-5 text-sm',
}
</script>

<template>
  <button
    :type="type"
    :class="[
      'rounded-full font-extrabold outline-none transition disabled:cursor-not-allowed disabled:opacity-50',
      'inline-flex items-center justify-center gap-2',
      variantClass[variant],
      sizeClass[size],
    ]"
  >
    <slot />
  </button>
</template>
