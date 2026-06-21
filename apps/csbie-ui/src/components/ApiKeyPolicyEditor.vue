<script setup lang="ts">
import type { ApiKeySettings } from '../api'

defineProps<{
  compact?: boolean
  permissionsOpen?: boolean
}>()

const settings = defineModel<ApiKeySettings>({ required: true })

const rpcMethods = [
  'session.profile',
  'account.profile',
  'account.assets.current',
  'account.power.buyingPower',
  'account.power.collateralRatio',
  'account.positions.cash',
  'account.positions.cashDetail',
  'account.positions.cashForIssue',
  'account.positions.margin',
  'account.positions.marginDetail',
  'account.positions.marginForIssue',
  'account.positions.marginSummaryForIssue',
  'account.positions.marginDetailsForIssue',
  'account.positions.closeableMargin',
  'account.positions.deliverableMargin',
  'account.profitLoss.unrealized',
  'market.issue.search',
  'market.issue.suggest',
  'market.issue.allowedPrices',
  'market.issue.board',
  'market.issue.chart',
  'market.issue.openOrders',
  'market.issue.tradingInfo',
  'market.index.major',
  'market.overview',
  'market.ranking.market',
  'market.ranking.sector',
  'market.ranking.sbi',
  'news.list',
  'watchlist.list',
  'orders.inquiry.detail',
  'orders.inquiry.executionsToday',
  'orders.inquiry.open',
  'orders.inquiry.tradeRecords',
  'orders.cash.estimate',
  'orders.cash.place',
  'orders.cash.estimateCorrection',
  'orders.cash.estimateCorrectionConfirm',
  'orders.cash.placeCorrection',
  'orders.cash.estimateCancel',
  'orders.cash.placeCancel',
  'orders.margin.estimateOpen',
  'orders.margin.open',
  'orders.margin.estimateClose',
  'orders.margin.close',
  'orders.margin.estimateCloseSummary',
  'orders.margin.closeSummary',
  'orders.margin.estimateSummary',
  'orders.margin.placeSummary',
  'orders.margin.estimateActualDelivery',
  'orders.margin.actualDelivery',
  'orders.ifd.estimate',
  'orders.ifd.place',
  'orders.ifd.estimateCorrection',
  'orders.ifd.placeCorrection',
  'orders.ifd.estimateCancel',
  'orders.ifd.placeCancel',
  'orders.themeInvestment.list',
  'orders.themeInvestment.estimate',
  'orders.themeInvestment.place',
  'orders.exchange.rate',
  'orders.exchange.estimate',
  'orders.exchange.place',
] as const

const tradingMethods = [
  'orders.cash.place',
  'orders.cash.placeCorrection',
  'orders.cash.placeCancel',
  'orders.margin.open',
  'orders.margin.close',
  'orders.margin.closeSummary',
  'orders.margin.placeSummary',
  'orders.margin.actualDelivery',
  'orders.ifd.place',
  'orders.ifd.placeCorrection',
  'orders.ifd.placeCancel',
  'orders.themeInvestment.place',
  'orders.exchange.place',
] as const

const tradingMethodSet = new Set<string>(tradingMethods)
const readMethods = rpcMethods.filter((method) => !tradingMethodSet.has(method))

const setMethods = (methods: readonly string[] | null) => {
  settings.value.allowedMethods = methods ? [...methods] : null
}

const toggleMethod = (method: string) => {
  const current = settings.value.allowedMethods ?? [...rpcMethods]
  settings.value.allowedMethods = current.includes(method)
    ? current.filter((candidate) => candidate !== method)
    : [...current, method].sort()
}

const methodAllowed = (method: string) => {
  return settings.value.allowedMethods == null || settings.value.allowedMethods.includes(method)
}

const ui = {
  root: 'grid gap-3',
  limitGrid: 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3',
  limitGridCompact: 'xl:grid-cols-5',
  label: 'grid gap-2 text-xs font-extrabold text-[#9aa0a9]',
  input:
    'min-h-12 w-full rounded-[16px] border border-[#4a5058] bg-[#111418] px-4 text-[#e3e3e9] outline-none transition focus:border-[#a8c7fa]',
  permissions: 'border-t border-[#33383f] pt-3',
  summary: 'cursor-pointer font-black text-[#e3e3e9]',
  actions: 'mt-3 flex flex-wrap gap-2',
  button:
    'min-h-9 rounded-full bg-[#263141] px-4 text-sm font-extrabold text-[#d3e3fd] transition hover:bg-[#303b4d]',
  methodGrid: 'mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2',
  methodToggle:
    'flex min-h-10 items-center gap-2 rounded-[16px] bg-[#111418] p-3 text-xs text-[#c3c7cf]',
  checkbox: 'h-4 min-h-4 w-4',
}
</script>

<template>
  <div :class="ui.root">
    <div :class="[ui.limitGrid, compact && ui.limitGridCompact]">
      <label :class="ui.label">
        1時間 取引上限
        <input v-model.number="settings.maxTradesPerHour" :class="ui.input" type="number" min="0" />
      </label>
      <label :class="ui.label">
        6時間 取引上限
        <input
          v-model.number="settings.maxTradesPer6Hours"
          :class="ui.input"
          type="number"
          min="0"
        />
      </label>
      <label :class="ui.label">
        1日 取引上限
        <input v-model.number="settings.maxTradesPerDay" :class="ui.input" type="number" min="0" />
      </label>
      <label :class="ui.label">
        1注文 最大価格
        <input v-model.number="settings.maxOrderPriceJpy" :class="ui.input" type="number" min="0" />
      </label>
      <label :class="ui.label">
        1注文 最大取引価格
        <input
          v-model.number="settings.maxOrderAmountJpy"
          :class="ui.input"
          type="number"
          min="0"
        />
      </label>
    </div>

    <details :class="ui.permissions" :open="permissionsOpen">
      <summary :class="ui.summary">
        権限:
        {{
          settings.allowedMethods == null ? 'すべて' : `${settings.allowedMethods.length} methods`
        }}
      </summary>
      <div :class="ui.actions">
        <button :class="ui.button" type="button" @click="setMethods(null)">すべて</button>
        <button :class="ui.button" type="button" @click="setMethods(readMethods)">参照のみ</button>
        <button :class="ui.button" type="button" @click="setMethods(tradingMethods)">
          取引のみ
        </button>
      </div>
      <div :class="ui.methodGrid">
        <label v-for="method in rpcMethods" :key="method" :class="ui.methodToggle">
          <input
            :class="ui.checkbox"
            type="checkbox"
            :checked="methodAllowed(method)"
            @change="toggleMethod(method)"
          />
          <span>{{ method }}</span>
        </label>
      </div>
    </details>
  </div>
</template>
