/**
 * Verifies the SBI virtual-account stack against a real session: physical asset
 * refresh (deposit-inclusive cash), the complete open-order sync path, and
 * reconciliation of the SBI physical account.
 *
 * With --remediate, un-attributable assets (allocated but absent at the broker)
 * are returned to the system Unallocated account and reconciliation is
 * approved, mirroring the owner-facing reconciliation UI actions.
 */
import { resolve } from 'node:path'
import { createDb } from '../apps/mnie-server/src/db'
import { loadConfig } from '../apps/mnie-server/src/config'
import { ProviderRegistry } from '../apps/mnie-server/src/providers/registry'
import { PhysicalAccountGateway } from '../apps/mnie-server/src/physical-account-gateway'
import { syncAccountOrders } from '../apps/mnie-server/src/account-sync'
import {
  approvePhysicalAccountReconciliation,
  listDerivedUnallocatedAssets,
  reconcilePhysicalAccount,
  transferVirtualAsset,
} from '../apps/mnie-server/src/virtual-accounts'

const REMEDIATE = process.argv.includes('--remediate')
const db = createDb(resolve(process.env.MNIE_DATABASE_PATH ?? 'apps/mnie-app/data/mnie-app.sqlite'))
const config = loadConfig()
const registry = new ProviderRegistry(db, config)
const gateway = new PhysicalAccountGateway(registry)

const physical = await db.query.financialAccounts.findMany({
  where: (t, { eq }) => eq(t.kind, 'brokerage'),
})
const sbi = physical.find((account) => account.provider === 'sbisec') ?? physical[0]
if (!sbi) throw new Error('no brokerage physical account')
console.log('physical account:', sbi.id, sbi.providerAccountId)

const reconciliation = await syncAccountOrders(db, gateway, sbi.id)
console.log('reconciliation:', JSON.stringify(reconciliation, null, 2))

const assets = await db.query.physicalAccountAssets.findMany({
  where: (t, { eq }) => eq(t.physicalAccountId, sbi.id),
})
console.log(
  'physical assets:',
  JSON.stringify(assets.map((a) => ({ key: a.assetKey, amount: a.amount }))),
)

const accounts = await db.query.virtualAccounts.findMany({
  where: (t, { eq }) => eq(t.physicalAccountId, sbi.id),
})
console.log(
  'account statuses:',
  accounts.map((a) => `${a.label ?? a.id}: ${a.status}`),
)

if (REMEDIATE && reconciliation.deficits.length) {
  const unallocated = accounts.find((account) => account.systemRole === 'unallocated')
  if (!unallocated) throw new Error('unallocated account not found')
  for (const deficit of reconciliation.deficits) {
    const magnitude = deficit.available.replace('-', '')
    const holder = (
      await db.query.virtualAccountAssets.findMany({
        where: (t, { eq }) => eq(t.assetKey, deficit.assetKey),
      })
    )
      .filter((row) => row.virtualAccountId !== unallocated.id && Number(row.available) > 0)
      .sort((left, right) => Number(right.available) - Number(left.available))[0]
    if (!holder) throw new Error(`no holding account can cover deficit ${deficit.assetKey}`)
    const derived = listDerivedUnallocatedAssets(db, sbi.id).find(
      (asset) => asset.assetKey === deficit.assetKey,
    )
    console.log(
      `remediating ${deficit.assetKey}: ${holder.virtualAccountId} -> unallocated ${magnitude}`,
    )
    await transferVirtualAsset(db, {
      fromAccountId: holder.virtualAccountId,
      toAccountId: unallocated.id,
      assetKey: deficit.assetKey,
      amount: magnitude,
      expectedFromVersion: holder.version,
      expectedToVersion: derived?.version ?? 0,
      reason: 'reconciliation: un-attributable asset returned to unallocated',
    })
  }
}

const updated = await db.query.virtualAccounts.findMany({
  where: (t, { eq }) => eq(t.physicalAccountId, sbi.id),
})
if (REMEDIATE && updated.some((a) => a.status === 'reconciliation_required')) {
  const clean = await reconcilePhysicalAccount(db, sbi.id)
  if (clean.deficits.length)
    throw new Error(`remaining deficits: ${JSON.stringify(clean.deficits)}`)
  await approvePhysicalAccountReconciliation(db, sbi.id)
  const after = await db.query.virtualAccounts.findMany({
    where: (t, { eq }) => eq(t.physicalAccountId, sbi.id),
  })
  console.log(
    'after approval:',
    after.map((a) => `${a.label ?? a.id}: ${a.status}`),
  )
}

await gateway.close()
console.log('done')
