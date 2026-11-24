<script setup lang="ts">
import { computed } from 'vue'
import { methodGroups, toggleMethods } from './method-tree'

defineOptions({ name: 'MethodTree' })
const props = withDefaults(
  defineProps<{ methods: string[]; selected: string[]; prefix?: string }>(),
  { prefix: '' },
)
const emit = defineEmits<{ change: [value: string[]] }>()
const groups = computed(() => methodGroups(props.methods, props.prefix))
const count = (methods: string[]) =>
  methods.filter((method) => props.selected.includes(method)).length
const toggle = (methods: string[], enabled: boolean) => {
  emit('change', toggleMethods(props.selected, methods, enabled))
}
</script>
<template>
  <ul class="grid gap-1 pl-3">
    <li v-for="group in groups" :key="group.path">
      <label class="flex min-h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          :checked="count(group.methods) === group.methods.length"
          :indeterminate="count(group.methods) > 0 && count(group.methods) < group.methods.length"
          @change="toggle(group.methods, ($event.target as HTMLInputElement).checked)"
        />
        <span class="break-all">{{ group.path.slice(prefix ? prefix.length + 1 : 0) }}</span>
      </label>
      <label
        v-if="group.methods.includes(group.path) && group.methods.length > 1"
        class="ml-4 flex min-h-9 items-center gap-2 text-sm"
      >
        <input
          type="checkbox"
          :checked="selected.includes(group.path)"
          @change="toggle([group.path], ($event.target as HTMLInputElement).checked)"
        />
        <span>このメソッド</span>
      </label>
      <MethodTree
        v-if="group.methods.some((method) => method !== group.path)"
        :methods="group.methods.filter((method) => method !== group.path)"
        :selected="selected"
        :prefix="group.path"
        @change="emit('change', $event)"
      />
    </li>
  </ul>
</template>
