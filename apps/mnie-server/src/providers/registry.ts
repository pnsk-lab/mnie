import { eq } from 'drizzle-orm'
import {
  createProvider as createMobileSuicaProvider,
  exportSession as exportMobileSuicaSession,
  importSession as importMobileSuicaSession,
  login as loginMobileSuica,
  type MobileSuicaProfile,
} from '@mnie/provider-mobile-suica'
import {
  createProvider as createPayPayBankProvider,
  exportSession as exportPayPayBankSession,
  importSession as importPayPayBankSession,
  login as loginPayPayBank,
  type PayPayBankSession,
} from '@mnie/provider-paypay-bank'
import {
  createProvider as createSmbcDirectProvider,
  exportSession as exportSmbcDirectSession,
  importSession as importSmbcDirectSession,
  loginWithPasskey as loginSmbcDirect,
  type SmbcDirectLoginChallenge,
  type SmbcDirectSession,
} from '@mnie/provider-smbc-direct'
import type {
  FinancialProvider,
  OperationAvailability,
  OperationMap,
  ProviderAvailability,
  OperationAvailabilityRequest,
  ProfileDescriptor,
} from '@mnie/types'
import type { ServerConfig } from '../config'
import type { Db } from '../db'
import { accountProfiles, assetValuations, historySyncs, historyTransactions } from '../db/schema'
import { syncInitialHistory } from '../history'
import { withProfileLock } from '../profile-lock'
import { connectSbi } from './sbi'
import { randomId } from '../security/crypto'
import { deleteSecret, readSecret, saveSecret } from '../security/keyring'
import { operationAvailability } from './operations'
import type {
  SbiPasskeySource,
  StoredMobileSuicaSecret,
  StoredPayPayBankSecret,
  StoredPayPaySecSecret,
  StoredSbiPasskeySecret,
  StoredSmbcDirectSecret,
} from './credentials'
import { openPayPaySec } from './paypay-sec'
import { normalizePayPaySecCredential } from './paypay-sec-options'

export type AccountProfile = typeof accountProfiles.$inferSelect

export interface OpenProvider {
  profile: AccountProfile
  provider: FinancialProvider<OperationMap>
  persist(): Promise<void>
  /** Releases server-side resources without logging out the persisted remote session. */
  release(): Promise<void>
}

export type ConnectionResult =
  | { status: 'connected'; profileId: string; providerId: string }
  | {
      status: 'interaction-required'
      profileId: string
      providerId: string
      interaction: {
        id: string
        kind: 'qr'
        url: string
        qrUrl: string
      }
    }

export type ProviderConnection =
  | { connection: Extract<ConnectionResult, { status: 'connected' }>; open: OpenProvider }
  | {
      connection: Extract<ConnectionResult, { status: 'interaction-required' }>
      open?: undefined
    }

interface PendingSmbcInteraction {
  id: string
  profile: AccountProfile
  challenge: SmbcDirectLoginChallenge
}

interface PendingMobileSuicaInteraction {
  label: string
  user: string
  password: string
  createProfile: boolean
  answer: (value: string) => void
  login: Promise<MobileSuicaProfile>
  profileId: string
  keyringAccount: string
}

const asProvider = <Operations>(provider: FinancialProvider<Operations>) =>
  provider as unknown as FinancialProvider<OperationMap>

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause)

const requiredCredential = (credentials: Record<string, unknown>, key: string) => {
  const value = credentials[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`credentials.${key} is required`)
  return value.trim()
}

const optionalCredential = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const tokyoOffsetMs = 9 * 60 * 60_000
const smbcDirectHistoryStart = new Date('2019-01-01T00:00:00+09:00')
const smbcDirectHistoryStartDate = '20190101'
const compactDate = (date: Date) => {
  const tokyo = new Date(date.getTime() + tokyoOffsetMs)
  return `${tokyo.getUTCFullYear()}${String(tokyo.getUTCMonth() + 1).padStart(2, '0')}${String(tokyo.getUTCDate()).padStart(2, '0')}`
}

const dashedDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const splitDateRange = (from: Date, to: Date): [Date, Date, Date, Date] | undefined => {
  const start = new Date(from)
  start.setHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setHours(0, 0, 0, 0)
  if (start >= end) return undefined

  const middle = new Date(start.getTime() + Math.floor((end.getTime() - start.getTime()) / 2))
  middle.setHours(0, 0, 0, 0)
  const next = new Date(middle)
  next.setDate(next.getDate() + 1)
  return [from, middle, next, to]
}

