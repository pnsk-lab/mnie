import type { MarketCode } from './types'

export type MarketRegion = 'domestic' | 'us'

const DOMESTIC_TO_MTS = {
  XTKS: 'TKY',
} as const satisfies Record<string, string>

const MTS_TO_DOMESTIC = Object.fromEntries(
  Object.entries(DOMESTIC_TO_MTS).map(([mic, mts]) => [mts, mic]),
) as Record<string, MarketCode>

const US_MARKETS = new Set<MarketCode>(['XNAS', 'XNYS', 'ARCX'])

export const marketRegion = (market: MarketCode | undefined, methodName: string): MarketRegion => {
  if (!market) throw new Error(`${methodName} requires market`)
  if (market in DOMESTIC_TO_MTS) return 'domestic'
  if (market === 'STK') return 'domestic'
  if (US_MARKETS.has(market)) return 'us'
  throw new Error(`${methodName} does not support market: ${market}`)
}

export const isUsMarket = (market: MarketCode | undefined) =>
  market != null && US_MARKETS.has(market)

export const domesticMarketToMts = (market: MarketCode | undefined, methodName: string) => {
  if (!market) throw new Error(`${methodName} requires market`)
  const mts = DOMESTIC_TO_MTS[market as keyof typeof DOMESTIC_TO_MTS]
  if (!mts) throw new Error(`${methodName} does not support domestic market: ${market}`)
  return mts
}

export const mtsMarketToDomestic = (market: string | undefined): MarketCode | undefined => {
  if (!market) return undefined
  return MTS_TO_DOMESTIC[market]
}

export const requireDomesticMarket = (market: MarketCode | undefined, methodName: string) => {
  const region = marketRegion(market, methodName)
  if (region !== 'domestic') {
    throw new Error(`${methodName} supports only domestic markets`)
  }
}

export const requireUsMarket = (market: MarketCode | undefined, methodName: string) => {
  const region = marketRegion(market, methodName)
  if (region !== 'us') {
    throw new Error(`${methodName} supports only US stock markets`)
  }
}
