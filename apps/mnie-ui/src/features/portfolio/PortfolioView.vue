<script setup lang="ts">
import { computed, ref } from 'vue'
import { AnimatePresence } from 'motion-v'
import { ArrowLeft, Ban, FileText, Plug } from 'lucide-vue-next'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiModal from '../../components/ui/UiModal.vue'
import { ui } from '../../styles/ui'
import type { MarketIndex, OrderRow, Position } from '../../types/trading'
import {
  currency,
  currencyForMarket,
  number as formatNumber,
  signedCurrency,
  signedCurrencyForMarket,
  signedPercent,
} from '../../utils/format'
import { orderAmountText, orderHistoryKey, orderQuantityText } from '../trading/trading-data'

const props = defineProps<{
  showPortfolioSpinner: boolean
  totalAssetValue: number
  buyingPower: number
  holdingsMarketValue: number
  totalProfitLoss: number
  totalProfitLossRate: number
  marketIndexes: MarketIndex[]
  stockAssetRatio: number
  cashAssetRatio: number
  otherAssetBreakdown: Array<{
    profileId: string
    label: string
    provider: string
    value: number
    ratio: number
  }>
  positions: Position[]
  recentOrders: OrderRow[]
  cancelingOrderKey: string
  dataLoading: boolean
  connected: boolean
  orderHistoryLoaded: boolean
  orderHistoryNotice: string
  loadPositionDetail: (position: Position) => Promise<Position>
}>()

const emit = defineEmits<{
  connect: []
  openPosition: [code: string]
  cancelOrder: [order: OrderRow]
}>()

const usMarkets = new Set(['XNAS', 'XNYS', 'ARCX'])
const isUsMarket = (market: string) => usMarkets.has(market)
const canCancel = (order: OrderRow) =>
  order.status === '注文中' && Boolean(order.orderNumber) && order.cancelable !== false
const isCanceling = (order: OrderRow, cancelingOrderKey: string) =>
  orderHistoryKey(order) === cancelingOrderKey
const cancelCandidate = ref<OrderRow | null>(null)
const positionDetail = ref<Position | null>(null)
const positionDetailLoadingKey = ref('')
const positionDetailError = ref('')
const cancelTitle = computed(() => cancelCandidate.value?.stock ?? '')
const indexValueText = (index: MarketIndex) =>
  index.valueText || (index.value == null ? '-' : formatNumber(index.value))
const indexChangeText = (index: MarketIndex) => {
  const change = index.changeText || (index.change == null ? '' : formatNumber(index.change))
  const rate =
    index.changeRateText || (index.changeRate == null ? '' : signedPercent(index.changeRate))
  return [change, rate].filter(Boolean).join(' / ') || '-'
}
const indexTone = (index: MarketIndex) => {
  if (index.sign === 'positive') return ui.positive
  if (index.sign === 'negative') return ui.negative
  return ui.muted
}
const positionKey = (position: Position) =>
  [position.market, position.code, position.accountType].filter(Boolean).join(':')
const canLoadPositionDetail = (position: Position) => isUsMarket(position.market)

