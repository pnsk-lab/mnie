<script setup lang="ts">
import {
  ArrowRight,
  Banknote,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Landmark,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  UserRound,
  WalletCards,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  approveVirtualAccountReconciliation,
  createVirtualAccount,
  migrateVirtualAccounts,
  listManagedVirtualAccounts,
  listVirtualAccountAssets,
  transferVirtualAssets,
  updateVirtualAccount,
  type ManagedVirtualAccount,
  type VirtualAccountAsset,
} from '../../api'
import { subtractDecimal } from '../../utils/decimal'
import { currencyCodeForMarket } from '../../utils/format'
import { ui } from '../../styles/ui'
import AccountManagement from './AccountManagement.vue'
import ReconciliationPanel from './ReconciliationPanel.vue'
import type { Position } from '../../types/trading'

const props = defineProps<{ positions: Position[] }>()

const route = useRoute()
const router = useRouter()
const accounts = ref<ManagedVirtualAccount[]>([])
const assets = ref<Record<string, VirtualAccountAsset[]>>({})
const creating = ref(false)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const name = ref('')
const physicalAccountId = ref('')
const allocationSourceId = ref('')
const allocationAmounts = ref<Record<string, string>>({})
const createReviewed = ref(false)
const allocationSources = computed(() =>
  accounts.value.filter(
    (account) =>
      account.physicalAccountId === physicalAccountId.value && account.status === 'active',
  ),
)
const allocationAssets = computed(() => assets.value[allocationSourceId.value] ?? [])
const initialAllocations = computed(() =>
  allocationAssets.value
    .filter(
      (asset) =>
        allocationAmounts.value[asset.assetKey] && allocationAmounts.value[asset.assetKey] !== '0',
    )
    .map((asset) => ({
      fromAccountId: allocationSourceId.value,
      assetKey: asset.assetKey,
      amount: allocationAmounts.value[asset.assetKey]!,
      expectedFromVersion: asset.version,
      reason: '口座作成時の割当',
    })),
)
const afterAllocation = (asset: VirtualAccountAsset) => {
  try {
    return subtractDecimal(asset.available, allocationAmounts.value[asset.assetKey] || '0')
  } catch {
    return '入力を確認してください'
  }
}
watch(
  [name, physicalAccountId, allocationSourceId, allocationAmounts],
  () => {
    createReviewed.value = false
  },
  { deep: true },
)
watch(physicalAccountId, () => {
  allocationSourceId.value = ''
  allocationAmounts.value = {}
})

const destinationAccountId = ref('')
const selectedAssetKeys = ref<Record<string, boolean>>({})
const transferAmounts = ref<Record<string, string>>({})

