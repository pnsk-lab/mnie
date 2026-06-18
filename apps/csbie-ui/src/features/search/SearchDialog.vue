<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { motion } from 'motion-v'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiField from '../../components/ui/UiField.vue'
import searchEmptyImage from '../../assets/search-empty.png'
import { ui } from '../../styles/ui'
import type { Stock } from '../../types/trading'
import { currency } from '../../utils/format'

const overlayTransition = { duration: 0.2, ease: 'easeOut' } as const
const sheetTransition = { type: 'spring', damping: 28, stiffness: 320 } as const

defineProps<{
  stocks: Stock[]
  selectedStockCode: string
  countries: string[]
  markets: string[]
  loading?: boolean
}>()

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
              :class="[ui.searchResult, selectedStockCode === stock.code && ui.searchResultActive]"
              type="button"
              :aria-current="selectedStockCode === stock.code ? 'true' : undefined"
              @click="emit('select', stock)"
            >
              <span class="grid gap-1">
                <strong>{{ stock.name }}</strong>
                <small>{{ stock.code }} / {{ stock.country }} / {{ stock.market }}</small>
              </span>
              <span>
                <template v-if="stock.price > 0">{{ currency(stock.price) }}</template>
                <Spinner v-else size="sm" />
              </span>
            </button>
          </template>
        </template>
      </div>
    </motion.section>
  </motion.div>
</template>
