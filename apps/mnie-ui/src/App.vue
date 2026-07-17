<script setup lang="ts">
import { AnimatePresence } from 'motion-v'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { revokeApiKey } from './api'
import AppHeader from './components/layout/AppHeader.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import SearchDialog from './features/search/SearchDialog.vue'
import AuthGate from './features/auth/AuthGate.vue'
import { useAuthAdmin } from './features/auth/useAuthAdmin'
import HistoryView from './features/history/HistoryView.vue'
import OAuthApprovalPanel from './features/oauth/OAuthApprovalPanel.vue'
import { useOAuthApproval } from './features/oauth/useOAuthApproval'
import OrderDialogs from './features/orders/OrderDialogs.vue'
import PortfolioView from './features/portfolio/PortfolioView.vue'
import ReconciliationView from './features/reconciliation/ReconciliationView.vue'
import SettingsView from './features/settings/SettingsView.vue'
import TradeView from './features/trade/TradeView.vue'
import { useTradingSession } from './features/trading/useTradingSession'
import { stockIdFromTradeRouteId, tradeRouteIdFromStockId } from './constants/trade'
import { routeNames, type RouteName } from './router'
import { ui } from './styles/ui'

const route = useRoute()
const router = useRouter()
const activeTab = computed<RouteName>(() => {
  return routeNames.includes(route.name as RouteName) ? (route.name as RouteName) : 'portfolio'
})
const isOAuthRoute = computed(() => route.name === 'oauthAuthorize')
const showAuthGate = computed(() => true)
const authReady = ref(false)
const decodedRouteParam = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
const tradePath = (id: string) => `/trade/${encodeURIComponent(id)}`
const tradeId = computed(() =>
  typeof route.params.id === 'string'
    ? stockIdFromTradeRouteId(decodedRouteParam(route.params.id))
    : '',
)
const navigateTrade = (id = selectedStock.value.routeId || selectedStockCode.value) => {
  void router.push(id ? tradePath(tradeRouteIdFromStockId(id)) : '/trade')
}
const navigate = (name: RouteName) => {
  if (name === 'settings') return router.push('/settings/api-keys')
  if (name === 'trade') {
    const profile =
      brokerageProfiles.value.find((item) => item.id === selectedProfileId.value) ??
      brokerageProfiles.value[0]
    if (profile) selectedProfileId.value = profile.id
    return router.push('/trade').then(() => {
      if (profile) connect()
    })
  }
  return router.push({ name })
}

const {
  status,
  apiKeys,
  sbiPasskeys,
  authManagers,
  profiles,
  providerDefinitions,
  profileAvailability,
  profileAvailabilityCheckedAt,
  profileAvailabilityLoading,
  cronJobs,
  selectedProfileId,
  setupPassword,
  authBusy,
  apiKeyLabel,
  newApiKeySettings,
  newApiToken,
  sbiLabel,
  authManagerLabel,
  authManagerDataPath,
  authManagerMasterPassword,
  selectedAuthManagerId,
  sbiCredentialJson,
  tradePassword,
  sbiDeviceId,
  smbcLabel,
  smbcUser,
  smbcPassword,
  smbcAccountItemCode,
  payPayBankLabel,
  payPayBankBranchNo,
  payPayBankAccountNo,
  payPayBankPassword,
  payPaySecLabel,
  payPaySecCredentialJson,
  payPaySecTradePassword,
  starbucksLabel,
  starbucksUsername,
  starbucksPassword,
  refresh,
  forceProfileAvailability,
  addApiKey,
  saveApiKeySettings,
  setupOwnerPasskey,
  loginWithPasskey,
  addSbiPasskey,
  addAuthManager,
  removeAuthManager,
  fillProviderCredentials,
  addSmbcDirectProfile,
  addPayPayBankProfile,
  addPayPaySecProfile,
  addStarbucksProfile,
  removeSbiPasskey,
  updateProfile,
} = useAuthAdmin()

// The sidebar, settings flow, and trading session must share one profile selection.
// Keeping a second ref here leaves the trading session disconnected after linking a provider.
const tradeProfileId = selectedProfileId
const selectedProfile = computed(() =>
  profiles.value.find((profile) => profile.id === tradeProfileId.value),
)
const brokerageProfiles = computed(() =>
  profiles.value.filter((profile) => profile.category === 'brokerage'),
)