const routeAccountId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const routePhysicalId = computed(() =>
  typeof route.params.physicalId === 'string' ? route.params.physicalId : '',
)
const isTransfer = computed(() => route.params.mode === 'transfer')
const isPhysicalView = computed(() => route.name === 'accountsPhysical' && !!routePhysicalId.value)
const selectedAccount = computed(() =>
  accounts.value.find((account) => account.id === routeAccountId.value),
)
const physicalGroups = computed(() => {
  const groups = new Map<
    string,
    { physicalAccountId: string; connectorTypeId: string; accounts: ManagedVirtualAccount[] }
  >()
  for (const account of accounts.value) {
    const group = groups.get(account.physicalAccountId)
    if (group) group.accounts.push(account)
    else
      groups.set(account.physicalAccountId, {
        physicalAccountId: account.physicalAccountId,
        connectorTypeId: account.connectorTypeId,
        accounts: [account],
      })
  }
  return [...groups.values()]
})
const selectedPhysical = computed(() =>
  physicalGroups.value.find((group) => group.physicalAccountId === routePhysicalId.value),
)
const selectedAssets = computed(() =>
  (assets.value[routeAccountId.value] ?? []).filter(
    (asset) =>
      Number(asset.available) !== 0 || Number(asset.reserved) !== 0 || Number(asset.pending) !== 0,
  ),
)
const transferableAssets = computed(() =>
  selectedAssets.value.filter((asset) => Number(asset.available) > 0),
)
const destinationAccounts = computed(() =>
  accounts.value.filter(
    (account) =>
      account.physicalAccountId === selectedAccount.value?.physicalAccountId &&
      account.id !== selectedAccount.value?.id &&
      (selectedAccount.value?.status !== 'reconciliation_required' || account.kind === 'system'),
  ),
)
const destinationAssets = computed(() => assets.value[destinationAccountId.value] ?? [])
const selectedTransferAssets = computed(() =>
  transferableAssets.value.filter((asset) => selectedAssetKeys.value[asset.assetKey]),
)
const physicalAccounts = computed(() =>
  physicalGroups.value.map((group) => ({
    physicalAccountId: group.physicalAccountId,
    connectorTypeId: group.connectorTypeId,
  })),
)
const cashValuations = computed(() => {
  const totals = new Map<string, number>()
  for (const asset of selectedAssets.value) {
    const parts = asset.assetKey.split(':')
    const quantity = Number(asset.available) + Number(asset.reserved) + Number(asset.pending)
    let currency = parts[1] || 'JPY'
    let value = quantity
    if (asset.assetKind === 'security') {
      const position = props.positions.find(
        (item) => item.code === parts[1] && (!parts[2] || item.market === parts[2]),
      )
      const price =
        position?.currentPrice ??
        (position?.quantity ? position.marketValue / position.quantity : undefined)
      if (price === undefined || !Number.isFinite(price)) continue
      currency = currencyCodeForMarket(position?.market)
      value *= price
    }
    totals.set(currency, (totals.get(currency) ?? 0) + value)
  }
  return [...totals].map(([currency, value]) => ({ currency, value }))
})
const unpricedAssetCount = computed(
  () =>
    selectedAssets.value.filter((asset) => {
      if (asset.assetKind === 'cash') return false
      const parts = asset.assetKey.split(':')
      const position = props.positions.find(
        (item) => item.code === parts[1] && (!parts[2] || item.market === parts[2]),
      )
      const price =
        position?.currentPrice ??
        (position?.quantity ? position.marketValue / position.quantity : undefined)
      return price === undefined || !Number.isFinite(price)
    }).length,
)
const canTransfer = computed(
  () =>
    Boolean(destinationAccountId.value) &&
    selectedTransferAssets.value.length > 0 &&
    selectedTransferAssets.value.every((asset) => {
      const amount = Number(transferAmounts.value[asset.assetKey])
      return Number.isFinite(amount) && amount > 0 && amount <= Number(asset.available)
    }),
)

const accountPath = (id: string) => `/accounts/${encodeURIComponent(id)}`
const physicalAccountPath = (physicalAccountId: string) =>
  `/accounts/physical/${encodeURIComponent(physicalAccountId)}`

const navigateWithTransition = (path: string, direction: 'forward' | 'back' = 'forward') => {
  document.documentElement.dataset.accountNavigation = direction
  const update = () => router.push(path)
  const startViewTransition = (
    document as Document & { startViewTransition?: (callback: () => Promise<unknown>) => void }
  ).startViewTransition
  if (startViewTransition) startViewTransition.call(document, update)
  else void update()
}

const resetTransfer = () => {
  destinationAccountId.value = destinationAccounts.value[0]?.id ?? ''
  selectedAssetKeys.value = {}
  transferAmounts.value = Object.fromEntries(
    transferableAssets.value.map((asset) => [asset.assetKey, asset.available]),
  )
}

const renaming = ref(false)
const renameLabel = ref('')
const renameInput = useTemplateRef<HTMLInputElement>('renameInput')

const startRename = async () => {
  if (!selectedAccount.value || selectedAccount.value.kind === 'system') return
  renameLabel.value = selectedAccount.value.label
  renaming.value = true
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}

const cancelRename = () => {
  renaming.value = false
}