export class ProviderRegistry {
  readonly #pendingSmbc = new Map<string, PendingSmbcInteraction>()
  readonly #pendingMobileSuica = new Map<string, PendingMobileSuicaInteraction>()

  constructor(
    readonly db: Db,
    readonly config: ServerConfig,
  ) {}

  profiles() {
    return this.db.select().from(accountProfiles).orderBy(accountProfiles.createdAt)
  }

  definitions() {
    return [
      {
        id: 'sbisec',
        name: 'SBI Securities',
        kind: 'brokerage',
        authentication: 'passkey',
        defaultColor: '#0a3e86',
        credentialFields: [
          { name: 'source', kind: 'passkey', required: true, secret: true },
          { name: 'tradePassword', kind: 'password', required: false, secret: true },
          { name: 'deviceId', kind: 'text', required: false, secret: true },
        ],
      },
      {
        id: 'paypay-sec',
        name: 'PayPay Securities',
        kind: 'brokerage',
        authentication: 'passkey',
        defaultColor: '#ff003c',
        credentialFields: [
          { name: 'credential', kind: 'passkey', required: true, secret: true },
          { name: 'tradePassword', kind: 'password', required: true, secret: true },
        ],
      },
      {
        id: 'smbc-direct',
        name: 'SMBC Direct',
        kind: 'bank',
        authentication: 'credentials-and-qr',
        defaultColor: '#005b47',
        credentialFields: [
          { name: 'user', kind: 'text', required: true, secret: true },
          { name: 'password', kind: 'password', required: true, secret: true },
          { name: 'accountItemCode', kind: 'text', required: false, secret: true },
        ],
      },
      {
        id: 'mobilesuica',
        name: 'Mobile Suica',
        kind: 'transit-card',
        authentication: 'credentials-and-captcha',
        defaultColor: '#2f8e3c',
        credentialFields: [
          { name: 'user', kind: 'text', required: true, secret: true },
          { name: 'password', kind: 'password', required: true, secret: true },
        ],
      },
      {
        id: 'paypay-bank',
        name: 'PayPay Bank',
        kind: 'bank',
        authentication: 'credentials',
        defaultColor: '#f5bac4',
        credentialFields: [
          { name: 'branchNo', kind: 'text', required: true, secret: true },
          { name: 'accountNo', kind: 'text', required: true, secret: true },
          { name: 'password', kind: 'password', required: true, secret: true },
        ],
      },
    ] as const
  }

  descriptor(profile: AccountProfile): ProfileDescriptor {
    const definition = this.definitions().find((item) => item.id === profile.provider)
    const category =
      definition?.kind === 'brokerage' || definition?.kind === 'bank'
        ? definition.kind
        : definition?.kind === 'transit-card'
          ? 'transit'
          : 'other'
    return {
      id: profile.id,
      provider: {
        id: profile.provider,
        name: definition?.name ?? profile.provider,
      },
      label: profile.label,
      category,
      defaultColor: definition?.defaultColor ?? '#9aa0a9',
    }
  }

  credentialOrigin(providerId: string) {
    const configured =
      providerId === 'sbisec'
        ? this.config.authBaseUrl
        : providerId === 'smbc-direct'
          ? (this.config.smbcDirectLoginBaseUrl ?? this.config.smbcDirectBaseUrl)
          : providerId === 'mobilesuica'
            ? this.config.mobileSuicaBaseUrl
            : providerId === 'paypay-bank'
              ? this.config.payPayBankBaseUrl
              : providerId === 'paypay-sec'
                ? this.config.payPaySecPasskeyOrigin
                : undefined
    if (!configured) throw new Error(`provider origin is not configured: ${providerId}`)
    return new URL(configured).origin
  }

  async profile(profileId: string): Promise<AccountProfile> {
    const [profile] = await this.db
      .select()
      .from(accountProfiles)
      .where(eq(accountProfiles.id, profileId))
      .limit(1)
    if (!profile) throw new Error('profile not found')
    return profile
  }

