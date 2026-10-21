<script setup lang="ts">
import { ref } from 'vue'
import AsyncButton from './ui/AsyncButton.vue'
import type { AuthManagerConfig } from '../api'
import UiModal from './ui/UiModal.vue'
import { ui } from '../styles/ui'

defineProps<{
  fill: () => Promise<void>
  authManagers: AuthManagerConfig[]
}>()

const busy = ref(false)
const selectedAuthManagerId = defineModel<string>('selectedAuthManagerId', { required: true })
const authManagerMasterPassword = defineModel<string>('authManagerMasterPassword', {
  required: true,
})

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <UiModal
    :close-on-backdrop="!busy"
    :close-on-escape="!busy"
    title="認証情報を読み込む"
    @close="emit('close')"
  >
    <div class="grid gap-3">
      <label :class="ui.label"
        >Auth Manager<select v-model="selectedAuthManagerId" :class="ui.input">
          <option value="" disabled>認証プロバイダーを選択</option>
          <option v-for="manager in authManagers" :key="manager.id" :value="manager.id">
            {{ manager.label }}
          </option>
        </select></label
      >
      <label :class="ui.label"
        >Master Password<input
          v-model="authManagerMasterPassword"
          :class="ui.input"
          type="password"
          autocomplete="off"
      /></label>
      <div class="flex justify-end">
        <AsyncButton :class="ui.primaryButton" :action="fill" @busy-change="busy = $event">
          Auth Manager から読み込む
        </AsyncButton>
      </div>
    </div>
  </UiModal>
</template>
