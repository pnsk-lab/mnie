<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  listVirtualAccounts,
  listManagedVirtualAccounts,
  rpcRequest,
  type PublicFinancialAccount,
  type ApiKeySettings,
} from '../api'
import { accountDisplayName } from '../constants/provider'
import MethodTree from './MethodTree.vue'

defineProps<{ compact?: boolean; permissionsOpen?: boolean }>()
const settings = defineModel<ApiKeySettings>({ required: true })
const accounts = ref<PublicFinancialAccount[]>([])
const accountError = ref('')
const accountMethods = ref<Record<string, string[]>>({})
const accountErrors = ref<Record<string, string>>({})
const rpcMethods = ref<string[]>([])
const scopes = ['read', 'trade', 'reconcile'] as const
const knownAccountMethods = [
  'account.operations',
  'account.capabilities',
  'account.availability',
  'account.accounts.list',
  'account.balances.list',
  'account.assets.valuation.get',
  'account.transactions.list',
  'account.history.list',
  'account.investments.positions.list',
  'account.investments.positions.get',
  'account.investments.orders.list',
  'account.investments.orders.get',
  'account.investments.orders.preview',
  'account.investments.orders.create',
  'account.investments.orders.replace.preview',
  'account.investments.orders.replace',
  'account.investments.orders.cancel',
]
const scopedAdmin = new Set([
  'admin.apiKeys.bind',
  'admin.accountAccess.list',
  'admin.accountAccess.revoke',
  'admin.accounts.update',
  'admin.accounts.freeze',
  'admin.accounts.unfreeze',
  'admin.accounts.close',
  'admin.accounts.activity',
  'admin.accounts.assets.transfer',
  'admin.accounts.assets.transferBatch',
  'admin.accounts.orders.reconcile',
  'admin.accounts.reconciliation.inspect',
  'admin.accounts.reconciliation.approve',
  'admin.accounts.migrate',
  'admin.accounts.create',
])
const scopedPortfolio = new Set([
  'portfolio.accounts.get',
  'portfolio.accounts.balances',
  'portfolio.accounts.positions',
  'portfolio.accounts.orders',
  'portfolio.accounts.history',
  'portfolio.overview.get',
  'portfolio.valuation.get',
  'portfolio.history.list',
])
const globalMethods = computed(() =>
  [...new Set([...rpcMethods.value, ...(settings.value.allowedMethods ?? [])])]
    .filter((m) => m !== 'rpc.methods' && !m.startsWith('account.') && !scopedPortfolio.has(m))
    .sort(),
)
const globalSelected = computed(() =>
  settings.value.allowedMethods == null
    ? globalMethods.value.filter(
        (m) => !m.startsWith('admin.') && !m.startsWith('portfolio.ledger.'),
      )
    : settings.value.allowedMethods,
)
const binding = (id: string) => settings.value.accountBindings?.find((b) => b.accountId === id)
const methodsFor = (id: string) =>
  [
    ...new Set([
      ...knownAccountMethods,
      ...(accountMethods.value[id] ?? []),
      ...rpcMethods.value.filter(
        (method) => scopedAdmin.has(method) || scopedPortfolio.has(method),
      ),
      ...(binding(id)?.allowedMethods ?? []),
    ]),
  ].sort()
const selectedFor = (id: string) =>
  binding(id)?.allowedMethods ?? methodsFor(id).filter((method) => !method.startsWith('admin.'))
