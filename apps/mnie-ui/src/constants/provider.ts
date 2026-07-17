import type { AccountProfile } from '../api'

export const defaultProviderColors: Record<string, string> = {
  'smbc-direct': '#005b47',
  'mobile-suica': '#2F8E3C',
  'paypay-bank': '#f5bac4',
  'paypay-sec': '#ff003c',
  'starbucks-jp': '#00704a',
  sbisec: '#0a3e86',
}

const generatedProviderColor = (provider: string) => {
  let hash = 0
  for (const character of provider) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 35% 55%)`
}

export const profileColor = (
  profile: Pick<AccountProfile, 'provider' | 'color'> & { defaultColor?: string },
) =>
  profile.color ||
  profile.defaultColor ||
  defaultProviderColors[profile.provider] ||
  generatedProviderColor(profile.provider)
