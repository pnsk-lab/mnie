<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  bindAccountAccess,
  getAccountAccess,
  getAccountActivity,
  listApiKeys,
  revokeAccountAccess,
  setVirtualAccountState,
  updateVirtualAccount,
  type ApiKey,
  type ManagedVirtualAccount,
} from '../../api'
import { ui } from '../../styles/ui'
const props = defineProps<{ account: ManagedVirtualAccount }>()
const emit = defineEmits<{ changed: [] }>()
const tradingEnabled = ref(true)
const maxOrderAmount = ref('')
const restrictions = ref([
  { key: 'allowedInstruments', label: '銘柄', enabled: false, value: '' },
  { key: 'allowedMarkets', label: '市場', enabled: false, value: '' },
  { key: 'allowedCurrencies', label: '通貨', enabled: false, value: '' },
  { key: 'allowedSides', label: '売買区分（buy / sell）', enabled: false, value: '' },
  { key: 'allowedOrderTypes', label: '注文方式（market / limit）', enabled: false, value: '' },
])
const riskLimits = ref([
  { key: 'maxDailyTurnover', label: '1日の取引金額上限', kind: 'decimal', value: '' },
  { key: 'maxDailyTrades', label: '1日の注文回数上限', kind: 'count', value: '' },
  { key: 'maxConcentrationPercent', label: '1銘柄の集中上限（%）', kind: 'decimal', value: '' },
  { key: 'approvalThreshold', label: '所有者の確認が必要な金額', kind: 'decimal', value: '' },
  { key: 'staleAfterMs', label: '情報の有効期間（分）', kind: 'minutes', value: '' },
])

const error = ref('')
const busy = ref(false)
const access = ref<
  Array<{ apiKeyId: string; label: string; role: 'read' | 'trade'; revokedAt?: string | null }>