const loadAccountMethods = async (id: string) => {
  try {
    const methods = await rpcRequest<string[]>('account.operations', {
      account: id,
      forApiKey: true,
    })
    accountMethods.value[id] = methods.filter((method) => method.startsWith('account.'))
    delete accountErrors.value[id]
  } catch (error) {
    accountErrors.value[id] =
      error instanceof Error ? error.message : 'メソッドを取得できませんでした'
  }
}
onMounted(async () => {
  try {
    const [result, methods] = await Promise.all([
      listVirtualAccounts(),
      rpcRequest<string[]>('rpc.methods'),
    ])
    accounts.value = result.accounts
    rpcMethods.value = methods
    await Promise.all(accounts.value.map((account) => loadAccountMethods(account.id)))
    // Profile methods are provider-specific and are not in the static RPC list.
    // Discover them as the owner; preserve an error instead of hiding failures.
    const managed = await listManagedVirtualAccounts()
    const profiles = [...new Set(managed.accounts.map((account) => account.profileId))]
    const profileMethods = await Promise.allSettled(
      profiles.map((profile) =>
        rpcRequest<string[]>('profile.operations', { profile, forApiKey: true }),
      ),
    )
    rpcMethods.value = [
      ...new Set([
        ...rpcMethods.value,
        ...profileMethods.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
      ]),
    ]
    if (profileMethods.some((result) => result.status === 'rejected'))
      accountError.value =
        '一部のプロファイルメソッドを取得できませんでした。既存の許可は保持されます。'
  } catch (error) {
    accountError.value =
      error instanceof Error ? error.message : '口座またはメソッドを取得できませんでした'
  }
})
const setBinding = (id: string, role: string) => {
  const current = binding(id)
  const bindings = (settings.value.accountBindings ?? []).filter((item) => item.accountId !== id)
  if (role === 'read' || role === 'trade')
    bindings.push({
      accountId: id,
      role,
      allowedMethods: current?.allowedMethods ?? (current ? null : []),
    })
  settings.value.accountBindings = bindings
}
const setAccountMethods = (id: string, methods: string[]) => {
  const current = binding(id)
  if (!current) return
  settings.value.accountBindings = (settings.value.accountBindings ?? []).map((item) =>
    item.accountId === id ? { ...item, allowedMethods: methods } : item,
  )
  // An account-scoped admin operation requires both grants. Selecting it
  // under an account expresses intent to grant the corresponding RPC too.
  const previous = current.allowedMethods ?? []
  const admin = methods.filter((method) => scopedAdmin.has(method) && !previous.includes(method))
  if (admin.length)
    settings.value.allowedMethods = [...new Set([...globalSelected.value, ...admin])].sort()
}
const toggleScope = (scope: string) => {
  const current = settings.value.scopes ?? []
  settings.value.scopes = current.includes(scope)
    ? current.filter((item) => item !== scope)
    : [...current, scope].sort()
}
</script>
<template>
  <div class="grid gap-4">
    <p v-if="accountError" role="alert">{{ accountError }}</p>
    <fieldset class="grid gap-3">
      <legend class="font-bold">口座ごとのアクセスとメソッド</legend>
      <div
        v-for="account in accounts"
        :key="account.id"
        class="grid gap-2 rounded-xl border border-border p-3"
      >
        <label class="flex items-center justify-between gap-3">
          <span>{{ accountDisplayName(account.label, account.provider) }}</span>
          <select
            :value="binding(account.id)?.role ?? ''"
            class="min-h-12 rounded-lg bg-inset px-3"
            :aria-label="`${account.label}の権限`"
            @change="setBinding(account.id, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">アクセス不可</option>
            <option value="read">参照</option>
            <option v-if="account.kind !== 'system'" value="trade">参照・取引</option>
          </select>
        </label>
        <template v-if="binding(account.id)">
          <p v-if="accountErrors[account.id]" role="alert">{{ accountErrors[account.id] }}</p>
          <MethodTree
            v-if="methodsFor(account.id).length"
            :methods="methodsFor(account.id)"
            :selected="selectedFor(account.id)"
            @change="setAccountMethods(account.id, $event)"
          />
          <p v-else class="text-sm text-fg-muted">利用可能なメソッドを取得できませんでした。</p>
        </template>
      </div>
    </fieldset>
    <fieldset class="grid gap-2">
      <legend class="font-bold">スコープ</legend>
      <label v-for="scope in scopes" :key="scope" class="flex items-center gap-2"
        ><input
          type="checkbox"
          :checked="settings.scopes?.includes(scope)"
          @change="toggleScope(scope)"
        />{{ scope }}</label
      >
    </fieldset>
    <div class="grid gap-3 md:grid-cols-2">
      <label class="grid gap-2"
        >1注文 最大価格<input
          v-model.number="settings.maxOrderPriceJpy"
          class="rounded-lg bg-inset p-3"
          type="number"
          min="0"
      /></label>
      <label class="grid gap-2"
        >1注文 最大取引価格<input
          v-model.number="settings.maxOrderAmountJpy"
          class="rounded-lg bg-inset p-3"
          type="number"
          min="0"
      /></label>
    </div>
    <details :open="permissionsOpen">
      <summary class="cursor-pointer font-bold">共通・管理メソッド</summary>
      <p class="text-sm text-fg-muted">
        口座を対象とする管理メソッドは、ここに加え各対象口座でも許可してください。管理メソッドや全体の台帳メソッドは明示的な許可が必要で、キーの権限を拡張できるものもあります。
      </p>
      <MethodTree
        :methods="globalMethods"
        :selected="globalSelected"
        @change="settings.allowedMethods = $event"
      />
    </details>
  </div>
</template>
