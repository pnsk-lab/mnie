<script setup lang="ts">
import * as d3 from 'd3'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Spinner from '../../components/ui/Spinner.vue'
import { marketTimeZones } from '../../constants/market'
import type { ChartMode, ChartNotice, ChartRange, RealtimePricePoint } from '../../types/trading'
import { currencyForMarket } from '../../utils/format'

const props = defineProps<{
  points: RealtimePricePoint[]
  stockName: string
  active: boolean
  mode: ChartMode
  range: ChartRange
  market?: string
  previousClose?: number
  notice?: ChartNotice | null
}>()

type ChartPoint = RealtimePricePoint & {
  index: number
  date: Date
}

const root = ref<HTMLDivElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
const gridLayer = ref<SVGGElement | null>(null)
const xAxisLayer = ref<SVGGElement | null>(null)
const yAxisLayer = ref<SVGGElement | null>(null)
const areaPath = ref<SVGPathElement | null>(null)
const linePath = ref<SVGPathElement | null>(null)
const previousCloseLine = ref<SVGLineElement | null>(null)
const dotsLayer = ref<SVGGElement | null>(null)
const candlesLayer = ref<SVGGElement | null>(null)
const hoverLayer = ref<SVGGElement | null>(null)
const hoverLine = ref<SVGLineElement | null>(null)
const hoverDot = ref<SVGCircleElement | null>(null)
const clipRect = ref<SVGRectElement | null>(null)
const zoomScale = ref(1)
const size = ref({ width: 0, height: 0 })
const tooltip = ref({
  visible: false,
  x: 0,
  y: 0,
  price: '',
  jstDate: '',
  localDate: '',
  detail: '',
})

let resizeObserver: ResizeObserver | undefined
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | undefined
let zoomTransform = d3.zoomIdentity
let syncingZoom = false
let followsLatest = true
let latestXScale: d3.ScaleTime<number, number> | undefined
let latestYScale: d3.ScaleLinear<number, number> | undefined

const clipId = `realtime-price-clip-${Math.random().toString(36).slice(2)}`
const margin = { top: 12, right: 18, bottom: 28, left: 48 }
const minZoom = 0.6
const maxZoom = 6
const zoomStep = 0.2
const basePointSpacing = 10
const dayMs = 24 * 60 * 60 * 1000
const tolerancePx = 10
const offscreenPointBuffer = 4
const minXAxisTickSpacing = 72
const chartPoints = computed<ChartPoint[]>(() =>
  props.points
    .map((point, index) => ({ ...point, index, date: new Date(point.at) }))
    .filter((point) => Number.isFinite(point.price) && !Number.isNaN(point.date.getTime())),
)

const plotWidth = computed(() => Math.max(1, size.value.width - margin.left - margin.right))
const plotHeight = computed(() => Math.max(1, size.value.height - margin.top - margin.bottom))

const labelFor = (point: ChartPoint) => {
  if (props.range === '1D') {
    return new Intl.DateTimeFormat('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(point.date)
  }

  if (props.range === '3D') {
    if (
      point.date.getHours() === 0 &&
      point.date.getMinutes() === 0 &&
      point.date.getSeconds() === 0
    ) {
      return new Intl.DateTimeFormat('ja-JP', {
        month: 'numeric',
        day: 'numeric',
      }).format(point.date)
    }

    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
    }).format(point.date)
  }

  if (props.range === 'ALL') {
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
    }).format(point.date)
  }

  if (
    point.date.getHours() === 0 &&
    point.date.getMinutes() === 0 &&
    point.date.getSeconds() === 0
  ) {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
    }).format(point.date)
  }
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(point.date)
}

const closePrice = (point: ChartPoint) => point.close ?? point.price
const marketTimeZone = computed(
  () => marketTimeZones[props.market?.toUpperCase() ?? ''] ?? 'Asia/Tokyo',
)

const previousCloseValue = computed(() =>
  props.range === '1D' && Number.isFinite(props.previousClose) && props.previousClose
    ? props.previousClose
    : null,
)

const ohlcFor = (point: ChartPoint) => {
  const close = closePrice(point)
  const open = point.open ?? close
  const high = Math.max(point.high ?? close, open, close)
  const low = Math.min(point.low ?? close, open, close)
  return { open, high, low, close }
}

