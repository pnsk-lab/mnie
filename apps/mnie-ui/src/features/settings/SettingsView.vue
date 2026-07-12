<script setup lang="ts">
import {
  Ban,
  Building2,
  ChevronRight,
  ChevronLeft,
  KeyRound,
  Landmark,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  TrainFront,
  WalletCards,
  Trash2,
  UserRoundCog,
} from 'lucide-vue-next'
import { AnimatePresence } from 'motion-v'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type {
  AccountProfile,
  ApiKey,
  ApiKeySettings,
  CronJob,
  ProfileAvailability,
  SbiPasskey,
} from '../../api'
import ApiKeyPolicyEditor from '../../components/ApiKeyPolicyEditor.vue'
import UiModal from '../../components/ui/UiModal.vue'
import UiSegmented from '../../components/ui/UiSegmented.vue'
import { ui } from '../../styles/ui'
import MobileSuicaPanel from './MobileSuicaPanel.vue'

const props = defineProps<{
  apiKeys: ApiKey[]
  sbiPasskeys: SbiPasskey[]
  profiles: AccountProfile[]
  profileAvailability: Record<string, ProfileAvailability>
  profileAvailabilityCheckedAt: Record<string, number>
  profileAvailabilityLoading: Record<string, boolean>
  cronJobs: CronJob[]
  smbcQrUrl: string
  smbcBalance: { amount: number; displayValue: string } | null
}>()

const apiKeyLabel = defineModel<string>('apiKeyLabel', { required: true })
const newApiKeySettings = defineModel<ApiKeySettings>('newApiKeySettings', { required: true })
const newApiToken = defineModel<string>('newApiToken', { required: true })
const sbiLabel = defineModel<string>('sbiLabel', { required: true })
const sbiPasskeySourceKind = defineModel<'json' | 'bitwarden'>('sbiPasskeySourceKind', {
  required: true,
})
const sbiCredentialJson = defineModel<string>('sbiCredentialJson', { required: true })
const sbiBitwardenDataPath = defineModel<string>('sbiBitwardenDataPath', { required: true })
const sbiBitwardenMasterPassword = defineModel<string>('sbiBitwardenMasterPassword', {
  required: true,
})
const sbiBitwardenRpId = defineModel<string>('sbiBitwardenRpId', { required: true })
const sbiBitwardenOrigin = defineModel<string>('sbiBitwardenOrigin', { required: true })
const sbiBitwardenCredentialId = defineModel<string>('sbiBitwardenCredentialId', {
  required: true,
})
const tradePassword = defineModel<string>('tradePassword', { required: true })
const sbiDeviceId = defineModel<string>('sbiDeviceId', { required: true })
const selectedProfileId = defineModel<string>('selectedProfileId', { required: true })
const smbcLabel = defineModel<string>('smbcLabel', { required: true })
const smbcUser = defineModel<string>('smbcUser', { required: true })
const smbcPassword = defineModel<string>('smbcPassword', { required: true })
const smbcAccountItemCode = defineModel<string>('smbcAccountItemCode', { required: true })
const payPayBankLabel = defineModel<string>('payPayBankLabel', { required: true })
const payPayBankBranchNo = defineModel<string>('payPayBankBranchNo', { required: true })
const payPayBankAccountNo = defineModel<string>('payPayBankAccountNo', { required: true })
const payPayBankPassword = defineModel<string>('payPayBankPassword', { required: true })
const editedLabel = ref('')

const emit = defineEmits<{
  addApiKey: []
  refresh: []
  saveApiKeySettings: [key: ApiKey]
  revokeApiKey: [id: string]
  addSbiPasskey: []
  addSmbcDirectProfile: []
  addPayPayBankProfile: []
  finishSmbc2fa: []
  forceProfileAvailability: [profileId: string]
  connect: []
  removeSbiPasskey: [id: string]
  updateProfileLabel: [id: string, label: string]
}>()

type SettingsSection = 'api-keys' | 'providers'