const {
  selectedStockCode,
  selectedStockId,
  tradeSide,
  orderKind,
  cashOrderAccountType,
  cashOrderMarket,
  cashOrderPriceCondition,
  cashOrderTerm,
  cashOrderDateInput,
  cashOrderMethod,
  cashOrderTriggerZone,
  cashOrderTriggerPriceInput,
  cashOrderSecondaryPriceCondition,
  cashOrderSecondaryPriceInput,
  quantityInput,
  amountInput,
  amountSellMode,
  selectedHoldingId,
  priceInput,
  chartMode,
  chartRange,
  showSearch,
  searchQuery,
  countryFilter,
  marketFilter,
  showEstimateDialog,
  showOrderDialog,
  lastCashEstimate,
  orderNotice,
  orderError,
  orderBusy,
  orderInputMode,
  orderAmountMinimum,
  orderAmountIncrement,
  chartAvailable,
  quoteLoading,
  searchQuotesAvailable,
  previewExpired,
  connected,
  dataLoading,
  searchLoading,
  totalProfitLoss,
  totalProfitLossRate,
  marketIndexes,
  orders,
  cancelingOrderKey,
  orderHistoryLoaded,
  orderHistoryNotice,
  positions,
  sellPositions,
  portfolioPositions,
  chartPricePoints,
  chartNotice,
  pricePolling,
  selectedStock,
  orderQuantity,
  orderAmount,
  orderPrice,
  cashOrderPrimaryRequiresPrice,
  cashOrderTriggerPrice,
  cashOrderSecondaryPrice,
  cashOrderAccountTypeOptions,
  cashOrderMarketOptions,
  cashOrderTermOptions,
  cashOrderDateOptions,
  cashOrderPriceStep,
  estimatedAmount,
  showPortfolioSpinner,
  canRequestOrderEstimate,
  canPlaceCashOrder,
  countries,
  markets,
  viewedStocks,
  filteredStocks,
  selectedPosition,
  selectedStockProviderPositions,
  recentOrders,
  portfolioRecentOrders,
  totalAssetValue,
  portfolioBuyingPower,
  portfolioHoldingsMarketValue,
  portfolioBrokerageAssetBreakdown,
  portfolioTotalProfitLoss,
  portfolioTotalProfitLossRate,
  stockAssetRatio,
  cashAssetRatio,
  otherAssetBreakdown,
  portfolioOtherAssetBreakdown,
  portfolioOverviewLoading,
  portfolioOrderHistoryNotice,
  assetHistory,
  assetHistoryLoading,
  hasQuote,
  selectTradeStock,
  selectStockByCode,
  connect,
  loadTradingData,
  loadPortfolioOverview,
  loadStoredAssetValuations,
  estimateCashOrder,
  askPlaceOrder,
  placeCashOrder,
  cancelOrder,
  loadOrderDetail,
  loadTradeRecords,
  estimateOrderCorrection,
  placeOrderCorrection,
  downloadCsv,
  smbcQrUrl,
  smbcBalance,
  finishSmbc2fa,
} = useTradingSession(tradeProfileId, profiles, providerDefinitions)

const openPortfolioPosition = (position: (typeof portfolioPositions.value)[number]) => {
  if (!position.profileId) return
  tradeProfileId.value = position.profileId
  connect()
  navigateTrade(position.code)
}

const selectBrokerageProfile = (id: string) => {
  if (!id || tradeProfileId.value === id) return
  tradeProfileId.value = id
  connect()
  if (tradeId.value) selectStockByCode(tradeId.value)
}

const finishSmbc2faAndRefreshAvailability = async () => {
  const connected = await finishSmbc2fa()
  if (!connected) return
  if (selectedProfileId.value) await forceProfileAvailability(selectedProfileId.value)
  await loadStoredAssetValuations()
  await loadPortfolioOverview()
}

const { oauthApproval, oauthSettings, loadOAuthApproval, approveOAuth } = useOAuthApproval()

const refreshAndMaybeConnect = async () => {
  await refresh()
  if (!status.value.authenticated) return
  await loadStoredAssetValuations().catch(() => {})
  await loadPortfolioOverview().catch(() => {})
}

const refreshPortfolio = async () => {
  await loadStoredAssetValuations().catch(() => {})
  await loadPortfolioOverview().catch(() => {})
}

const addSbiPasskeyAndConnect = async () => {
  await addSbiPasskey()
  tradeProfileId.value = selectedProfileId.value
  connect()
}

const addPayPaySecProfileAndConnect = async () => {
  await addPayPaySecProfile()
  tradeProfileId.value = selectedProfileId.value
  connect()
}

