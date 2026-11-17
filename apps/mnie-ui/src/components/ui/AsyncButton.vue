<script setup lang="ts">
import { ref } from 'vue'
import Spinner from './Spinner.vue'
import { notify, notifyError } from '../../features/feedback/feedback'
const props = defineProps<{
  action: () => unknown | Promise<unknown>
  success?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ busyChange: [busy: boolean] }>()
const busy = ref(false)
const run = async () => {
  if (busy.value || props.disabled) return
  busy.value = true
  emit('busyChange', true)
  try {
    await props.action()
    if (props.success) notify(props.success, 'success')
  } catch (cause) {
    notifyError(cause)
  } finally {
    busy.value = false
    emit('busyChange', false)
  }
}
</script>
<template>
  <button
    type="button"
    :disabled="busy || disabled"
    :aria-busy="busy"
    class="disabled:cursor-not-allowed disabled:opacity-50"
    @click="run"
  >
    <Spinner v-if="busy" size="sm" aria-hidden="true" />
    <slot />
  </button>
</template>
