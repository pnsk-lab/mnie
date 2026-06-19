<script setup lang="ts">
import { computed, ref } from 'vue'
import { AnimatePresence } from 'motion-v'
import { ArrowLeft, Ban, RefreshCw } from 'lucide-vue-next'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiModal from '../../components/ui/UiModal.vue'
import { ui } from '../../styles/ui'
import type { OrderRow } from '../../types/trading'
import { orderAmountText, orderHistoryKey, orderQuantityText } from '../trading/trading-data'

defineProps<{
  orders: OrderRow[]
  connected: boolean
  dataLoading: boolean
  cancelingOrderKey: string
  orderHistoryLoaded: boolean
  orderHistoryNotice: string
}>()

const emit = defineEmits<{
  refresh: []
  cancel: [order: OrderRow]
}>()

const cancelCandidate = ref<OrderRow | null>(null)
const usMarkets = new Set(['XNAS', 'XNYS', 'ARCX'])
const canCancel = (order: OrderRow) =>
  order.status === '注文中' && Boolean(order.orderNumber) && !usMarkets.has(order.market)
const isCanceling = (order: OrderRow, cancelingOrderKey: string) =>
  orderHistoryKey(order) === cancelingOrderKey
const cancelTitle = computed(() => cancelCandidate.value?.stock ?? '')

const askCancel = (order: OrderRow) => {
  if (!canCancel(order)) return
  cancelCandidate.value = order
}

const confirmCancel = () => {
  if (!cancelCandidate.value) return
  emit('cancel', cancelCandidate.value)
  cancelCandidate.value = null
}
</script>

<template>
  <section :class="ui.panel">
    <div :class="ui.panelHead">
      <h2>取引履歴</h2>
      <button
        :class="ui.ghostButton"
        type="button"
        :disabled="!connected || dataLoading"
        @click="emit('refresh')"
      >
        <RefreshCw class="h-4 w-4" aria-hidden="true" />
        履歴を更新
      </button>
    </div>
    <div :class="ui.list">
      <div v-for="order in orders" :key="order.id" :class="ui.orderRow">
        <span>
          <strong>{{ order.stock }}</strong>
          <small>{{ order.date }} / 通常単元</small>
        </span>
        <span :class="order.side === 'buy' ? ui.positive : ui.negative">
          {{ order.side === 'buy' ? '購入' : '売却' }}
        </span>
        <span>{{ orderQuantityText(order) }}</span>
        <span>{{ orderAmountText(order) }}</span>
        <span :class="[ui.statusBadge, order.status === '注文中' && ui.pendingBadge]">
          {{ order.status }}
        </span>
        <button
          v-if="canCancel(order)"
          :class="ui.ghostButton"
          type="button"
          :disabled="Boolean(cancelingOrderKey)"
          @click="askCancel(order)"
        >
          <Spinner v-if="isCanceling(order, cancelingOrderKey)" size="sm" />
          <Ban v-else class="h-4 w-4" aria-hidden="true" />
          {{ isCanceling(order, cancelingOrderKey) ? '取消中' : '取消' }}
        </button>
      </div>
      <div v-if="dataLoading && !orders.length" :class="[ui.muted, 'grid py-8 place-items-center']">
        <Spinner />
      </div>
      <p v-else-if="!orders.length" :class="[ui.muted, 'py-8 text-center']">
        {{
          orderHistoryLoaded
            ? orderHistoryNotice
              ? `SBI SDK は取引履歴なしを返しました (${orderHistoryNotice})`
              : '該当する注文履歴はありません'
            : '注文履歴はまだ取得されていません'
        }}
      </p>
    </div>
  </section>

  <AnimatePresence>
    <UiModal
      v-if="cancelCandidate"
      key="cancel-order-dialog"
      eyebrow="注文取消"
      :title="cancelTitle"
      @close="cancelCandidate = null"
    >
      <dl :class="ui.confirmList">
        <div :class="ui.confirmRow">
          <dt>注文番号</dt>
          <dd>{{ cancelCandidate.orderNumber }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>売買</dt>
          <dd>{{ cancelCandidate.side === 'buy' ? '購入' : '売却' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>数量</dt>
          <dd>{{ orderQuantityText(cancelCandidate) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>注文金額</dt>
          <dd>{{ orderAmountText(cancelCandidate) }}</dd>
        </div>
      </dl>
      <div :class="ui.actions">
        <UiButton variant="ghost" @click="cancelCandidate = null">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          戻る
        </UiButton>
        <UiButton variant="danger" @click="confirmCancel">
          <Ban class="h-4 w-4" aria-hidden="true" />
          注文取消
        </UiButton>
      </div>
    </UiModal>
  </AnimatePresence>
</template>
