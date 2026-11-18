<script setup lang="ts">
import AsyncButton from '../../components/ui/AsyncButton.vue'
import { ShieldCheck } from 'lucide-vue-next'
import type { ApiKeySettings } from '../../api'
import ApiKeyPolicyEditor from '../../components/ApiKeyPolicyEditor.vue'
import { ui } from '../../styles/ui'
import type { OAuthApprovalState } from './useOAuthApproval'

defineProps<{
  approve: () => Promise<void>
  approval: OAuthApprovalState
}>()

const settings = defineModel<ApiKeySettings>('settings', { required: true })
</script>

<template>
  <section :class="ui.authPanel">
    <article :class="[ui.panel, ui.oauthPanel]">
      <div :class="ui.panelHead">
        <div>
          <p :class="ui.eyebrow">OAuth approval</p>
          <h2>{{ approval.clientName }}</h2>
        </div>
        <AsyncButton :class="ui.primaryButton" :action="approve">
          <ShieldCheck class="h-4 w-4" aria-hidden="true" />
          承認
        </AsyncButton>
      </div>
      <label :class="ui.label">
        Redirect URI
        <input v-model="approval.redirectUri" :class="ui.input" readonly />
      </label>
      <ApiKeyPolicyEditor v-model="settings" permissions-open />
    </article>
  </section>
</template>
