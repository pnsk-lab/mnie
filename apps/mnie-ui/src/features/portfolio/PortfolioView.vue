<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { arc, area, extent, pie, scaleLinear, scaleTime } from 'd3'
import { AnimatePresence, motion } from 'motion-v'
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
import { defaultProviderColors } from '../../constants/provider'

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
  brokerageAssetBreakdown: Array<{
    id: string
    providerId: string
    label: string
    value: number
    holdingsValue: number
    cashValue: number
    color: string
  }>
  otherAssetBreakdown: Array<{
    profileId: string
    label: string
    provider: string
    value: number
    ratio: number
    color: string
  }>
  assetHistory: Array<{
    at: string
    profileId: string
    groupId: string
    label: string
    value: number
    color: string
  }>
  assetHistoryLoading: boolean
  positions: Position[]
  recentOrders: OrderRow[]
  cancelingOrderKey: string
  dataLoading: boolean
  connected: boolean
  orderHistoryLoaded: boolean
  orderHistoryNotice: string
  loadPositionDetail?: (position: Position) => Promise<Position>
}>()

const emit = defineEmits<{
  connect: []
  openPosition: [position: Position]
  cancelOrder: [order: OrderRow]
}>()

type AssetSlice = {
  id: string
  label: string
  value: number
  color: string
  profileId: string
  kind: 'brokerage' | 'balance'
  holdingsValue?: number
  cashValue?: number
}

const profileColors = ['#c29a62', '#9d8cac', '#9fac8d', '#b77f6b', '#aa8999']
const historyProfileColor = (color: string | undefined, index: number) =>
  color || (profileColors[index % profileColors.length] ?? '#9aa0a9')
const profileSlices = computed<AssetSlice[]>(() =>
  [
    ...props.brokerageAssetBreakdown.map((item) => ({
      id: item.id,
      profileId: item.id,
      label: item.label,
      value: item.value,
      color: item.color,
      kind: 'brokerage' as const,
      holdingsValue: item.holdingsValue,
      cashValue: item.cashValue,
    })),
    ...props.otherAssetBreakdown.map((item, index) => ({
      id: item.profileId,
      profileId: item.profileId,
      label: item.label,
      value: item.value,
      color:
        item.color ||
        defaultProviderColors[item.provider as keyof typeof defaultProviderColors] ||
        profileColors[index % profileColors.length] ||
        '#9aa0a9',
      kind: 'balance' as const,
    })),
  ].filter((item) => item.value > 0),
)

const detailSlices = computed<AssetSlice[]>(() => {
  return profileSlices.value.flatMap((item): AssetSlice[] => {
    if (item.kind === 'balance') {
      return [{ ...item, id: `${item.id}-balance`, label: '残高' }]
    }
    const details: AssetSlice[] = []
    if ((item.holdingsValue ?? 0) > 0) {
      details.push({
        id: `${item.profileId}-stocks`,
        profileId: item.profileId,
        label: '株式',
        value: item.holdingsValue ?? 0,
        color: '#91a9c7',
        kind: 'brokerage',
      })
    }
    if ((item.cashValue ?? 0) > 0) {
      details.push({
        id: `${item.profileId}-cash`,
        profileId: item.profileId,
        label: '余力',
        value: item.cashValue ?? 0,
        color: '#c58468',
        kind: 'brokerage',
      })
    }
    return details
  })
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

const historySvg = ref<SVGSVGElement | null>(null)
const historyViewWidth = ref(380)
const historyViewHeight = ref(190)
const historyChartBottom = computed(() => historyViewHeight.value - 24)
const historyZoomRange = ref<{ start: number; end: number } | null>(null)
let historyResizeObserver: ResizeObserver | undefined
onMounted(() => {
  historyResizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.height <= 0) return
    historyViewWidth.value = entry.contentRect.width
    historyViewHeight.value = entry.contentRect.height
  })
  if (historySvg.value) historyResizeObserver.observe(historySvg.value)
})
watch(historySvg, (svg) => {
  if (svg && historyResizeObserver) historyResizeObserver.observe(svg)
})
watch(
  () => props.assetHistory,
  () => {
    historyZoomRange.value = null
  },
  { deep: true },
)
onBeforeUnmount(() => historyResizeObserver?.disconnect())

