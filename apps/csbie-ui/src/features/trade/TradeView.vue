<script setup lang="ts">
import { ChevronDown, Download, FileCheck2, Search, ShieldCheck } from 'lucide-vue-next'
import { AnimatePresence, LayoutGroup, motion } from 'motion-v'
import { computed, ref } from 'vue'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiField from '../../components/ui/UiField.vue'
import UiSegmented from '../../components/ui/UiSegmented.vue'
import {
  cashOrderAccountTypeOptions,
  cashOrderMarketOptions,
  cashOrderMethodOptions,
  cashOrderPriceConditionOptions,
  cashOrderTermOptions,
  cashOrderTriggerZoneOptions,
  orderKindOptions,
  sKabuOrderMarketOptions,
  tradeSideOptions,
} from '../../constants/trade'
import { ui } from '../../styles/ui'
import type {
  ChartMode,
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
import { currency } from '../../utils/format'
import RealtimePriceChart from './RealtimePriceChart.vue'

type StockInfoTab = 'detail' | 'holding'

defineProps<{
  viewedStocks: Stock[]
  selectedStock: Stock
  selectedPosition?: Position
  connected: boolean
  orderQuantity: number
  estimatedAmount: number
  canRequestCashEstimate: boolean
  canPlaceCashOrder: boolean
  realtimePricePoints: RealtimePricePoint[]
  pricePolling: boolean
  boxPlotStyle: {
    min: string
    q1: string
    median: string
    q3: string
    max: string
  }
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
const activeStockInfoTab = ref<StockInfoTab>('detail')
const advancedOptionsOpen = ref(false)
const orderMarketOptions = computed(() =>
  orderKind.value === 's' ? sKabuOrderMarketOptions : cashOrderMarketOptions,
)
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
const tabTransition = { type: 'spring', damping: 28, stiffness: 360 } as const
const tabContentTransition = { duration: 0.18, ease: 'easeOut' } as const
const advancedTransition = { duration: 0.18, ease: 'easeOut' } as const

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
            <template v-if="hasQuote(stock)">{{ currency(stock.price) }}</template>
            <Spinner v-else size="sm" />
          </strong>
          <small v-if="hasQuote(stock)" :class="stock.change >= 0 ? ui.positive : ui.negative">
            {{ stock.change >= 0 ? '+' : '' }}{{ stock.change }}%
          </small>
          <Spinner v-else size="sm" />
        </span>
      </button>
      <p v-if="!viewedStocks.length" :class="[ui.muted, 'p-5 text-sm']">
        SBIに接続するか検索すると銘柄を表示します
      </p>
    </article>

    <div :class="ui.centerStack">
      <article :class="ui.stockPanel">
        <div :class="ui.stockTitle">
          <div>
            <p :class="ui.eyebrow">{{ selectedStock.symbol }}</p>
            <h2>{{ selectedStock.name }}</h2>
          </div>
          <div :class="ui.quoteBox">
            <strong>
              <template v-if="hasQuote(selectedStock)">{{
                currency(selectedStock.price)
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

        <div :class="ui.periodTabs">
          <button :class="[ui.periodButton, ui.periodButtonActive]" type="button">1D</button>
          <button :class="ui.periodButton" type="button">1W</button>
          <button :class="ui.periodButton" type="button">1M</button>
        </div>

        <div :class="ui.chartActions">
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
          <button :class="ui.ghostButton" type="button" @click="emit('downloadCsv')">
            <Download class="h-4 w-4" aria-hidden="true" />
            CSV
          </button>
        </div>

        <div v-if="chartMode === 'line'" :class="ui.chartBox">
          <RealtimePriceChart
            v-if="hasQuote(selectedStock)"
            :points="realtimePricePoints"
            :stock-name="selectedStock.name"
            :active="pricePolling"
          />
          <span v-else class="grid h-full place-items-center text-[#8f949d]">
            <Spinner />
          </span>
        </div>
        <div v-else :class="ui.boxplot">
          <div :class="ui.boxplotScale">
            <span>
              <template v-if="hasQuote(selectedStock)">{{
                currency(selectedStock.box.min)
              }}</template>
              <Spinner v-else size="sm" />
            </span>
            <span>
              <template v-if="hasQuote(selectedStock)">{{
                currency(selectedStock.box.max)
              }}</template>
              <Spinner v-else size="sm" />
            </span>
          </div>
          <div v-if="hasQuote(selectedStock)" :class="ui.boxplotTrack">
            <i
              :class="ui.whisker"
              :style="{
                left: boxPlotStyle.min,
                width: `calc(${boxPlotStyle.max} - ${boxPlotStyle.min})`,
              }"
            ></i>
            <i
              :class="ui.box"
              :style="{
                left: boxPlotStyle.q1,
                width: `calc(${boxPlotStyle.q3} - ${boxPlotStyle.q1})`,
              }"
            ></i>
            <i :class="ui.median" :style="{ left: boxPlotStyle.median }"></i>
          </div>
          <div v-else class="grid min-h-20 place-items-center text-[#8f949d]">
            <Spinner />
          </div>
        </div>
      </article>

      <LayoutGroup id="stock-info-tabs">
        <article :class="ui.infoTabPanel">
          <div :class="ui.infoTabList" role="tablist" aria-label="銘柄別情報">
            <button
              id="stock-detail-tab"
              :class="[ui.infoTabButton, activeStockInfoTab === 'detail' && ui.infoTabButtonActive]"
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
            <AnimatePresence mode="wait" :initial="false">
              <motion.dl
                v-if="activeStockInfoTab === 'detail'"
                id="stock-detail-panel"
                key="detail"
                :class="ui.detailGrid"
                role="tabpanel"
                aria-labelledby="stock-detail-tab"
                :initial="{ opacity: 0, y: 8 }"
                :animate="{ opacity: 1, y: 0 }"
                :exit="{ opacity: 0, y: -8 }"
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
                      currency(selectedStock.open)
                    }}</template>
                    <Spinner v-else size="sm" />
                  </dd>
                </div>
                <div :class="ui.detailItem">
                  <dt class="text-xs text-[#9aa0a9]">高値</dt>
                  <dd class="font-bold">
                    <template v-if="hasQuote(selectedStock)">{{
                      currency(selectedStock.high)
                    }}</template>
                    <Spinner v-else size="sm" />
                  </dd>
                </div>
                <div :class="ui.detailItem">
                  <dt class="text-xs text-[#9aa0a9]">安値</dt>
                  <dd class="font-bold">
                    <template v-if="hasQuote(selectedStock)">{{
                      currency(selectedStock.low)
                    }}</template>
                    <Spinner v-else size="sm" />
                  </dd>
                </div>
              </motion.dl>

              <motion.div
                v-else
                id="stock-holding-panel"
                key="holding"
                role="tabpanel"
                aria-labelledby="stock-holding-tab"
                :initial="{ opacity: 0, y: 8 }"
                :animate="{ opacity: 1, y: 0 }"
                :exit="{ opacity: 0, y: -8 }"
                :transition="tabContentTransition"
              >
                <div v-if="selectedPosition" :class="ui.holdingNote">
                  保有 {{ selectedPosition.quantity }}株 / 平均
                  {{ currency(selectedPosition.avgPrice) }}
                </div>
                <p v-else :class="ui.holdingEmpty">保有なし</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </article>
      </LayoutGroup>
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
            <details
              :class="ui.advancedOptions"
              @toggle="advancedOptionsOpen = ($event.target as HTMLDetailsElement).open"
            >
              <summary :class="ui.advancedSummary">
                <span>Advanced Options</span>
                <motion.span
                  :class="ui.advancedSummaryIconWrap"
                  :animate="{ rotate: advancedOptionsOpen ? 180 : 0 }"
                  :transition="advancedTransition"
                >
                  <ChevronDown :class="ui.advancedSummaryIcon" aria-hidden="true" />
                </motion.span>
              </summary>
              <motion.div
                :class="ui.advancedBody"
                :initial="{ opacity: 0, y: -4 }"
                :animate="{ opacity: 1, y: 0 }"
                :transition="advancedTransition"
              >
                <span :class="ui.advancedLabel">預り区分</span>
                <UiSegmented
                  v-model="cashOrderAccountType"
                  :options="cashOrderAccountTypeOptions"
                />
                <UiField
                  v-model="cashOrderMarket"
                  as="select"
                  label="注文市場"
                  :disabled="orderKind === 's'"
                >
                  <option
                    v-for="option in orderMarketOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </UiField>
                <template v-if="orderKind !== 's'">
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
                    v-if="cashOrderTerm === 'date'"
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
                      placeholder="価格を入力"
                    />
                  </template>
                </template>
              </motion.div>
            </details>
          </div>
        </div>
      </div>
      <div :class="ui.ticketBottom">
        <div :class="ui.estimateSummary">
          <span>概算金額</span>
          <strong>{{ currency(estimatedAmount) }}</strong>
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
  </section>
</template>
