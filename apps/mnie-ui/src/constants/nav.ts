import { ArrowLeftRight, History, Settings, WalletCards } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { RouteName } from '../router'

export interface PageMeta {
  title: string
  icon: Component
}

export const pageMeta: Record<RouteName, PageMeta> = {
  portfolio: { title: 'ホーム', icon: WalletCards },
  trade: { title: '取引', icon: ArrowLeftRight },
  history: { title: '取引履歴', icon: History },
  settings: { title: '設定', icon: Settings },
}

export const sidebarItems: Array<{ name: RouteName; label: string; icon: Component }> = [
  { name: 'portfolio', label: 'ホーム', icon: pageMeta.portfolio.icon },
  { name: 'trade', label: '取引', icon: pageMeta.trade.icon },
  { name: 'settings', label: '設定', icon: pageMeta.settings.icon },
]
