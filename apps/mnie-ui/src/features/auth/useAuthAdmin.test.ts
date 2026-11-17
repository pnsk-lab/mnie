import { beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import {
  fillFromAuthManager,
  updateApiKeySettings,
  getStatus,
  saveStarbucksProfile,
} from '../../api'
import { useAuthAdmin } from './useAuthAdmin'
import { notifications } from '../feedback/feedback'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  fillFromAuthManager: vi.fn(),
  updateApiKeySettings: vi.fn(),
  getStatus: vi.fn(),
  saveStarbucksProfile: vi.fn(),
}))
beforeEach(() => {
  vi.resetAllMocks()
  notifications.value = []
})
const credential = { id: 'c', name: 'c', username: 'user', password: 'filled', passkeys: [] }
const adminWithPassword = () => {
  const admin = useAuthAdmin()
  admin.selectedAuthManagerId.value = 'manager'
  admin.authManagerMasterPassword.value = 'entered'
  return admin
}

describe('credential input survives unsuccessful actions', () => {
  test('network or unlock errors preserve master password and current provider inputs', async () => {
    const admin = adminWithPassword()
    admin.starbucksPassword.value = 'original'
    vi.mocked(fillFromAuthManager).mockRejectedValue(new Error('unlock failed'))
    await expect(admin.fillProviderCredentials('starbucks-jp')).rejects.toThrow('unlock failed')
    expect(admin.authManagerMasterPassword.value).toBe('entered')
    expect(admin.starbucksPassword.value).toBe('original')
  })
  test.each([{ credentials: [] }, { credentials: [credential, credential] }])(
    'ambiguous credentials preserve the password (%j)',
    async ({ credentials }) => {
      const admin = adminWithPassword()
      vi.mocked(fillFromAuthManager).mockResolvedValue({ credentials })
      await expect(admin.fillProviderCredentials('starbucks-jp')).rejects.toThrow('1件に特定')
      expect(admin.authManagerMasterPassword.value).toBe('entered')
    },
  )
  test('incomplete credentials do not erase existing input', async () => {
    const admin = adminWithPassword()
    admin.starbucksPassword.value = 'original'
    vi.mocked(fillFromAuthManager).mockResolvedValue({
      credentials: [{ ...credential, password: '' }],
    })
    await expect(admin.fillProviderCredentials('starbucks-jp')).rejects.toThrow('見つかりません')
    expect(admin.authManagerMasterPassword.value).toBe('entered')
    expect(admin.starbucksPassword.value).toBe('original')
  })
  test('successful fill populates input and clears the master password', async () => {
    const admin = adminWithPassword()
    vi.mocked(fillFromAuthManager).mockResolvedValue({ credentials: [credential] })
    await admin.fillProviderCredentials('starbucks-jp')
    expect(admin.starbucksPassword.value).toBe('filled')
    expect(admin.authManagerMasterPassword.value).toBe('')
  })
  test('a failed save preserves the provider password', async () => {
    const admin = useAuthAdmin()
    admin.starbucksPassword.value = 'original'
    vi.mocked(saveStarbucksProfile).mockRejectedValue(new Error('save failed'))
    await expect(admin.addStarbucksProfile()).rejects.toThrow('save failed')
    expect(admin.starbucksPassword.value).toBe('original')
  })
  test('successful save plus failed reload reports the saved outcome without a duplicate retry', async () => {
    const admin = useAuthAdmin()
    vi.mocked(updateApiKeySettings).mockResolvedValue({ ok: true })
    vi.mocked(getStatus).mockRejectedValue(new Error('offline'))
    await expect(
      admin.saveApiKeySettings({ id: 'key', label: 'key', createdAt: '', scopes: ['read'] }),
    ).resolves.toBeUndefined()
    expect(updateApiKeySettings).toHaveBeenCalledWith(
      'key',
      expect.objectContaining({ scopes: ['read'] }),
    )
    expect(notifications.value[0]?.message).toContain('変更は保存されましたが')
  })
})
