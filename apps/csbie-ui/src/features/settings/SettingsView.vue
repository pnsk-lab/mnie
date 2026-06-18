<script setup lang="ts">
import { Ban, KeyRound, Plug, RefreshCw, Save, Trash2 } from 'lucide-vue-next'
import type { ApiKey, ApiKeySettings, SbiPasskey } from '../../api'
import ApiKeyPolicyEditor from '../../components/ApiKeyPolicyEditor.vue'
import { ui } from '../../styles/ui'

defineProps<{
  apiKeys: ApiKey[]
  sbiPasskeys: SbiPasskey[]
}>()

const apiKeyLabel = defineModel<string>('apiKeyLabel', { required: true })
const newApiKeySettings = defineModel<ApiKeySettings>('newApiKeySettings', { required: true })
const newApiToken = defineModel<string>('newApiToken', { required: true })
const sbiLabel = defineModel<string>('sbiLabel', { required: true })
const sbiCredentialJson = defineModel<string>('sbiCredentialJson', { required: true })
const tradePassword = defineModel<string>('tradePassword', { required: true })
const sbiDeviceId = defineModel<string>('sbiDeviceId', { required: true })
const selectedPasskeyId = defineModel<string>('selectedPasskeyId', { required: true })

const emit = defineEmits<{
  addApiKey: []
  refresh: []
  saveApiKeySettings: [key: ApiKey]
  revokeApiKey: [id: string]
  addSbiPasskey: []
  connect: []
  removeSbiPasskey: [id: string]
}>()
</script>

<template>
  <section :class="ui.settingsLayout">
    <div :class="ui.apiLayout">
      <article :class="ui.panel">
        <div :class="ui.panelHead">
          <div>
            <p :class="ui.eyebrow">Fine-grained</p>
            <h2>API Key 発行</h2>
          </div>
          <button :class="ui.primaryButton" type="button" @click="emit('addApiKey')">
            <KeyRound class="h-4 w-4" aria-hidden="true" />
            発行
          </button>
        </div>
        <label :class="ui.label">
          名前
          <input v-model="apiKeyLabel" :class="ui.input" placeholder="例: trade-bot-readonly" />
        </label>
        <ApiKeyPolicyEditor v-model="newApiKeySettings" permissions-open />
        <textarea v-if="newApiToken" v-model="newApiToken" :class="ui.input" readonly></textarea>
      </article>

      <article :class="ui.panel">
        <div :class="ui.panelHead">
          <h2>発行済みキー</h2>
          <button :class="ui.ghostButton" type="button" @click="emit('refresh')">
            <RefreshCw class="h-4 w-4" aria-hidden="true" />
            更新
          </button>
        </div>
        <div :class="ui.list">
          <div v-for="key in apiKeys" :key="key.id" :class="ui.keyRow">
            <div :class="ui.row">
              <span>{{ key.label }}</span>
              <div :class="ui.rowActions">
                <button
                  :class="ui.primaryButton"
                  type="button"
                  title="Save settings"
                  @click="emit('saveApiKeySettings', key)"
                >
                  <Save class="h-4 w-4" aria-hidden="true" />
                  保存
                </button>
                <button
                  :class="ui.dangerButton"
                  type="button"
                  title="Revoke"
                  @click="emit('revokeApiKey', key.id)"
                >
                  <Ban class="h-4 w-4" aria-hidden="true" />
                  失効
                </button>
              </div>
            </div>
            <ApiKeyPolicyEditor
              :model-value="key"
              compact
              @update:model-value="Object.assign(key, $event)"
            />
          </div>
        </div>
      </article>
    </div>

    <div :class="ui.apiLayout">
      <article :class="ui.panel">
        <div :class="ui.panelHead">
          <div>
            <p :class="ui.eyebrow">Profiles</p>
            <h2>パスキー設定</h2>
          </div>
          <button :class="ui.primaryButton" type="button" @click="emit('addSbiPasskey')">
            <Save class="h-4 w-4" aria-hidden="true" />
            保存
          </button>
        </div>
        <label :class="ui.label">
          名前
          <input v-model="sbiLabel" :class="ui.input" placeholder="例: 個人メイン" />
        </label>
        <label :class="ui.label">
          パスキー JSON
          <textarea
            v-model="sbiCredentialJson"
            :class="ui.input"
            spellcheck="false"
            placeholder="{ ... }"
          ></textarea>
        </label>
        <div :class="ui.ticketBox">
          <label :class="ui.label">
            取引パスワード
            <input v-model="tradePassword" :class="ui.input" type="password" autocomplete="off" />
          </label>
          <label :class="ui.label">
            デバイスキー
            <input v-model="sbiDeviceId" :class="ui.input" autocomplete="off" spellcheck="false" />
          </label>
        </div>
      </article>

      <article :class="ui.panel">
        <div :class="ui.panelHead">
          <h2>プロフィール切り替え</h2>
          <button :class="ui.ghostButton" type="button" @click="emit('connect')">
            <Plug class="h-4 w-4" aria-hidden="true" />
            接続
          </button>
        </div>
        <div :class="ui.list">
          <label v-for="passkey in sbiPasskeys" :key="passkey.id" :class="ui.profileRow">
            <input
              v-model="selectedPasskeyId"
              type="radio"
              :value="passkey.id"
              @change="emit('connect')"
            />
            <span>
              <strong>{{ passkey.label }}</strong>
              <small>{{ new Date(passkey.createdAt).toLocaleString() }}</small>
            </span>
            <button
              :class="ui.dangerButton"
              type="button"
              title="Delete passkey"
              @click.prevent="emit('removeSbiPasskey', passkey.id)"
            >
              <Trash2 class="h-4 w-4" aria-hidden="true" />
              削除
            </button>
          </label>
        </div>
      </article>
    </div>
  </section>
</template>
