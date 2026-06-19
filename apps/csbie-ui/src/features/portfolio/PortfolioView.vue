<script setup lang="ts">
import { computed, ref } from 'vue'
import { AnimatePresence } from 'motion-v'
import { ArrowLeft, Ban, Plug } from 'lucide-vue-next'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiModal from '../../components/ui/UiModal.vue'
import { ui } from '../../styles/ui'
import type { OrderRow, Position } from '../../types/trading'
import {
  currency,
  currencyForMarket,
  signedCurrency,
  signedCurrencyForMarket,
  signedPercent,
} from '../../utils/format'
import { orderAmountText, orderHistoryKey, orderQuantityText } from '../trading/trading-data'

defineProps<{
  showPortfolioSpinner: boolean
  totalAssetValue: number
  buyingPower: number
  holdingsMarketValue: number
  totalProfitLoss: number
  totalProfitLossRate: number
  stockAssetRatio: number
  cashAssetRatio: number
  positions: Position[]
  recentOrders: OrderRow[]
  cancelingOrderKey: string
  dataLoading: boolean
  connected: boolean
  orderHistoryLoaded: boolean
  orderHistoryNotice: string
}>()

const emit = defineEmits<{
  connect: []
  openPosition: [code: string]
  cancelOrder: [order: OrderRow]
}>()

const usMarkets = new Set(['XNAS', 'XNYS', 'ARCX'])
const canCancel = (order: OrderRow) =>
  order.status === '注文中' && Boolean(order.orderNumber) && !usMarkets.has(order.market)
const isCanceling = (order: OrderRow, cancelingOrderKey: string) =>
  orderHistoryKey(order) === cancelingOrderKey
const cancelCandidate = ref<OrderRow | null>(null)
const cancelTitle = computed(() => cancelCandidate.value?.stock ?? '')

const askCancel = (order: OrderRow) => {
  if (!canCancel(order)) return
  cancelCandidate.value = order
}

const confirmCancel = () => {
  if (!cancelCandidate.value) return
  emit('cancelOrder', cancelCandidate.value)
  cancelCandidate.value = null
}
</script>

