<script setup lang="ts">
import { computed, ref } from 'vue'
import { arc, pie } from 'd3'
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

type AssetSlice = {
  id: string
  label: string
  value: number
  color: string
  profileId: string
}

const profileColors = ['#c29a62', '#9d8cac', '#9fac8d', '#b77f6b', '#aa8999']
const profileSlices = computed<AssetSlice[]>(() =>
  [
    {
      id: 'sbi',
      profileId: 'sbi',
      label: 'SBI証券',
      value: props.holdingsMarketValue + props.buyingPower,
      color: '#817f9f',
    },
    ...props.otherAssetBreakdown.map((item, index) => ({
      id: item.profileId,
      profileId: item.profileId,
      label: item.label,
      value: item.value,
      color: profileColors[index % profileColors.length] ?? '#9aa0a9',
    })),
  ].filter((item) => item.value > 0),
)

const detailSlices = computed<AssetSlice[]>(() => {
  const sbi = profileSlices.value.find((item) => item.id === 'sbi')
  const details: AssetSlice[] = []
  if (props.holdingsMarketValue > 0 && sbi) {
    details.push({
      id: 'sbi-stocks',
      profileId: 'sbi',
      label: '株式',
      value: props.holdingsMarketValue,
      color: '#91a9c7',
    })
  }
  if (props.buyingPower > 0 && sbi) {
    details.push({
      id: 'sbi-cash',
      profileId: 'sbi',
      label: '余力',
      value: props.buyingPower,
      color: '#c58468',
    })
  }
  details.push(
    ...profileSlices.value
      .filter((item) => item.id !== 'sbi')
      .map((item) => ({ ...item, id: `${item.id}-balance`, label: '残高' })),
  )
  return details
})

const sectorPath = (
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
) =>
  arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(innerRadius)
    .outerRadius(outerRadius)
    .cornerRadius(0)
    .padAngle(0.012)({ startAngle, endAngle }) ?? ''

const hoveredProfileId = ref<string | null>(null)
const chartArcs = computed(() => {
  const profiles = pie<AssetSlice>()
    .sort(null)
    .value((item) => item.value)(profileSlices.value)

  return profiles.flatMap((profileArc) => {
    const profile = profileArc.data
    const details = detailSlices.value.filter((detail) => detail.profileId === profile.profileId)
    const isExpanded = profile.profileId === hoveredProfileId.value && details.length > 1
    if (!isExpanded) {
      return [
        {
          ...profile,
          expanded: false,
          path: sectorPath(profileArc.startAngle, profileArc.endAngle, 103, 136),
        },
      ]
    }

    const anglePerValue = (profileArc.endAngle - profileArc.startAngle) / profile.value
    let detailStart = profileArc.startAngle
    const expandedDetails = details.map((detail) => {
      const detailEnd = detailStart + detail.value * anglePerValue
      const result = {
        ...detail,
        expanded: true,
        path: sectorPath(detailStart, detailEnd, 136, 169),
      }
      detailStart = detailEnd
      return result
    })
    return [
      {
        ...profile,
        expanded: false,
        path: sectorPath(profileArc.startAngle, profileArc.endAngle, 103, 136),
      },
      ...expandedDetails,
    ]
  })
})
const sliceRatio = (value: number) =>
  props.totalAssetValue > 0 ? (value / props.totalAssetValue) * 100 : 0

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
const hoveredAsset = ref<AssetSlice | null>(null)
const isAssetDetailCollapsing = ref(false)
let assetDetailCollapseTimer: ReturnType<typeof setTimeout> | undefined
const showAssetDetail = (item: AssetSlice) => {
  if (assetDetailCollapseTimer) clearTimeout(assetDetailCollapseTimer)
  isAssetDetailCollapsing.value = false
  hoveredAsset.value = item
  hoveredProfileId.value = item.profileId
}
const clearAssetDetail = () => {
  hoveredAsset.value = null
  if (!hoveredProfileId.value) return
  isAssetDetailCollapsing.value = true
  assetDetailCollapseTimer = setTimeout(() => {
    hoveredProfileId.value = null
    isAssetDetailCollapsing.value = false
    assetDetailCollapseTimer = undefined
  }, 220)
}
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
      <div :class="ui.assetBreakdownPanel">
        <span :class="ui.assetBreakdownTitle">内訳</span>
        <div class="relative mx-auto aspect-square w-full max-w-[19rem]">
          <svg
            viewBox="0 0 300 300"
            class="h-full w-full overflow-visible"
            role="img"
            aria-label="資産構成の円グラフ"
            @mouseleave="clearAssetDetail"
          >
            <g transform="translate(150 150)">
              <g
                v-for="item in chartArcs"
                :key="item.id"
                class="asset-slice"
                :class="[
                  hoveredAsset && hoveredAsset.profileId !== item.profileId
                    ? 'opacity-45'
                    : 'opacity-100',
                  hoveredAsset?.id === item.id ? 'asset-slice-hovered' : '',
                ]"
                @mouseenter="showAssetDetail(item)"
              >
                <path
                  :d="item.path"
                  :fill="item.color"
                  class="cursor-pointer"
                  :class="
                    item.expanded
                      ? isAssetDetailCollapsing
                        ? 'asset-detail-collapse'
                        : 'asset-detail-expand'
                      : ''
                  "
                >
                  <title>
                    {{ item.label }}: {{ currency(item.value) }} ({{
                      sliceRatio(item.value).toFixed(1)
                    }}%)
                  </title>
                </path>
              </g>
            </g>
          </svg>
          <div
            class="pointer-events-none absolute inset-0 grid place-content-center justify-items-center gap-1 text-center"
          >
            <span :class="ui.metricLabel">{{ hoveredAsset?.label ?? '総資産' }}</span>
            <strong class="text-xl font-black text-[#e3e3e9] sm:text-2xl">
              <template v-if="!showPortfolioSpinner">{{
                currency(hoveredAsset?.value ?? totalAssetValue)
              }}</template>
              <Spinner v-else size="lg" />
            </strong>
            <small
              :class="hoveredAsset ? ui.muted : totalProfitLoss >= 0 ? ui.positive : ui.negative"
            >
              <template v-if="!showPortfolioSpinner">{{
                hoveredAsset
                  ? `${sliceRatio(hoveredAsset.value).toFixed(1)}%`
                  : signedPercent(totalProfitLossRate)
              }}</template>
            </small>
          </div>
        </div>
      </div>
      <div :class="ui.assetBreakdownPanel">
        <span :class="ui.assetBreakdownTitle">内訳</span>
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

<style scoped>
@keyframes asset-detail-expand {
  from {
    opacity: 0;
    transform: scale(0.805);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes asset-detail-collapse {
  from {
    opacity: 1;
    transform: scale(1);
  }

  to {
    opacity: 0;
    transform: scale(0.805);
  }
}

.asset-detail-expand {
  transform-origin: 0 0;
  animation: asset-detail-expand 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}

.asset-detail-collapse {
  transform-origin: 0 0;
  animation: asset-detail-collapse 220ms cubic-bezier(0.4, 0, 0.8, 0.2) both;
}

.asset-slice {
  transform-origin: 0 0;
  transition:
    transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 150ms ease;
}

.asset-slice-hovered {
  transform: scale(1.035);
}

@media (prefers-reduced-motion: reduce) {
  .asset-detail-expand,
  .asset-detail-collapse {
    animation: none;
  }

  .asset-slice {
    transition: none;
  }
}
</style>
