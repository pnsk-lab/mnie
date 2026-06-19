<script setup lang="ts">
import {
  Ban,
  ChevronRight,
  KeyRound,
  Pencil,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserRoundCog,
} from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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

type SettingsSection = 'api-keys' | 'passkeys'

const route = useRoute()
const router = useRouter()
const editingApiKey = ref<ApiKey | null>(null)

const activeSection = computed<SettingsSection>(() => {
  return route.params.section === 'passkeys' ? 'passkeys' : 'api-keys'
})

const settingsGroups = [
  {
    label: 'アクセス',
    items: [
      {
        id: 'api-keys',
        label: 'API キー',
        description: '権限と取引上限を管理',
        icon: KeyRound,
      },
    ],
  },
  {
    label: '証券口座',
    items: [
      {
        id: 'passkeys',
        label: 'SBI パスキー',
        description: '接続プロフィールを管理',
        icon: UserRoundCog,
      },
    ],
  },
] as const

const openSection = (section: SettingsSection) => {
  router.push(`/settings/${section}`)
}

const sectionTitle = computed(() =>
  activeSection.value === 'api-keys' ? 'API キー' : 'SBI パスキー',
)

const openApiKeyEditor = (key: ApiKey) => {
  editingApiKey.value = {
    ...key,
    allowedMethods: key.allowedMethods ? [...key.allowedMethods] : key.allowedMethods,
  }
}

const closeApiKeyEditor = () => {
  editingApiKey.value = null
}

const saveEditingApiKey = () => {
  if (!editingApiKey.value) return
  emit('saveApiKeySettings', editingApiKey.value)
  closeApiKeyEditor()
}
</script>

