<script setup lang="ts">
import { LogIn, UserPlus } from 'lucide-vue-next'
import type { AuthStatus } from '../../api'
import { ui } from '../../styles/ui'

defineProps<{
  status: AuthStatus
  authBusy: boolean
}>()

const setupPassword = defineModel<string>('setupPassword', { required: true })

const emit = defineEmits<{
  login: []
  setup: []
}>()
</script>

<template>
  <section :class="ui.authPanel">
    <article :class="[ui.panel, ui.loginPanel]">
      <div>
        <p :class="ui.eyebrow">{{ status.configured ? 'Login' : 'Initial setup' }}</p>
        <h2>{{ status.configured ? 'パスキーでログイン' : '初期セットアップ' }}</h2>
      </div>
      <label v-if="!status.configured" :class="ui.label">
        セットアップパスワード
        <input
          v-model="setupPassword"
          :class="ui.input"
          type="password"
          autocomplete="current-password"
        />
      </label>
      <button
        v-if="status.configured"
        :class="ui.primaryButton"
        type="button"
        :disabled="authBusy"
        @click="emit('login')"
      >
        <LogIn class="h-4 w-4" aria-hidden="true" />
        ログイン
      </button>
      <button
        v-else
        :class="ui.primaryButton"
        type="button"
        :disabled="authBusy"
        @click="emit('setup')"
      >
        <UserPlus class="h-4 w-4" aria-hidden="true" />
        登録
      </button>
    </article>
  </section>
</template>
