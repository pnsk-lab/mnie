<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RefreshCw } from 'lucide-vue-next'
import { AnimatePresence } from 'motion-v'
import {
  confirmReconciliationProposal,
  listAccountProfiles,
  listFinancialAccounts,
  listReconciliationProposals,
  listTransactionObservations,
  rejectReconciliationProposal,
  syncAccountHistorySinceLast,
  syncAllAccountHistory,
  type AccountProfile,
  type FinancialAccount,
  type ReconciliationProposal,
  type TransactionObservation,
} from '../../api'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiModal from '../../components/ui/UiModal.vue'
import { ui } from '../../styles/ui'

const proposals = ref<ReconciliationProposal[]>([])
const loading = ref(false)
const error = ref('')
const changing = ref('')
const accounts = ref<FinancialAccount[]>([])
const observations = ref<TransactionObservation[]>([])
const profiles = ref<AccountProfile[]>([])
const syncingProfileId = ref('')
const selectedObservation = ref<TransactionObservation | null>(null)
const highlightedObservationId = ref('')
const syncResults = ref<Record<string, { kind: 'success' | 'error'; message: string }>>({})
let highlightTimer: ReturnType<typeof setTimeout> | undefined

const amount = (proposal: ReconciliationProposal) => {
  const value = proposal.observations.find((observation) => observation.amount)?.amount
  return value?.kind === 'money'
    ? new Intl.NumberFormat('ja-JP', { style: 'currency', currency: value.money.currency }).format(
        Number(value.money.value),
      )
    : '-'
}

const observationAmount = (observation: TransactionObservation) => {
  const value = observation.transaction.amount
  if (!value) return '-'
  const sign = observation.transaction.direction === 'debit' ? -1 : 1
  if (value.kind === 'money') {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: value.money.currency,
    }).format(sign * Number(value.money.value))
  }
  return `${sign < 0 ? '-' : ''}${value.value} ${value.unit}`
}

const observationDate = (observation: TransactionObservation) =>
  new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(observation.timestamps.precision === 'day'
      ? {}
      : { hour: '2-digit' as const, minute: '2-digit' as const }),
  }).format(new Date(observation.timestamps.occurredAt))

const accountName = (observation: TransactionObservation) => {
  const account = accounts.value.find((item) => item.id === observation.accountId)
  return account
    ? `${account.connectorTypeId} / ${account.providerAccountId}`
    : `${observation.source.connectorTypeId} / ${observation.source.providerAccountId}`
}

const title = (proposal: ReconciliationProposal) =>
  proposal.event.kind === 'wallet-topup' ? 'チャージ' : proposal.event.kind

const evidence = (proposal: ReconciliationProposal) => {
  const items = proposal.bindings.flatMap((binding) => binding.evidence)
  const kinds = new Set(items.map((item) => item.kind))
  const competing = items.find((item) => item.kind === 'competing-candidates')
  return [
    kinds.has('same-amount') ? '金額一致' : '',
    kinds.has('account-link') ? '登録済み資金元' : '',
    kinds.has('time-distance') ? '日時が近い' : '',
    competing && 'count' in competing ? `競合候補${competing.count}件` : '',
  ].filter(Boolean)
}

const load = async () => {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [nextObservations, nextProposals, nextAccounts, nextProfiles] = await Promise.all([
      listTransactionObservations(),
      listReconciliationProposals(['proposed', 'confirmed']),
      listFinancialAccounts(),
      listAccountProfiles(),
    ])
    observations.value = nextObservations
    proposals.value = nextProposals.items
    accounts.value = nextAccounts
    profiles.value = nextProfiles.profiles
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '照合候補を取得できませんでした'
  } finally {
    loading.value = false
  }
}

const syncHistory = async (profile: AccountProfile, mode: 'all' | 'since-last') => {
  if (syncingProfileId.value) return
  syncingProfileId.value = profile.id
  const { [profile.id]: _previous, ...remainingResults } = syncResults.value
  syncResults.value = remainingResults
  try {
    const result =
      mode === 'all'
        ? await syncAllAccountHistory(profile.id)
        : await syncAccountHistorySinceLast(profile.id)
    if (result.errors.length) {
      throw new Error(result.errors.map((item) => item.message).join('; '))
    }
    syncResults.value = {
      ...syncResults.value,
      [profile.id]: { kind: 'success', message: `${result.synced}件を取得しました` },
    }
    await load()
  } catch (cause) {
    syncResults.value = {
      ...syncResults.value,
      [profile.id]: {
        kind: 'error',
        message: cause instanceof Error ? cause.message : '履歴を再取得できませんでした',
      },
    }
  } finally {
    syncingProfileId.value = ''
  }
}

const accountLabel = (account: FinancialAccount) =>
  `${account.connectorTypeId} / ${account.providerAccountId}`

const decide = async (proposal: ReconciliationProposal, decision: 'confirm' | 'reject') => {
  if (changing.value) return false
  changing.value = proposal.id
  error.value = ''
  try {
    if (decision === 'confirm') await confirmReconciliationProposal(proposal.id)
    else await rejectReconciliationProposal(proposal.id)
    await load()
    return true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '照合判断を保存できませんでした'
    return false
  } finally {
    changing.value = ''
  }
}

