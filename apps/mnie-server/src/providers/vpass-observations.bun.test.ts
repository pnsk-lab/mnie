import { expect, test } from 'bun:test'
import { createProvider, VpassClient, VpassProfile, type VpassSession } from '@mnie/provider-vpass'
import { createDb } from '../db'
import { persistTransactionObservations } from '../observations'

test('an appended equal-amount refund retains the purchase observation identity', async () => {
  const session: VpassSession = {
    apiBaseURL: 'https://app.example.test',
    webBaseURL: 'https://member.example.test',
    appVersion: '5.13.0',
    endpoint: 'Fauth',
    push: false,
    deviceId: '8e15abae-2918-4237-84f5-11c456415883',
    deviceToken: '',
    cardCompanyCode: '001',
    idKind: 'vpass',
    globalId: 'GID1',
    cardCode: 'AUTH_CARD_CODE',
    cookies: {},
  }
  const purchase = { riyouDate: '26/01/02', kmName: 'Shop A', riyouKin: '500' }
  const rows = [purchase]
  const client = new VpassClient({
    ...session,
    fetch: async (url) => {
      const content = url.pathname.includes('multicard')
        ? {
            MulticardInformationResponseServiceBean: {
              cardInfo: [{ globalId: 'GID1', cardIdentifyKey: 'CARD1', cardCompanyCode: '001' }],
            },
          }
        : {
            CustomizedMeisaiAnsDisplayServiceBean: {
              seikyuYM: '202601',
              total: rows.length,
              pageSize: 100,
              seikyuYMList: [{ value: '202601' }],
              meisaiList: rows,
            },
          }
      return Response.json({ header: { resultCode: '0', loginFlg: true }, body: { content } })
    },
  })
  const provider = await createProvider(new VpassProfile(client, session))
  const profile = {
    id: 'vpass-observation-profile',
    connectorTypeId: 'vpass',
    policy: provider.transactionObservationPolicy!,
  }
  const db = createDb(':memory:')
  const initial = await persistTransactionObservations(
    db,
    profile,
    (await provider.invoke('transactions.list', {})).items,
  )

  rows.push({ ...purchase, riyouKin: '-500' })
  const next = await persistTransactionObservations(
    db,
    profile,
    (await provider.invoke('transactions.list', {})).items,
  )

  expect(next).toHaveLength(2)
  expect(next[0]!.observation.id).toBe(initial[0]!.observation.id)
  expect(next[0]!.observation.transaction.direction).toBe('debit')
  expect(next[1]!.observation.id).not.toBe(initial[0]!.observation.id)
  expect(next[1]!.observation.transaction.direction).toBe('credit')
})
