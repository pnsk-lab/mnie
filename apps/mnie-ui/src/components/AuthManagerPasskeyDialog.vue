<script setup lang="ts">
import type { AuthManagerConfig } from '../api'
import UiModal from './ui/UiModal.vue'
import { ui } from '../styles/ui'

defineProps<{
  authManagers: AuthManagerConfig[]
}>()

const selectedAuthManagerId = defineModel<string>('selectedAuthManagerId', { required: true })
const authManagerMasterPassword = defineModel<string>('authManagerMasterPassword', {
  required: true,
})

const emit = defineEmits<{
  close: []
  fill: []
}>()
</script>

<template>
  <UiModal title="" @close="emit('close')">
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
        <button :class="ui.ghostButton" type="button" @click="emit('fill')">
          Auth Manager から読み込む
        </button>
      </div>
    </div>
  </UiModal>
</template>
