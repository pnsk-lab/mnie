import type { AccountProfile } from '../api'

export const defaultProviderColors: Record<AccountProfile['provider'], string> = {
  'smbc-direct': '#005b47',
  mobilesuica: '#2F8E3C',
  'paypay-bank': '#f5bac4',
  sbisec: '#0a3e86',
}

export const profileColor = (profile: Pick<AccountProfile, 'provider' | 'color'>) =>
  profile.color || defaultProviderColors[profile.provider]