<template>
  <section :class="ui.dashboardGrid">
    <article :class="ui.assetOverviewPanel">
      <div :class="ui.assetOverviewHead">
        <span :class="ui.metricLabel">総資産価値</span>
        <strong :class="ui.metricValue">
          <template v-if="!showPortfolioSpinner">{{ currency(totalAssetValue) }}</template>
          <Spinner v-else size="lg" />
        </strong>
        <small :class="ui.assetOverviewSubtext">
          余力:
          <template v-if="!showPortfolioSpinner">{{ currency(buyingPower) }}</template>
          <Spinner v-else size="sm" />
        </small>
      </div>
      <div :class="ui.assetBreakdownPanel">
        <span :class="ui.assetBreakdownTitle">内訳</span>
        <i :class="ui.assetBreakdownBar" aria-hidden="true">
          <b :class="ui.assetBreakdownStocks" :style="{ width: `${stockAssetRatio}%` }"></b>
          <b :class="ui.assetBreakdownCash" :style="{ width: `${cashAssetRatio}%` }"></b>
        </i>
        <div :class="ui.assetBreakdownRows">
          <div :class="ui.assetBreakdownRow">
            <span :class="ui.assetBreakdownLabel">
              <i :class="[ui.assetBreakdownSwatch, ui.assetBreakdownSwatchStocks]"></i>
              株式
            </span>
            <span :class="ui.assetBreakdownMeta">
              <strong :class="ui.assetBreakdownAmount">
                <template v-if="!showPortfolioSpinner">{{
                  currency(holdingsMarketValue)
                }}</template>
                <Spinner v-else size="sm" />
              </strong>
              <small :class="ui.assetBreakdownRatio">
                <template v-if="!showPortfolioSpinner">{{ stockAssetRatio.toFixed(1) }}%</template>
                <Spinner v-else size="sm" />
              </small>
            </span>
          </div>
          <div :class="ui.assetBreakdownRow">
            <span :class="ui.assetBreakdownLabel">
              <i :class="[ui.assetBreakdownSwatch, ui.assetBreakdownSwatchCash]"></i>
              余力
            </span>
            <span :class="ui.assetBreakdownMeta">
              <strong :class="ui.assetBreakdownAmount">
                <template v-if="!showPortfolioSpinner">{{ currency(buyingPower) }}</template>
                <Spinner v-else size="sm" />
              </strong>
              <small :class="ui.assetBreakdownRatio">
                <template v-if="!showPortfolioSpinner">{{ cashAssetRatio.toFixed(1) }}%</template>
                <Spinner v-else size="sm" />
              </small>
            </span>
          </div>
        </div>
      </div>
    </article>

    <article :class="ui.metricPanel">
      <span :class="ui.metricLabel">通算評価損益</span>
      <strong :class="[ui.metricValue, totalProfitLoss >= 0 ? ui.positive : ui.negative]">
        <template v-if="!showPortfolioSpinner">
          {{ signedCurrency(totalProfitLoss) }}
          <small> · {{ signedPercent(totalProfitLossRate) }}</small>
        </template>
        <Spinner v-else size="lg" />
      </strong>
    </article>

    <article :class="ui.holdingsPanel">
      <div :class="ui.panelHead">
        <h2>保有銘柄</h2>
        <button
          :class="ui.ghostButton"
          type="button"
          :disabled="dataLoading"
          @click="emit('connect')"
        >
          <Plug class="h-4 w-4" aria-hidden="true" />
          {{ connected ? '再取得' : '接続' }}
        </button>
      </div>
      <div :class="ui.holdingsBody">
        <div :class="ui.holdingsHead">
          <span>銘柄</span>
          <span>タイプ</span>
          <span>数量</span>
          <span>評価額</span>
          <span>評価損益</span>
        </div>
        <div v-if="positions.length" :class="ui.holdingsRows">
          <button
            v-for="position in positions"
            :key="position.code"
            :class="ui.holdingRow"
            type="button"
            @click="emit('openPosition', position.code)"
          >
            <span class="grid gap-1">
              <strong>{{ position.name }}</strong>
              <small>{{ position.code }}</small>
            </span>
            <b :class="ui.typePill">{{
              position.type ?? (position.quantity >= 100 ? '単元' : 'S株')
            }}</b>
            <span>{{ position.quantity }}</span>
            <span :class="ui.muted">{{
              currencyForMarket(position.marketValue, position.market)
            }}</span>
            <span
              class="grid justify-items-end gap-0.5"
              :class="position.profitLoss >= 0 ? ui.positive : ui.negative"
            >
              <strong>{{ signedCurrencyForMarket(position.profitLoss, position.market) }}</strong>
              <small>{{ signedPercent(position.profitLossRate) }}</small>
            </span>
          </button>
        </div>
        <div v-else-if="dataLoading" :class="[ui.muted, ui.emptyState]">
          <Spinner />
        </div>
        <p v-else :class="[ui.muted, ui.emptyState]">SBIに接続すると保有銘柄を表示します</p>
      </div>
    </article>

    <article :class="ui.portfolioHistory">
      <h2>取引履歴</h2>
      <div :class="ui.historyList">
        <div v-if="recentOrders.length" :class="ui.historyRows">
          <div v-for="order in recentOrders" :key="order.id" :class="ui.miniOrder">
            <span class="grid gap-1">
              <strong>{{ order.stock }}</strong>
              <small
                >{{ order.side === 'buy' ? '買付' : '売却' }}(単元) ・
                {{ orderQuantityText(order) }}</small
              >
              <small :class="[ui.statusBadge, order.status === '注文中' && ui.pendingBadge]">
                {{ order.status }}
              </small>
            </span>
            <span class="grid justify-items-end gap-1">
              <small>{{ order.date.slice(5, 10) }}</small>
              <strong>{{ orderAmountText(order) }}</strong>
              <button
                v-if="canCancel(order)"
                :class="ui.ghostButton"
                class="min-h-8 px-3 text-xs"
                type="button"
                :disabled="Boolean(cancelingOrderKey)"
                @click="askCancel(order)"
              >
                <Spinner v-if="isCanceling(order, cancelingOrderKey)" size="sm" />
                <Ban v-else class="h-3.5 w-3.5" aria-hidden="true" />
                {{ isCanceling(order, cancelingOrderKey) ? '取消中' : '取消' }}
              </button>
            </span>
          </div>
        </div>
        <div v-else-if="dataLoading" :class="[ui.muted, ui.emptyState]">
          <Spinner />
        </div>
        <p v-else :class="[ui.muted, ui.emptyState]">
          {{
            orderHistoryLoaded
              ? orderHistoryNotice
                ? `SBI SDK は取引履歴なしを返しました (${orderHistoryNotice})`
                : '該当する取引履歴はありません'
              : '取引履歴はまだ取得されていません'
          }}
        </p>
      </div>
    </article>
  </section>

  <AnimatePresence>
    <UiModal
      v-if="cancelCandidate"
      key="portfolio-cancel-order-dialog"
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