const route = useRoute()
const router = useRouter()
const editingApiKey = ref<ApiKey | null>(null)
const profileToDelete = ref<AccountProfile | null>(null)
const unavailableProfile = ref<AccountProfile | null>(null)
const providerIds = ['sbisec', 'smbc-direct', 'mobilesuica', 'paypay-bank'] as const
const sbiPasskeySourceOptions = [
  { label: 'Bitwarden', value: 'bitwarden' },
  { label: 'JSON', value: 'json' },
] as const
const selectedProvider = computed<AccountProfile['provider']>(() => {
  const provider = route.params.provider
  return typeof provider === 'string' &&
    providerIds.includes(provider as AccountProfile['provider'])
    ? (provider as AccountProfile['provider'])
    : 'sbisec'
})

const activeSection = computed<SettingsSection>(() => {
  return route.params.section === 'providers' ? 'providers' : 'api-keys'
})

const isNewApiKey = computed(
  () => activeSection.value === 'api-keys' && route.params.mode === 'new',
)
const isNewProvider = computed(
  () => activeSection.value === 'providers' && route.params.mode === 'new',
)
const isEditingProvider = computed(
  () => activeSection.value === 'providers' && route.params.mode === 'edit',
)
const isProviderSetup = computed(() => isNewProvider.value || isEditingProvider.value)
const isProviderChooser = computed(() => isNewProvider.value && !route.params.provider)
const editedProfile = computed(() => {
  const id = route.params.profileId
  return typeof id === 'string'
    ? props.profiles.find(
        (profile) => profile.id === id && profile.provider === selectedProvider.value,
      )
    : undefined
})
watch(
  editedProfile,
  (profile) => {
    editedLabel.value = profile?.label ?? ''
  },
  { immediate: true },
)

const providerCards = computed(() => [
  {
    id: 'paypay-bank' as const,
    label: 'PayPay銀行',
    description: '銀行口座・残高',
    icon: WalletCards,
    connectionCount: props.profiles.filter((profile) => profile.provider === 'paypay-bank').length,
    connected: props.profiles.some((profile) => profile.provider === 'paypay-bank'),
  },
  {
    id: 'sbisec' as const,
    label: 'SBI証券',
    description: '証券口座・取引',
    icon: Landmark,
    connectionCount: props.sbiPasskeys.length,
    connected: props.sbiPasskeys.length > 0,
  },
  {
    id: 'smbc-direct' as const,
    label: 'SMBC Direct',
    description: '銀行口座・残高',
    icon: Building2,
    connectionCount: props.profiles.filter((profile) => profile.provider === 'smbc-direct').length,
    connected: props.profiles.some((profile) => profile.provider === 'smbc-direct'),
  },
  {
    id: 'mobilesuica' as const,
    label: 'モバイルSuica',
    description: '利用履歴',
    icon: TrainFront,
    connectionCount: props.profiles.filter((profile) => profile.provider === 'mobilesuica').length,
    connected: props.profiles.some((profile) => profile.provider === 'mobilesuica'),
  },
])

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
    label: '連携サービス',
    items: [
      {
        id: 'providers',
        label: 'プロバイダー',
        description: '口座と接続を管理',
        icon: UserRoundCog,
      },
    ],
  },
] as const

const openSection = (section: SettingsSection) => {
  router.push(`/settings/${section}`)
}

const openNewApiKey = () => {
  router.push('/settings/api-keys/new')
}

const navigateWithTransition = (path: string, direction: 'forward' | 'back' = 'forward') => {
  document.documentElement.dataset.providerNavigation = direction
  const update = () => router.push(path)
  const startViewTransition = (
    document as Document & { startViewTransition?: (callback: () => Promise<unknown>) => void }
  ).startViewTransition
  if (startViewTransition) startViewTransition.call(document, update)
  else void update()
}

const openProviderSetup = (provider?: AccountProfile['provider'], profileId?: string) => {
  navigateWithTransition(
    provider
      ? profileId
        ? `/settings/providers/edit/${provider}/${profileId}`
        : `/settings/providers/new/${provider}`
      : '/settings/providers/new',
  )
}

const backToProviders = () => {
  navigateWithTransition('/settings/providers', 'back')
}

const backToProviderChooser = () => {
  navigateWithTransition('/settings/providers/new', 'back')
}

const availabilityLabel = (availability: ProfileAvailability | undefined) => {
  if (!availability) return '未確認'
  if (availability.ok) return '利用可'
  if (availability.reason === '2FA_REQUIRED') return '再認証必要'
  if (availability.reason === 'CAPTCHA_REQIRED') return 'CAPTCHA 必要'
  return '利用不可'
}

