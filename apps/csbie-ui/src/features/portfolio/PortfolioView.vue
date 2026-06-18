<script setup lang="ts">
import { Plug } from 'lucide-vue-next'
import Spinner from '../../components/ui/Spinner.vue'
import { ui } from '../../styles/ui'
import type { OrderRow, Position } from '../../types/trading'
import { currency, signedCurrency, signedPercent } from '../../utils/format'
import { orderAmountText, orderQuantityText } from '../trading/trading-data'

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
  dataLoading: boolean
  connected: boolean
  orderHistoryLoaded: boolean
  orderHistoryNotice: string
}>()

const emit = defineEmits<{
  connect: []
  openPosition: [code: string]
}>()
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
            <span :class="ui.muted">{{ currency(position.marketValue) }}</span>
            <span
              class="grid justify-items-end gap-0.5"
              :class="position.profitLoss >= 0 ? ui.positive : ui.negative"
            >
              <strong>{{ signedCurrency(position.profitLoss) }}</strong>
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
                >{{ order.side === 'buy' ? '買付' : '売却' }}({{
                  order.kind === 's' ? 'S株' : '単元'
                }}) ・ {{ orderQuantityText(order) }}</small
              >
            </span>
            <span class="grid justify-items-end gap-1">
              <small>{{ order.date.slice(5, 10) }}</small>
              <strong>{{ orderAmountText(order) }}</strong>
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
</template>