const proposalDistance = (proposal: ReconciliationProposal) =>
  Math.min(
    ...proposal.bindings.flatMap((binding) =>
      binding.evidence.flatMap((item) =>
        item.kind === 'time-distance' && 'milliseconds' in item ? [Number(item.milliseconds)] : [],
      ),
    ),
  )

const pendingProposals = computed(() => {
  const usedObservationIds = new Set<string>()
  return proposals.value
    .filter((item) => item.event.state === 'proposed')
    .sort((left, right) => {
      const distance = proposalDistance(left) - proposalDistance(right)
      return distance !== 0 ? distance : left.id.localeCompare(right.id)
    })
    .filter((proposal) => {
      const observationIds = proposal.bindings.map((binding) => binding.observationId)
      if (observationIds.some((id) => usedObservationIds.has(id))) return false
      for (const id of observationIds) usedObservationIds.add(id)
      return true
    })
})

const proposalsByObservationId = computed(() => {
  const result = new Map<string, ReconciliationProposal[]>()
  for (const proposal of pendingProposals.value) {
    for (const observationId of new Set(
      proposal.bindings.map((binding) => binding.observationId),
    )) {
      result.set(observationId, [...(result.get(observationId) ?? []), proposal])
    }
  }
  return result
})

const confirmedByObservationId = computed(() => {
  const result = new Map<string, ReconciliationProposal>()
  for (const proposal of proposals.value.filter((item) => item.event.state === 'confirmed')) {
    for (const binding of proposal.bindings) result.set(binding.observationId, proposal)
  }
  return result
})

const selectedProposals = computed(() =>
  selectedObservation.value
    ? (proposalsByObservationId.value.get(selectedObservation.value.id) ?? [])
    : [],
)

const proposalCounterparts = (proposal: ReconciliationProposal, observationId: string) =>
  proposal.bindings.flatMap((binding) => {
    if (binding.observationId === observationId) return []
    const observation = observations.value.find((item) => item.id === binding.observationId)
    return observation ? [observation] : []
  })

const counterpartLabel = (proposal: ReconciliationProposal, observationId: string) =>
  proposalCounterparts(proposal, observationId)
    .map((observation) => observation.transaction.description)
    .join(' / ')

const rowAnchor = (observationId: string) => `transaction-observation-${observationId}`
const scrollToCounterpart = (proposal: ReconciliationProposal, observationId: string) => {
  const counterpart = proposal.bindings.find((binding) => binding.observationId !== observationId)
  if (!counterpart) return
  const element = document.getElementById(rowAnchor(counterpart.observationId))
  if (!(element instanceof HTMLElement)) return
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element.focus({ preventScroll: true })
  highlightedObservationId.value = counterpart.observationId
  if (highlightTimer) clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightedObservationId.value = ''
    highlightTimer = undefined
  }, 1600)
}

const decideFromDialog = async (
  proposal: ReconciliationProposal,
  decision: 'confirm' | 'reject',
) => {
  const succeeded = await decide(proposal, decision)
  if (!succeeded) return
  if (decision === 'confirm' || selectedProposals.value.length === 0) {
    selectedObservation.value = null
  }
}
onMounted(load)
onUnmounted(() => {
  if (highlightTimer) clearTimeout(highlightTimer)
})
</script>