const zonedClockParts = (date: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Partial<Record<'hour' | 'minute' | 'second', number>>
  return {
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  }
}

const tooltipDateFor = (point: ChartPoint, timeZone: string) => {
  const parts = zonedClockParts(point.date, timeZone)
  const hasTime = parts.hour !== 0 || parts.minute !== 0 || parts.second !== 0
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(hasTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        }
      : {}),
  }).format(point.date)
}

const tooltipStyle = computed(() => {
  const width = 220
  const height = 92
  const pad = 8
  const left = Math.min(
    Math.max(pad, tooltip.value.x + 12),
    Math.max(pad, size.value.width - width - pad),
  )
  const top =
    tooltip.value.y > height + pad
      ? Math.max(pad, tooltip.value.y - height)
      : Math.min(size.value.height - height - pad, tooltip.value.y + 14)
  return {
    left: `${left}px`,
    top: `${top}px`,
  }
})

const timeDomainMs = (): [number, number] => {
  const points = chartPoints.value
  const start = d3.min(points, (point) => point.date.getTime()) ?? 0
  const end = d3.max(points, (point) => point.date.getTime()) ?? start + dayMs
  return end === start ? [start, start + dayMs] : [start, end]
}

const baseContentWidth = () => {
  const points = chartPoints.value
  return Math.max(plotWidth.value, Math.max(1, points.length - 1) * basePointSpacing)
}

const basePixelsPerMs = () => {
  const [start, end] = timeDomainMs()
  const duration = end - start
  return duration > 0 ? baseContentWidth() / duration : basePointSpacing / dayMs
}

const contentWidth = (k = zoomTransform.k) => {
  return Math.max(plotWidth.value, baseContentWidth() * k)
}

const minTranslateX = (k = zoomTransform.k) => Math.min(0, plotWidth.value - contentWidth(k))

const zoomTransformWith = (k: number, x: number) => d3.zoomIdentity.translate(x, 0).scale(k)

const clampTransform = (transform: d3.ZoomTransform) => {
  const k = Math.min(maxZoom, Math.max(minZoom, transform.k))
  const minX = minTranslateX(k)
  const x = Math.min(0, Math.max(minX, transform.x))
  return zoomTransformWith(k, x)
}

const isLatestVisible = (transform = zoomTransform) =>
  contentWidth(transform.k) + transform.x <= plotWidth.value + tolerancePx

const syncZoomBehavior = (transform: d3.ZoomTransform) => {
  if (!svg.value || !zoomBehavior) return
  syncingZoom = true
  d3.select(svg.value).call(zoomBehavior.transform, transform)
  syncingZoom = false
}

const applyTransform = (transform: d3.ZoomTransform, sync = true) => {
  zoomTransform = clampTransform(transform)
  zoomScale.value = Number(zoomTransform.k.toFixed(2))
  followsLatest = isLatestVisible(zoomTransform)
  renderChart()
  if (sync) syncZoomBehavior(zoomTransform)
}

const alignLatest = (k = zoomTransform.k, sync = true) => {
  followsLatest = true
  applyTransform(zoomTransformWith(k, minTranslateX(k)), sync)
}

const visibleTickIndexes = () => {
  if (!latestXScale) return [] as Date[]
  const maxTicks = Math.max(2, Math.floor(plotWidth.value / minXAxisTickSpacing))
  const tickDates = latestXScale.ticks(maxTicks).filter((date) => {
    const x = latestXScale?.(date) ?? 0
    return x >= margin.left && x <= margin.left + plotWidth.value
  })

  const visibleTicks: Date[] = []
  let previousX = Number.NEGATIVE_INFINITY
  for (const date of tickDates) {
    const x = latestXScale(date)
    if (x - previousX < minXAxisTickSpacing) continue
    visibleTicks.push(date)
    previousX = x
  }
  return visibleTicks
}

