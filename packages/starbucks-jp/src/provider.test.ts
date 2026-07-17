import { describe, expect, test } from 'vite-plus/test'
import { createStarbucksProvider } from './provider'
import type { StarbucksJpSession } from './index'

const session = (
  cards: Awaited<ReturnType<StarbucksJpSession['listCards']>>,
  histories: Record<string, Awaited<ReturnType<StarbucksJpSession['history']>>>,
) =>
  ({
    session: { export: () => ({ sessionId: 'session' }) },
    getUserInfo: async () => ({}) as never,
    listCards: async () => cards,
    getBalance: async () =>
      cards.map((card) => ({
        card_number: card.card_number,
        amount: card.latest_amount.amount,
        updated_date: card.latest_amount.updated_date,
      })),
    listCreditCards: async () => [],
    listHistories: async (cardNumber: string) => histories[cardNumber] ?? [],
    history: async (cardNumber: string) => histories[cardNumber] ?? [],
  }) as StarbucksJpSession

describe('createStarbucksProvider', () => {
  test('exposes card balances and normalized transaction history', async () => {
    const cards = [
      {
        card_number: '1234567890123456',
        order: 1,
        status: 1,
        nickname: 'メイン',
        main_card: true,
        digital_starbucks_card: true,
        digital_starbucks_card_type: 'normal',
        image_url: '',
        latest_amount: { amount: 925, updated_date: '2026-07-17T20:50:49' },
        auto_charge_setting: { enabled: false },
        sb_card_id: 44379064,
      },
    ]
    const provider = createStarbucksProvider(
      session(cards, {
        '1234567890123456': [
          {
            store_name: 'モバイルオーダー&ペイ',
            created_date: '2026-06-06T20:57:00',
            used_amount: -555,
          },
          {
            store_name: 'PayPay（オンライン入金）',
            created_date: '2026-06-06T20:51:00',
            used_amount: 1000,
          },
        ],
      }),
    )

    await expect(provider.invoke('balances.list', {})).resolves.toMatchObject([
      {
        accountId: 'starbucks-card:44379064',
        type: 'current',
        amount: { kind: 'money', money: { currency: 'JPY', value: '925' } },
      },
    ])
    await expect(provider.invoke('history.list', {})).resolves.toMatchObject({
      items: [
        {
          kind: 'transaction',
          transaction: {
            kind: 'payment',
            direction: 'debit',
            amount: { kind: 'money', money: { currency: 'JPY', value: '555' } },
          },
        },
        {
          kind: 'transaction',
          transaction: {
            kind: 'deposit',
            direction: 'credit',
            amount: { kind: 'money', money: { currency: 'JPY', value: '1000' } },
          },
        },
      ],
    })
  })
})
