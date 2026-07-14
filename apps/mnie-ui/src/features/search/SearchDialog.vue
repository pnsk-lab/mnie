<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { type ComponentPublicInstance, nextTick, ref, watch } from 'vue'
import { motion } from 'motion-v'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiField from '../../components/ui/UiField.vue'
import searchEmptyImage from '../../assets/search-empty.png'
import { uiMotion } from '../../constants/motion'
import { ui } from '../../styles/ui'
import type { Stock } from '../../types/trading'
import { currencyForMarket } from '../../utils/format'

const overlayTransition = uiMotion.overlay.fadeDefault
const sheetTransition = uiMotion.trade.searchSheet

const props = defineProps<{
  stocks: Stock[]
  selectedStockCode: string
  countries: string[]
  markets: string[]
  loading?: boolean
  priceDataAvailable: boolean
}>()
const selectedButtonRefs = ref(new Map<string, Element | null>())
const setSelectedButtonRef =
  (code: string) => (element: Element | ComponentPublicInstance | null) => {
    if (element instanceof Element) {
      selectedButtonRefs.value.set(code, element)
    } else {
      selectedButtonRefs.value.delete(code)
    }
  }

const scrollToSelectedStock = async () => {
  await nextTick()
  const element = selectedButtonRefs.value.get(props.selectedStockCode)
  if (!(element instanceof HTMLButtonElement)) return
  element.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    behavior: 'smooth',
  })
}

watch(
  () => [props.stocks, props.selectedStockCode],
  () => {
    void scrollToSelectedStock()
  },
  { immediate: true },
)

const searchQuery = defineModel<string>('searchQuery', { required: true })
const countryFilter = defineModel<string>('countryFilter', { required: true })
const marketFilter = defineModel<string>('marketFilter', { required: true })

const emit = defineEmits<{
  close: []
  select: [stock: Stock]
}>()
</script>

<template>
  <motion.div
    :class="ui.searchOverlay"
    :initial="{ opacity: 0 }"
    :animate="{ opacity: 1 }"
    :exit="{ opacity: 0 }"
    :transition="overlayTransition"
    @click.self="emit('close')"
  >
    <motion.section
      :class="ui.searchSheet"
      role="dialog"
      aria-modal="true"
      aria-label="銘柄検索"
      :initial="{ opacity: 0, y: -20, scale: 0.98 }"
      :animate="{ opacity: 1, y: 0, scale: 1 }"
      :exit="{ opacity: 0, y: -16, scale: 0.98 }"
      :transition="sheetTransition"
    >
      <div :class="ui.searchInputRow">
        <UiField v-model="searchQuery" autofocus placeholder="銘柄名、コード、シンボル" />
        <UiButton variant="ghost" @click="emit('close')">
          <X class="h-4 w-4" aria-hidden="true" />
          閉じる
        </UiButton>
      </div>
      <div :class="ui.filterRow">
        <UiField v-model="countryFilter" as="select">
          <option value="all">すべての国</option>
          <option v-for="country in countries" :key="country" :value="country">
            {{ country }}
          </option>
        </UiField>
        <UiField v-model="marketFilter" as="select">
          <option value="all">すべての市場</option>
          <option v-for="marketName in markets" :key="marketName" :value="marketName">
            {{ marketName }}
          </option>
        </UiField>
      </div>
      <div :class="ui.searchResults">
        <div v-if="loading" :class="ui.searchLoading" role="status" aria-live="polite">
          <Spinner />
          <span>検索中...</span>
        </div>
        <template v-else>
          <div
            v-if="!stocks.length"
            :class="[ui.muted, 'grid justify-items-center gap-3 py-8 text-center']"
          >
            <img
              :src="searchEmptyImage"
              alt=""
              class="h-32 w-32 object-contain opacity-75"
              loading="lazy"
              aria-hidden="true"
            />
            <p>ありません</p>
          </div>
          <template v-else>
            <button
              v-for="stock in stocks"
              :key="stock.code"
              :ref="setSelectedButtonRef(stock.code)"
              :class="[
                ui.searchResult,
                selectedStockCode === stock.code && ui.searchResultActive,
                selectedStockCode === stock.code && ui.searchResultFocus,
              ]"
              type="button"
              :aria-current="selectedStockCode === stock.code ? 'true' : undefined"
              :aria-selected="selectedStockCode === stock.code"
              :tabindex="selectedStockCode === stock.code ? 0 : -1"
              @click="emit('select', stock)"
              @keyup.enter="emit('select', stock)"
            >
              <span class="grid gap-1">
                <strong>{{ stock.name }}</strong>
                <small>{{ stock.code }} / {{ stock.country }} / {{ stock.market }}</small>
              </span>
              <span>
                <template v-if="stock.price > 0">{{
                  currencyForMarket(stock.price, stock.market)
                }}</template>
                <Spinner v-else-if="priceDataAvailable" size="sm" />
                <span v-else :class="ui.muted">データなし</span>
              </span>
            </button>
          </template>
        </template>
      </div>
    </motion.section>
  </motion.div>
</template>