const visiblePointRange = (points: ChartPoint[]) => {
  const [domainStart] = timeDomainMs()
  const pixelsPerMs = basePixelsPerMs() * zoomTransform.k
  const rawStartMs = domainStart + -zoomTransform.x / pixelsPerMs
  const rawEndMs = domainStart + (plotWidth.value - zoomTransform.x) / pixelsPerMs
  const rawStart = d3
    .bisector<ChartPoint, number>((point) => point.date.getTime())
    .left(points, rawStartMs)
  const rawEnd = d3
    .bisector<ChartPoint, number>((point) => point.date.getTime())
    .right(points, rawEndMs)
  const start = Math.max(0, Math.min(points.length - 1, rawStart - offscreenPointBuffer))
  const end = Math.max(start, Math.min(points.length - 1, rawEnd + offscreenPointBuffer))
  return { start, end }
}

const renderChart = () => {
  const points = chartPoints.value
  const width = size.value.width
  const height = size.value.height
  if (
    !svg.value ||
    !gridLayer.value ||
    !xAxisLayer.value ||
    !yAxisLayer.value ||
    !areaPath.value ||
    !linePath.value ||
    !previousCloseLine.value ||
    !dotsLayer.value ||
    !candlesLayer.value ||
    !hoverLayer.value ||
    !clipRect.value ||
    width <= 0 ||
    height <= 0
  ) {
    return
  }

  d3.select(clipRect.value)
    .attr('x', margin.left)
    .attr('y', margin.top)
    .attr('width', plotWidth.value)
    .attr('height', plotHeight.value)

  if (!points.length) {
    d3.select(areaPath.value).attr('d', '')
    d3.select(linePath.value).attr('d', '')
    d3.select(previousCloseLine.value).attr('display', 'none')
    d3.select(dotsLayer.value).selectAll('circle').remove()
    d3.select(candlesLayer.value).selectAll('*').remove()
    hideHover()
    d3.select(gridLayer.value).selectAll('*').remove()
    d3.select(xAxisLayer.value).selectAll('*').remove()
    d3.select(yAxisLayer.value).selectAll('*').remove()
    return
  }

  const prices =
    props.mode === 'box'
      ? points.flatMap((point) => {
          const ohlc = ohlcFor(point)
          return [ohlc.open, ohlc.high, ohlc.low, ohlc.close]
        })
      : points.map(closePrice)
  if (previousCloseValue.value) prices.push(previousCloseValue.value)
  const minPrice = d3.min(prices) ?? 0
  const maxPrice = d3.max(prices) ?? 1
  const padding = Math.max(1, (maxPrice - minPrice) * 0.08)
  const yScale = d3
    .scaleLinear()
    .domain([minPrice - padding, maxPrice + padding])
    .nice()
    .range([margin.top + plotHeight.value, margin.top])

  const [domainStart, domainEnd] = timeDomainMs()
  const xScale = d3
    .scaleTime()
    .domain([new Date(domainStart), new Date(domainEnd)])
    .range([margin.left + zoomTransform.x, margin.left + contentWidth() + zoomTransform.x])
  latestXScale = xScale
  latestYScale = yScale

  const line = d3
    .line<ChartPoint>()
    .defined((point) => Number.isFinite(closePrice(point)))
    .x((point) => xScale(point.date))
    .y((point) => yScale(closePrice(point)))
    .curve(d3.curveMonotoneX)

  const area = d3
    .area<ChartPoint>()
    .defined((point) => Number.isFinite(closePrice(point)))
    .x((point) => xScale(point.date))
    .y0(margin.top + plotHeight.value)
    .y1((point) => yScale(closePrice(point)))
    .curve(d3.curveMonotoneX)

  const { start, end } = visiblePointRange(points)
  const visiblePoints = points.slice(start, end + 1)

  d3.select(areaPath.value).attr('d', props.mode === 'line' ? (area(visiblePoints) ?? '') : '')
  d3.select(linePath.value).attr('d', props.mode === 'line' ? (line(visiblePoints) ?? '') : '')

  d3.select(dotsLayer.value)
    .selectAll<SVGCircleElement, ChartPoint>('circle')
    .data(props.mode === 'line' ? visiblePoints : [], (point) => point.at)
    .join(
      (enter) =>
        enter
          .append('circle')
          .attr('r', 2.5)
          .attr('fill', '#d3e3fd')
          .attr('stroke', '#40dba2')
          .attr('stroke-width', 1.6),
      (update) => update,
      (exit) => exit.remove(),
    )
    .attr('cx', (point) => xScale(point.date))
    .attr('cy', (point) => yScale(closePrice(point)))

  const previousCloseY = previousCloseValue.value ? yScale(previousCloseValue.value) : null
  d3.select(previousCloseLine.value)
    .attr('display', previousCloseY === null ? 'none' : null)
    .attr('x1', margin.left)
    .attr('x2', margin.left + plotWidth.value)
    .attr('y1', previousCloseY ?? 0)
    .attr('y2', previousCloseY ?? 0)

  const candleGroups = d3
    .select(candlesLayer.value)
    .selectAll<SVGGElement, ChartPoint>('g')
    .data(props.mode === 'box' ? visiblePoints : [], (point) => point.at)
    .join(
      (enter) => {
        const group = enter.append('g')
        group
          .append('line')
          .attr('class', 'wick')
          .attr('stroke-width', 1.4)
          .attr('stroke-linecap', 'round')
        group.append('rect').attr('class', 'body').attr('rx', 1.5)
        return group
      },
      (update) => update,
      (exit) => exit.remove(),
    )

  candleGroups.each(function (point) {
    const ohlc = ohlcFor(point)
    const x = xScale(point.date)
    const pointIndex = points.indexOf(point)
    const previous = points[pointIndex - 1]
    const next = points[pointIndex + 1]
    const previousGap = previous ? point.date.getTime() - previous.date.getTime() : undefined
    const nextGap = next ? next.date.getTime() - point.date.getTime() : undefined
    const gap = Math.min(
      ...(previousGap && nextGap ? [previousGap, nextGap] : [previousGap ?? nextGap ?? dayMs]),
    )
    const candleWidth = Math.max(2, Math.min(14, gap * basePixelsPerMs() * zoomTransform.k * 0.62))
    const yOpen = yScale(ohlc.open)
    const yClose = yScale(ohlc.close)
    const yHigh = yScale(ohlc.high)
    const yLow = yScale(ohlc.low)
    const rising = ohlc.close >= ohlc.open
    const color = rising ? '#40dba2' : '#ffb4ab'
    const bodyY = Math.min(yOpen, yClose)
    const bodyHeight = Math.max(2, Math.abs(yClose - yOpen))

    d3.select(this)
      .select<SVGLineElement>('line.wick')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', yHigh)
      .attr('y2', yLow)
      .attr('stroke', color)

    d3.select(this)
      .select<SVGRectElement>('rect.body')
      .attr('x', x - candleWidth / 2)
      .attr('y', bodyY)
      .attr('width', candleWidth)
      .attr('height', bodyHeight)
      .attr('fill', rising ? 'rgba(64, 219, 162, 0.28)' : 'rgba(255, 180, 171, 0.28)')
      .attr('stroke', color)
      .attr('stroke-width', 1.4)
  })

  const yGridAxis = d3
    .axisLeft(yScale)
    .ticks(5)
    .tickSize(-plotWidth.value)
    .tickFormat(() => '')
  d3.select(gridLayer.value)
    .attr('transform', `translate(${margin.left}, 0)`)
    .call(yGridAxis)
    .call((selection) => {
      selection.select('.domain').remove()
      selection.selectAll('line').attr('stroke', 'rgba(143, 148, 157, 0.12)')
    })

  const yAxis = d3
    .axisLeft(yScale)
    .ticks(5)
    .tickSize(0)
    .tickPadding(8)
    .tickFormat((value) => Number(value).toLocaleString('ja-JP'))
  d3.select(yAxisLayer.value)
    .attr('transform', `translate(${margin.left}, 0)`)
    .call(yAxis)
    .call((selection) => {
      selection.select('.domain').remove()
      selection.selectAll('text').attr('fill', '#8f949d').attr('font-size', 12)
    })

  const tickDates = visibleTickIndexes()
  const xAxis = d3
    .axisBottom(xScale)
    .tickValues(tickDates)
    .tickSize(0)
    .tickPadding(8)
    .tickFormat((value) => {
      const date = value instanceof Date ? value : new Date(Number(value))
      return labelFor({
        at: date.toISOString(),
        date,
        index: 0,
        price: 0,
      })
    })
  d3.select(xAxisLayer.value)
    .attr('transform', `translate(0, ${margin.top + plotHeight.value})`)
    .call(xAxis)
    .call((selection) => {
      selection.select('.domain').remove()
      selection.selectAll('text').attr('fill', '#8f949d').attr('font-size', 12)
    })

  if (tooltip.value.visible) {
    const hovered = nearestPointAt(tooltip.value.x)
    if (hovered) showHover(hovered)
    else hideHover()
  }
}

