export type MarketSession = readonly [openMinutes: number, closeMinutes: number]

const minutes = (hour: number, minute = 0) => hour * 60 + minute

export const marketTimeZones: Record<string, string> = {
  ARCX: 'America/New_York',
  XNAS: 'America/New_York',
  XNYS: 'America/New_York',
  XTKS: 'Asia/Tokyo',
}

export const countryTimeZones: Record<string, string> = {
  アメリカ: 'America/New_York',
  日本: 'Asia/Tokyo',
  米国: 'America/New_York',
  US: 'America/New_York',
  USA: 'America/New_York',
}

export const marketSessions: Record<string, readonly MarketSession[]> = {
  ARCX: [[minutes(9, 30), minutes(16)]],
  XNAS: [[minutes(9, 30), minutes(16)]],
  XNYS: [[minutes(9, 30), minutes(16)]],
  XTKS: [
    [minutes(9), minutes(11, 30)],
    [minutes(12, 30), minutes(15, 30)],
  ],
}
