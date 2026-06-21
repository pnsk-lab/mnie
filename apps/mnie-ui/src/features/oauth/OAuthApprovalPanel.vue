<script setup lang="ts">
import { ShieldCheck } from 'lucide-vue-next'
import type { ApiKeySettings } from '../../api'
import ApiKeyPolicyEditor from '../../components/ApiKeyPolicyEditor.vue'
import { ui } from '../../styles/ui'
import type { OAuthApprovalState } from './useOAuthApproval'

defineProps<{
  approval: OAuthApprovalState
}>()

const settings = defineModel<ApiKeySettings>('settings', { required: true })

const emit = defineEmits<{
  approve: []
}>()
</script>

<template>
  <section :class="ui.authPanel">
    <article :class="ui.panel">
      <div :class="ui.panelHead">
        <div>
          <p :class="ui.eyebrow">OAuth approval</p>
          <h2>{{ approval.clientName }}</h2>
        </div>
        <button :class="ui.primaryButton" type="button" @click="emit('approve')">
          <ShieldCheck class="h-4 w-4" aria-hidden="true" />
          承認
        </button>
      </div>
      <label :class="ui.label">
        Redirect URI
        <input v-model="approval.redirectUri" :class="ui.input" readonly />
      </label>
      <ApiKeyPolicyEditor v-model="settings" permissions-open />
    </article>
  </section>
</template>
