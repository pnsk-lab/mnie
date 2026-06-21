<script setup lang="ts">
import { computed, ref } from 'vue'
import { AnimatePresence } from 'motion-v'
import {
  ArrowLeft,
  Ban,
  FileText,
  Pencil,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-vue-next'
import Spinner from '../../components/ui/Spinner.vue'
import UiButton from '../../components/ui/UiButton.vue'
import UiModal from '../../components/ui/UiModal.vue'
import { ui } from '../../styles/ui'
import type { OrderDetail, OrderPreview, OrderRow, TradeRecordRow } from '../../types/trading'
import { currencyForMarket } from '../../utils/format'
import { orderAmountText, orderHistoryKey, orderQuantityText } from '../trading/trading-data'

const props = defineProps<{
  orders: OrderRow[]
  connected: boolean
  dataLoading: boolean
  cancelingOrderKey: string
  orderHistoryLoaded: boolean
  orderHistoryNotice: string
  loadOrderDetail: (order: OrderRow) => Promise<OrderDetail>
  loadTradeRecords: () => Promise<TradeRecordRow[]>
  estimateOrderCorrection: (
    order: OrderRow,
    draft: { quantity: number; priceCondition: 'market' | 'limit'; price?: number },
  ) => Promise<OrderPreview>
  placeOrderCorrection: (
    order: OrderRow,
    draft: { quantity: number; priceCondition: 'market' | 'limit'; price?: number },
  ) => Promise<void>
}>()

const emit = defineEmits<{
  refresh: []
  cancel: [order: OrderRow]
}>()

const cancelCandidate = ref<OrderRow | null>(null)
const usMarkets = new Set(['XNAS', 'XNYS', 'ARCX'])
const isUsMarket = (market: string) => usMarkets.has(market)
const canCancel = (order: OrderRow) =>
  order.status === '注文中' && Boolean(order.orderNumber) && order.cancelable !== false
const canShowUsDetail = (order: OrderRow) => isUsMarket(order.market)
const canCorrect = (order: OrderRow) =>
  order.status === '注文中' &&
  Boolean(order.orderNumber) &&
  isUsMarket(order.market) &&
  order.correctable !== false
const isCanceling = (order: OrderRow, cancelingOrderKey: string) =>
  orderHistoryKey(order) === cancelingOrderKey
const cancelTitle = computed(() => cancelCandidate.value?.stock ?? '')
const orderDetail = ref<OrderDetail | null>(null)
const orderDetailLoadingKey = ref('')
const orderActionError = ref('')
const tradeRecords = ref<TradeRecordRow[]>([])
const showTradeRecords = ref(false)
const tradeRecordsLoading = ref(false)
const correctionCandidate = ref<OrderRow | null>(null)
const correctionQuantityInput = ref('')
const correctionPriceCondition = ref<'market' | 'limit'>('limit')
const correctionPriceInput = ref('')
const correctionPreview = ref<OrderPreview | null>(null)
const correctionLoading = ref(false)
const correctionSubmitting = ref(false)

const orderActionKey = (order: OrderRow) => orderHistoryKey(order)
const numericInput = (value: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
const correctionDraft = () => {
  const quantity = numericInput(correctionQuantityInput.value)
  if (!quantity || quantity <= 0) throw new Error('数量を入力してください')
  if (correctionPriceCondition.value === 'market') {
    return { quantity, priceCondition: 'market' as const }
  }
  const price = numericInput(correctionPriceInput.value)
  if (!price || price <= 0) throw new Error('指値を入力してください')
  return { quantity, priceCondition: 'limit' as const, price }
}
const priceText = (value: number | null | undefined, market: string) =>
  value == null ? '-' : currencyForMarket(value, market)
const tradeAmountText = (record: TradeRecordRow) =>
  record.amount == null ? '-' : currencyForMarket(record.amount, record.market)

const askCancel = (order: OrderRow) => {
  if (!canCancel(order)) return
  cancelCandidate.value = order
}

const confirmCancel = () => {
  if (!cancelCandidate.value) return
  emit('cancel', cancelCandidate.value)
  cancelCandidate.value = null
}

const showOrderDetail = async (order: OrderRow) => {
  if (!canShowUsDetail(order) || orderDetailLoadingKey.value) return
  orderActionError.value = ''
  orderDetailLoadingKey.value = orderActionKey(order)
  try {
    orderDetail.value = await props.loadOrderDetail(order)
  } catch (cause) {
    orderActionError.value = cause instanceof Error ? cause.message : '注文詳細の取得に失敗しました'
  } finally {
    orderDetailLoadingKey.value = ''
  }
}

const loadTradeRecords = async () => {
  if (tradeRecordsLoading.value) return
  orderActionError.value = ''
  tradeRecordsLoading.value = true
  try {
    tradeRecords.value = await props.loadTradeRecords()
    showTradeRecords.value = true
  } catch (cause) {
    orderActionError.value = cause instanceof Error ? cause.message : '約定履歴の取得に失敗しました'
  } finally {
    tradeRecordsLoading.value = false
  }
}

const askCorrection = (order: OrderRow) => {
  if (!canCorrect(order)) return
  correctionCandidate.value = order
  correctionQuantityInput.value = String(order.unexecutedQuantity ?? order.quantity ?? '')
  correctionPriceCondition.value = order.price == null ? 'market' : 'limit'
  correctionPriceInput.value = order.price == null ? '' : String(order.price)
  correctionPreview.value = null
  orderActionError.value = ''
}

const estimateCorrection = async () => {
  if (!correctionCandidate.value || correctionLoading.value) return
  orderActionError.value = ''
  correctionLoading.value = true
  try {
    correctionPreview.value = await props.estimateOrderCorrection(
      correctionCandidate.value,
      correctionDraft(),
    )
  } catch (cause) {
    orderActionError.value = cause instanceof Error ? cause.message : '注文訂正の見積に失敗しました'
  } finally {
    correctionLoading.value = false
  }
}

const confirmCorrection = async () => {
  if (!correctionCandidate.value || correctionSubmitting.value) return
  orderActionError.value = ''
  correctionSubmitting.value = true
  try {
    await props.placeOrderCorrection(correctionCandidate.value, correctionDraft())
    correctionCandidate.value = null
    correctionPreview.value = null
  } catch (cause) {
    orderActionError.value = cause instanceof Error ? cause.message : '注文訂正に失敗しました'
  } finally {
    correctionSubmitting.value = false
  }
}
</script>

<template>
  <section :class="ui.panel">
    <div :class="ui.panelHead">
      <h2>取引履歴</h2>
      <span :class="ui.rowActions">
        <button
          :class="ui.ghostButton"
          type="button"
          :disabled="!connected || tradeRecordsLoading"
          @click="loadTradeRecords"
        >
          <Spinner v-if="tradeRecordsLoading" size="sm" />
          <ReceiptText v-else class="h-4 w-4" aria-hidden="true" />
          約定履歴
        </button>
        <button
          :class="ui.ghostButton"
          type="button"
          :disabled="!connected || dataLoading"
          @click="emit('refresh')"
        >
          <RefreshCw class="h-4 w-4" aria-hidden="true" />
          更新
        </button>
      </span>
    </div>
    <p v-if="orderActionError" :class="ui.dialogNote">{{ orderActionError }}</p>
    <div :class="ui.list">
      <div v-for="order in orders" :key="order.id" :class="ui.orderRow">
        <span>
          <strong>{{ order.stock }}</strong>
          <small>{{ order.code }} / {{ order.market }} / {{ order.date }}</small>
        </span>
        <span :class="order.side === 'buy' ? ui.positive : ui.negative">
          {{ order.side === 'buy' ? '購入' : '売却' }}
        </span>
        <span>{{ orderQuantityText(order) }}</span>
        <span>{{ orderAmountText(order) }}</span>
        <span :class="[ui.statusBadge, order.status === '注文中' && ui.pendingBadge]">
          {{ order.status }}
        </span>
        <span :class="ui.rowActions">
          <button
            v-if="canShowUsDetail(order)"
            :class="ui.ghostButton"
            class="min-h-8 px-3 text-xs"
            type="button"
            :disabled="Boolean(orderDetailLoadingKey)"
            @click="showOrderDetail(order)"
          >
            <Spinner v-if="orderDetailLoadingKey === orderActionKey(order)" size="sm" />
            <FileText v-else class="h-3.5 w-3.5" aria-hidden="true" />
            詳細
          </button>
          <button
            v-if="canCorrect(order)"
            :class="ui.ghostButton"
            class="min-h-8 px-3 text-xs"
            type="button"
            :disabled="Boolean(cancelingOrderKey)"
            @click="askCorrection(order)"
          >
            <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
            訂正
          </button>
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
      <div v-if="dataLoading && !orders.length" :class="[ui.muted, 'grid py-8 place-items-center']">
        <Spinner />
      </div>
      <p v-else-if="!orders.length" :class="[ui.muted, 'py-8 text-center']">
        {{
          orderHistoryLoaded
            ? orderHistoryNotice
              ? `SBI SDK は取引履歴なしを返しました (${orderHistoryNotice})`
              : '該当する注文履歴はありません'
            : '注文履歴はまだ取得されていません'
        }}
      </p>
    </div>
  </section>

  <AnimatePresence>
    <UiModal
      v-if="orderDetail"
      key="order-detail-dialog"
      eyebrow="注文詳細"
      :title="orderDetail.stock"
      @close="orderDetail = null"
    >
      <dl :class="ui.confirmList">
        <div :class="ui.confirmRow">
          <dt>注文番号</dt>
          <dd>{{ orderDetail.orderNumber ?? '-' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>枝番</dt>
          <dd>{{ orderDetail.orderSubNo ?? '-' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>銘柄</dt>
          <dd>{{ orderDetail.code }} / {{ orderDetail.market }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>売買</dt>
          <dd>{{ orderDetail.side === 'buy' ? '購入' : '売却' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>数量</dt>
          <dd>{{ orderQuantityText(orderDetail) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>未約定数量</dt>
          <dd>{{ orderDetail.unexecutedQuantity ?? '-' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>価格</dt>
          <dd>{{ priceText(orderDetail.price, orderDetail.market) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>状態</dt>
          <dd>{{ orderDetail.statusText ?? orderDetail.status }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>有効期限</dt>
          <dd>{{ orderDetail.expiresAt ?? '-' }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>取消/訂正</dt>
          <dd>
            {{ orderDetail.cancelable === false ? '取消不可' : '取消可' }} /
            {{ orderDetail.correctable === false ? '訂正不可' : '訂正可' }}
          </dd>
        </div>
      </dl>
      <div :class="ui.actions">
        <UiButton variant="ghost" @click="orderDetail = null">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          閉じる
        </UiButton>
      </div>
    </UiModal>
  </AnimatePresence>

  <AnimatePresence>
    <UiModal
      v-if="showTradeRecords"
      key="trade-records-dialog"
      eyebrow="約定履歴"
      title="米国株"
      @close="showTradeRecords = false"
    >
      <div v-if="tradeRecords.length" :class="ui.confirmList">
        <div v-for="record in tradeRecords" :key="record.id" :class="ui.row">
          <span class="grid gap-1">
            <strong>{{ record.stock }}</strong>
            <small>{{ record.code }} / {{ record.market }} / {{ record.type }}</small>
            <small :class="ui.muted">
              {{ record.tradeDate ?? '-' }} 約定 / {{ record.valueDate ?? '-' }} 受渡
            </small>
          </span>
          <span class="grid justify-items-end gap-1 text-right">
            <strong>{{ tradeAmountText(record) }}</strong>
            <small :class="ui.muted">
              {{ record.quantity ?? '-' }}株 @ {{ priceText(record.price, record.market) }}
            </small>
          </span>
        </div>
      </div>
      <p v-else :class="ui.dialogNote">該当する約定履歴はありません</p>
      <div :class="ui.actions">
        <UiButton variant="ghost" @click="showTradeRecords = false">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          閉じる
        </UiButton>
      </div>
    </UiModal>
  </AnimatePresence>

  <AnimatePresence>
    <UiModal
      v-if="correctionCandidate"
      key="correction-dialog"
      eyebrow="注文訂正"
      :title="correctionCandidate.stock"
      @close="correctionCandidate = null"
    >
      <dl :class="ui.confirmList">
        <div :class="ui.confirmRow">
          <dt>注文番号</dt>
          <dd>{{ correctionCandidate.orderNumber }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>現在数量</dt>
          <dd>{{ orderQuantityText(correctionCandidate) }}</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>現在価格</dt>
          <dd>{{ priceText(correctionCandidate.price, correctionCandidate.market) }}</dd>
        </div>
      </dl>
      <div class="grid gap-3">
        <label :class="ui.label">
          数量
          <input
            v-model="correctionQuantityInput"
            :class="ui.input"
            inputmode="decimal"
            @input="correctionPreview = null"
          />
        </label>
        <label :class="ui.label">
          執行条件
          <select
            v-model="correctionPriceCondition"
            :class="ui.input"
            @change="correctionPreview = null"
          >
            <option value="limit">指値</option>
            <option value="market">成行</option>
          </select>
        </label>
        <label v-if="correctionPriceCondition === 'limit'" :class="ui.label">
          指値
          <input
            v-model="correctionPriceInput"
            :class="ui.input"
            inputmode="decimal"
            @input="correctionPreview = null"
          />
        </label>
      </div>
      <dl v-if="correctionPreview" :class="ui.confirmList">
        <div :class="ui.confirmRow">
          <dt>見積数量</dt>
          <dd>{{ correctionPreview.quantity }}株</dd>
        </div>
        <div :class="ui.confirmRow">
          <dt>見積金額</dt>
          <dd>
            {{
              correctionPreview.price
                ? priceText(correctionPreview.price.value, correctionCandidate.market)
                : '-'
            }}
          </dd>
        </div>
      </dl>
      <div :class="ui.actions">
        <UiButton variant="ghost" @click="correctionCandidate = null">
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
          戻る
        </UiButton>
        <UiButton :disabled="correctionLoading" @click="estimateCorrection">
          <Spinner v-if="correctionLoading" size="sm" />
          <ShieldCheck v-else class="h-4 w-4" aria-hidden="true" />
          見積
        </UiButton>
        <UiButton
          variant="danger"
          :disabled="!correctionPreview || correctionSubmitting"
          @click="confirmCorrection"
        >
          <Spinner v-if="correctionSubmitting" size="sm" />
          <Pencil v-else class="h-4 w-4" aria-hidden="true" />
          訂正
        </UiButton>
      </div>
    </UiModal>
  </AnimatePresence>

  <AnimatePresence>
    <UiModal
      v-if="cancelCandidate"
      key="cancel-order-dialog"
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