const addStarbucksProfileAndRefresh = async () => {
  await addStarbucksProfile()
  await loadStoredAssetValuations()
  await loadPortfolioOverview()
}

const revokeAndRefresh = async (id: string) => {
  await revokeApiKey(id)
  await refresh()
}

watch(
  [tradeId, activeTab, brokerageProfiles],
  ([id, tab, availableProfiles]) => {
    if (tab !== 'trade') return

    // On a direct visit the route is resolved before refresh() has populated the
    // profiles. Connect as soon as a brokerage profile becomes available, then
    // restore the route selection because connect() resets profile-scoped state.
    const profile =
      availableProfiles.find((item) => item.id === tradeProfileId.value) ?? availableProfiles[0]
    if (!profile) return
    tradeProfileId.value = profile.id
    connect()
    if (id) selectStockByCode(id)
  },
  { immediate: true },
)

watch(
  [activeTab, () => selectedStock.value.routeId, selectedStockId, selectedStockCode],
  ([tab]) => {
    const id = selectedStock.value.routeId || selectedStockId.value || selectedStockCode.value
    if (tab !== 'trade' || !id || tradeId.value === id) return
    void router.replace(tradePath(tradeRouteIdFromStockId(id)))
  },
  { immediate: true },
)

let availabilityPolling: number | undefined

onMounted(async () => {
  try {
    await refreshAndMaybeConnect()
  } catch (cause) {
    // A failed profile availability check must not turn an already-authenticated
    // session into the login screen. The auth status is authoritative and was
    // fetched at the start of refresh().
    console.error('Failed to initialize admin data', cause)
  } finally {
    authReady.value = true
  }
  await loadOAuthApproval()
  availabilityPolling = window.setInterval(
    () => {
      if (status.value.authenticated) void refresh()
    },
    10 * 60 * 1000,
  )
})

onUnmounted(() => {
  if (availabilityPolling) window.clearInterval(availabilityPolling)
})
</script>

