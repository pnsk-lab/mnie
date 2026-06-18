<script setup lang="ts">
import { Ban, RefreshCw } from 'lucide-vue-next'
import Spinner from '../../components/ui/Spinner.vue'
import { ui } from '../../styles/ui'
import type { OrderRow } from '../../types/trading'
import { orderAmountText, orderQuantityText } from '../trading/trading-data'

defineProps<{
  orders: OrderRow[]
  connected: boolean
  dataLoading: boolean
  orderHistoryLoaded: boolean
  orderHistoryNotice: string
}>()

const emit = defineEmits<{
  refresh: []
  cancel: [order: OrderRow]
}>()
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
          <small>{{ order.date }} / {{ order.kind === 's' ? 'S株' : '通常単元' }}</small>
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
          v-if="order.status === '注文中'"
          :class="ui.ghostButton"
          type="button"
          @click="emit('cancel', order)"
        >
          <Ban class="h-4 w-4" aria-hidden="true" />
          取消
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
</template>
