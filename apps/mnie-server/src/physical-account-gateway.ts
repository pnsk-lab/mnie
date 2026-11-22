import type { MethodAvailabilityRequest } from '@mnie/types'
import type { OpenProvider, ProviderRegistry } from './providers/registry'
import type { Db } from './db'
import type { financialAccounts } from './db/schema'
import { refreshPhysicalAccountAssets } from './physical-accounts'
import { methodAvailability } from './providers/operations'

// Only the gateway owns a live provider. Its public execution surface separates reads from writes.
export class PhysicalAccountGateway {
  #open?: OpenProvider
  constructor(private readonly providers: ProviderRegistry) {}
  async close() {
    const open = this.#open
    this.#open = undefined
    if (!open) return
    try {
      await open.persist()
    } finally {
      await open.release()
    }
  }
  async #provider(profileId: string) {
    if (this.#open?.profile.id !== profileId) {
      await this.close()
      this.#open = await this.providers.open(profileId)
    }
    return this.#open!.provider
  }
  async connect(profileId: string, _forceLogin: boolean) {
    await this.close()
    const connected = await this.providers.connect(profileId)
    this.#open = connected.open
    return connected.connection
  }
  async complete(profileId: string, interactionId: string) {
    await this.close()
    const connected = await this.providers.completeConnection(profileId, interactionId)
    this.#open = connected.open
    return connected.connection
  }
  async snapshot(db: Db, physical: typeof financialAccounts.$inferSelect) {
    return refreshPhysicalAccountAssets(db, await this.#provider(physical.profileId), physical)
  }
  async assertVirtualTrading(profileId: string) {
    const support = (await this.#provider(profileId)).accountIsolation
    if (
      !support?.physicalCashIncludesReservations ||
      !support.stableOrderReferences ||
      !support.attributableSettlementEffects ||
      !support.completeOpenOrderSnapshot
    )
      throw new Error(
        'provider cannot guarantee total cash, stable order references, and attributable settlement effects required for virtual-account trading',
      )
  }
  async methods(profileId: string) {
    return (await this.#provider(profileId)).methods()
  }
  async capabilities(profileId: string) {
    return (await this.#provider(profileId)).capabilities()
  }
  async availability(profileId: string, request?: MethodAvailabilityRequest) {
    return this.providers.availabilityForProvider(await this.#provider(profileId), request)
  }
  async methodAvailability(profileId: string, request: MethodAvailabilityRequest) {
    return methodAvailability(await this.#provider(profileId), request)
  }
  async invokeMethod(profileId: string, method: string, input: Record<string, unknown>) {
    return (await this.#provider(profileId)).invoke(method, input)
  }
  async openOrders(profileId: string, input: Record<string, unknown>) {
    const provider = await this.#provider(profileId)
    if (!provider.methods().includes('investments.orders.open'))
      throw new Error('provider cannot provide a complete open-order snapshot')
    return provider.invoke('investments.orders.open', input)
  }
  async orderSnapshot(profileId: string, input: Record<string, unknown>) {
    return (await this.#provider(profileId)).invoke('investments.orders.get', input)
  }
  async positionSnapshot(profileId: string, input: Record<string, unknown>) {
    return (await this.#provider(profileId)).invoke('investments.positions.list', input)
  }
  async previewOrder(profileId: string, input: Record<string, unknown>, replace = false) {
    return (await this.#provider(profileId)).invoke(
      replace ? 'investments.orders.replace.preview' : 'investments.orders.preview',
      input,
    )
  }
  async placeOrder(profileId: string, input: Record<string, unknown>) {
    return (await this.#provider(profileId)).invoke('investments.orders.create', input)
  }
  async replaceOrder(profileId: string, input: Record<string, unknown>) {
    return (await this.#provider(profileId)).invoke('investments.orders.replace', input)
  }
  async cancelOrder(profileId: string, input: Record<string, unknown>) {
    return (await this.#provider(profileId)).invoke('investments.orders.cancel', input)
  }
}