<template>
  <main :class="isOAuthRoute ? ui.oauthShell : ui.appShell">
    <AppSidebar v-if="!isOAuthRoute" :active-tab="activeTab" @navigate="navigate" />

    <section :class="isOAuthRoute ? ui.oauthWorkspace : ui.workspace">
      <AppHeader v-if="!isOAuthRoute && activeTab !== 'settings'" :active-tab="activeTab" />

      <OAuthApprovalPanel
        v-if="oauthApproval.active && status.authenticated"
        v-model:settings="oauthSettings"
        :approval="oauthApproval"
        @approve="approveOAuth"
      />

      <AuthGate
        v-else-if="authReady && showAuthGate && !status.authenticated"
        v-model:setup-password="setupPassword"
        :status="status"
        :auth-busy="authBusy"
        @login="loginWithPasskey"
        @setup="setupOwnerPasskey"
      />

      <template v-else>
        <PortfolioView
          v-if="activeTab === 'portfolio'"
          :show-portfolio-spinner="showPortfolioSpinner"
          :total-asset-value="totalAssetValue"
          :buying-power="portfolioBuyingPower"
          :holdings-market-value="portfolioHoldingsMarketValue"
          :brokerage-asset-breakdown="portfolioBrokerageAssetBreakdown"
          :total-profit-loss="portfolioTotalProfitLoss"
          :total-profit-loss-rate="portfolioTotalProfitLossRate"
          :market-indexes="marketIndexes"
          :stock-asset-ratio="stockAssetRatio"
          :cash-asset-ratio="cashAssetRatio"
          :other-asset-breakdown="portfolioOtherAssetBreakdown"
          :asset-history="assetHistory"
          :asset-history-loading="assetHistoryLoading"
          :positions="portfolioPositions"
          :recent-orders="portfolioRecentOrders"
          :canceling-order-key="cancelingOrderKey"
          :data-loading="portfolioOverviewLoading"
          :connected="true"
          :order-history-loaded="!portfolioOverviewLoading"
          :order-history-notice="portfolioOrderHistoryNotice"
          @connect="refreshPortfolio"
          @open-position="openPortfolioPosition"
        />

        <div
          v-if="activeTab === 'trade' && !selectedProfile"
          class="m-5 grid min-h-64 place-items-center rounded-2xl border border-[#30343a] bg-[#111418] p-8 text-[#9aa0a9]"
        >
          取引口座を選択してください
        </div>

        <TradeView
          v-else-if="activeTab === 'trade' && selectedProfile"
          v-model:trade-side="tradeSide"
          v-model:order-kind="orderKind"
          v-model:cash-order-account-type="cashOrderAccountType"
          v-model:cash-order-market="cashOrderMarket"
          v-model:cash-order-price-condition="cashOrderPriceCondition"
          v-model:cash-order-term="cashOrderTerm"
          v-model:cash-order-date-input="cashOrderDateInput"
          v-model:cash-order-method="cashOrderMethod"
          v-model:cash-order-trigger-zone="cashOrderTriggerZone"
          v-model:cash-order-trigger-price-input="cashOrderTriggerPriceInput"
          v-model:cash-order-secondary-price-condition="cashOrderSecondaryPriceCondition"
          v-model:cash-order-secondary-price-input="cashOrderSecondaryPriceInput"
          v-model:quantity-input="quantityInput"
          v-model:amount-input="amountInput"
          v-model:amount-sell-mode="amountSellMode"
          v-model:selected-holding-id="selectedHoldingId"
          v-model:price-input="priceInput"
          v-model:chart-mode="chartMode"
          v-model:chart-range="chartRange"
          :viewed-stocks="viewedStocks"
          :selected-stock="selectedStock"
          :provider-positions="selectedStockProviderPositions"
          :selected-position="selectedPosition"
          :positions="sellPositions"
          :brokerage-profiles="brokerageProfiles"
          :selected-profile-id="tradeProfileId"
          :profile-name="`${selectedProfile.providerName} / ${selectedProfile.label}`"
          :order-input-mode="orderInputMode"
          :chart-available="chartAvailable"
          :quote-loading="quoteLoading"
          :order-busy="orderBusy"
          :order-notice="orderNotice"
          :order-error="orderError"
          :connected="connected"
          :order-quantity="orderQuantity"
          :order-amount="orderAmount"
          :order-amount-minimum="orderAmountMinimum"
          :order-amount-increment="orderAmountIncrement"
          :estimated-amount="estimatedAmount"
          :cash-order-account-type-options="cashOrderAccountTypeOptions"
          :cash-order-market-options="cashOrderMarketOptions"
          :cash-order-term-options="cashOrderTermOptions"
          :cash-order-date-options="cashOrderDateOptions"
          :cash-order-price-step="cashOrderPriceStep"
          :can-request-cash-estimate="canRequestOrderEstimate"
          :can-place-cash-order="canPlaceCashOrder"
          :realtime-price-points="chartPricePoints"
          :chart-notice="chartNotice"
          :price-polling="pricePolling"
          :has-quote="hasQuote"
          @open-search="showSearch = true"
          @select-profile="selectBrokerageProfile"
          @select-stock="
            (stock) => {
              void selectTradeStock(stock).then(() => navigateTrade(stock.routeId || stock.code))
            }
          "
          @download-csv="downloadCsv"
          @estimate="estimateCashOrder"
          @confirm-order="askPlaceOrder"
        />

        <ReconciliationView v-if="activeTab === 'history'" />

        <HistoryView
          v-if="activeTab === 'history'"
          :orders="orders"
          :connected="connected"
          :data-loading="dataLoading"
          :canceling-order-key="cancelingOrderKey"
          :order-history-loaded="orderHistoryLoaded"
          :order-history-notice="orderHistoryNotice"
          :load-order-detail="loadOrderDetail"
          :load-trade-records="loadTradeRecords"
          :estimate-order-correction="estimateOrderCorrection"
          :place-order-correction="placeOrderCorrection"
          @refresh="loadTradingData"
          @cancel="cancelOrder"
        />

        <SettingsView
          v-if="activeTab === 'settings'"
          v-model:api-key-label="apiKeyLabel"
          v-model:new-api-key-settings="newApiKeySettings"
          v-model:new-api-token="newApiToken"
          v-model:sbi-label="sbiLabel"
          v-model:auth-manager-label="authManagerLabel"
          v-model:auth-manager-data-path="authManagerDataPath"
          v-model:auth-manager-master-password="authManagerMasterPassword"
          v-model:selected-auth-manager-id="selectedAuthManagerId"
          v-model:sbi-credential-json="sbiCredentialJson"
          v-model:trade-password="tradePassword"
          v-model:sbi-device-id="sbiDeviceId"
          v-model:selected-profile-id="selectedProfileId"
          v-model:smbc-label="smbcLabel"
          v-model:smbc-user="smbcUser"
          v-model:smbc-password="smbcPassword"
          v-model:smbc-account-item-code="smbcAccountItemCode"
          v-model:pay-pay-bank-label="payPayBankLabel"
          v-model:pay-pay-bank-branch-no="payPayBankBranchNo"
          v-model:pay-pay-bank-account-no="payPayBankAccountNo"
          v-model:pay-pay-bank-password="payPayBankPassword"
          v-model:pay-pay-sec-label="payPaySecLabel"
          v-model:pay-pay-sec-credential-json="payPaySecCredentialJson"
          v-model:pay-pay-sec-trade-password="payPaySecTradePassword"
          v-model:starbucks-label="starbucksLabel"
          v-model:starbucks-username="starbucksUsername"
          v-model:starbucks-password="starbucksPassword"
          :api-keys="apiKeys"
          :sbi-passkeys="sbiPasskeys"
          :auth-managers="authManagers"
          :profiles="profiles"
          :provider-definitions="providerDefinitions"
          :profile-availability="profileAvailability"
          :profile-availability-checked-at="profileAvailabilityCheckedAt"
          :profile-availability-loading="profileAvailabilityLoading"
          :cron-jobs="cronJobs"
          :smbc-qr-url="smbcQrUrl"
          :smbc-balance="smbcBalance"
          @add-api-key="addApiKey"
          @refresh="refresh"
          @save-api-key-settings="saveApiKeySettings"
          @revoke-api-key="revokeAndRefresh"
          @add-sbi-passkey="addSbiPasskeyAndConnect"
          @add-auth-manager="addAuthManager"
          @remove-auth-manager="removeAuthManager"
          @fill-provider-credentials="fillProviderCredentials"
          @add-smbc-direct-profile="addSmbcDirectProfile"
          @add-pay-pay-bank-profile="addPayPayBankProfile"
          @add-pay-pay-sec-profile="addPayPaySecProfileAndConnect"
          @add-starbucks-profile="addStarbucksProfileAndRefresh"
          @finish-smbc-2fa="finishSmbc2faAndRefreshAvailability"
          @force-profile-availability="forceProfileAvailability"
          @connect="connect"
          @remove-sbi-passkey="removeSbiPasskey"
          @update-profile="updateProfile"
        />
      </template>
    </section>

    <AnimatePresence>
      <SearchDialog
        v-if="showSearch"
        key="search-dialog"
        v-model:search-query="searchQuery"
        v-model:country-filter="countryFilter"
        v-model:market-filter="marketFilter"
        :stocks="filteredStocks"
        :selected-stock-code="selectedStockCode"
        :countries="countries"
        :markets="markets"
        :loading="searchLoading"
        :price-data-available="searchQuotesAvailable"
        @close="showSearch = false"
        @select="
          (stock) =>
            void selectTradeStock(stock).then(() => {
              showSearch = false
              navigateTrade(stock.routeId || stock.code)
            })
        "
      />
    </AnimatePresence>

    <OrderDialogs
      v-if="selectedProfile"
      :estimate="lastCashEstimate"
      :show-estimate="showEstimateDialog"
      :show-order="showOrderDialog"
      :stock-name="selectedStock.name"
      :stock-market="selectedStock.market"
      :side="tradeSide"
      :kind="orderKind"
      :account-type="cashOrderAccountType"
      :market="cashOrderMarket"
      :price-condition="cashOrderPriceCondition"
      :price="cashOrderPrimaryRequiresPrice ? orderPrice : 0"
      :order-term="cashOrderTerm"
      :order-date="cashOrderDateInput"
      :order-method="cashOrderMethod"
      :trigger-zone="cashOrderTriggerZone"
      :trigger-price="cashOrderTriggerPrice"
      :secondary-price-condition="cashOrderSecondaryPriceCondition"
      :secondary-price="cashOrderSecondaryPrice"
      :quantity="orderQuantity"
      :amount="orderInputMode === 'amount' ? orderAmount : estimatedAmount"
      :order-input-mode="orderInputMode"
      :can-confirm="canPlaceCashOrder"
      :preview-expired="previewExpired"
      :profile-name="
        selectedProfile ? `${selectedProfile.providerName} / ${selectedProfile.label}` : ''
      "
      @close-estimate="showEstimateDialog = false"
      @proceed="askPlaceOrder"
      @close-order="showOrderDialog = false"
      @place="placeCashOrder"
    />
  </main>
</template>