const nearestPointAt = (x: number) => {
  if (!latestXScale) return undefined
  const time = latestXScale.invert(x).getTime()
  return d3.least(chartPoints.value, (point) => Math.abs(point.date.getTime() - time))
}

const showHover = (point: ChartPoint) => {
  if (!latestXScale || !latestYScale || !hoverLayer.value || !hoverLine.value || !hoverDot.value)
    return

  const x = latestXScale(point.date)
  const ohlc = ohlcFor(point)
  const y = latestYScale(props.mode === 'box' ? ohlc.close : closePrice(point))
  if (x < margin.left || x > margin.left + plotWidth.value) {
    hideHover()
    return
  }

  tooltip.value = {
    visible: true,
    x,
    y,
    price: currencyForMarket(closePrice(point), props.market),
    jstDate: tooltipDateFor(point, 'Asia/Tokyo'),
    localDate: tooltipDateFor(point, marketTimeZone.value),
    detail:
      props.mode === 'box'
        ? `始 ${currencyForMarket(ohlc.open, props.market)} / 高 ${currencyForMarket(ohlc.high, props.market)} / 安 ${currencyForMarket(ohlc.low, props.market)}`
        : '',
  }

  d3.select(hoverLayer.value).style('opacity', 1)
  d3.select(hoverLine.value)
    .transition()
    .duration(120)
    .ease(d3.easeCubicOut)
    .attr('x1', x)
    .attr('x2', x)
    .attr('y1', margin.top)
    .attr('y2', margin.top + plotHeight.value)
  d3.select(hoverDot.value)
    .transition()
    .duration(120)
    .ease(d3.easeCubicOut)
    .attr('cx', x)
    .attr('cy', y)
    .attr('r', 5)
}