const historyChart = computed(() => {
  const events = props.assetHistory
    .map((item) => ({ ...item, date: new Date(item.at) }))
    .filter((item) => Number.isFinite(item.date.getTime()) && Number.isFinite(item.value))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const sources = new Map(
    events.map((item) => [item.profileId, [item.groupId, item.label, item.color] as const]),
  )
  const providers = [
    ...new Map(events.map((item) => [item.groupId, [item.label, item.color] as const])).entries(),
  ]
  const latest = new Map<string, number>()
  const points = events.map((event) => {
    latest.set(event.profileId, event.value)
    const breakdown = providers.map(([groupId, [label, color]], index) => ({
      profileId: groupId,
      label,
      color: historyProfileColor(color, index),
      value: [...sources.entries()].reduce(
        (sum, [profileId, [sourceGroupId]]) =>
          sum + (sourceGroupId === groupId ? (latest.get(profileId) ?? 0) : 0),
        0,
      ),
    }))
    return {
      date: event.date,
      value: breakdown.reduce((sum, item) => sum + item.value, 0),
      breakdown,
    }
  })
  if (!points.length)
    return {
      layers: [],
      first: 0,
      last: 0,
      min: 0,
      max: 0,
      domainStart: 0,
      domainEnd: 0,
      fullStart: 0,
      fullEnd: 0,
      points: [],
      xTicks: [],
      yTicks: [],
    }
  const dates = extent(points, (item) => item.date)
  const values = extent(points, (item) => item.value)
  const firstDate = dates[0] ?? points[0]!.date
  const lastDate = dates[1] ?? firstDate
  const fullStart = firstDate.getTime()
  const fullEnd = lastDate.getTime()
  const requestedRange = historyZoomRange.value
  const domainStart = new Date(
    requestedRange ? Math.max(fullStart, Math.min(requestedRange.start, fullEnd)) : fullStart,
  )
  const domainEnd = new Date(
    requestedRange ? Math.min(fullEnd, Math.max(requestedRange.end, fullStart)) : fullEnd,
  )
  const xDomain: [Date, Date] =
    domainEnd > domainStart ? [domainStart, domainEnd] : [firstDate, lastDate]
  const visiblePoints = points.filter(
    (point) => point.date >= xDomain[0] && point.date <= xDomain[1],
  )
  const min = 0
  const max = values[1] ?? min
  const padding = Math.max(max * 0.05, 1)
  const x = scaleTime()
    .domain(xDomain)
    .range([68, historyViewWidth.value - 12])
  const y = scaleLinear()
    .domain([min, max + padding])
    .range([historyChartBottom.value, 12])
  const layers = providers.map(([profileId, [label, color]], providerIndex) => {
    const values = points.map((point) => {
      const y0 = point.breakdown.slice(0, providerIndex).reduce((sum, item) => sum + item.value, 0)
      const value = point.breakdown[providerIndex]?.value ?? 0
      return { date: point.date, y0, y1: y0 + value }
    })
    return {
      profileId,
      label,
      color: historyProfileColor(color, providerIndex),
      path:
        area<(typeof values)[number]>()
          .x((item) => x(item.date))
          .y0((item) => y(item.y0))
          .y1((item) => y(item.y1))(values) ?? '',
    }
  })
  return {
    layers,
    first: points[0]?.value ?? 0,
    last: points.at(-1)?.value ?? 0,
    min,
    max,
    domainStart: xDomain[0].getTime(),
    domainEnd: xDomain[1].getTime(),
    fullStart,
    fullEnd,
    points: (visiblePoints.length ? visiblePoints : points).map((item) => ({
      ...item,
      x: x(item.date),
      y: y(item.value),
    })),
    yTicks: y.ticks(4).map((value) => ({ value, y: y(value) })),
    xTicks: x.ticks(5).map((value) => ({ value, x: x(value) })),
  }
})
const hoveredHistoryIndex = ref<number | null>(null)
const hoveredHistoryPoint = computed(() =>
  hoveredHistoryIndex.value == null
    ? null
    : (historyChart.value.points[hoveredHistoryIndex.value] ?? null),
)
const showHistoryPoint = (event: MouseEvent) => {
  const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const x = ((event.clientX - bounds.left) / bounds.width) * historyViewWidth.value
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY
  historyChart.value.points.forEach((point, index) => {
    const distance = Math.abs(point.x - x)
    if (distance >= nearestDistance) return
    nearestDistance = distance
    nearestIndex = index
  })
  hoveredHistoryIndex.value = nearestIndex
}
type HistoryRange = { start: number; end: number }
type HistoryDrag = { pointerId: number; startX: number; range: HistoryRange; moved: boolean }
type HistoryPinch = { distance: number; range: HistoryRange }

