<script setup lang="ts">
import {
  ChevronDown,
  Download,
  FileCheck2,
  Minus,
  TriangleAlert,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-vue-next'
import { AnimatePresence, LayoutGroup, motion } from 'motion-v'
import { computed, ref } from 'vue'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiField from '../../components/ui/UiField.vue'
import UiSegmented from '../../components/ui/UiSegmented.vue'
import {
  cashOrderMethodOptions,
  cashOrderPriceConditionOptions,
  cashOrderTriggerZoneOptions,
  orderKindOptions,
  tradeSideOptions,
} from '../../constants/trade'
import { ui } from '../../styles/ui'
import { uiMotion } from '../../constants/motion'
import type {
  ChartMode,
  ChartNotice,
  ChartRange,
  CashOrderAccountType,
  CashOrderMarket,
  CashOrderMethod,
  CashOrderPriceCondition,
  CashOrderTerm,
  CashOrderTriggerZone,
  OrderKind,
  Position,
  RealtimePricePoint,
  Stock,
  TradeSide,
} from '../../types/trading'
import { currency, currencyForMarket } from '../../utils/format'
import RealtimePriceChart from './RealtimePriceChart.vue'

type StockInfoTab = 'detail' | 'holding'
interface CashOrderAccountTypeOption {
  label: string
  value: CashOrderAccountType
}
interface CashOrderMarketOption {
  label: string
  value: CashOrderMarket
}
interface CashOrderTermOption {
  label: string
  value: CashOrderTerm
}
interface CashOrderDateOption {
  label: string
  value: string
}

const chartRangeOptions: ChartRange[] = ['1D', '3D', '3M', '1Y', 'ALL']

defineProps<{
  viewedStocks: Stock[]
  selectedStock: Stock
  selectedPosition?: Position
  connected: boolean
  orderQuantity: number
  estimatedAmount: number
  cashOrderAccountTypeOptions: CashOrderAccountTypeOption[]
  cashOrderMarketOptions: CashOrderMarketOption[]
  cashOrderTermOptions: CashOrderTermOption[]
  cashOrderDateOptions: CashOrderDateOption[]
  cashOrderPriceStep: number
  canRequestCashEstimate: boolean
  canPlaceCashOrder: boolean
  realtimePricePoints: RealtimePricePoint[]
  chartNotice: ChartNotice | null
  pricePolling: boolean
  hasQuote: (stock: Stock) => boolean
}>()

const tradeSide = defineModel<TradeSide>('tradeSide', { required: true })
const orderKind = defineModel<OrderKind>('orderKind', { required: true })
const cashOrderAccountType = defineModel<CashOrderAccountType>('cashOrderAccountType', {
  required: true,
})
const cashOrderMarket = defineModel<CashOrderMarket>('cashOrderMarket', {
  required: true,
})
const cashOrderPriceCondition = defineModel<CashOrderPriceCondition>('cashOrderPriceCondition', {
  required: true,
})
const cashOrderTerm = defineModel<CashOrderTerm>('cashOrderTerm', { required: true })
const cashOrderDateInput = defineModel<string>('cashOrderDateInput', { required: true })
const cashOrderMethod = defineModel<CashOrderMethod>('cashOrderMethod', { required: true })
const cashOrderTriggerZone = defineModel<CashOrderTriggerZone>('cashOrderTriggerZone', {
  required: true,
})
const cashOrderTriggerPriceInput = defineModel<string>('cashOrderTriggerPriceInput', {
  required: true,
})
const cashOrderSecondaryPriceCondition = defineModel<CashOrderPriceCondition>(
  'cashOrderSecondaryPriceCondition',
  {
    required: true,
  },
)
const cashOrderSecondaryPriceInput = defineModel<string>('cashOrderSecondaryPriceInput', {
  required: true,
})
const quantityInput = defineModel<string>('quantityInput', { required: true })
const priceInput = defineModel<string>('priceInput', { required: true })
const chartMode = defineModel<ChartMode>('chartMode', { required: true })
const chartRange = defineModel<ChartRange>('chartRange', { required: true })
const activeStockInfoTab = ref<StockInfoTab>('detail')
const advancedOptionsOpen = ref(false)
const priceChart = ref<InstanceType<typeof RealtimePriceChart> | null>(null)
const primaryPriceConditionRequiresPrice = computed(() =>
  ['limit', 'limitAtOpen', 'limitAtClose', 'limitIoc', 'funari'].includes(
    cashOrderPriceCondition.value,
  ),
)
const secondaryPriceConditionRequiresPrice = computed(() =>
  ['limit', 'limitAtOpen', 'limitAtClose', 'limitIoc', 'funari'].includes(
    cashOrderSecondaryPriceCondition.value,
  ),
)
const tabTransition = uiMotion.trade.tabIndicator
const tabContentTransition = uiMotion.trade.tabContentFade
const advancedTransition = uiMotion.trade.advancedOptions

const emit = defineEmits<{
  openSearch: []
  selectStock: [stock: Stock]
  downloadCsv: []
  estimate: []
  confirmOrder: []
}>()
</script>

<template>
  <section :class="ui.tradeLayout">
    <div :class="ui.centerStack">
      <article :class="ui.stockMetadataPanel">
        <div :class="ui.stockTitle">
          <div>
            <p :class="ui.eyebrow">{{ selectedStock.symbol }}</p>
            <h2>{{ selectedStock.name }}</h2>
          </div>
          <div :class="ui.quoteBox">
            <strong>
              <template v-if="hasQuote(selectedStock)">{{
                currencyForMarket(selectedStock.price, selectedStock.market)
              }}</template>
              <Spinner v-else size="sm" />
            </strong>
            <small
              v-if="hasQuote(selectedStock)"
              :class="selectedStock.change >= 0 ? ui.positive : ui.negative"
            >
              {{ selectedStock.change >= 0 ? '+' : '' }}{{ selectedStock.change }}%
            </small>
            <Spinner v-else size="sm" />
          </div>
        </div>
      </article>

      <div :class="ui.stockBodyGrid">
        <article :class="[ui.stockPanel, ui.stockPanelSpan]">
          <div :class="ui.periodTabs">
            <button
              v-for="range in chartRangeOptions"
              :key="range"
              :class="[ui.periodButton, chartRange === range && ui.periodButtonActive]"
              type="button"
              :aria-pressed="chartRange === range"
              @click="chartRange = range"
            >
              {{ range }}
            </button>
          </div>

          <div :class="ui.chartActions">
            <div class="flex items-center gap-2">
              <div :class="ui.smallTabs">
                <button
                  :class="[ui.smallTab, chartMode === 'line' && ui.smallTabActive]"
                  type="button"
                  @click="chartMode = 'line'"
                >
                  推移
                </button>
                <button
                  :class="[ui.smallTab, chartMode === 'box' && ui.smallTabActive]"
                  type="button"
                  @click="chartMode = 'box'"
                >
                  箱ひげ
                </button>
              </div>
              <div class="flex items-center gap-1">
                <button
                  class="grid h-8 w-8 place-items-center rounded-md border border-[#2d3440] text-[#d3e3fd] transition hover:bg-[#1d232b] disabled:opacity-40"
                  type="button"
                  aria-label="縮小"
                  :disabled="!hasQuote(selectedStock)"
                  @click="priceChart?.zoomOut()"
                >
                  <Minus class="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  class="grid h-8 w-8 place-items-center rounded-md border border-[#2d3440] text-[#d3e3fd] transition hover:bg-[#1d232b] disabled:opacity-40"
                  type="button"
                  aria-label="拡大"
                  :disabled="!hasQuote(selectedStock)"
                  @click="priceChart?.zoomIn()"
                >
                  <Plus class="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  class="grid h-8 w-8 place-items-center rounded-md border border-[#2d3440] text-[#8f949d] transition hover:bg-[#1d232b] hover:text-[#d3e3fd] disabled:opacity-40"
                  type="button"
                  aria-label="縮尺を戻す"
                  :disabled="!hasQuote(selectedStock)"
                  @click="priceChart?.resetZoom()"
                >
                  <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <button :class="ui.ghostButton" type="button" @click="emit('downloadCsv')">
              <Download class="h-4 w-4" aria-hidden="true" />
              CSV
            </button>
          </div>

          <div :class="[ui.chartBox, 'overflow-visible']">
            <RealtimePriceChart
              v-if="hasQuote(selectedStock) || realtimePricePoints.length > 0 || chartNotice"
              ref="priceChart"
              :points="realtimePricePoints"
              :stock-name="selectedStock.name"
              :active="pricePolling"
              :mode="chartMode"
              :range="chartRange"
              :market="selectedStock.market"
              :previous-close="selectedStock.prevClose"
              :notice="chartNotice"
            />
            <span v-else class="grid h-full place-items-center text-[#8f949d]">
              <Spinner />
            </span>

            <div
              v-if="chartNotice"
              class="mt-2 flex items-start gap-1.5 px-3 pb-2 text-xs text-[#8f949d]"
            >
              <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-[#6f7783]" />
              <span>
                <span class="font-medium text-[#9aa0a9]">{{ chartNotice.title }}</span>
                <span v-if="chartNotice.detail" class="ml-1">{{ chartNotice.detail }}</span>
              </span>
            </div>
          </div>
        </article>

        <LayoutGroup id="stock-info-tabs">
          <article :class="ui.infoTabPanel">
            <div :class="ui.infoTabList" role="tablist" aria-label="銘柄別情報">
              <button
                id="stock-detail-tab"
                :class="[
                  ui.infoTabButton,
                  activeStockInfoTab === 'detail' && ui.infoTabButtonActive,
                ]"
                type="button"
                role="tab"
                :aria-selected="activeStockInfoTab === 'detail'"
                aria-controls="stock-detail-panel"
                @click="activeStockInfoTab = 'detail'"
              >
                詳細
                <motion.span
                  v-if="activeStockInfoTab === 'detail'"
                  layout-id="stock-info-tab-indicator"
                  :class="ui.infoTabIndicator"
                  :transition="tabTransition"
                />
              </button>
              <button
                id="stock-holding-tab"
                :class="[
                  ui.infoTabButton,
                  activeStockInfoTab === 'holding' && ui.infoTabButtonActive,
                ]"
                type="button"
                role="tab"
                :aria-selected="activeStockInfoTab === 'holding'"
                aria-controls="stock-holding-panel"
                @click="activeStockInfoTab = 'holding'"
              >
                保有
                <motion.span
                  v-if="activeStockInfoTab === 'holding'"
                  layout-id="stock-info-tab-indicator"
                  :class="ui.infoTabIndicator"
                  :transition="tabTransition"
                />
              </button>
            </div>

            <div :class="ui.infoTabBody">
              <div :class="ui.infoTabBodyInner">
                <motion.dl
                  v-show="activeStockInfoTab === 'detail'"
                  id="stock-detail-panel"
                  key="detail"
                  :class="ui.detailGrid"
                  role="tabpanel"
                  aria-labelledby="stock-detail-tab"
                  :initial="{ opacity: 0 }"
                  :animate="{ opacity: activeStockInfoTab === 'detail' ? 1 : 0 }"
                  :transition="tabContentTransition"
                >
                  <div :class="ui.detailItem">
                    <dt class="text-xs text-[#9aa0a9]">国</dt>
                    <dd class="font-bold">{{ selectedStock.country }}</dd>
                  </div>
                  <div :class="ui.detailItem">
                    <dt class="text-xs text-[#9aa0a9]">市場</dt>
                    <dd class="font-bold">{{ selectedStock.market }}</dd>
                  </div>
                  <div :class="ui.detailItem">
                    <dt class="text-xs text-[#9aa0a9]">業種</dt>
                    <dd class="font-bold">{{ selectedStock.sector }}</dd>
                  </div>
                  <div :class="ui.detailItem">
                    <dt class="text-xs text-[#9aa0a9]">始値</dt>
                    <dd class="font-bold">
                      <template v-if="hasQuote(selectedStock)">{{
                        currencyForMarket(selectedStock.open, selectedStock.market)
                      }}</template>
                      <Spinner v-else size="sm" />
                    </dd>
                  </div>
                  <div :class="ui.detailItem">
                    <dt class="text-xs text-[#9aa0a9]">高値</dt>
                    <dd class="font-bold">
                      <template v-if="hasQuote(selectedStock)">{{
                        currencyForMarket(selectedStock.high, selectedStock.market)
                      }}</template>
                      <Spinner v-else size="sm" />
                    </dd>
                  </div>
                  <div :class="ui.detailItem">
                    <dt class="text-xs text-[#9aa0a9]">安値</dt>
                    <dd class="font-bold">
                      <template v-if="hasQuote(selectedStock)">{{
                        currencyForMarket(selectedStock.low, selectedStock.market)
                      }}</template>
                      <Spinner v-else size="sm" />
                    </dd>
                  </div>
                </motion.dl>
                <motion.div
                  v-show="activeStockInfoTab === 'holding'"
                  id="stock-holding-panel"
                  key="holding"
                  role="tabpanel"
                  aria-labelledby="stock-holding-tab"
                  :initial="{ opacity: 0 }"
                  :animate="{ opacity: activeStockInfoTab === 'holding' ? 1 : 0 }"
                  :transition="tabContentTransition"
                >
                  <div v-if="selectedPosition" :class="ui.holdingNote">
                    保有 {{ selectedPosition.quantity }}株 / 平均
                    {{ currencyForMarket(selectedPosition.avgPrice, selectedPosition.market) }}
                  </div>
                  <p v-else :class="ui.holdingEmpty">保有なし</p>
                </motion.div>
              </div>
            </div>
          </article>
        </LayoutGroup>
      </div>
    </div>

    <div :class="ui.tradeSeparator" aria-hidden="true"></div>

    <article :class="ui.ticketPanel">
      <div :class="ui.ticketTop">
        <UiSegmented v-model="tradeSide" :options="tradeSideOptions" />
      </div>
      <div :class="ui.ticketScroll">
        <div :class="ui.ticketScrollInner">
          <UiSegmented v-model="orderKind" :options="orderKindOptions" />
          <div :class="ui.ticketBox">
            <UiField
              v-model="quantityInput"
              label="発注株数"
              type="number"
              min="1"
              placeholder="株数を入力"
            />
            <section :class="ui.advancedOptions">
              <button
                type="button"
                :class="ui.advancedSummary"
                :aria-expanded="advancedOptionsOpen"
                @click="advancedOptionsOpen = !advancedOptionsOpen"
              >
                <span>Advanced Options</span>
                <motion.span
                  :class="ui.advancedSummaryIconWrap"
                  :animate="{ rotate: advancedOptionsOpen ? 180 : 0 }"
                  :transition="advancedTransition"
                >
                  <ChevronDown :class="ui.advancedSummaryIcon" aria-hidden="true" />
                </motion.span>
              </button>
              <AnimatePresence>
                <motion.div
                  v-if="advancedOptionsOpen"
                  key="advanced-options"
                  :class="ui.advancedBody"
                  :initial="{ opacity: 0, height: 0, y: -4 }"
                  :animate="{ opacity: 1, height: 'auto', y: 0 }"
                  :exit="{ opacity: 0, height: 0, y: -4 }"
                  :transition="advancedTransition"
                >
                  <span :class="ui.advancedLabel">預り区分</span>
                  <LayoutGroup id="cash-order-account-type">
                    <div :class="ui.accountTypeGrid" role="radiogroup" aria-label="預り区分">
                      <button
                        v-for="option in cashOrderAccountTypeOptions"
                        :key="option.value"
                        type="button"
                        role="radio"
                        :aria-checked="cashOrderAccountType === option.value"
                        :class="[
                          ui.accountTypeButton,
                          cashOrderAccountType === option.value && ui.accountTypeButtonActive,
                        ]"
                        @click="cashOrderAccountType = option.value"
                      >
                        <motion.span
                          v-if="cashOrderAccountType === option.value"
                          layout-id="cash-order-account-type-indicator"
                          :class="ui.accountTypeIndicator"
                          :transition="tabTransition"
                        />
                        <span :class="ui.accountTypeText">{{ option.label }}</span>
                      </button>
                    </div>
                  </LayoutGroup>
                  <UiField v-model="cashOrderMarket" as="select" label="注文市場">
                    <option
                      v-for="option in cashOrderMarketOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </UiField>
                  <template>
                    <UiField v-model="cashOrderPriceCondition" as="select" label="執行条件">
                      <option
                        v-for="option in cashOrderPriceConditionOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </UiField>
                    <UiField
                      v-if="primaryPriceConditionRequiresPrice"
                      v-model="priceInput"
                      label="注文価格"
                      type="number"
                      min="1"
                      :step="cashOrderPriceStep"
                      placeholder="価格を入力"
                    />
                    <UiField v-model="cashOrderTerm" as="select" label="有効期限">
                      <option
                        v-for="option in cashOrderTermOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </UiField>
                    <UiField
                      v-if="cashOrderTerm === 'date' && cashOrderDateOptions.length"
                      v-model="cashOrderDateInput"
                      as="select"
                      label="指定日"
                    >
                      <option
                        v-for="option in cashOrderDateOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </UiField>
                    <UiField
                      v-else-if="cashOrderTerm === 'date'"
                      v-model="cashOrderDateInput"
                      label="指定日"
                      type="date"
                    />
                    <UiField v-model="cashOrderMethod" as="select" label="特殊注文">
                      <option
                        v-for="option in cashOrderMethodOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </UiField>
                    <template v-if="cashOrderMethod !== 'normal'">
                      <UiField v-model="cashOrderTriggerZone" as="select" label="逆指値条件">
                        <option
                          v-for="option in cashOrderTriggerZoneOptions"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </UiField>
                      <UiField
                        v-model="cashOrderTriggerPriceInput"
                        label="逆指値価格"
                        type="number"
                        min="1"
                        :step="cashOrderPriceStep"
                        placeholder="価格を入力"
                      />
                    </template>
                    <template v-if="cashOrderMethod === 'oco'">
                      <UiField
                        v-model="cashOrderSecondaryPriceCondition"
                        as="select"
                        label="OCO執行条件"
                      >
                        <option
                          v-for="option in cashOrderPriceConditionOptions"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </UiField>
                      <UiField
                        v-if="secondaryPriceConditionRequiresPrice"
                        v-model="cashOrderSecondaryPriceInput"
                        label="OCO価格"
                        type="number"
                        min="1"
                        :step="cashOrderPriceStep"
                        placeholder="価格を入力"
                      />
                    </template>
                  </template>
                </motion.div>
              </AnimatePresence>
            </section>
          </div>
        </div>
      </div>
      <div :class="ui.ticketBottom">
        <div :class="ui.estimateSummary">
          <span>概算金額</span>
          <strong>{{ currencyForMarket(estimatedAmount, selectedStock.market) }}</strong>
        </div>
        <div :class="ui.actions">
          <UiButton type="button" :disabled="!canRequestCashEstimate" @click="emit('estimate')">
            <FileCheck2 class="h-4 w-4" aria-hidden="true" />
            見積
          </UiButton>
          <UiButton
            variant="danger"
            type="button"
            :disabled="!canPlaceCashOrder"
            @click="emit('confirmOrder')"
          >
            <ShieldCheck class="h-4 w-4" aria-hidden="true" />
            注文確認
          </UiButton>
        </div>
      </div>
    </article>

    <article :class="ui.watchlist">
      <button :class="ui.watchSearch" type="button" @click="emit('openSearch')">
        <Search class="h-4 w-4" aria-hidden="true" />
        Search
      </button>
      <button
        v-for="stock in viewedStocks"
        :key="stock.code"
        :class="[ui.watchRow, selectedStock.code === stock.code && ui.watchRowActive]"
        type="button"
        :aria-current="selectedStock.code === stock.code ? 'true' : undefined"
        @click="emit('selectStock', stock)"
      >
        <span class="grid gap-1">
          <strong>{{ stock.name }}</strong>
          <small>{{ stock.symbol }}</small>
        </span>
        <span class="grid justify-items-end gap-1">
          <strong>
            <template v-if="hasQuote(stock)">{{
              currencyForMarket(stock.price, stock.market)
            }}</template>
            <Spinner v-else size="sm" />
          </strong>
          <small v-if="hasQuote(stock)" :class="stock.change >= 0 ? ui.positive : ui.negative">
            {{ stock.change >= 0 ? '+' : '' }}{{ stock.change }}%
          </small>
          <Spinner v-else size="sm" />
        </span>
      </button>
      <p v-if="!viewedStocks.length" :class="[ui.muted, 'p-5 text-sm']">
        対応する証券口座に接続するか検索すると銘柄を表示します
      </p>
    </article>
  </section>
</template>
