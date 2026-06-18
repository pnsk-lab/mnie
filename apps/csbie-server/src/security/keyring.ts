import { getPassword, setPassword, deletePassword } from '@napi-rs/keyring/keytar'

const SERVICE = 'csbie'

export const saveSecret = async (account: string, secret: unknown) => {
  await setPassword(SERVICE, account, JSON.stringify(secret))
}

export const readSecret = async <T>(account: string): Promise<T> => {
  const secret = await getPassword(SERVICE, account)
  if (!secret) throw new Error(`secret not found: ${account}`)
  return JSON.parse(secret) as T
}

export const deleteSecret = async (account: string) => {
  await deletePassword(SERVICE, account)
}