  async createProfile(input: {
    providerId: string
    label: string
    credentials: Record<string, unknown>
  }) {
    const { providerId, label, credentials } = input
    const now = new Date()
    const id = randomId(providerId)
    const keyringAccount = `profile:${id}`

    if (providerId === 'sbisec') {
      const source = credentials.source as SbiPasskeySource | undefined
      if (!source || (source.kind !== 'json' && source.kind !== 'bitwarden')) {
        throw new Error('credentials.source is required')
      }
      if (source.kind === 'json' && !source.credential) {
        throw new Error('credentials.source.credential is required')
      }
      if (source.kind === 'bitwarden' && (!source.masterPassword || !source.rpId)) {
        throw new Error('Bitwarden masterPassword and rpId are required')
      }
      await saveSecret(keyringAccount, {
        source,
        tradePassword: optionalCredential(credentials.tradePassword),
        deviceId: optionalCredential(credentials.deviceId),
      } satisfies StoredSbiPasskeySecret)
    } else if (providerId === 'paypay-sec') {
      const credential = normalizePayPaySecCredential(
        credentials.credential,
        this.config.payPaySecPasskeyOrigin,
      )
      await saveSecret(keyringAccount, {
        credential,
        deviceId: randomId('device'),
        tradePassword: requiredCredential(credentials, 'tradePassword'),
      } satisfies StoredPayPaySecSecret)
    } else if (providerId === 'smbc-direct') {
      const user = requiredCredential(credentials, 'user')
      if (!/^\d+-\d+$/.test(user)) throw new Error('user must be <branch>-<account>')
      await saveSecret(keyringAccount, {
        user,
        password: requiredCredential(credentials, 'password'),
        accountItemCode: optionalCredential(credentials.accountItemCode),
      } satisfies StoredSmbcDirectSecret)
    } else if (providerId === 'paypay-bank') {
      const branchNo = requiredCredential(credentials, 'branchNo')
      const accountNo = requiredCredential(credentials, 'accountNo')
      const password = requiredCredential(credentials, 'password')
      if (!/^\d{3}$/.test(branchNo)) throw new Error('branchNo must be three digits')
      if (!/^\d{7}$/.test(accountNo)) throw new Error('accountNo must be seven digits')
      if (!/^[\x20-\x7e]{1,32}$/.test(password)) {
        throw new Error('password must be 1–32 ASCII characters')
      }
      await saveSecret(keyringAccount, {
        branchNo,
        accountNo,
        password,
      } satisfies StoredPayPayBankSecret)
    } else {
      throw new Error(`provider profile creation is not registered: ${providerId}`)
    }

    try {
      await this.db.insert(accountProfiles).values({
        id,
        provider: providerId,
        label,
        keyringAccount,
        createdAt: now,
        updatedAt: now,
      })
    } catch (cause) {
      await deleteSecret(keyringAccount)
      throw cause
    }
    if (providerId === 'sbisec' || providerId === 'paypay-sec') {
      try {
        await syncInitialHistory(this.db, this, id)
      } catch (cause) {
        await this.deleteProfile(id)
        throw cause
      }
    }
    return { id, provider: providerId, label, createdAt: now, updatedAt: now }
  }

  async deleteProfile(profileId: string) {
    const profile = await this.profile(profileId)
    await this.db.transaction(async (tx) => {
      await tx.delete(assetValuations).where(eq(assetValuations.profileId, profile.id))
      await tx.delete(historyTransactions).where(eq(historyTransactions.profileId, profile.id))
      await tx.delete(historySyncs).where(eq(historySyncs.profileId, profile.id))
      await tx.delete(accountProfiles).where(eq(accountProfiles.id, profile.id))
    })
    await deleteSecret(profile.keyringAccount)
  }