const showPositionDetail = async (position: Position) => {
  if (!canLoadPositionDetail(position) || positionDetailLoadingKey.value) return
  const key = positionKey(position)
  positionDetailLoadingKey.value = key
  positionDetailError.value = ''
  try {
    positionDetail.value = await props.loadPositionDetail(position)
  } catch (cause) {
    positionDetailError.value =
      cause instanceof Error ? cause.message : '保有詳細の取得に失敗しました'
  } finally {
    positionDetailLoadingKey.value = ''
  }
}

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
        <small :class="[ui.assetOverviewSubtext, totalProfitLoss >= 0 ? ui.positive : ui.negative]">
          通算評価損益:
          <template v-if="!showPortfolioSpinner">
            {{ signedCurrency(totalProfitLoss) }} · {{ signedPercent(totalProfitLossRate) }}
          </template>
          <Spinner v-else size="sm" />
        </small>
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
          <strong class="text-sm font-black text-[#e3e3e9]">SBI証券</strong>
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
          <div
            v-for="item in otherAssetBreakdown"
            :key="item.profileId"
            class="mt-2 grid gap-2 border-t border-[#33383f] pt-3"
          >
            <strong class="text-sm font-black text-[#e3e3e9]">{{ item.label }}</strong>
            <div :class="ui.assetBreakdownRow">
              <span :class="ui.assetBreakdownLabel">残高</span>
              <span :class="ui.assetBreakdownMeta">
                <strong :class="ui.assetBreakdownAmount">{{ currency(item.value) }}</strong>
                <small :class="ui.assetBreakdownRatio">{{ item.ratio.toFixed(1) }}%</small>
              </span>
            </div>
          </div>
        </div>
      </div>
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
          <span>操作</span>
        </div>
        <div v-if="positions.length" :class="ui.holdingsRows">
          <div v-for="position in positions" :key="positionKey(position)" :class="ui.holdingRow">
            <button
              class="grid gap-1 text-left text-[#e3e3e9]"
              type="button"
              @click="emit('openPosition', position.code)"
            >
              <strong>{{ position.name }}</strong>
              <small>{{ position.code }}</small>
            </button>
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
            <span :class="ui.rowActions">
              <button
                v-if="canLoadPositionDetail(position)"
                :class="ui.ghostButton"
                class="min-h-8 px-3 text-xs"
                type="button"
                :disabled="Boolean(positionDetailLoadingKey)"
                @click="showPositionDetail(position)"
              >
                <Spinner v-if="positionDetailLoadingKey === positionKey(position)" size="sm" />
                <FileText v-else class="h-3.5 w-3.5" aria-hidden="true" />
                詳細
              </button>
            </span>
          </div>
        </div>
        <div v-else-if="dataLoading" :class="[ui.muted, ui.emptyState]">
          <Spinner />
        </div>
        <p v-else :class="[ui.muted, ui.emptyState]">SBIに接続すると保有銘柄を表示します</p>
        <p v-if="positionDetailError" :class="ui.dialogNote">{{ positionDetailError }}</p>
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

    <article :class="ui.marketIndexPanel">
      <div :class="ui.panelHead">
        <h2>指数</h2>
      </div>
      <div v-if="marketIndexes.length" :class="ui.marketIndexGrid">
        <div
          v-for="index in marketIndexes"
          :key="index.code ?? index.name"
          :class="ui.marketIndexCard"
        >
          <span :class="ui.metricLabel">{{ index.name }}</span>
          <strong :class="ui.marketIndexValue">{{ indexValueText(index) }}</strong>
          <small :class="indexTone(index)">{{ indexChangeText(index) }}</small>
        </div>
      </div>
      <div v-else-if="dataLoading" :class="[ui.muted, ui.emptyState]">
        <Spinner />
      </div>
      <p v-else :class="[ui.muted, ui.emptyState]">SBIに接続すると指数を表示します</p>
    </article>
  </section>

  <AnimatePresence>
    <UiModal
      v-if="positionDetail"
      key="position-detail-dialog"
      eyebrow="保有詳細"
      :title="positionDetail.name"
      @close="positionDetail = null"
    >
      <dl :class="ui.confirmList">
        <div :class="ui.confirmRow">
          <dt>銘柄</dt>
          <dd>{{ positionDetail.code }} / {{ positionDetail.market }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>預り区分</dt>
          <dd>{{ positionDetail.type ?? positionDetail.accountType ?? '-' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>数量</dt>
          <dd>{{ positionDetail.quantity }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>現在値</dt>
          <dd>
            {{
              positionDetail.currentPrice == null
                ? '-'
                : currencyForMarket(positionDetail.currentPrice, positionDetail.market)
            }}
          </dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>平均取得単価</dt>
          <dd>{{ currencyForMarket(positionDetail.avgPrice, positionDetail.market) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>評価額</dt>
          <dd>{{ currencyForMarket(positionDetail.marketValue, positionDetail.market) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>評価損益</dt>
          <dd :class="positionDetail.profitLoss >= 0 ? ui.positive : ui.negative">
            {{ signedCurrencyForMarket(positionDetail.profitLoss, positionDetail.market) }} /
            {{ signedPercent(positionDetail.profitLossRate) }}
          </dd>
        </div>
      </dl>
      <div :class="ui.actions">
        <UiButton variant="ghost" @click="positionDetail = null">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          閉じる
        </UiButton>
      </div>
    </UiModal>
  </AnimatePresence>

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