<template>
  <section
    class="grid min-h-[calc(100dvh-9rem)] min-w-0 max-w-full gap-0 lg:grid-cols-[18rem_minmax(0,1fr)]"
  >
    <aside
      class="min-w-0 border-b border-[#30343a] pb-4 lg:sticky lg:top-0 lg:h-fit lg:border-r lg:border-b-0 lg:pr-5 lg:pb-0"
      aria-label="Settings"
    >
      <div class="grid gap-5">
        <div class="grid gap-1">
          <h2 class="text-xl font-black text-[#e3e3e9]">設定</h2>
          <p class="text-sm font-semibold text-[#9aa0a9]">用途ごとに管理項目を分けています。</p>
        </div>

        <nav class="grid gap-5">
          <section v-for="group in settingsGroups" :key="group.label" class="grid gap-2">
            <p class="px-2 text-xs font-black text-[#747982]">{{ group.label }}</p>
            <button
              v-for="item in group.items"
              :key="item.id"
              :class="[
                'grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] px-3 text-left transition hover:bg-[#22272e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]',
                activeSection === item.id ? 'bg-[#263141] text-[#d3e3fd]' : 'text-[#e3e3e9]',
              ]"
              type="button"
              @click="openSection(item.id)"
            >
              <span
                :class="[
                  'grid h-10 w-10 place-items-center rounded-full',
                  activeSection === item.id
                    ? 'bg-[#a8c7fa] text-[#102033]'
                    : 'bg-[#111418] text-[#c3c7cf]',
                ]"
                aria-hidden="true"
              >
                <component :is="item.icon" class="h-5 w-5" :stroke-width="2.4" />
              </span>
              <span class="grid min-w-0 gap-0.5">
                <strong class="truncate text-sm font-black">{{ item.label }}</strong>
                <small class="truncate text-xs font-semibold text-[#9aa0a9]">
                  {{ item.description }}
                </small>
              </span>
              <ChevronRight class="h-4 w-4 text-[#8f949d]" aria-hidden="true" />
            </button>
          </section>
        </nav>
      </div>
    </aside>

    <div class="grid min-w-0 content-start gap-5 pt-5 lg:pl-7 lg:pt-0">
      <header
        class="flex flex-wrap items-center justify-between gap-3 border-b border-[#30343a] pb-5"
      >
        <div class="grid gap-1">
          <p :class="ui.eyebrow">Settings</p>
          <h2 class="text-2xl font-black text-[#e3e3e9]">{{ sectionTitle }}</h2>
        </div>
        <button :class="ui.ghostButton" type="button" @click="emit('refresh')">
          <RefreshCw class="h-4 w-4" aria-hidden="true" />
          更新
        </button>
      </header>

      <template v-if="activeSection === 'api-keys'">
        <article :class="[ui.panel, 'min-w-0 overflow-hidden']">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p :class="ui.eyebrow">Create</p>
              <h3 class="text-lg font-black">API Key 発行</h3>
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
          <label v-if="newApiToken" :class="ui.label">
            新しい API キー
            <textarea
              v-model="newApiToken"
              :class="[ui.input, 'min-h-28 py-3']"
              readonly
            ></textarea>
          </label>
        </article>

        <article :class="[ui.panel, 'min-w-0 overflow-hidden']">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p :class="ui.eyebrow">Active keys</p>
              <h3 class="text-lg font-black">発行済みキー</h3>
            </div>
          </div>
          <div v-if="apiKeys.length" :class="ui.list">
            <div v-for="key in apiKeys" :key="key.id" :class="ui.keyRow">
              <div :class="ui.row">
                <span class="min-w-0 truncate font-black">{{ key.label }}</span>
                <div class="flex flex-wrap gap-2">
                  <button
                    :class="ui.ghostButton"
                    type="button"
                    title="Edit settings"
                    @click="openApiKeyEditor(key)"
                  >
                    <Pencil class="h-4 w-4" aria-hidden="true" />
                    編集
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
            </div>
          </div>
          <div
            v-else
            class="rounded-[18px] border border-[#30343a] bg-[#111418] p-5 text-sm font-semibold text-[#9aa0a9]"
          >
            発行済みの API キーはありません。
          </div>
        </article>
      </template>

      <template v-else>
        <article :class="[ui.panel, 'min-w-0 overflow-hidden']">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p :class="ui.eyebrow">Profiles</p>
              <h3 class="text-lg font-black">パスキー追加</h3>
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
              :class="[ui.input, 'min-h-48 py-3 font-mono text-xs']"
              spellcheck="false"
              placeholder="{ ... }"
            ></textarea>
          </label>
          <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <label :class="ui.label">
              取引パスワード
              <input v-model="tradePassword" :class="ui.input" type="password" autocomplete="off" />
            </label>
            <label :class="ui.label">
              デバイスキー
              <input
                v-model="sbiDeviceId"
                :class="ui.input"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
          </div>
        </article>

        <article :class="[ui.panel, 'min-w-0 overflow-hidden']">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p :class="ui.eyebrow">Connection</p>
              <h3 class="text-lg font-black">プロフィール切り替え</h3>
            </div>
            <button :class="ui.ghostButton" type="button" @click="emit('connect')">
              <Plug class="h-4 w-4" aria-hidden="true" />
              接続
            </button>
          </div>
          <div v-if="sbiPasskeys.length" :class="ui.list">
            <label v-for="passkey in sbiPasskeys" :key="passkey.id" :class="ui.profileRow">
              <input
                v-model="selectedPasskeyId"
                type="radio"
                :value="passkey.id"
                @change="emit('connect')"
              />
              <span class="grid min-w-0 gap-1">
                <strong class="truncate">{{ passkey.label }}</strong>
                <small class="truncate text-[#8f949d]">
                  {{ new Date(passkey.createdAt).toLocaleString() }}
                </small>
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
          <div
            v-else
            class="grid gap-2 rounded-[18px] border border-[#30343a] bg-[#111418] p-5 text-sm font-semibold text-[#9aa0a9]"
          >
            <span class="inline-flex items-center gap-2 text-[#c3c7cf]">
              <ShieldCheck class="h-4 w-4" aria-hidden="true" />
              保存済みプロフィールはありません。
            </span>
          </div>
        </article>
      </template>
    </div>

    <div
      v-if="editingApiKey"
      class="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-[#101418]/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      @click.self="closeApiKeyEditor"
    >
      <section
        class="grid max-h-[calc(100dvh-2rem)] w-full max-w-5xl gap-5 overflow-y-auto rounded-[28px] border border-[#30343a] bg-[#1b1f24] p-6 shadow-2xl shadow-black/35"
      >
        <header
          class="flex flex-wrap items-center justify-between gap-3 border-b border-[#33383f] pb-4"
        >
          <div class="grid min-w-0 gap-1">
            <p :class="ui.eyebrow">Edit API key</p>
            <h3 class="truncate text-xl font-black text-[#e3e3e9]">
              {{ editingApiKey.label }}
            </h3>
          </div>
          <div class="flex flex-wrap gap-2">
            <button :class="ui.ghostButton" type="button" @click="closeApiKeyEditor">
              キャンセル
            </button>
            <button :class="ui.primaryButton" type="button" @click="saveEditingApiKey">
              <Save class="h-4 w-4" aria-hidden="true" />
              保存
            </button>
          </div>
        </header>

        <ApiKeyPolicyEditor v-model="editingApiKey" permissions-open />
      </section>
    </div>
  </section>
</template>