let historyDrag: HistoryDrag | null = null
let historyPinch: HistoryPinch | null = null
const historyTouchPointers = new Map<number, { x: number; y: number }>()
const historyRange = () => {
  const chart = historyChart.value
  return { start: chart.domainStart, end: chart.domainEnd }
}
const setHistoryRange = (start: number, span: number) => {
  const chart = historyChart.value
  const fullSpan = chart.fullEnd - chart.fullStart
  if (!fullSpan) return
  const nextSpan = Math.min(fullSpan, Math.max(fullSpan / 20, span))
  const nextStart = Math.min(chart.fullEnd - nextSpan, Math.max(chart.fullStart, start))
  historyZoomRange.value = { start: nextStart, end: nextStart + nextSpan }
  hoveredHistoryIndex.value = null
}
const historyPointerRatio = (event: MouseEvent | PointerEvent | WheelEvent) => {
  const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  if (!bounds.width) return null
  const plotLeft = 68
  const plotRight = historyViewWidth.value - 12
  const pointerX = ((event.clientX - bounds.left) / bounds.width) * historyViewWidth.value
  return Math.min(1, Math.max(0, (pointerX - plotLeft) / (plotRight - plotLeft)))
}
const zoomHistory = (event: WheelEvent) => {
  const chart = historyChart.value
  const fullSpan = chart.fullEnd - chart.fullStart
  const currentSpan = chart.domainEnd - chart.domainStart
  if (!fullSpan || !currentSpan) return

  const anchorRatio = historyPointerRatio(event)
  if (anchorRatio == null) return
  const horizontalDelta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX
  if (Math.abs(horizontalDelta) > Math.abs(event.deltaY) || event.shiftKey) {
    setHistoryRange(
      chart.domainStart + (horizontalDelta / (historyViewWidth.value - 80)) * currentSpan,
      currentSpan,
    )
    return
  }
  const factor = Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * 0.003)
  const nextSpan = Math.min(fullSpan, Math.max(fullSpan / 20, currentSpan * factor))
  const anchor = chart.domainStart + currentSpan * anchorRatio
  setHistoryRange(anchor - nextSpan * anchorRatio, nextSpan)
}
const startHistoryPointer = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const target = event.currentTarget as SVGSVGElement
  target.setPointerCapture(event.pointerId)
  event.preventDefault()

  if (event.pointerType === 'touch') {
    historyTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (historyTouchPointers.size === 2) {
      const [first, second] = [...historyTouchPointers.values()]
      if (!first || !second) return
      historyDrag = null
      historyPinch = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        range: historyRange(),
      }
      return
    }
  }
  historyDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    range: historyRange(),
    moved: false,
  }
}
const moveHistoryPointer = (event: PointerEvent) => {
  if (event.pointerType === 'touch') {
    historyTouchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (historyPinch && historyTouchPointers.size === 2) {
      const [first, second] = [...historyTouchPointers.values()]
      if (!first || !second || !historyPinch.distance) return
      const ratio = historyPointerRatio(event)
      if (ratio == null) return
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const startSpan = historyPinch.range.end - historyPinch.range.start
      const nextSpan = startSpan * (historyPinch.distance / distance)
      const anchor = historyPinch.range.start + startSpan * ratio
      setHistoryRange(anchor - nextSpan * ratio, nextSpan)
      return
    }
  }
  if (!historyDrag || historyDrag.pointerId !== event.pointerId) {
    if (event.pointerType === 'mouse') showHistoryPoint(event)
    return
  }
  const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  if (!bounds.width) return
  const delta = event.clientX - historyDrag.startX
  if (Math.abs(delta) > 3) historyDrag.moved = true
  const span = historyDrag.range.end - historyDrag.range.start
  setHistoryRange(historyDrag.range.start - (delta / bounds.width) * span, span)
}
const endHistoryPointer = (event: PointerEvent) => {
  const drag = historyDrag?.pointerId === event.pointerId ? historyDrag : null
  if (event.pointerType === 'touch') historyTouchPointers.delete(event.pointerId)
  if (drag && !drag.moved) showHistoryPoint(event)
  if (drag) historyDrag = null
  if (historyTouchPointers.size < 2) historyPinch = null
}
const clearHistoryHover = () => {
  if (!historyDrag && !historyPinch) hoveredHistoryIndex.value = null
}
const historyDate = (date: Date) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
const historyAxisDate = (date: Date) => {
  const points = historyChart.value.points
  const range = (points.at(-1)?.date.getTime() ?? 0) - (points[0]?.date.getTime() ?? 0)
  return new Intl.DateTimeFormat(
    'ja-JP',
    range < 2 * 24 * 60 * 60_000
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'numeric', day: 'numeric' },
  ).format(date)
}

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
  [position.profileId, position.id, position.market, position.code, position.accountType]
    .filter(Boolean)
    .join(':')