const hideHover = () => {
  tooltip.value = { ...tooltip.value, visible: false }
  if (!hoverLayer.value || !hoverDot.value) return
  d3.select(hoverLayer.value).transition().duration(120).style('opacity', 0)
  d3.select(hoverDot.value).transition().duration(120).attr('r', 0)
}

const setZoomScale = (value: number) => {
  const k = Math.min(maxZoom, Math.max(minZoom, value))
  const center = plotWidth.value / 2
  const contentCenter = (center - zoomTransform.x) / zoomTransform.k
  applyTransform(zoomTransformWith(k, center - contentCenter * k))
}

const zoomOut = () => setZoomScale(zoomScale.value - zoomStep)

const zoomIn = () => setZoomScale(zoomScale.value + zoomStep)

const resetZoom = () => alignLatest(1)

defineExpose({
  resetZoom,
  zoomIn,
  zoomOut,
})

const normalizedWheelDelta = (value: number, event: WheelEvent) => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return value * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return value * plotWidth.value
  return value
}

const zoomAround = (k: number, localX: number) => {
  const nextK = Math.min(maxZoom, Math.max(minZoom, k))
  const center = Math.min(plotWidth.value, Math.max(0, localX - margin.left))
  const contentCenter = (center - zoomTransform.x) / zoomTransform.k
  applyTransform(zoomTransformWith(nextK, center - contentCenter * nextK))
}

const handleWheel = (event: WheelEvent) => {
  event.preventDefault()
  hideHover()

  const deltaX = normalizedWheelDelta(event.deltaX, event)
  const deltaY = normalizedWheelDelta(event.deltaY, event)
  const panDelta = event.shiftKey && !deltaX ? deltaY : deltaX

  if ((event.shiftKey && panDelta) || Math.abs(panDelta) > Math.abs(deltaY)) {
    applyTransform(zoomTransformWith(zoomTransform.k, zoomTransform.x - panDelta))
    return
  }

  if (!deltaY) return
  const direction = deltaY < 0 ? 1 : -1
  const [x] = svg.value ? d3.pointer(event, svg.value) : [event.offsetX]
  zoomAround(zoomTransform.k + direction * zoomStep, x)
}

