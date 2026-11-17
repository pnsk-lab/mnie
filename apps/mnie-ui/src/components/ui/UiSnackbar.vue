<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { notifications, dismissNotification } from '../../features/feedback/feedback'
</script>

<template>
  <aside
    class="fixed inset-x-4 bottom-4 z-50 mx-auto grid max-h-72 max-w-xl gap-2 overflow-y-auto"
    aria-label="通知"
  >
    <div
      v-for="item in notifications"
      :key="item.id"
      :role="item.kind === 'error' ? 'alert' : 'status'"
      class="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm shadow-xl"
    >
      <p
        class="min-w-0 flex-1 whitespace-pre-wrap break-words"
        :class="item.kind === 'error' ? 'text-negative' : 'text-positive'"
      >
        {{ item.message }}
      </p>
      <button
        type="button"
        class="rounded p-1 focus-visible:outline-2 focus-visible:outline-primary"
        aria-label="通知を閉じる"
        @click="dismissNotification(item.id)"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </aside>
</template>