const submitRename = async () => {
  const account = selectedAccount.value
  const label = renameLabel.value.trim()
  renaming.value = false
  if (!account || !label || label === account.label) return
  busy.value = true
  error.value = ''
  try {
    await updateVirtualAccount(account.id, account.version, { label })
    notice.value = '口座名を変更しました'
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const result = await listManagedVirtualAccounts()
    accounts.value = result.accounts
    assets.value = Object.fromEntries(
      await Promise.all(
        accounts.value.map(async (account) => [
          account.id,
          (await listVirtualAccountAssets(account.id)).assets,
        ]),
      ),
    )
    if (!routeAccountId.value && !routePhysicalId.value && accounts.value[0]) {
      await router.replace(accountPath(accounts.value[0].id))
    }
    resetTransfer()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

const selectAccount = (id: string) => {
  creating.value = false
  notice.value = ''
  void router.push(accountPath(id))
}

const selectPhysical = (physicalId: string) => {
  creating.value = false
  notice.value = ''
  void router.push(physicalAccountPath(physicalId))
}

const openCreate = () => {
  creating.value = true
  notice.value = ''
  name.value = ''
  allocationSourceId.value = ''
  allocationAmounts.value = {}
  createReviewed.value = false
  physicalAccountId.value =
    selectedAccount.value?.physicalAccountId ?? physicalAccounts.value[0]?.physicalAccountId ?? ''
}

const createAccount = async () => {
  if (!name.value.trim() || !physicalAccountId.value) return
  if (!createReviewed.value) {
    createReviewed.value = true
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await createVirtualAccount({
      physicalAccountId: physicalAccountId.value,
      label: name.value.trim(),
      allocations: initialAllocations.value,
    })
    notice.value = '仮想口座を作成しました'
    creating.value = false
    await load()
    await router.push(accountPath(result.account.id))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

const openTransfer = () => {
  if (!selectedAccount.value) return
  resetTransfer()
  navigateWithTransition(`${accountPath(selectedAccount.value.id)}/transfer`)
}

const backToAccount = () => {
  if (!selectedAccount.value) return
  navigateWithTransition(accountPath(selectedAccount.value.id), 'back')
}

const transfer = async () => {
  if (!selectedAccount.value || !canTransfer.value) return
  busy.value = true
  error.value = ''
  try {
    await transferVirtualAssets(
      selectedTransferAssets.value.map((asset) => {
        const destinationAsset = destinationAssets.value.find(
          (item) => item.assetKey === asset.assetKey,
        )
        return {
          fromAccountId: selectedAccount.value!.id,
          toAccountId: destinationAccountId.value,
          assetKey: asset.assetKey,
          amount: transferAmounts.value[asset.assetKey]!,
          expectedFromVersion: asset.version,
          expectedToVersion: destinationAsset?.version ?? 0,
          reason: '資産移行',
        }
      }),
    )
    notice.value = '資産を移行しました'
    await load()
    backToAccount()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await load()
    error.value = message
  } finally {
    busy.value = false
  }
}

const migrate = async () => {
  const physicalId = routePhysicalId.value || selectedAccount.value?.physicalAccountId
  if (!physicalId) return
  busy.value = true
  error.value = ''
  try {
    const result = await migrateVirtualAccounts(physicalId)
    await load()
    await router.push(accountPath(result.accountId))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

const approveReconciliation = async () => {
  const physicalId = routePhysicalId.value || selectedAccount.value?.physicalAccountId
  if (!physicalId) return
  busy.value = true
  error.value = ''
  try {
    await approveVirtualAccountReconciliation(physicalId)
    notice.value = '口座のロックを解除しました'
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

const assetName = (asset: VirtualAccountAsset) => {
  const parts = asset.assetKey.split(':')
  if (asset.assetKind === 'cash') return parts[1] || '現金'
  return parts[1] || asset.assetKey
}

const assetDetail = (asset: VirtualAccountAsset) => {
  const parts = asset.assetKey.split(':')
  if (asset.assetKind === 'cash') return '現金'
  return [parts[2], parts[4]].filter(Boolean).join(' · ') || '株式'
}

const formatQuantity = (value: string) =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 8 }).format(Number(value))

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(value)

const statusLabel = (status: ManagedVirtualAccount['status']) => {
  if (status === 'active') return '利用中'
  if (status === 'frozen') return '停止中'
  if (status === 'reconciliation_required') return '確認が必要'
  return '閉鎖済み'
}

watch([routeAccountId, isTransfer], () => {
  renaming.value = false
  resetTransfer()
})
onMounted(load)
</script>

<template>
  <section
    class="grid min-h-[calc(100dvh-4rem)] min-w-0 flex-none lg:grid-cols-[18rem_minmax(0,1fr)]"
  >
    <aside
      class="min-w-0 border-b border-border pb-4 lg:sticky lg:top-0 lg:self-start lg:h-[calc(100dvh-4rem)] lg:border-r lg:border-b-0 lg:pr-5"
    >
      <div class="flex h-full flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span
              class="grid h-11 w-11 place-items-center rounded-2xl bg-primary-container text-primary"
              aria-hidden="true"
            >
              <UserRound class="h-5 w-5" :stroke-width="2.4" />
            </span>
            <h1 class="text-3xl font-black tracking-normal text-fg">口座</h1>
          </div>
          <button
            class="grid h-8 w-8 place-items-center rounded-full text-fg-muted hover:bg-hover"
            type="button"
            :disabled="loading"
            title="更新"
            @click="load"
          >
            <RefreshCw class="h-4 w-4" :class="loading && 'animate-spin'" aria-hidden="true" />
          </button>
        </div>

        <nav class="grid flex-1 content-start gap-4 overflow-y-auto" aria-label="口座一覧">
          <div v-for="group in physicalGroups" :key="group.physicalAccountId" class="grid gap-1">
            <button
              class="block w-full truncate px-3 text-left text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft"
              :class="
                isPhysicalView && routePhysicalId === group.physicalAccountId
                  ? 'text-primary'
                  : 'text-fg-muted hover:text-fg'
              "
              type="button"
              @click="selectPhysical(group.physicalAccountId)"
            >
              {{ group.connectorTypeId }}
            </button>
            <button
              v-for="account in group.accounts"
              :key="account.id"
              :class="[
                'grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-3 text-left transition hover:bg-hover',
                !creating && routeAccountId === account.id
                  ? 'bg-primary-container text-primary-soft'
                  : 'text-fg',
              ]"
              type="button"
              @click="selectAccount(account.id)"
            >
              <span
                :class="[
                  'grid h-10 w-10 place-items-center rounded-full',
                  !creating && routeAccountId === account.id
                    ? 'bg-primary text-on-primary'
                    : 'bg-inset text-fg-secondary',
                ]"
              >
                <WalletCards class="h-5 w-5" aria-hidden="true" />
              </span>
              <span class="min-w-0">
                <strong class="block truncate text-sm font-black">{{ account.label }}</strong>
              </span>
              <ChevronRight class="h-4 w-4 text-fg-faint" aria-hidden="true" />
            </button>
          </div>
        </nav>

        <button
          class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border font-black text-fg transition hover:bg-hover"
          type="button"
          @click="openCreate"
        >
          <Plus class="h-4 w-4" aria-hidden="true" /> 仮想口座を作成
        </button>
      </div>
    </aside>

    <div class="accounts-content grid min-w-0 content-start gap-6 pt-5 lg:pl-7 lg:pt-0">
      <p
        v-if="error"
        role="alert"
        class="rounded-xl bg-danger p-4 text-sm font-bold text-on-danger"
      >
        {{ error }}
      </p>
      <p
        v-if="notice"
        role="status"
        class="rounded-xl bg-primary-container p-4 text-sm font-bold text-primary"
      >
        {{ notice }}
      </p>

      <div v-if="loading" class="grid min-h-52 place-items-center text-fg-muted">
        <LoaderCircle class="h-7 w-7 animate-spin" aria-label="読み込み中" />
      </div>

      <form v-else-if="creating" class="grid max-w-2xl gap-5" @submit.prevent="createAccount">
        <header class="border-b border-border pb-5">
          <h2 class="text-2xl font-black text-fg">仮想口座を作成</h2>
        </header>
        <label class="grid gap-2 text-sm font-bold text-fg">
          実口座
          <select
            v-model="physicalAccountId"
            class="h-11 rounded-xl border border-border bg-surface px-3"
          >
            <option
              v-for="account in physicalAccounts"
              :key="account.physicalAccountId"
              :value="account.physicalAccountId"
            >
              {{ account.connectorTypeId }}
            </option>
          </select>
        </label>
        <label class="grid gap-2 text-sm font-bold text-fg">
          名前
          <input
            v-model="name"
            class="h-11 rounded-xl border border-border bg-surface px-3"
            autofocus
          />
        </label>
        <label class="grid gap-2 font-bold"
          >割当元
          <select v-model="allocationSourceId" :class="ui.input">
            <option value="">割り当てずに作成</option>
            <option v-for="account in allocationSources" :key="account.id" :value="account.id">
              {{ account.label }}
            </option>
          </select>
        </label>
        <div
          v-for="asset in allocationAssets"
          :key="asset.assetKey"
          class="grid gap-2 rounded-xl border border-border p-4"
        >
          <label class="grid gap-2"
            >{{ assetName(asset)
            }}<input
              v-model="allocationAmounts[asset.assetKey]"
              :class="ui.input"
              inputmode="decimal"
              :aria-label="`${assetName(asset)}の初期割当`"
          /></label>
          <p class="text-sm text-fg-muted">
            利用可能 {{ asset.available }} · 予約中 {{ asset.reserved }}
          </p>
          <p v-if="createReviewed" class="text-sm">
            割当元 {{ asset.available }} → {{ afterAllocation(asset) }} ／ 新口座 0 →
            {{ allocationAmounts[asset.assetKey] || '0' }}
          </p>
        </div>
        <p class="text-sm text-fg-muted">
          仮想口座はMnie内の管理単位です。証券会社上の口座は分割されません。
        </p>
        <p v-if="createReviewed" role="status" class="font-bold">
          {{ name }}と資産の割当を確定します。
        </p>
        <button
          class="h-11 rounded-xl bg-primary font-black text-on-primary disabled:opacity-50"
          type="submit"
          :disabled="busy || !name.trim() || !physicalAccountId"
        >
          {{ createReviewed ? '確定して作成' : '内容を確認' }}
        </button>
      </form>

      <template v-else-if="selectedAccount && isTransfer">
        <button
          class="inline-flex min-h-8 w-fit items-center gap-1.5 self-start rounded-md bg-transparent px-0 text-sm font-bold text-fg-muted transition hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-soft"
          type="button"
          @click="backToAccount"
        >
          <ChevronLeft class="h-3.5 w-3.5" aria-hidden="true" /> 戻る
        </button>

        <header class="border-b border-border pb-5">
          <h2 class="text-2xl font-black text-fg">資産を移行</h2>
          <p class="mt-1 text-sm font-semibold text-fg-muted">{{ selectedAccount.label }}</p>
        </header>

        <form class="grid gap-6" @submit.prevent="transfer">
          <label class="grid max-w-xl gap-2 text-sm font-bold text-fg">
            移行先
            <select
              v-model="destinationAccountId"
              class="h-12 rounded-xl border border-border bg-surface px-4 outline-none focus:border-primary"
            >
              <option value="">選択してください</option>
              <option v-for="account in destinationAccounts" :key="account.id" :value="account.id">
                {{ account.label }}
              </option>
            </select>
          </label>

          <div class="overflow-x-auto rounded-2xl border border-border">
            <table class="w-full min-w-[42rem] border-collapse text-left">
              <thead class="bg-inset text-xs font-black text-fg-muted">
                <tr>
                  <th class="w-14 px-5 py-4"><span class="sr-only">選択</span></th>
                  <th class="px-3 py-4">資産</th>
                  <th class="px-3 py-4 text-right">移行可能</th>
                  <th class="w-56 px-5 py-4 text-right">移行する数量</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="asset in transferableAssets"
                  :key="asset.assetKey"
                  class="border-t border-border"
                >
                  <td class="px-5 py-4">
                    <input
                      v-model="selectedAssetKeys[asset.assetKey]"
                      class="h-5 w-5 accent-primary"
                      type="checkbox"
                      :aria-label="`${assetName(asset)}を選択`"
                    />
                  </td>
                  <td class="px-3 py-4">
                    <span class="flex items-center gap-3">
                      <span
                        class="grid h-10 w-10 place-items-center rounded-full bg-inset text-fg-secondary"
                      >
                        <Banknote
                          v-if="asset.assetKind === 'cash'"
                          class="h-5 w-5"
                          aria-hidden="true"
                        />
                        <Landmark v-else class="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span>
                        <strong class="block font-black text-fg">{{ assetName(asset) }}</strong>
                        <small class="text-xs font-semibold text-fg-muted">{{
                          assetDetail(asset)
                        }}</small>
                      </span>
                    </span>
                  </td>
                  <td class="px-3 py-4 text-right font-bold text-fg">
                    {{ formatQuantity(asset.available) }}
                  </td>
                  <td class="px-5 py-4">
                    <input
                      v-model="transferAmounts[asset.assetKey]"
                      class="h-11 w-full rounded-xl border border-border bg-surface px-3 text-right font-bold outline-none focus:border-primary disabled:opacity-50"
                      inputmode="decimal"
                      :disabled="!selectedAssetKeys[asset.assetKey]"
                      :aria-label="`${assetName(asset)}の移行数量`"
                    />
                  </td>
                </tr>
                <tr v-if="!transferableAssets.length">
                  <td colspan="4" class="px-5 py-12 text-center font-semibold text-fg-muted">
                    移行できる資産はありません
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="flex justify-end">
            <button :class="ui.primaryButton" type="submit" :disabled="busy || !canTransfer">
              <LoaderCircle v-if="busy" class="h-4 w-4 animate-spin" aria-hidden="true" />
              <ArrowRight v-else class="h-4 w-4" aria-hidden="true" />
              移行する
            </button>
          </div>
        </form>
      </template>

      <template v-else-if="isPhysicalView && selectedPhysical">
        <header class="border-b border-border pb-5">
          <h2 class="text-2xl font-black text-fg">{{ selectedPhysical.connectorTypeId }}</h2>
        </header>
        <section
          v-if="
            !selectedPhysical.accounts.some((account) => account.kind !== 'system') &&
            selectedPhysical.accounts.some((account) => account.kind === 'system')
          "
          class="grid gap-3 rounded-xl border border-border p-5"
        >
          <h3 class="font-bold">仮想口座へ移行</h3>
          <p>
            未約定注文と資産を確認し、現在の全資産を新しい仮想口座へ割り当てます。API
            keyの口座権限は移行後に設定してください。
          </p>
          <button :class="ui.primaryButton" type="button" :disabled="busy" @click="migrate">
            確認して移行
          </button>
        </section>
        <button
          v-if="selectedPhysical.accounts.some((a) => a.status === 'reconciliation_required')"
          :class="ui.primaryButton"
          type="button"
          :disabled="busy"
          @click="approveReconciliation"
        >
          ロック解除を承認
        </button>
        <ReconciliationPanel
          :key="routePhysicalId"
          :physical-account-id="routePhysicalId"
          @changed="load"
        />
        <section class="grid gap-3">
          <h3 class="font-black text-fg">仮想口座</h3>
          <div class="grid gap-2">
            <button
              v-for="account in selectedPhysical.accounts"
              :key="account.id"
              class="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-4 text-left font-bold text-fg transition hover:bg-hover"
              type="button"
              @click="selectAccount(account.id)"
            >
              {{ account.label }}
              <span class="text-xs font-bold text-fg-muted">{{ statusLabel(account.status) }}</span>
            </button>
          </div>
        </section>
      </template>

      <template v-else-if="selectedAccount">
        <header
          class="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5"
        >
          <div class="flex min-w-0 items-center gap-2">
            <h2 v-if="!renaming" class="min-w-0 truncate text-2xl font-black text-fg">
              {{ selectedAccount.label }}
            </h2>
            <input
              v-else
              ref="renameInput"
              v-model="renameLabel"
              class="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-1 text-2xl font-black text-fg outline-none focus:border-primary"
              :disabled="busy"
              aria-label="口座名"
              @keydown.enter.prevent="submitRename"
              @keydown.esc.prevent="cancelRename"
              @blur="renaming && submitRename()"
            />
            <button
              v-if="!renaming && selectedAccount.kind !== 'system'"
              class="grid h-8 w-8 flex-none place-items-center rounded-full text-fg-muted transition hover:bg-hover hover:text-fg"
              type="button"
              title="名前を変更"
              aria-label="名前を変更"
              @click="startRename"
            >
              <Pencil class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <span class="rounded-full bg-inset px-3 py-1 text-xs font-bold text-fg">
            {{ statusLabel(selectedAccount.status) }}
          </span>
        </header>

        <section class="grid gap-3 rounded-2xl bg-inset p-6 sm:p-8">
          <span class="flex items-center gap-2 text-sm font-black text-fg-muted">
            <CircleDollarSign class="h-4 w-4" aria-hidden="true" /> 評価額
          </span>
          <div v-if="cashValuations.length" class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <strong
              v-for="valuation in cashValuations"
              :key="valuation.currency"
              class="text-3xl font-black tracking-tight text-fg sm:text-4xl"
            >
              {{ formatCurrency(valuation.value, valuation.currency) }}
            </strong>
          </div>
          <strong v-else class="text-3xl font-black text-fg">—</strong>
          <small v-if="unpricedAssetCount" class="font-semibold text-fg-muted">
            価格未取得の資産 {{ unpricedAssetCount }}件
          </small>
        </section>

        <section class="grid gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="font-black text-fg">保有資産</h3>
            <button
              :class="ui.primaryButton"
              type="button"
              :disabled="!destinationAccounts.length || !transferableAssets.length"
              @click="openTransfer"
            >
              資産を移行 <ArrowRight class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div class="overflow-x-auto rounded-2xl border border-border">
            <table class="w-full min-w-80 border-collapse text-left">
              <thead class="bg-inset text-xs font-black text-fg-muted">
                <tr>
                  <th class="px-5 py-4">資産</th>
                  <th class="px-5 py-4 text-right">利用可能</th>
                  <th class="px-5 py-4 text-right">予約中</th>
                  <th class="px-5 py-4 text-right">確定待ち</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="asset in selectedAssets"
                  :key="asset.assetKey"
                  class="border-t border-border"
                >
                  <td class="px-5 py-4">
                    <strong class="block font-black text-fg">{{ assetName(asset) }}</strong>
                    <small class="text-xs font-semibold text-fg-muted">{{
                      assetDetail(asset)
                    }}</small>
                  </td>
                  <td class="px-5 py-4 text-right font-bold text-fg">
                    {{ formatQuantity(asset.available) }}
                  </td>
                  <td class="px-5 py-4 text-right">{{ formatQuantity(asset.reserved) }}</td>
                  <td class="px-5 py-4 text-right">{{ formatQuantity(asset.pending) }}</td>
                </tr>
                <tr v-if="!selectedAssets.length">
                  <td colspan="2" class="px-5 py-12 text-center font-semibold text-fg-muted">
                    保有資産はありません
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <AccountManagement :account="selectedAccount" @changed="load" />
      </template>

      <div v-else class="grid min-h-52 place-items-center text-center text-fg-muted">
        口座が見つかりません
      </div>
    </div>
  </section>
</template>

<style>
.accounts-content {
  view-transition-name: accounts-content;
}

::view-transition-old(accounts-content) {
  animation: account-slide-out 140ms ease both;
}

::view-transition-new(accounts-content) {
  animation: account-slide-in 180ms ease both;
}

:root[data-account-navigation='back']::view-transition-old(accounts-content) {
  animation-name: account-slide-out-back;
}

:root[data-account-navigation='back']::view-transition-new(accounts-content) {
  animation-name: account-slide-in-back;
}

@keyframes account-slide-out {
  to {
    opacity: 0;
    transform: translateX(-0.75rem);
  }
}

@keyframes account-slide-in {
  from {
    opacity: 0;
    transform: translateX(0.75rem);
  }
}

@keyframes account-slide-out-back {
  to {
    opacity: 0;
    transform: translateX(0.75rem);
  }
}

@keyframes account-slide-in-back {
  from {
    opacity: 0;
    transform: translateX(-0.75rem);
  }
}
</style>
