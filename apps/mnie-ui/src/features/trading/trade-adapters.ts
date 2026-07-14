import type {
  CashOrderAccountType,
  OrderPreview,
  Position,
  Stock,
  TradeOrderInputMode,
  TradeSide,
} from '../../types/trading'
import { asArray, asRecord, numberValue, textValue } from './trading-data'

export interface AmountOrderDraft {
  profileId: string
  side: TradeSide
  stock: Stock
  holding?: Position
  accountType: CashOrderAccountType
  amount: string
  sellAll: boolean
}

export interface TradeAdapter {
  orderInputMode: TradeOrderInputMode
  buildPreviewRequest?: (draft: AmountOrderDraft) => Record<string, unknown>
  normalizePreview?: (value: unknown, draft: AmountOrderDraft) => OrderPreview
  buildCreateRequest?: (confirmationToken: string) => Record<string, unknown>
  errorMessage?: (providerCode: string | undefined, fallback: string) => string
}

const quantityTradeAdapter: TradeAdapter = {
  orderInputMode: 'quantity',
}

const amountTradeAdapter: TradeAdapter = {
  orderInputMode: 'amount',
  buildPreviewRequest: (draft) => ({
    accountId: draft.profileId,
    instrumentId: draft.side === 'sell' ? draft.holding?.code : draft.stock.code,
    side: draft.side,
    accountType: String(
      draft.side === 'sell' ? (draft.holding?.accountType ?? '') : draft.accountType,
    ),
    positionId: draft.side === 'sell' ? draft.holding?.id : undefined,
    sellAll: draft.side === 'sell' && draft.sellAll,
    amount:
      draft.side === 'sell' && draft.sellAll ? undefined : { currency: 'JPY', value: draft.amount },
  }),
  normalizePreview: (value, draft) => {
    const preview = asRecord(value)
    const price = asRecord(preview.price)
    const estimatedAmount = asRecord(preview.estimatedAmount)
    return {
      issue: {
        code: draft.side === 'sell' ? (draft.holding?.code ?? '') : draft.stock.code,
        market: draft.side === 'sell' ? (draft.holding?.market ?? '') : draft.stock.market,
      },
      side: draft.side,
      quantity: numberValue(preview.quantity),
      ...(price.value !== undefined
        ? {
            price: {
              value: numberValue(price.value),
              text: textValue(price.value),
              currency: textValue(price.currency, 'JPY'),
            },
          }
        : {}),
      warnings: asArray(preview.warnings).map(String),
      confirmationId: textValue(preview.confirmationToken),
      ...(textValue(estimatedAmount.value)
        ? {
            estimatedAmount: {
              currency: textValue(estimatedAmount.currency, 'JPY'),
              value: textValue(estimatedAmount.value),
            },
          }
        : {}),
      exchangeRate: textValue(preview.exchangeRate) || undefined,
      expiresAt: textValue(preview.expiresAt) || undefined,
    }
  },
  buildCreateRequest: (confirmationToken) => ({
    confirmationToken,
    allowTransaction: true,
  }),
  errorMessage: (providerCode, fallback) =>
    providerCode === 'ORDER_OUTCOME_UNKNOWN'
      ? '注文結果を確認できません。再送せず、注文履歴を確認してください。'
      : providerCode === 'EXPIRED_CONFIRMATION'
        ? 'プレビューの有効期限が切れました。再度プレビューしてください。'
        : providerCode === 'INVALID_CONFIRMATION'
          ? 'この確認IDは無効または使用済みです。再度プレビューしてください。'
          : providerCode === 'ORDER_DISABLED'
            ? '現在この取引は停止されています。'
            : providerCode === 'TRADE_PASSWORD_INVALID'
              ? '取引パスワードが正しくありません。設定画面で更新してください。'
              : fallback,
}

export const tradeAdapterFor = (inputMode: TradeOrderInputMode): TradeAdapter =>
  inputMode === 'amount' ? amountTradeAdapter : quantityTradeAdapter
