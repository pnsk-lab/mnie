<script setup lang="ts">
import { nextTick, onMounted, useTemplateRef } from 'vue'

const props = withDefaults(
  defineProps<{
    as?: 'input' | 'textarea' | 'select'
    label?: string
    modelValue?: string | number
    type?: string
    placeholder?: string
    autocomplete?: string
    spellcheck?: boolean
    readonly?: boolean
    disabled?: boolean
    min?: string | number
    step?: string | number
    autofocus?: boolean
  }>(),
  {
    as: 'input',
    type: 'text',
    placeholder: '',
    autocomplete: undefined,
    spellcheck: undefined,
    readonly: false,
    disabled: false,
    min: undefined,
    step: undefined,
    autofocus: false,
  },
)

const controlRef = useTemplateRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  'control',
)

onMounted(() => {
  if (!props.autofocus) return
  nextTick(() => controlRef.value?.focus())
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const controlClass =
  'min-h-12 w-full rounded-[16px] border border-border-strong bg-inset px-4 text-fg outline-none transition placeholder:text-fg-placeholder focus:border-primary disabled:cursor-not-allowed disabled:opacity-60'
</script>

<template>
  <label class="grid gap-2 text-xs font-extrabold text-fg-muted">
    <span v-if="label">{{ label }}</span>
    <textarea
      v-if="as === 'textarea'"
      ref="control"
      :class="[controlClass, 'min-h-32 resize-y py-3']"
      :value="modelValue"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :spellcheck="spellcheck"
      :readonly="readonly"
      :disabled="disabled"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <select
      v-else-if="as === 'select'"
      ref="control"
      :class="controlClass"
      :value="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
    <input
      v-else
      ref="control"
      :class="controlClass"
      :value="modelValue"
      :type="type"
      :min="min"
      :step="step"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :spellcheck="spellcheck"
      :readonly="readonly"
      :disabled="disabled"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
  </label>
</template>
