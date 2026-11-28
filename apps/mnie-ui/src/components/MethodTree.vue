<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import { computed, reactive } from 'vue'
import { methodGroups, toggleMethods } from './method-tree'

defineOptions({ name: 'MethodTree' })
const props = withDefaults(
  defineProps<{ methods: string[]; selected: string[]; prefix?: string }>(),
  { prefix: '' },
)
const emit = defineEmits<{ change: [value: string[]] }>()
const expanded = reactive(new Set<string>())
const groups = computed(() =>
  methodGroups(props.methods, props.prefix).map((group) => ({
    ...group,
    label: group.path.slice(props.prefix ? props.prefix.length + 1 : 0),
    children: group.methods.filter((method) => method !== group.path),
    selectedCount: group.methods.filter((method) => props.selected.includes(method)).length,
  })),
)
const toggleExpanded = (path: string) => {
  if (expanded.has(path)) expanded.delete(path)
  else expanded.add(path)
}
const toggle = (methods: string[], enabled: boolean) => {
  emit('change', toggleMethods(props.selected, methods, enabled))
}
</script>
<template>
  <ul class="grid gap-1 pl-3">
    <li v-for="group in groups" :key="group.path">
      <div class="flex min-h-9 items-center gap-1">
        <button
          v-if="group.children.length"
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded hover:bg-inset"
          :aria-expanded="expanded.has(group.path)"
          :aria-label="`${group.path} を${expanded.has(group.path) ? '折りたたむ' : '展開する'}`"
          @click="toggleExpanded(group.path)"
        >
          <ChevronRight
            class="size-4"
            :class="{ 'rotate-90': expanded.has(group.path) }"
            aria-hidden="true"
          />
        </button>
        <span v-else class="w-8 shrink-0" aria-hidden="true" />
        <label class="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            :checked="group.selectedCount === group.methods.length"
            :indeterminate="group.selectedCount > 0 && group.selectedCount < group.methods.length"
            @change="toggle(group.methods, ($event.target as HTMLInputElement).checked)"
          />
          <span class="break-all">{{ group.label }}</span>
        </label>
      </div>
      <div v-if="group.children.length" v-show="expanded.has(group.path)" class="pl-4">
        <label
          v-if="group.methods.includes(group.path)"
          class="ml-12 flex min-h-9 items-center gap-2 text-sm"
        >
          <input
            type="checkbox"
            :checked="selected.includes(group.path)"
            @change="toggle([group.path], ($event.target as HTMLInputElement).checked)"
          />
          <span>このメソッド</span>
        </label>
        <MethodTree
          :methods="group.children"
          :selected="selected"
          :prefix="group.path"
          @change="emit('change', $event)"
        />
      </div>
    </li>
  </ul>
</template>