const availabilityClass = (availability: ProfileAvailability | undefined) => {
  if (!availability) return 'text-[#9aa0a9]'
  return availability.ok ? 'text-[#8ee6b0]' : 'text-[#ffb4ab]'
}

const availabilityMessage = (availability: ProfileAvailability | undefined) => {
  if (!availability || availability.ok) return undefined
  const message = availability.message
  if (typeof message === 'string') return message
  if (message && typeof message === 'object' && 'message' in message) {
    const nestedMessage = message.message
    if (typeof nestedMessage === 'string') return nestedMessage
  }
  return '詳細なエラーメッセージを取得できませんでした'
}

const availabilityCheckedLabel = (profileId: string) => {
  const checkedAt = props.profileAvailabilityCheckedAt[profileId]
  if (!checkedAt) return '未確認'
  return `${Math.max(0, Math.floor((Date.now() - checkedAt) / 60_000))}分前に確認`
}

const availabilityCheckedDate = (profileId: string) => {
  const checkedAt = props.profileAvailabilityCheckedAt[profileId]
  return checkedAt ? new Date(checkedAt).toLocaleString() : '未確認'
}

const backFromProviderSetup = () => {
  if (isEditingProvider.value || isProviderChooser.value) backToProviders()
  else backToProviderChooser()
}

const startSmbcReauthentication = () => {
  if (!editedProfile.value) return
  selectedProfileId.value = editedProfile.value.id
  emit('connect')
}

const confirmProfileDeletion = () => {
  if (!profileToDelete.value) return
  emit('removeSbiPasskey', profileToDelete.value.id)
  profileToDelete.value = null
}