  async open(
    profileOrId: AccountProfile | string,
    options: { forceLogin?: boolean } = {},
  ): Promise<OpenProvider> {
    const profile = typeof profileOrId === 'string' ? await this.profile(profileOrId) : profileOrId

    if (profile.provider === 'sbisec') {
      const provider = await connectSbi(this.db, this.config, profile.id)
      return {
        profile,
        provider,
        persist: async () => {},
        release: async () => {},
      }
    }

    if (profile.provider === 'paypay-sec') {
      const opened = await openPayPaySec(this.db, this.config, profile.id, options)
      return {
        profile,
        provider: opened.provider,
        persist: opened.persist,
        release: async () => {},
      }
    }

    if (profile.provider === 'smbc-direct') {
      const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
      if (!secret.session) {
        throw new Error('SMBC Direct authentication is required')
      }
      const imported = await importSmbcDirectSession(secret.session as SmbcDirectSession)
      const provider = asProvider(createSmbcDirectProvider(imported))
      return {
        profile,
        provider,
        persist: async () =>
          saveSecret(profile.keyringAccount, {
            ...secret,
            session: exportSmbcDirectSession(imported),
          } satisfies StoredSmbcDirectSecret),
        release: async () => {},
      }
    }

    if (profile.provider === 'paypay-bank') {
      const secret = await readSecret<StoredPayPayBankSecret>(profile.keyringAccount)
      const imported =
        !options.forceLogin && secret.session
          ? await importPayPayBankSession(secret.session as PayPayBankSession)
          : await loginPayPayBank({
              branchNo: secret.branchNo,
              accountNo: secret.accountNo,
              password: secret.password,
              baseURL: this.config.payPayBankBaseUrl,
            })
      const provider = asProvider(createPayPayBankProvider(imported))
      return {
        profile,
        provider,
        persist: async () =>
          saveSecret(profile.keyringAccount, {
            ...secret,
            session: exportPayPayBankSession(imported),
          } satisfies StoredPayPayBankSecret),
        release: async () => {},
      }
    }

    if (profile.provider === 'mobilesuica') {
      const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
      if (!secret.session) throw new Error('Mobile Suica authentication is required')
      const imported = await importMobileSuicaSession(secret.session)
      const provider = asProvider(createMobileSuicaProvider(imported))
      return {
        profile,
        provider,
        persist: async () =>
          saveSecret(profile.keyringAccount, {
            ...secret,
            session: exportMobileSuicaSession(imported),
          } satisfies StoredMobileSuicaSecret),
        release: async () => {},
      }
    }

    throw new Error(`provider is not registered: ${profile.provider}`)
  }

  async use<T>(
    profileOrId: AccountProfile | string,
    action: (open: OpenProvider) => Promise<T>,
    options: { forceLogin?: boolean } = {},
  ) {
    const profile = typeof profileOrId === 'string' ? await this.profile(profileOrId) : profileOrId
    return withProfileLock(profile.id, async () => {
      const open = await this.open(profile, options)
      try {
        const value = await action(open)
        await open.persist()
        return value
      } finally {
        await open.release()
      }
    })
  }

  async connect(profileId: string): Promise<ProviderConnection> {
    const profile = await this.profile(profileId)
    if (profile.provider === 'smbc-direct') {
      const secret = await readSecret<StoredSmbcDirectSecret>(profile.keyringAccount)
      if (secret.session) {
        const open = await this.open(profile)
        let availability: ProviderAvailability
        try {
          availability = await this.availabilityForProvider(open.provider)
        } catch (cause) {
          await open.release()
          throw cause
        }
        if (availability.connection.ok) {
          return {
            connection: {
              status: 'connected',
              profileId: profile.id,
              providerId: profile.provider,
            },
            open,
          }
        }
        try {
          await open.persist()
        } finally {
          await open.release()
        }
      }

      if (!this.config.smbcDirectBaseUrl || !this.config.smbcDirectLoginBaseUrl) {
        throw new Error('SMBC_DIRECT_BASE_URL and SMBC_DIRECT_LOGIN_BASE_URL are required')
      }
      const challenge = await loginSmbcDirect({
        user: secret.user,
        password: secret.password,
        accountItemCode: secret.accountItemCode,
        baseURL: this.config.smbcDirectBaseUrl,
        loginURL: this.config.smbcDirectLoginBaseUrl,
      })
      const interaction = { id: randomId('interaction'), profile, challenge }
      this.#pendingSmbc.set(interaction.id, interaction)
      return {
        connection: {
          status: 'interaction-required',
          profileId: profile.id,
          providerId: profile.provider,
          interaction: {
            id: interaction.id,
            kind: 'qr',
            url: challenge.url,
            qrUrl: challenge.qrurl,
          },
        },
      }
    }

    let open: OpenProvider | undefined = await this.open(profile)
    try {
      let availability = await this.availabilityForProvider(open.provider)
      if (!availability.connection.ok && profile.provider === 'paypay-bank') {
        const expired = open
        open = undefined
        try {
          await expired.persist()
        } finally {
          await expired.release()
        }
        open = await this.open(profile, { forceLogin: true })
        availability = await this.availabilityForProvider(open.provider)
      }
      if (!availability.connection.ok) {
        throw new Error(message(availability.connection.message))
      }
      return {
        connection: {
          status: 'connected',
          profileId: profile.id,
          providerId: profile.provider,
        },
        open,
      }
    } catch (cause) {
      await open?.release()
      throw cause
    }
  }