<template>
  <section :class="ui.panel">
    <div :class="ui.panelHead">
      <h2>すべての取引</h2>
      <span :class="ui.muted">{{ observations.length }}件</span>
    </div>
    <div v-if="observations.length" class="max-h-[32rem] overflow-auto">
      <table class="w-full min-w-[58rem] border-collapse text-sm">
        <thead class="sticky top-0 z-10 bg-surface text-left text-xs text-fg-faint">
          <tr class="border-b border-border-subtle">
            <th class="px-3 py-3 font-extrabold">日時</th>
            <th class="px-3 py-3 font-extrabold">口座</th>
            <th class="px-3 py-3 font-extrabold">内容</th>
            <th class="px-3 py-3 font-extrabold">種別</th>
            <th class="px-3 py-3 text-right font-extrabold">金額</th>
            <th class="px-3 py-3 font-extrabold">関連</th>
            <th class="px-3 py-3 font-extrabold">状態</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="observation in observations"
            :id="rowAnchor(observation.id)"
            :key="observation.id"
            class="border-b border-border-subtle transition-[background-color,box-shadow] duration-700 last:border-b-0"
            :class="
              highlightedObservationId === observation.id
                ? 'bg-primary-surface-strong shadow-[inset_4px_0_0_var(--color-primary)]'
                : ''
            "
            tabindex="-1"
          >
            <td class="whitespace-nowrap px-3 py-3">
              {{ observationDate(observation) }}
            </td>
            <td class="whitespace-nowrap px-3 py-3">{{ accountName(observation) }}</td>
            <td class="px-3 py-3 font-semibold">{{ observation.transaction.description }}</td>
            <td class="px-3 py-3">{{ observation.transaction.kind }}</td>
            <td
              class="whitespace-nowrap px-3 py-3 text-right font-bold"
              :class="observation.transaction.direction === 'debit' ? ui.negative : ui.positive"
            >
              {{ observationAmount(observation) }}
            </td>
            <td class="px-3 py-3">
              <button
                v-if="confirmedByObservationId.get(observation.id)"
                type="button"
                class="max-w-48 truncate rounded-full bg-positive-container px-2.5 py-1 text-xs font-semibold text-positive transition hover:bg-positive-container-hover focus-visible:outline-2 focus-visible:outline-primary"
                @click="
                  scrollToCounterpart(confirmedByObservationId.get(observation.id)!, observation.id)
                "
              >
                {{
                  counterpartLabel(confirmedByObservationId.get(observation.id)!, observation.id)
                }}
              </button>
              <button
                v-else-if="proposalsByObservationId.get(observation.id)?.length"
                type="button"
                class="rounded-full bg-primary-container px-2.5 py-1 text-xs font-semibold text-primary-soft transition hover:bg-primary-container-hover focus-visible:outline-2 focus-visible:outline-primary"
                @click="selectedObservation = observation"
              >
                候補 {{ proposalsByObservationId.get(observation.id)?.length }}件
              </button>
              <span v-else :class="ui.muted">—</span>
            </td>
            <td class="px-3 py-3">{{ observation.transaction.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!loading" :class="[ui.muted, 'py-6 text-center']">保存済みの取引はありません</p>
  </section>

  <section :class="ui.panel">
    <div :class="ui.panelHead">
      <h2>プロバイダ</h2>
      <span :class="ui.muted">{{ profiles.length }}件</span>
    </div>
    <div v-if="profiles.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="profile in profiles"
        :key="profile.id"
        class="grid gap-3 rounded-2xl border border-border bg-transparent p-4"
      >
        <div class="flex items-start gap-3">
          <span
            class="mt-1 h-3 w-3 shrink-0 rounded-full"
            :style="{ backgroundColor: profile.color || profile.defaultColor }"
          />
          <span class="grid min-w-0 flex-1 gap-1">
            <strong class="truncate">{{ profile.label }}</strong>
            <small :class="ui.muted">{{ profile.providerName }}</small>
          </span>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <UiButton
            size="sm"
            variant="ghost"
            :disabled="Boolean(syncingProfileId)"
            @click="syncHistory(profile, 'all')"
          >
            <Spinner v-if="syncingProfileId === profile.id" size="sm" />
            <RefreshCw v-else class="h-4 w-4" aria-hidden="true" />
            履歴を全取得
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            :disabled="Boolean(syncingProfileId)"
            @click="syncHistory(profile, 'since-last')"
          >
            <Spinner v-if="syncingProfileId === profile.id" size="sm" />
            <RefreshCw v-else class="h-4 w-4" aria-hidden="true" />
            前回以降を取得
          </UiButton>
        </div>
        <small
          v-if="syncResults[profile.id]"
          :class="syncResults[profile.id]?.kind === 'error' ? ui.negative : ui.positive"
        >
          {{ syncResults[profile.id]?.message }}
        </small>
      </article>
    </div>
    <p v-else-if="!loading" :class="[ui.muted, 'py-6 text-center']">
      登録済みのプロバイダはありません
    </p>
  </section>

  <p v-if="error" :class="ui.dialogNote">{{ error }}</p>

  <AnimatePresence>
    <UiModal
      v-if="selectedObservation"
      key="reconciliation-candidates"
      eyebrow="照合候補"
      :title="`${selectedObservation.transaction.description}の候補`"
      size="lg"
      @close="selectedObservation = null"
    >
      <p :class="ui.muted">関連させる相手を選んでください。</p>
      <div class="grid gap-3">
        <article
          v-for="proposal in selectedProposals"
          :key="proposal.id"
          class="grid gap-3 rounded-2xl border border-border bg-transparent p-4"
        >
          <strong>
            {{ counterpartLabel(proposal, selectedObservation.id) }} と関連させますか？
          </strong>
          <div
            v-for="counterpart in proposalCounterparts(proposal, selectedObservation.id)"
            :key="counterpart.id"
            class="grid gap-1 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-center"
          >
            <span>{{ observationDate(counterpart) }}</span>
            <span>
              {{ accountName(counterpart) }} / {{ counterpart.transaction.description }}
            </span>
            <strong>{{ observationAmount(counterpart) }}</strong>
          </div>
          <small :class="ui.muted">
            {{ title(proposal) }} {{ amount(proposal) }}・{{ evidence(proposal).join('・') }}
          </small>
          <div :class="ui.actions">
            <UiButton
              size="sm"
              :disabled="Boolean(changing)"
              @click="decideFromDialog(proposal, 'confirm')"
            >
              <Spinner v-if="changing === proposal.id" size="sm" />
              関連させる
            </UiButton>
            <UiButton
              size="sm"
              variant="ghost"
              :disabled="Boolean(changing)"
              @click="decideFromDialog(proposal, 'reject')"
            >
              関係なし
            </UiButton>
          </div>
        </article>
      </div>
    </UiModal>
  </AnimatePresence>
</template>
