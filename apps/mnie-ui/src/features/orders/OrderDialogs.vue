<script setup lang="ts">
import { ArrowLeft, Send, ShieldCheck } from 'lucide-vue-next'
import { AnimatePresence } from 'motion-v'
import UiButton from '../../components/ui/UiButton.vue'
import UiModal from '../../components/ui/UiModal.vue'
import { ui } from '../../styles/ui'
import type {
  CashOrderAccountType,
  CashOrderMarket,
  CashOrderMethod,
  CashOrderPriceCondition,
  CashOrderTerm,
  CashOrderTriggerZone,
  OrderKind,
  OrderPreview,
  TradeSide,
} from '../../types/trading'
import { currencyForMarket } from '../../utils/format'

defineProps<{
  estimate: OrderPreview | null
  showEstimate: boolean
  showOrder: boolean
  stockName: string
  stockMarket: string
  side: TradeSide
  kind: OrderKind
  accountType: CashOrderAccountType
  market: CashOrderMarket
  priceCondition: CashOrderPriceCondition
  price: number
  orderTerm: CashOrderTerm
  orderDate: string
  orderMethod: CashOrderMethod
  triggerZone: CashOrderTriggerZone
  triggerPrice: number
  secondaryPriceCondition: CashOrderPriceCondition
  secondaryPrice: number
  quantity: number
  amount: number
}>()

const emit = defineEmits<{
  closeEstimate: []
  proceed: []
  closeOrder: []
  place: []
}>()

const priceConditionLabel = (condition: CashOrderPriceCondition) =>
  ({
    limit: '指値',
    limitAtOpen: '寄指',
    limitAtClose: '引指',
    limitIoc: 'IOC指',
    market: '成行',
    marketAtOpen: '寄成',
    marketAtClose: '引成',
    marketIoc: 'IOC成',
    funari: '不成',
  })[condition]

const orderTermLabel = (term: CashOrderTerm, date: string) =>
  term === 'day' ? '当日中' : term === 'week' ? '今週中' : date

const orderMethodLabel = (method: CashOrderMethod) =>
  method === 'normal' ? '通常' : method === 'stop' ? '逆指値' : 'OCO'

const triggerZoneLabel = (zone: CashOrderTriggerZone) => (zone === 'above' ? '以上' : '以下')

const accountTypeLabel = (type: CashOrderAccountType) =>
  ({
    specific: '特定',
    general: '一般',
    growthInvestment: 'NISA成長投資枠',
    nisa: 'NISA',
  })[type]
</script>

<template>
  <AnimatePresence>
    <UiModal
      v-if="showEstimate && estimate"
      key="estimate-dialog"
      eyebrow="見積"
      :title="stockName"
    >
      <dl :class="ui.confirmList">
        <div :class="ui.confirmRow">
          <dt>売買</dt>
          <dd>{{ side === 'buy' ? '購入' : '売却' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>数量</dt>
          <dd>{{ quantity }}株</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>預り区分</dt>
          <dd>{{ accountTypeLabel(accountType) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>注文市場</dt>
          <dd>{{ market === 'auto' ? '自動' : market }}</dd>
        </div>
        <template>
          <div :class="ui.confirmRow">
            <dt>執行条件</dt>
            <dd>{{ priceConditionLabel(priceCondition) }}</dd>
          </div>
          <div v-if="price > 0" :class="ui.confirmRow">
            <dt>注文価格</dt>
            <dd>{{ currencyForMarket(price, stockMarket) }}</dd>
          </div>
          <div :class="ui.confirmRow">
            <dt>有効期限</dt>
            <dd>{{ orderTermLabel(orderTerm, orderDate) }}</dd>
          </div>
          <div :class="ui.confirmRow">
            <dt>特殊注文</dt>
            <dd>{{ orderMethodLabel(orderMethod) }}</dd>
          </div>
          <div v-if="orderMethod !== 'normal'" :class="ui.confirmRow">
            <dt>逆指値</dt>
            <dd>
              {{ currencyForMarket(triggerPrice, stockMarket) }} {{ triggerZoneLabel(triggerZone) }}
            </dd>
          </div>
          <div v-if="orderMethod === 'oco'" :class="ui.confirmRow">
            <dt>OCO条件</dt>
            <dd>
              {{ priceConditionLabel(secondaryPriceCondition) }}
              <template v-if="secondaryPrice > 0">
                {{ currencyForMarket(secondaryPrice, stockMarket) }}</template
              >
            </dd>
          </div>
        </template>
        <div :class="ui.confirmRow">
          <dt>概算</dt>
          <dd>{{ currencyForMarket(amount, stockMarket) }}</dd>
        </div>
      </dl>
      <p :class="ui.dialogNote">
        {{ estimate.message ?? estimate.warnings.join(' ') }}
      </p>
      <div :class="ui.actions">
        <UiButton variant="ghost" @click="emit('closeEstimate')">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          戻る
        </UiButton>
        <UiButton @click="emit('proceed')">
          <ShieldCheck class="h-4 w-4" aria-hidden="true" />
          注文確認へ
        </UiButton>
      </div>
    </UiModal>
  </AnimatePresence>

  <AnimatePresence>
    <UiModal v-if="showOrder" key="order-dialog" eyebrow="注文確認" :title="stockName">
      <dl :class="ui.confirmList">
        <div :class="ui.confirmRow">
          <dt>区分</dt>
          <dd>通常単元</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>売買</dt>
          <dd>{{ side === 'buy' ? '購入' : '売却' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>数量</dt>
          <dd>{{ quantity }}株</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>預り区分</dt>
          <dd>{{ accountTypeLabel(accountType) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>注文市場</dt>
          <dd>{{ market === 'auto' ? '自動' : market }}</dd>
        </div>
        <template>
          <div :class="ui.confirmRow">
            <dt>執行条件</dt>
            <dd>{{ priceConditionLabel(priceCondition) }}</dd>
          </div>
          <div v-if="price > 0" :class="ui.confirmRow">
            <dt>注文価格</dt>
            <dd>{{ currencyForMarket(price, stockMarket) }}</dd>
          </div>
          <div :class="ui.confirmRow">
            <dt>有効期限</dt>
            <dd>{{ orderTermLabel(orderTerm, orderDate) }}</dd>
          </div>
          <div :class="ui.confirmRow">
            <dt>特殊注文</dt>
            <dd>{{ orderMethodLabel(orderMethod) }}</dd>
          </div>
          <div v-if="orderMethod !== 'normal'" :class="ui.confirmRow">
            <dt>逆指値</dt>
            <dd>
              {{ currencyForMarket(triggerPrice, stockMarket) }} {{ triggerZoneLabel(triggerZone) }}
            </dd>
          </div>
          <div v-if="orderMethod === 'oco'" :class="ui.confirmRow">
            <dt>OCO条件</dt>
            <dd>
              {{ priceConditionLabel(secondaryPriceCondition) }}
              <template v-if="secondaryPrice > 0">
                {{ currencyForMarket(secondaryPrice, stockMarket) }}</template
              >
            </dd>
          </div>
        </template>
        <div :class="ui.confirmRow">
          <dt>概算</dt>
          <dd>{{ currencyForMarket(amount, stockMarket) }}</dd>
        </div>
      </dl>
      <div :class="ui.actions">
        <UiButton variant="ghost" @click="emit('closeOrder')">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          戻る
        </UiButton>
        <UiButton variant="danger" @click="emit('place')">
          <Send class="h-4 w-4" aria-hidden="true" />
          発注
        </UiButton>
      </div>
    </UiModal>
  </AnimatePresence>
</template>