  async completeConnection(profileId: string, interactionId: string): Promise<ProviderConnection> {
    const pending = this.#pendingSmbc.get(interactionId)
    if (!pending || pending.profile.id !== profileId) {
      throw new Error('profile authentication interaction was not found')
    }
    this.#pendingSmbc.delete(interactionId)
    const imported = await pending.challenge.finished2fa()
    const secret = await readSecret<StoredSmbcDirectSecret>(pending.profile.keyringAccount)
    await saveSecret(pending.profile.keyringAccount, {
      ...secret,
      session: exportSmbcDirectSession(imported),
    } satisfies StoredSmbcDirectSecret)
    return {
      connection: {
        status: 'connected',
        profileId: pending.profile.id,
        providerId: pending.profile.provider,
      },
      open: {
        profile: pending.profile,
        provider: asProvider(createSmbcDirectProvider(imported)),
        persist: async () =>
          saveSecret(pending.profile.keyringAccount, {
            ...secret,
            session: exportSmbcDirectSession(imported),
          } satisfies StoredSmbcDirectSecret),
        release: async () => {},
      },
    }
  }

  async startMobileSuicaLogin(
    input: Record<string, unknown>,
    solveCaptcha: (image: Uint8Array) => Promise<string>,
  ) {
    const baseURL = this.config.mobileSuicaBaseUrl
    if (!baseURL) throw new Error('MOBILE_SUICA_BASE_URL is required')
    const reauthenticateProfileId = optionalCredential(input.profileId)
    let label: string
    let user: string
    let password: string
    let profileId: string
    let keyringAccount: string
    let createProfile: boolean

    if (reauthenticateProfileId) {
      const profile = await this.profile(reauthenticateProfileId)
      if (profile.provider !== 'mobilesuica') throw new Error('profile is not Mobile Suica')
      const secret = await readSecret<StoredMobileSuicaSecret>(profile.keyringAccount)
      if (!secret.user || !secret.password) {
        throw new Error('Mobile Suica credentials are not stored')
      }
      label = profile.label
      user = secret.user
      password = secret.password
      profileId = profile.id
      keyringAccount = profile.keyringAccount
      createProfile = false
    } else {
      label = requiredCredential(input, 'label')
      user = requiredCredential(input, 'user')
      password = requiredCredential(input, 'password')
      profileId = randomId('mobilesuica')
      keyringAccount = `profile:${profileId}`
      createProfile = true
    }

    let publishCaptcha:
      | ((value: { interactionId: string; imageDataUrl: string; suggestedAnswer: string }) => void)
      | undefined
    let rejectCaptcha: ((reason?: unknown) => void) | undefined
    const captcha = new Promise<{
      interactionId: string
      imageDataUrl: string
      suggestedAnswer: string
    }>((resolve, reject) => {
      publishCaptcha = resolve
      rejectCaptcha = reject
    })
    let login: Promise<MobileSuicaProfile> | undefined
    let captchaAttempt = 0
    login = loginMobileSuica({
      baseURL,
      user,
      password,
      onCaptcha: async ({ image, contentType }) => {
        const interactionId = randomId('interaction')
        const suggestedAnswer = await solveCaptcha(image)
        if (captchaAttempt > 0) return suggestedAnswer
        captchaAttempt += 1
        const answer = new Promise<string>((resolve) => {
          if (!login) throw new Error('Mobile Suica login was not initialized')
          this.#pendingMobileSuica.set(interactionId, {
            label,
            user,
            password,
            createProfile,
            answer: resolve,
            login,
            profileId,
            keyringAccount,
          })
        })
        publishCaptcha?.({
          interactionId,
          imageDataUrl: `data:${contentType};base64,${Buffer.from(image).toString('base64')}`,
          suggestedAnswer,
        })
        return answer
      },
    })
    void login.catch(rejectCaptcha)
    return captcha
  }

  async completeMobileSuicaLogin(interactionId: string, answer: string) {
    const pending = this.#pendingMobileSuica.get(interactionId)
    if (!pending) throw new Error('CAPTCHA interaction not found or expired')
    this.#pendingMobileSuica.delete(interactionId)
    pending.answer(answer)
    const session = await pending.login
    const now = new Date()
    await saveSecret(pending.keyringAccount, {
      session: exportMobileSuicaSession(session),
      user: pending.user,
      password: pending.password,
    } satisfies StoredMobileSuicaSecret)
    if (pending.createProfile) {
      await this.db.insert(accountProfiles).values({
        id: pending.profileId,
        provider: 'mobilesuica',
        label: pending.label,
        keyringAccount: pending.keyringAccount,
        createdAt: now,
        updatedAt: now,
      })
      try {
        await syncInitialHistory(this.db, this, pending.profileId)
      } catch (cause) {
        await this.deleteProfile(pending.profileId)
        throw cause
      }
    } else {
      await this.db
        .update(accountProfiles)
        .set({ updatedAt: now })
        .where(eq(accountProfiles.id, pending.profileId))
    }
    return { profile: { id: pending.profileId } }
  }

  async availability(
    profileOrId: AccountProfile | string,
    request?: OperationAvailabilityRequest,
  ): Promise<ProviderAvailability> {
    try {
      const profile =
        typeof profileOrId === 'string' ? await this.profile(profileOrId) : profileOrId
      const check = (forceLogin = false) =>
        this.use(profile, ({ provider }) => this.availabilityForProvider(provider, request), {
          forceLogin,
        })
      const initial = await check()
      if (!initial.connection.ok && profile.provider === 'paypay-bank') {
        return check(true)
      }
      return initial
    } catch (cause) {
      return {
        connection: { ok: false, reason: 'AUTHENTICATION_REQUIRED', message: message(cause) },
        operations: {},
        checkedAt: new Date().toISOString(),
      }
    }
  }

  async availabilityForProvider(
    provider: FinancialProvider<OperationMap>,
    request?: OperationAvailabilityRequest,
  ): Promise<ProviderAvailability> {
    const checkedAt = new Date().toISOString()
    const rawConnection = await provider.checkAvailability()
    const connection = rawConnection.ok
      ? rawConnection
      : { ...rawConnection, message: message(rawConnection.message) }
    const advertised = provider.operations()
    const requestedOperations = request ? [request.operation] : advertised
    const operations = Object.fromEntries(
      await Promise.all(
        requestedOperations.map(async (operation) => {
          const availability: OperationAvailability = connection.ok
            ? await operationAvailability(provider, {
                operation,
                input: request?.operation === operation ? request.input : undefined,
              })
            : {
                available: false,
                reason: connection.reason,
                message: connection.message,
              }
          return [operation, availability] as const
        }),
      ),
    )
    return { connection, operations, checkedAt }
  }

  assetRefreshIntervalMs(profile: AccountProfile) {
    return profile.provider === 'sbisec' ? 5 * 60_000 : 60 * 60_000
  }

  sessionRefreshIntervalMs(profile: AccountProfile) {
    return profile.provider === 'smbc-direct' || profile.provider === 'mobilesuica'
      ? 5 * 60_000
      : undefined
  }

  historyListInput(profile: AccountProfile, from: Date, to: Date) {
    if (profile.provider === 'smbc-direct') {
      return { from: compactDate(from), to: compactDate(to), kinds: ['transaction'] as const }
    }
    if (profile.provider === 'paypay-bank') {
      return { from: dashedDate(from), to: dashedDate(to), kinds: ['transaction'] as const }
    }
    return { kinds: ['transaction'] as const }
  }

  normalizeHistoryRange(profile: AccountProfile, from: Date, to: Date): [Date, Date] | undefined {
    if (profile.provider !== 'smbc-direct') return [from, to]
    if (compactDate(to) < smbcDirectHistoryStartDate) return undefined
    return [compactDate(from) < smbcDirectHistoryStartDate ? smbcDirectHistoryStart : from, to]
  }

  splitHistoryRange(profile: AccountProfile, cause: unknown, from: Date, to: Date) {
    if (
      profile.provider !== 'smbc-direct' ||
      !(cause instanceof Error) ||
      !cause.message.includes('02194-E')
    ) {
      return undefined
    }
    return splitDateRange(from, to)
  }
}

export const createProviderRegistry = (db: Db, config: ServerConfig) =>
  new ProviderRegistry(db, config)
