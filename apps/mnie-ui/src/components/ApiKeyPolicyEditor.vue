<script setup lang="ts">
import type { ApiKeySettings } from '../api'

defineProps<{
  compact?: boolean
  permissionsOpen?: boolean
}>()

const settings = defineModel<ApiKeySettings>({ required: true })

const rpcMethods = [
  'accounts.list',
  'balances.list',
  'assets.valuation.get',
  'transactions.list',
  'transfers.recipients.list',
  'investments.positions.list',
  'investments.orders.list',
  'investments.orders.preview',
] as const

const tradingMethods = ['investments.orders.preview'] as const

const tradingMethodSet = new Set<string>(tradingMethods)
const readMethods = rpcMethods.filter((method) => !tradingMethodSet.has(method))
const scopes = ['read', 'write', 'trade', 'mcp'] as const

const toggleScope = (scope: string) => {
  const current = settings.value.scopes ?? []
  settings.value.scopes = current.includes(scope)
    ? current.filter((candidate) => candidate !== scope)
    : [...current, scope].sort()
}

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
  scopeGrid: 'grid grid-cols-2 gap-2 md:grid-cols-4',
  summary: 'cursor-pointer font-black text-[#e3e3e9]',
  actions: 'mt-3 flex flex-wrap gap-2',
  button:
    'min-h-9 rounded-full bg-[#263141] px-4 text-sm font-extrabold text-[#d3e3fd] transition hover:bg-[#303b4d]',
  methodGrid: 'mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2',
  methodToggle:
    'flex min-h-10 min-w-0 items-center gap-2 rounded-[16px] bg-[#111418] p-3 text-xs text-[#c3c7cf]',
  checkbox: 'h-4 min-h-4 w-4',
  methodName: 'min-w-0 break-all',
}
</script>

<template>
  <div :class="ui.root">
    <div :class="ui.scopeGrid">
      <label v-for="scope in scopes" :key="scope" :class="ui.methodToggle">
        <input
          :class="ui.checkbox"
          type="checkbox"
          :checked="settings.scopes?.includes(scope)"
          @change="toggleScope(scope)"
        />
        <span :class="ui.methodName">{{ scope }}</span>
      </label>
    </div>

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
          <span :class="ui.methodName">{{ method }}</span>
        </label>
      </div>
    </details>
  </div>
</template>