const canLoadPositionDetail = (position: Position) =>
  Boolean(props.loadPositionDetail) && isUsMarket(position.market)

const showPositionDetail = async (position: Position) => {
  const loadPositionDetail = props.loadPositionDetail
  if (!loadPositionDetail || !canLoadPositionDetail(position) || positionDetailLoadingKey.value)
    return
  const key = positionKey(position)
  positionDetailLoadingKey.value = key
  positionDetailError.value = ''
  try {
    positionDetail.value = await loadPositionDetail(position)
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
      <div :class="[ui.assetBreakdownPanel, 'h-full max-h-[24rem] sm:col-span-1']">
        <div class="relative mx-auto aspect-square w-full max-w-[24rem]">
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
      <div :class="[ui.assetBreakdownPanel, 'h-full max-h-[24rem] w-full sm:col-span-2']">
        <div v-if="historyChart.points.length" class="relative h-full min-h-48 w-full">
          <svg
            ref="historySvg"
            :viewBox="`0 0 ${historyViewWidth} ${historyViewHeight}`"
            class="h-full max-h-[24rem] min-h-48 w-full cursor-grab touch-none select-none overflow-visible active:cursor-grabbing"
            role="img"
            aria-label="総資産推移"
            tabindex="0"
            @wheel.prevent="zoomHistory"
            @pointerdown="startHistoryPointer"
            @pointermove="moveHistoryPointer"
            @pointerup="endHistoryPointer"
            @pointercancel="endHistoryPointer"
            @pointerleave="clearHistoryHover"
            @focus="hoveredHistoryIndex = historyChart.points.length - 1"
            @blur="hoveredHistoryIndex = null"
          >
            <defs>
              <clipPath id="portfolio-history-clip">
                <rect
                  x="68"
                  y="12"
                  :width="historyViewWidth - 80"
                  :height="historyChartBottom - 12"
                />
              </clipPath>
            </defs>
            <g v-for="tick in historyChart.yTicks" :key="tick.value">
              <line
                x1="68"
                :y1="tick.y"
                :x2="historyViewWidth - 12"
                :y2="tick.y"
                stroke="#33383f"
                stroke-dasharray="3 4"
              />
              <text
                x="60"
                :y="tick.y"
                fill="#8f949d"
                class="text-sm"
                font-weight="600"
                text-anchor="end"
                dominant-baseline="middle"
              >
                {{ currency(tick.value) }}
              </text>
            </g>
            <line x1="68" y1="12" x2="68" :y2="historyChartBottom" stroke="#59616c" />
            <line
              x1="68"
              :y1="historyChartBottom"
              :x2="historyViewWidth - 12"
              :y2="historyChartBottom"
              stroke="#59616c"
            />
            <g v-for="tick in historyChart.xTicks" :key="tick.value.getTime()">
              <line
                :x1="tick.x"
                y1="12"
                :x2="tick.x"
                :y2="historyChartBottom"
                stroke="#33383f"
                stroke-dasharray="3 4"
              />
              <line
                :x1="tick.x"
                :y1="historyChartBottom"
                :x2="tick.x"
                :y2="historyChartBottom + 4"
                stroke="#59616c"
              />
              <text
                :x="tick.x"
                :y="historyViewHeight - 4"
                fill="#8f949d"
                class="text-sm"
                font-weight="600"
                text-anchor="middle"
              >
                {{ historyAxisDate(tick.value) }}
              </text>
            </g>
            <g clip-path="url(#portfolio-history-clip)">
              <path
                v-for="layer in historyChart.layers"
                :key="layer.profileId"
                :d="layer.path"
                :fill="layer.color"
                fill-opacity="0.72"
                :aria-label="layer.label"
              />
              <g v-if="hoveredHistoryPoint" class="pointer-events-none">
                <line
                  :x1="hoveredHistoryPoint.x"
                  y1="12"
                  :x2="hoveredHistoryPoint.x"
                  :y2="historyChartBottom"
                  stroke="#59616c"
                  stroke-dasharray="4 4"
                />
                <circle
                  :cx="hoveredHistoryPoint.x"
                  :cy="hoveredHistoryPoint.y"
                  r="5"
                  fill="#a8c7fa"
                  stroke="#1b1f24"
                  stroke-width="3"
                />
              </g>
            </g>
          </svg>
          <AnimatePresence>
            <motion.div
              v-if="hoveredHistoryPoint"
              key="asset-history-tooltip"
              class="pointer-events-none absolute rounded-xl border border-[#3b424b] bg-[#111418]/95 px-3 py-2 shadow-xl"
              :style="{
                left: `${Math.min(
                  Math.max((hoveredHistoryPoint.x / historyViewWidth) * 100, 18),
                  82,
                )}%`,
                top: '5.5rem',
              }"
              :initial="{ opacity: 0, x: '-50%', y: 6, scale: 0.96 }"
              :animate="{ opacity: 1, x: '-50%', y: 0, scale: 1 }"
              :exit="{ opacity: 0, x: '-50%', y: 4, scale: 0.97 }"
              :transition="{ duration: 0.16, ease: 'easeOut' }"
            >
              <strong class="block whitespace-nowrap text-sm text-[#e3e3e9]">{{
                currency(hoveredHistoryPoint.value)
              }}</strong>
              <small class="block whitespace-nowrap text-[#9aa0a9]">{{
                historyDate(hoveredHistoryPoint.date)
              }}</small>
              <span
                v-for="item in hoveredHistoryPoint.breakdown.filter((entry) => entry.value > 0)"
                :key="item.profileId"
                class="mt-1 flex min-w-36 items-center justify-between gap-4 text-xs"
              >
                <span class="inline-flex items-center gap-2 text-[#c3c7cf]">
                  <i
                    class="size-2 shrink-0 rounded-full"
                    :style="{ backgroundColor: item.color }"
                    aria-hidden="true"
                  ></i>
                  {{ item.label }}
                </span>
                <strong class="text-[#e3e3e9]">{{ currency(item.value) }}</strong>
              </span>
            </motion.div>
          </AnimatePresence>
        </div>
        <div v-else-if="assetHistoryLoading" :class="ui.emptyState">
          <Spinner size="lg" />
        </div>
        <div v-else :class="ui.emptyState"><span :class="ui.muted">履歴がありません</span></div>
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
          <span>プロファイル</span>
          <span>銘柄</span>
          <span>タイプ</span>
          <span>数量</span>
          <span>評価額</span>
          <span>評価損益</span>
          <span>操作</span>
        </div>
        <div v-if="positions.length" :class="ui.holdingsRows">
          <div v-for="position in positions" :key="positionKey(position)" :class="ui.holdingRow">
            <span class="col-span-2 truncate text-sm font-semibold text-[#c3c7cf] md:col-span-1">
              {{ position.profileLabel ?? '-' }}
            </span>
            <button
              class="grid gap-1 text-left text-[#e3e3e9]"
              type="button"
              @click="emit('openPosition', position)"
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
        <p v-else :class="[ui.muted, ui.emptyState]">保有銘柄はありません</p>
        <p v-if="positionDetailError" :class="ui.dialogNote">{{ positionDetailError }}</p>
      </div>
    </article>

    <article :class="ui.portfolioHistory">
      <h2>取引履歴</h2>
      <div :class="ui.historyList">
        <div v-if="recentOrders.length" :class="ui.historyRows">
          <div
            v-for="order in recentOrders"
            :key="`${order.profileId ?? ''}:${order.id}`"
            :class="ui.miniOrder"
          >
            <span class="grid gap-1">
              <strong>{{ order.stock }}</strong>
              <small
                >{{ order.side === 'buy' ? '買付' : '売却' }} ・
                {{ orderQuantityText(order) }}</small
              >
              <small v-if="order.profileLabel" class="text-[#a8c7fa]">
                {{ order.providerName }} / {{ order.profileLabel }}
              </small>
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
                ? `一部の口座を取得できませんでした (${orderHistoryNotice})`
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
      <p v-else :class="[ui.muted, ui.emptyState]">指数データはありません</p>
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