const handlePointerMove = (event: PointerEvent) => {
  if (!svg.value || event.buttons) {
    hideHover()
    return
  }
  const [x, y] = d3.pointer(event, svg.value)
  const insidePlot =
    x >= margin.left &&
    x <= margin.left + plotWidth.value &&
    y >= margin.top &&
    y <= margin.top + plotHeight.value
  if (!insidePlot) {
    hideHover()
    return
  }
  const point = nearestPointAt(x)
  if (point) showHover(point)
}

onMounted(async () => {
  await nextTick()
  if (!root.value || !svg.value) return

  resizeObserver = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (!rect) return
    size.value = { width: rect.width, height: rect.height }
    if (followsLatest) alignLatest(zoomTransform.k)
    else applyTransform(zoomTransform)
  })
  resizeObserver.observe(root.value)

  zoomBehavior = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([minZoom, maxZoom])
    .filter((event) => event.type !== 'wheel' && !event.button && event.type !== 'dblclick')
    .on('zoom', (event) => {
      if (syncingZoom) return
      applyTransform(event.transform, false)
      syncZoomBehavior(zoomTransform)
    })

  d3.select(svg.value).call(zoomBehavior).on('dblclick.zoom', null)
  alignLatest(1)
})

watch(
  () => props.points,
  () => {
    if (followsLatest) alignLatest(zoomTransform.k)
    else applyTransform(zoomTransform)
  },
  { deep: true },
)

watch(
  () => [props.mode, props.range, props.previousClose],
  () => {
    hideHover()
    renderChart()
  },
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (svg.value) d3.select(svg.value).on('.zoom', null)
})
</script>

<template>
  <div ref="root" class="relative h-full w-full">
    <svg
      ref="svg"
      class="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      :aria-label="`${stockName} realtime price chart`"
      role="img"
      @wheel="handleWheel"
      @pointermove="handlePointerMove"
      @pointerleave="hideHover"
    >
      <defs>
        <clipPath :id="clipId">
          <rect ref="clipRect"></rect>
        </clipPath>
      </defs>
      <g ref="gridLayer"></g>
      <g ref="yAxisLayer"></g>
      <g ref="xAxisLayer"></g>
      <path :clip-path="`url(#${clipId})`" ref="areaPath" fill="rgba(64, 219, 162, 0.14)"></path>
      <path
        :clip-path="`url(#${clipId})`"
        ref="linePath"
        fill="none"
        stroke="#40dba2"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2.2"
      ></path>
      <line
        ref="previousCloseLine"
        stroke="#ffcf6e"
        stroke-dasharray="5 5"
        stroke-linecap="round"
        stroke-width="1.2"
      ></line>
      <g :clip-path="`url(#${clipId})`" ref="candlesLayer"></g>
      <g :clip-path="`url(#${clipId})`" ref="dotsLayer"></g>
      <g ref="hoverLayer" :clip-path="`url(#${clipId})`" class="pointer-events-none" opacity="0">
        <line
          ref="hoverLine"
          stroke="rgba(211, 227, 253, 0.42)"
          stroke-dasharray="4 4"
          stroke-width="1"
        ></line>
        <circle ref="hoverDot" fill="#111418" r="0" stroke="#40dba2" stroke-width="2"></circle>
      </g>
    </svg>

    <span
      v-if="active && !points.length"
      class="absolute inset-0 grid place-items-center text-[#8f949d]"
    >
      <Spinner />
    </span>

    <div
      class="pointer-events-none absolute w-[220px] translate-y-1 rounded-md border border-[#2d3440] bg-[#111418]/95 px-3 py-2 text-xs text-[#d3e3fd] opacity-0 shadow-lg shadow-black/30 transition-all duration-150 ease-out"
      :class="tooltip.visible && 'translate-y-0 opacity-100'"
      :style="tooltipStyle"
    >
      <div class="font-black text-[#40dba2]">{{ tooltip.price }}</div>
      <div class="mt-1 grid gap-0.5 text-[#8f949d]">
        <div>JST {{ tooltip.jstDate }}</div>
        <div>現地 {{ tooltip.localDate }}</div>
      </div>
      <div v-if="tooltip.detail" class="mt-1 leading-relaxed text-[#8f949d]">
        {{ tooltip.detail }}
      </div>
    </div>
  </div>
</template>