>([])
const activity = ref<Array<{ id: string; event: string; createdAt: string }>>([])
const keys = ref<ApiKey[]>([])
const keyId = ref('')
const role = ref<'read' | 'trade'>('read')
watch(
  () => props.account,
  async (account) => {
    tradingEnabled.value = account.policy?.tradingEnabled !== false
    maxOrderAmount.value =
      typeof account.policy?.maxOrderAmount === 'string' ? account.policy.maxOrderAmount : ''
    for (const restriction of restrictions.value) {
      const values = account.policy[restriction.key]
      restriction.enabled = Array.isArray(values)
      restriction.value = Array.isArray(values) ? values.join(', ') : ''
    }
    for (const limit of riskLimits.value) {
      const value = account.policy[limit.key]
      limit.value =
        value === undefined ? '' : String(limit.kind === 'minutes' ? Number(value) / 60_000 : value)
    }
    error.value = ''
    const id = account.id
    try {
      const [bindings, events, result] = await Promise.all([
        getAccountAccess(id),
        getAccountActivity(id),
        listApiKeys(),
      ])
      if (props.account.id !== id) return
      access.value = bindings.items.filter((binding) => !binding.revokedAt)
      activity.value = events.items.filter((event) => event.event !== 'external_activity.detected')
      keys.value = result.apiKeys
    } catch (cause) {
      if (props.account.id === id)
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)
const run = async (action: () => Promise<unknown>) => {
  busy.value = true
  error.value = ''
  try {
    await action()
    emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
const eventLabel = (event: string) =>
  ({
    'account.created': '口座を作成',
    'reconciliation.locked': '照合のため取引を停止',
    'order.reference_confirmed': '注文番号を照合',
    'account.updated': '口座設定を変更',
    'access.bound': 'アクセス権限を付与',
    'access.updated': 'アクセス権限を変更',
    'access.revoked': 'アクセス権限を解除',
    'order.submitting': '注文を送信',
    'order.submission_unknown': '注文結果を確認中',
    'order.open': '注文受付',
    'order.filled': '約定',
    'order.cancelled': '注文取消',
    'order.partially_filled': '一部約定',
    'order.recovered': '注文状態を確認',
    'order.cancel_pending': '取消確認中',
    'order.replace_pending': '訂正確認中',
    'order.rejected': '注文不成立',
    'migration.completed': '資産移行が完了',
    'reconciliation.approved': '照合を承認',
  })[event] ?? '口座の操作'
const save = () =>
  run(() =>
    updateVirtualAccount(props.account.id, props.account.version, {
      policy: {
        ...props.account.policy,
        tradingEnabled: tradingEnabled.value,
        ...Object.fromEntries(
          restrictions.value.map((restriction) => [
            restriction.key,
            restriction.enabled
              ? restriction.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean)
              : undefined,
          ]),
        ),
        ...Object.fromEntries(
          riskLimits.value.map((limit) => [
            limit.key,
            !limit.value.trim()
              ? undefined
              : limit.kind === 'minutes'
                ? Number(limit.value) * 60_000
                : limit.kind === 'count'
                  ? Number(limit.value)
                  : limit.value,
          ]),
        ),
        ...(maxOrderAmount.value
          ? { maxOrderAmount: maxOrderAmount.value }
          : { maxOrderAmount: undefined }),
      },
    }),
  )
</script>
<template>
  <section class="grid gap-5">
    <p v-if="error" role="alert" class="text-red-600">{{ error }}</p>
    <form
      v-if="account.kind !== 'system'"
      class="grid gap-4 rounded-xl border border-border p-5"
      @submit.prevent="save"
    >
      <h3 class="font-bold">口座設定</h3>
      <label class="flex min-h-12 items-center gap-3"
        ><input v-model="tradingEnabled" type="checkbox" />取引を許可</label
      >
      <label class="grid gap-2"
        >1注文の上限額<input
          v-model="maxOrderAmount"
          :class="ui.input"
          inputmode="decimal"
          placeholder="上限なし"
      /></label>
      <details v-if="account.category === 'brokerage'" class="grid gap-3">
        <summary class="min-h-11 cursor-pointer font-bold">取引条件と上限</summary>
        <div class="mt-3 grid gap-4">
          <fieldset v-for="restriction in restrictions" :key="restriction.key" class="grid gap-2">
            <label class="flex min-h-11 items-center gap-3"
              ><input v-model="restriction.enabled" type="checkbox" />{{
                restriction.label
              }}を制限</label
            >
            <input
              v-if="restriction.enabled"
              v-model="restriction.value"
              :class="ui.input"
              :aria-label="`許可する${restriction.label}`"
              placeholder="カンマ区切りで入力"
            />
            <p
              v-if="restriction.enabled && !restriction.value.trim()"
              class="text-sm text-fg-muted"
            >
              許可対象なし
            </p>
          </fieldset>
          <label v-for="limit in riskLimits" :key="limit.key" class="grid gap-2"
            >{{ limit.label
            }}<input
              v-model="limit.value"
              :class="ui.input"
              inputmode="decimal"
              placeholder="未設定"
          /></label>
        </div>
      </details>
      <div class="flex flex-wrap gap-3">
        <button :class="ui.primaryButton" :disabled="busy" type="submit">保存</button>
        <button
          v-if="account.status === 'active' || account.status === 'frozen'"
          :class="ui.ghostButton"
          type="button"
          :disabled="busy"
          @click="
            run(() =>
              setVirtualAccountState(
                account.id,
                account.version,
                account.status === 'active' ? 'freeze' : 'unfreeze',
              ),
            )
          "
        >
          {{ account.status === 'frozen' ? '凍結解除' : '凍結' }}
        </button>
        <button
          :class="ui.ghostButton"
          type="button"
          :disabled="busy"
          @click="run(() => setVirtualAccountState(account.id, account.version, 'close'))"
        >
          口座を閉じる
        </button>
      </div>
    </form>
    <section
      v-if="account.kind !== 'system'"
      class="grid gap-3 rounded-xl border border-border p-5"
    >
      <h3 class="font-bold">アクセス</h3>
      <div
        v-for="binding in access"
        :key="binding.apiKeyId"
        class="flex flex-wrap items-center justify-between gap-3"
      >
        <span>{{ binding.label }} · {{ binding.role === 'trade' ? '参照・取引' : '参照' }}</span>
        <button
          :class="ui.ghostButton"
          type="button"
          :disabled="busy"
          @click="run(() => revokeAccountAccess(account.id, binding.apiKeyId))"
        >
          解除
        </button>
      </div>
      <form
        class="flex flex-wrap gap-3"
        @submit.prevent="run(() => bindAccountAccess(account.id, keyId, role))"
      >
        <select v-model="keyId" :class="ui.input" aria-label="API key" required>
          <option value="" disabled>API keyを選択</option>
          <option v-for="key in keys" :key="key.id" :value="key.id">{{ key.label }}</option>
        </select>
        <select v-model="role" :class="ui.input" aria-label="口座アクセス権限">
          <option value="read">参照</option>
          <option value="trade">参照・取引</option>
        </select>
        <button :class="ui.primaryButton" type="submit" :disabled="busy || !keyId">割り当て</button>
      </form>
    </section>
    <section class="grid gap-3 rounded-xl border border-border p-5">
      <h3 class="font-bold">操作履歴</h3>
      <p v-if="!activity.length" class="text-fg-muted">操作履歴はありません</p>
      <ol class="grid gap-2">
        <li
          v-for="event in activity"
          :key="event.id"
          class="flex flex-wrap justify-between gap-3 text-sm"
        >
          <span>{{ eventLabel(event.event) }}</span
          ><time :datetime="event.createdAt">{{
            new Date(event.createdAt).toLocaleString('ja-JP')
          }}</time>
        </li>
      </ol>
    </section>
  </section>
</template>
