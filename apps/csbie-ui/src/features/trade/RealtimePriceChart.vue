<script setup lang="ts">
import Chart from 'chart.js/auto'
import { Minus, Plus, RotateCcw } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Spinner from '../../components/ui/Spinner.vue'
import type { RealtimePricePoint } from '../../types/trading'

const props = defineProps<{
  points: RealtimePricePoint[]
  stockName: string
  active: boolean
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const scroller = ref<HTMLDivElement | null>(null)
const zoomScale = ref(1)
let chart: Chart<'line', number[], string> | undefined
let wasScrolledToEnd = true

const minChartWidth = 720
const minZoom = 0.6
const maxZoom = 3
const zoomStep = 0.2
const basePointSpacing = 10
const pointSpacing = computed(() => basePointSpacing * zoomScale.value)

const labelFor = (point: RealtimePricePoint) => {
  const date = new Date(point.at)
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
    }).format(date)
  }
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

const labels = computed(() => props.points.map(labelFor))

const prices = computed(() => props.points.map((point) => point.price))

const chartWidth = computed(() => {
  const width = Math.max(minChartWidth, props.points.length * pointSpacing.value + 72)
  return `max(100%, ${width}px)`
})

const rememberScrollPosition = () => {
  const element = scroller.value
  if (!element) return
  wasScrolledToEnd =
    element.scrollLeft + element.clientWidth >= element.scrollWidth - pointSpacing.value
}

const scrollToEndIfNeeded = async () => {
  if (!wasScrolledToEnd) return
  await nextTick()
  const element = scroller.value
  if (!element) return
  element.scrollLeft = element.scrollWidth
}

const updateChart = () => {
  if (!chart) return
  rememberScrollPosition()
  chart.data.labels = labels.value
  const dataset = chart.data.datasets[0]
  if (dataset) dataset.data = prices.value
  chart.update('none')
  chart.resize()
  void scrollToEndIfNeeded()
}

const setZoomScale = (value: number) => {
  rememberScrollPosition()
  zoomScale.value = Math.min(maxZoom, Math.max(minZoom, value))
}

const zoomOut = () => setZoomScale(zoomScale.value - zoomStep)

const zoomIn = () => setZoomScale(zoomScale.value + zoomStep)

const resetZoom = () => setZoomScale(1)

const setZoomScaleFromInput = (event: Event) => {
  const value = Number((event.target as HTMLInputElement).value)
  setZoomScale(value)
}

const handleWheel = (event: WheelEvent) => {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  setZoomScale(zoomScale.value + (event.deltaY < 0 ? zoomStep : -zoomStep))
}

onMounted(() => {
  if (!canvas.value) return
  chart = new Chart(canvas.value, {
    type: 'line',
    data: {
      labels: labels.value,
      datasets: [
        {
          data: prices.value,
          borderColor: '#40dba2',
          backgroundColor: 'rgba(64, 219, 162, 0.14)',
          borderWidth: 2,
          fill: true,
          pointBackgroundColor: '#d3e3fd',
          pointBorderColor: '#40dba2',
          pointRadius: 2.5,
          pointHoverRadius: 4,
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            label: (item) => `${(item.parsed.y ?? 0).toLocaleString('ja-JP')}円`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(143, 148, 157, 0.12)' },
          ticks: { color: '#8f949d', maxTicksLimit: 5 },
        },
        y: {
          grid: { color: 'rgba(143, 148, 157, 0.12)' },
          ticks: {
            color: '#8f949d',
            callback: (value) =>
              typeof value === 'number' ? value.toLocaleString('ja-JP') : value,
          },
        },
      },
    },
  })
  void scrollToEndIfNeeded()
})

watch(() => props.points, updateChart, { deep: true })
watch(chartWidth, () => {
  chart?.resize()
  void scrollToEndIfNeeded()
})

onBeforeUnmount(() => {
  chart?.destroy()
  chart = undefined
})
</script>

<template>
  <div class="relative h-full w-full">
    <div
      ref="scroller"
      class="h-full w-full overflow-x-auto overflow-y-hidden"
      @scroll="rememberScrollPosition"
      @wheel="handleWheel"
    >
      <div class="h-full" :style="{ width: chartWidth }">
        <canvas
          ref="canvas"
          class="h-full w-full"
          :aria-label="`${stockName} realtime price chart`"
        ></canvas>
      </div>
    </div>
    <span
      v-if="active && !points.length"
      class="absolute inset-0 grid place-items-center text-[#8f949d]"
    >
      <Spinner />
    </span>
    <div
      class="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-[#2d3440] bg-[#111418]/90 px-1.5 py-1 shadow-sm"
    >
      <button
        class="grid h-6 w-6 place-items-center rounded text-[#d3e3fd] hover:bg-[#1d232b]"
        type="button"
        aria-label="縮小"
        @click="zoomOut"
      >
        <Minus class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <input
        :value="zoomScale"
        class="h-6 w-24 accent-[#40dba2]"
        type="range"
        :min="minZoom"
        :max="maxZoom"
        :step="zoomStep"
        aria-label="グラフ縮尺"
        @input="setZoomScaleFromInput"
      />
      <button
        class="grid h-6 w-6 place-items-center rounded text-[#d3e3fd] hover:bg-[#1d232b]"
        type="button"
        aria-label="拡大"
        @click="zoomIn"
      >
        <Plus class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        class="grid h-6 w-6 place-items-center rounded text-[#8f949d] hover:bg-[#1d232b] hover:text-[#d3e3fd]"
        type="button"
        aria-label="縮尺を戻す"
        @click="resetZoom"
      >
        <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