const sectionTitle = computed(() =>
  isNewApiKey.value
    ? 'API Key 発行'
    : activeSection.value === 'api-keys'
      ? 'API キー'
      : isProviderChooser.value
        ? 'プロバイダーを追加'
        : isNewProvider.value
          ? `${providerCards.value.find((provider) => provider.id === selectedProvider.value)?.label} を追加`
          : isEditingProvider.value
            ? `${editedProfile.value?.label ?? 'プロバイダー'} を編集`
            : 'プロバイダー',
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
  <section class="grid min-h-[calc(100dvh-9rem)] min-w-0 max-w-full gap-0 lg:block">
    <aside
      class="min-w-0 border-b border-[#30343a] pb-4 lg:fixed lg:top-8 lg:left-[9rem] lg:z-10 lg:h-fit lg:max-h-[calc(100dvh-4rem)] lg:w-72 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:pr-5 lg:pb-0"
      aria-label="Settings"
    >
      <div class="grid gap-5">
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

    <div
      class="settings-content grid min-w-0 content-start pt-5 lg:ml-72 lg:pl-7 lg:pt-0"
      :class="isProviderSetup ? 'gap-3' : 'gap-8'"
    >
      <button
        v-if="isProviderSetup"
        class="inline-flex min-h-8 w-fit items-center gap-1.5 self-start rounded-md bg-transparent px-0 text-sm font-bold text-[#9aa0a9] transition hover:text-[#e3e3e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]"
        type="button"
        @click="backFromProviderSetup"
      >
        <ChevronLeft class="h-3.5 w-3.5" aria-hidden="true" /> 戻る
      </button>
      <header
        class="flex flex-wrap items-center justify-between gap-3 border-b border-[#30343a] pb-5"
      >
        <div class="grid gap-1">
          <h2 class="text-2xl font-black text-[#e3e3e9]">{{ sectionTitle }}</h2>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="isNewApiKey"
            :class="ui.primaryButton"
            type="button"
            @click="emit('addApiKey')"
          >
            <KeyRound class="h-4 w-4" aria-hidden="true" />
            発行
          </button>
          <template v-else>
            <button :class="ui.ghostButton" type="button" @click="emit('refresh')">
              <RefreshCw class="h-4 w-4" aria-hidden="true" />
              更新
            </button>
            <button
              v-if="activeSection === 'api-keys'"
              class="inline-grid h-10 w-10 place-items-center rounded-full bg-[#a8c7fa] text-[#102033] shadow-sm shadow-black/20 transition hover:bg-[#d3e3fd] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]"
              type="button"
              title="API Key 発行"
              @click="openNewApiKey"
            >
              <Plus class="h-4 w-4" aria-hidden="true" />
            </button>
          </template>
        </div>
      </header>

      <template v-if="isNewApiKey">
        <article class="grid min-w-0 content-start gap-4 overflow-hidden bg-transparent">
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
      </template>

      <template v-else-if="activeSection === 'api-keys'">
        <article class="grid min-w-0 content-start gap-4 overflow-hidden bg-transparent">
          <div v-if="apiKeys.length" :class="ui.list">
            <div v-for="key in apiKeys" :key="key.id" :class="ui.keyRow">
              <div :class="ui.row">
                <span class="min-w-0 truncate font-bold text-slate-100">{{ key.label }}</span>
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
        <template v-if="isProviderChooser">
          <div class="grid gap-4">
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <button
                v-for="provider in providerCards"
                :key="provider.id"
                class="grid min-h-40 content-between rounded-2xl border border-[#30343a] bg-[#111418] p-5 text-left transition hover:border-[#a8c7fa] hover:bg-[#182331] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3e3fd]"
                type="button"
                @click="openProviderSetup(provider.id)"
              >
                <span
                  class="grid h-11 w-11 place-items-center rounded-xl bg-[#263141] text-[#a8c7fa]"
                  ><component :is="provider.icon" class="h-5 w-5" aria-hidden="true"
                /></span>
                <span class="grid gap-1"
                  ><strong class="text-base font-black text-[#f0f4f9]">{{ provider.label }}</strong
                  ><small class="font-semibold text-[#9aa0a9]">{{
                    provider.description
                  }}</small></span
                >
              </button>
            </div>
          </div>
        </template>

        <template v-else-if="isProviderSetup">
          <article class="grid min-w-0 content-start gap-5 p-0">
            <template v-if="isEditingProvider">
              <template v-if="editedProfile">
                <label :class="ui.label">
                  名前
                  <input v-model="editedLabel" :class="ui.input" />
                </label>
                <div v-if="selectedProvider === 'smbc-direct'" class="flex justify-end">
                  <button
                    :class="ui.primaryButton"
                    type="button"
                    @click="startSmbcReauthentication"
                  >
                    再認証
                  </button>
                </div>
                <div
                  v-if="selectedProvider === 'smbc-direct' && smbcQrUrl"
                  class="grid gap-3 rounded-[18px] border border-[#4c5b72] bg-[#182331] p-4"
                >
                  <h4 class="font-black">生体認証を承認してください</h4>
                  <img
                    :src="smbcQrUrl"
                    alt="SMBC Direct 生体認証 QR コード"
                    class="h-56 w-56 rounded-lg bg-white p-2"
                  />
                  <button :class="ui.primaryButton" type="button" @click="emit('finishSmbc2fa')">
                    承認完了
                  </button>
                </div>
                <MobileSuicaPanel
                  v-else-if="selectedProvider === 'mobilesuica'"
                  reauth
                  :profile-id="editedProfile.id"
                  @reauthenticated="emit('forceProfileAvailability', $event)"
                />
                <div class="flex justify-end">
                  <button
                    :class="ui.primaryButton"
                    type="button"
                    @click="emit('updateProfileLabel', editedProfile.id, editedLabel)"
                  >
                    <Save class="h-4 w-4" aria-hidden="true" /> 保存
                  </button>
                </div>
                <div
                  v-if="selectedProvider === 'smbc-direct' || selectedProvider === 'mobilesuica'"
                  v-for="job in cronJobs.filter(
                    (value) =>
                      value.id ===
                      (selectedProvider === 'mobilesuica'
                        ? 'mobilesuica-session'
                        : 'smbc-direct-session'),
                  )"
                  :key="job.id"
                  class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-800 p-4 text-sm"
                >
                  <div>
                    <h4 class="font-black text-slate-100">{{ job.label }}</h4>
                    <p class="mt-1 text-slate-300">
                      {{
                        selectedProvider === 'mobilesuica'
                          ? '5 分ごとに利用履歴を取得して接続を維持します。'
                          : '5 分ごとに接続を維持します。'
                      }}
                    </p>
                  </div>
                  <span :class="job.lastError ? 'text-red-300' : 'text-emerald-300'">
                    {{ job.lastError ? job.lastError : job.running ? '実行中' : '有効' }}
                  </span>
                </div>
              </template>
              <p v-else class="text-sm text-red-300" role="alert">プロファイルが見つかりません。</p>
            </template>
            <template v-else-if="selectedProvider === 'sbisec'">
              <label :class="ui.label"
                >名前<input v-model="sbiLabel" :class="ui.input" placeholder="例: SBI 証券"
              /></label>
              <UiSegmented v-model="sbiPasskeySourceKind" :options="sbiPasskeySourceOptions" />
              <template v-if="sbiPasskeySourceKind === 'bitwarden'">
                <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <label :class="ui.label"
                    >data.json パス<input
                      v-model="sbiBitwardenDataPath"
                      :class="ui.input"
                      autocomplete="off"
                      spellcheck="false"
                  /></label>
                  <label :class="ui.label"
                    >RP ID<input
                      v-model="sbiBitwardenRpId"
                      :class="ui.input"
                      autocomplete="off"
                      spellcheck="false"
                  /></label>
                </div>
                <label :class="ui.label"
                  >Master Password<input
                    v-model="sbiBitwardenMasterPassword"
                    :class="ui.input"
                    type="password"
                    autocomplete="off"
                /></label>
                <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <label :class="ui.label"
                    >Origin<input
                      v-model="sbiBitwardenOrigin"
                      :class="ui.input"
                      autocomplete="off"
                      spellcheck="false"
                  /></label>
                  <label :class="ui.label"
                    >Credential ID<input
                      v-model="sbiBitwardenCredentialId"
                      :class="ui.input"
                      autocomplete="off"
                      spellcheck="false"
                  /></label>
                </div>
              </template>
              <label v-else :class="ui.label"
                >パスキー JSON<textarea
                  v-model="sbiCredentialJson"
                  :class="[ui.input, 'min-h-44 py-3 font-mono text-xs']"
                  spellcheck="false"
                  placeholder="{ ... }"
                ></textarea>
              </label>
              <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <label :class="ui.label"
                  >取引パスワード<input
                    v-model="tradePassword"
                    :class="ui.input"
                    type="password"
                    autocomplete="off" /></label
                ><label :class="ui.label"
                  >デバイスキー<input
                    v-model="sbiDeviceId"
                    :class="ui.input"
                    autocomplete="off"
                    spellcheck="false"
                /></label>
              </div>
              <div class="flex justify-end">
                <button :class="ui.primaryButton" type="button" @click="emit('addSbiPasskey')">
                  <Save class="h-4 w-4" aria-hidden="true" /> 保存
                </button>
              </div>
            </template>

            <template v-else-if="selectedProvider === 'smbc-direct'">
              <template v-if="smbcQrUrl">
                <div class="grid gap-3 rounded-[18px] border border-[#4c5b72] bg-[#182331] p-4">
                  <h4 class="font-black">生体認証を承認してください</h4>
                  <p class="text-sm text-[#b9c3d0]">
                    SMBC アプリで QR コードを読み取り、認証後に続行します。
                  </p>
                  <img
                    :src="smbcQrUrl"
                    alt="SMBC Direct 生体認証 QR コード"
                    class="h-56 w-56 rounded-lg bg-white p-2"
                  />
                  <button :class="ui.primaryButton" type="button" @click="emit('finishSmbc2fa')">
                    承認完了
                  </button>
                </div>
              </template>
              <p
                v-else-if="smbcBalance"
                class="rounded-[18px] bg-[#182331] p-4 text-sm text-[#b9c3d0]"
              >
                取得済み残高
                <strong class="ml-2 text-xl text-[#f0f4f9]">{{ smbcBalance.displayValue }}</strong>
              </p>
              <label :class="ui.label"
                >名前<input v-model="smbcLabel" :class="ui.input" placeholder="例: 生活費口座"
              /></label>
              <label :class="ui.label"
                >支店-口座番号<input
                  v-model="smbcUser"
                  :class="ui.input"
                  placeholder="0000-0000000"
              /></label>
              <label :class="ui.label"
                >ログインパスワード<input
                  v-model="smbcPassword"
                  :class="ui.input"
                  type="password"
                  autocomplete="off"
              /></label>
              <label :class="ui.label"
                >口座種別コード（任意）<input
                  v-model="smbcAccountItemCode"
                  :class="ui.input"
                  placeholder="2206"
              /></label>
              <div class="flex justify-end">
                <button
                  :class="ui.primaryButton"
                  type="button"
                  @click="emit('addSmbcDirectProfile')"
                >
                  <Save class="h-4 w-4" aria-hidden="true" /> 保存
                </button>
              </div>
            </template>

            <template v-else-if="selectedProvider === 'mobilesuica'">
              <MobileSuicaPanel />
            </template>
            <template v-else-if="selectedProvider === 'paypay-bank'">
              <label :class="ui.label"
                >名前<input v-model="payPayBankLabel" :class="ui.input"
              /></label>
              <div class="grid gap-3 sm:grid-cols-2">
                <label :class="ui.label"
                  >支店番号<input
                    v-model="payPayBankBranchNo"
                    :class="ui.input"
                    inputmode="numeric"
                    maxlength="11"
                    placeholder="008 または 008-7358242"
                /></label>
                <label :class="ui.label"
                  >口座番号<input
                    v-model="payPayBankAccountNo"
                    :class="ui.input"
                    inputmode="numeric"
                    maxlength="7"
                /></label>
              </div>
              <label :class="ui.label"
                >ログインパスワード<input
                  v-model="payPayBankPassword"
                  :class="ui.input"
                  type="password"
                  autocomplete="current-password"
              /></label>
              <div class="flex justify-end">
                <button
                  :class="ui.primaryButton"
                  type="button"
                  @click="emit('addPayPayBankProfile')"
                >
                  <Save class="h-4 w-4" aria-hidden="true" /> 保存
                </button>
              </div>
            </template>
          </article>
        </template>

        <template v-else>
          <div class="grid gap-3">
            <article
              v-for="profile in props.profiles"
              :key="profile.id"
              class="grid min-h-20 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-[#30343a] bg-[#111418] px-4 py-3"
            >
              <span class="grid h-11 w-11 place-items-center rounded-xl bg-[#263141] text-[#a8c7fa]"
                ><component
                  :is="providerCards.find((provider) => provider.id === profile.provider)?.icon"
                  class="h-5 w-5"
                  aria-hidden="true"
              /></span>
              <span class="grid min-w-0 gap-1"
                ><strong class="truncate text-[#f0f4f9]">{{ profile.label }}</strong
                ><small class="truncate font-semibold text-[#9aa0a9]"
                  >{{ providerCards.find((provider) => provider.id === profile.provider)?.label }} ·
                  {{ new Date(profile.createdAt).toLocaleDateString() }} に追加 ·
                  <span
                    v-if="props.profileAvailabilityLoading[profile.id]"
                    class="inline-flex items-center gap-1 text-[#9aa0a9]"
                  >
                    <LoaderCircle class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    <span class="sr-only">確認中</span>
                  </span>
                  <button
                    v-else-if="props.profileAvailability[profile.id]?.ok === false"
                    type="button"
                    :class="availabilityClass(props.profileAvailability[profile.id])"
                    class="cursor-pointer underline decoration-current/50 underline-offset-2 hover:decoration-current"
                    @click="unavailableProfile = profile"
                  >
                    {{ availabilityLabel(props.profileAvailability[profile.id]) }}
                  </button>
                  <span v-else :class="availabilityClass(props.profileAvailability[profile.id])">{{
                    availabilityLabel(props.profileAvailability[profile.id])
                  }}</span>
                  · {{ availabilityCheckedLabel(profile.id) }} ></small
                ></span
              >
              <span class="flex flex-wrap justify-end gap-2"
                ><button
                  :class="ui.ghostButton"
                  class="!h-10 !w-10 !p-0"
                  type="button"
                  title="編集"
                  aria-label="編集"
                  @click="openProviderSetup(profile.provider, profile.id)"
                >
                  <Pencil class="h-4 w-4" aria-hidden="true" /></button
                ><button
                  :class="ui.dangerButton"
                  class="!h-10 !w-10 !p-0"
                  type="button"
                  title="削除"
                  aria-label="削除"
                  @click="profileToDelete = profile"
                >
                  <Trash2 class="h-4 w-4" aria-hidden="true" /></button
              ></span>
            </article>
            <button
              class="grid min-h-20 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-dashed border-[#59616d] px-4 py-3 text-left text-[#d3e3fd] transition hover:border-[#a8c7fa] hover:bg-[#182331]"
              type="button"
              @click="openProviderSetup()"
            >
              <span class="grid h-11 w-11 place-items-center rounded-xl bg-[#263141]"
                ><Plus class="h-5 w-5" aria-hidden="true" /></span
              ><span class="font-black">プロバイダーを追加</span
              ><ChevronRight class="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </template>
      </template>
    </div>

    <AnimatePresence>
      <UiModal
        v-if="unavailableProfile"
        key="availability-detail"
        :title="unavailableProfile.label"
        eyebrow="利用不可の詳細"
        @close="unavailableProfile = null"
      >
        <dl class="grid gap-4 text-sm">
          <div class="grid gap-1">
            <dt class="font-bold text-[#9aa0a9]">最終確認</dt>
            <dd class="text-[#e3e3e9]">{{ availabilityCheckedDate(unavailableProfile.id) }}</dd>
          </div>
          <div class="grid gap-1">
            <dt class="font-bold text-[#9aa0a9]">詳細</dt>
            <dd class="whitespace-pre-wrap break-words rounded-xl bg-[#111418] p-4 text-[#ffb4ab]">
              {{ availabilityMessage(props.profileAvailability[unavailableProfile.id]) }}
            </dd>
          </div>
        </dl>
        <template #actions>
          <button :class="ui.primaryButton" type="button" @click="unavailableProfile = null">
            閉じる
          </button>
        </template>
      </UiModal>
      <UiModal
        v-if="editingApiKey"
        :title="editingApiKey.label"
        size="lg"
        @close="closeApiKeyEditor"
      >
        <template #actions>
          <button :class="ui.ghostButton" type="button" @click="closeApiKeyEditor">
            キャンセル
          </button>
          <button :class="ui.primaryButton" type="button" @click="saveEditingApiKey">
            <Save class="h-4 w-4" aria-hidden="true" />
            保存
          </button>
        </template>
        <ApiKeyPolicyEditor v-model="editingApiKey" permissions-open />
      </UiModal>
      <UiModal
        v-if="profileToDelete"
        key="delete-provider-profile"
        title="接続を削除しますか？"
        @close="profileToDelete = null"
      >
        <p class="text-sm leading-6 text-[#c3c7cf]">
          {{ profileToDelete.label }}
          を削除すると、この接続の認証情報も削除されます。この操作は元に戻せません。
        </p>
        <template #actions>
          <button :class="ui.ghostButton" type="button" @click="profileToDelete = null">
            キャンセル
          </button>
          <button :class="ui.dangerButton" type="button" @click="confirmProfileDeletion">
            <Trash2 class="h-4 w-4" aria-hidden="true" /> 削除
          </button>
        </template>
      </UiModal>
    </AnimatePresence>
  </section>
</template>

<style>
::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
}

.settings-content {
  view-transition-name: settings-content;
}

::view-transition-old(settings-content) {
  animation: provider-slide-out 140ms ease both;
}

::view-transition-new(settings-content) {
  animation: provider-slide-in 180ms ease both;
}

:root[data-provider-navigation='back']::view-transition-old(settings-content) {
  animation-name: provider-slide-out-back;
}

:root[data-provider-navigation='back']::view-transition-new(settings-content) {
  animation-name: provider-slide-in-back;
}

@keyframes provider-slide-out {
  to {
    opacity: 0;
    transform: translateX(-0.75rem);
  }
}

@keyframes provider-slide-in {
  from {
    opacity: 0;
    transform: translateX(0.75rem);
  }
}

@keyframes provider-slide-out-back {
  to {
    opacity: 0;
    transform: translateX(0.75rem);
  }
}

@keyframes provider-slide-in-back {
  from {
    opacity: 0;
    transform: translateX(-0.75rem);
  }
}
</style>
