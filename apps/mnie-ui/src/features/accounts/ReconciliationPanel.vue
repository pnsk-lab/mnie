<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  inspectAccountReconciliation,
  reconcileOrderReference,
  type AccountReconciliation,
} from '../../api'
import { ui } from '../../styles/ui'
const props = defineProps<{ physicalAccountId: string }>()
const emit = defineEmits<{ changed: [] }>()
const evidence = ref<AccountReconciliation>()
const references = ref<Record<string, string>>({})
const error = ref('')
const busy = ref(false)
watch(
  () => props.physicalAccountId,
  async (id) => {
    evidence.value = undefined
    error.value = ''
    try {
      const value = await inspectAccountReconciliation(id)
      if (id === props.physicalAccountId) evidence.value = value
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  },
  { immediate: true },
)
const reconcile = async (id: string) => {
  busy.value = true
  error.value = ''
  try {
    await reconcileOrderReference(id, references.value[id]!)
    emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
const statusLabel = (status: string) =>
  ({
    submission_unknown: '注文結果を確認中',
    reconciliation_required: '照合が必要',
    cancel_pending: '取消確認中',
    replace_pending: '訂正確認中',
    partially_filled: '一部約定',
    open: '注文中',
  })[status] ?? status
</script>
<template>
  <section class="grid gap-4 rounded-xl border border-border p-5">
    <h3 class="font-bold">照合</h3>
    <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
    <div v-if="evidence?.syncErrors?.length" role="alert" class="grid gap-2 text-sm">
      <div
        v-for="syncError in evidence.syncErrors"
        :key="syncError.scope"
        class="rounded-lg border border-border p-3"
      >
        同期エラー: {{ syncError.scope }} ({{ syncError.reason
        }}{{ syncError.code ? `: ${syncError.code}` : '' }})
        <span v-if="syncError.venues?.length" class="text-fg-muted">
          · 対象市場: {{ syncError.venues.join(', ') }}
        </span>
      </div>
    </div>
    <p v-else-if="evidence?.snapshotError" role="alert">
      金融機関の残高・注文情報を確認できないため、取引を停止しています。
    </p>
    <div
      v-for="order in evidence?.externalOrders"
      :key="order.id"
      class="rounded-lg border border-border p-3 text-sm"
    >
      {{
        order.state === 'needs_review'
          ? '外部注文の拘束額を確認できません。証券会社の注文状態を確認してください。'
          : '未割当の外部注文に資産を予約しています。'
      }}
    </div>
    <div v-if="evidence" class="overflow-x-auto">
      <table class="w-full text-sm">
        <caption class="mb-3 text-left text-fg-muted">
          実口座と全口座の資産割当
        </caption>
        <thead>
          <tr>
            <th class="p-2 text-left">資産</th>
            <th class="p-2">割当済み</th>
            <th class="p-2">実残高</th>
            <th class="p-2">未割当</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="asset in evidence.assets" :key="asset.assetKey">
            <td class="p-2">{{ asset.assetKey }}</td>
            <td class="p-2 text-right">{{ asset.allocated }}</td>
            <td class="p-2 text-right">{{ asset.actual }}</td>
            <td class="p-2 text-right">{{ asset.unallocated }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-for="order in evidence?.orders"
      :key="order.id"
      class="grid gap-3 border-t border-border pt-3"
    >
      <p>{{ order.instrumentId }} · {{ statusLabel(order.status) }}</p>
      <form
        v-if="['submission_unknown', 'reconciliation_required'].includes(order.status)"
        class="grid gap-3"
        @submit.prevent="reconcile(order.id)"
      >
        <label class="grid gap-2"
          >証券会社の注文番号<input
            v-model="references[order.id]"
            :class="ui.input"
            required
            autocomplete="off"
        /></label>
        <button :class="ui.primaryButton" type="submit" :disabled="busy || !references[order.id]">
          注文と照合
        </button>
      </form>
    </div>
    <section v-if="evidence?.events.length" class="grid gap-2">
      <h4 class="font-bold">未割当の外部操作</h4>
      <p v-for="event in evidence.events" :key="event.id" class="text-sm">
        {{ event.detail.assetKey }} {{ event.detail.delta }} ·
        {{ new Date(event.createdAt).toLocaleString('ja-JP') }}
      </p>
    </section>
  </section>
</template>
