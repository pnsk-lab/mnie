<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, RefreshCw, X } from 'lucide-vue-next'
import {
  confirmReconciliationProposal,
  listFinancialAccounts,
  listReconciliationProposals,
  rejectReconciliationProposal,
  saveAccountLink,
  type FinancialAccount,
  type ReconciliationProposal,
} from '../../api'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import { ui } from '../../styles/ui'

const proposals = ref<ReconciliationProposal[]>([])
const loading = ref(false)
const error = ref('')
const changing = ref('')
const accounts = ref<FinancialAccount[]>([])
const sourceAccountId = ref('')
const targetAccountId = ref('')
const savingLink = ref(false)

const amount = (proposal: ReconciliationProposal) => {
  const value = proposal.observations.find((observation) => observation.amount)?.amount
  return value?.kind === 'money'
    ? new Intl.NumberFormat('ja-JP', { style: 'currency', currency: value.money.currency }).format(
        Number(value.money.value),
      )
    : '-'
}

const title = (proposal: ReconciliationProposal) =>
  proposal.event.kind === 'wallet-topup' ? 'チャージ' : proposal.event.kind

const evidence = (proposal: ReconciliationProposal) => {
  const kinds = new Set(
    proposal.bindings.flatMap((binding) => binding.evidence.map((item) => item.kind)),
  )
  return [
    kinds.has('same-amount') ? '金額一致' : '',
    kinds.has('account-link') ? '登録済み資金元' : '',
    kinds.has('time-distance') ? '日時が近い' : '',
  ].filter(Boolean)
}

const load = async () => {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const [nextProposals, nextAccounts] = await Promise.all([
      listReconciliationProposals(),
      listFinancialAccounts(),
    ])
    proposals.value = nextProposals.items
    accounts.value = nextAccounts
    if (!sourceAccountId.value) sourceAccountId.value = accounts.value[0]?.id ?? ''
    if (!targetAccountId.value) targetAccountId.value = accounts.value[1]?.id ?? ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '照合候補を取得できませんでした'
  } finally {
    loading.value = false
  }
}

const accountLabel = (account: FinancialAccount) =>
  `${account.connectorTypeId} / ${account.providerAccountId}`

const saveLink = async () => {
  if (savingLink.value) return
  savingLink.value = true
  error.value = ''
  try {
    await saveAccountLink({
      sourceAccountId: sourceAccountId.value,
      targetAccountId: targetAccountId.value,
      type: 'funds',
      source: 'user',
      confirmed: true,
    })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '資金元を保存できませんでした'
  } finally {
    savingLink.value = false
  }
}

const decide = async (proposal: ReconciliationProposal, decision: 'confirm' | 'reject') => {
  if (changing.value) return
  changing.value = proposal.id
  error.value = ''
  try {
    if (decision === 'confirm') await confirmReconciliationProposal(proposal.id)
    else await rejectReconciliationProposal(proposal.id)
    proposals.value = proposals.value.filter((item) => item.id !== proposal.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '照合判断を保存できませんでした'
  } finally {
    changing.value = ''
  }
}

const hasProposals = computed(() => proposals.value.length > 0)
onMounted(load)
</script>

<template>
  <section :class="ui.panel">
    <div :class="ui.panelHead">
      <h2>照合候補</h2>
      <UiButton size="sm" variant="ghost" :disabled="loading" @click="load">
        <Spinner v-if="loading" size="sm" />
        <RefreshCw v-else class="h-4 w-4" aria-hidden="true" />
        更新
      </UiButton>
    </div>
    <p v-if="error" :class="ui.dialogNote">{{ error }}</p>
    <form v-if="accounts.length > 1" :class="[ui.rowActions, 'mb-4']" @submit.prevent="saveLink">
      <select v-model="sourceAccountId" :class="ui.input" aria-label="資金元">
        <option v-for="account in accounts" :key="account.id" :value="account.id">
          {{ accountLabel(account) }}
        </option>
      </select>
      <span :class="ui.muted">から</span>
      <select v-model="targetAccountId" :class="ui.input" aria-label="チャージ先">
        <option v-for="account in accounts" :key="account.id" :value="account.id">
          {{ accountLabel(account) }}
        </option>
      </select>
      <UiButton
        size="sm"
        :disabled="savingLink || sourceAccountId === targetAccountId"
        type="submit"
      >
        <Spinner v-if="savingLink" size="sm" />
        資金元を保存
      </UiButton>
    </form>
    <div v-if="hasProposals" :class="ui.list">
      <article v-for="proposal in proposals" :key="proposal.id" :class="ui.orderRow">
        <span>
          <strong>{{ title(proposal) }} {{ amount(proposal) }}</strong>
          <small>{{ proposal.observations.map((item) => item.description).join(' / ') }}</small>
        </span>
        <span :class="ui.muted">{{ evidence(proposal).join('・') }}</span>
        <span :class="ui.rowActions">
          <UiButton size="sm" :disabled="Boolean(changing)" @click="decide(proposal, 'confirm')">
            <Spinner v-if="changing === proposal.id" size="sm" />
            <Check v-else class="h-4 w-4" aria-hidden="true" />
            確定
          </UiButton>
          <UiButton
            size="sm"
            variant="ghost"
            :disabled="Boolean(changing)"
            @click="decide(proposal, 'reject')"
          >
            <X class="h-4 w-4" aria-hidden="true" />
            関係なし
          </UiButton>
        </span>
      </article>
    </div>
    <p v-else-if="!loading" :class="[ui.muted, 'py-6 text-center']">照合候補はありません</p>
  </section>
</template>
