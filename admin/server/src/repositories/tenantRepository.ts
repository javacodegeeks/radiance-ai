/**
 * Write-capable side of the shared `tenants` collection ({ tenantId,
 * subdomain, name }) — admin/server/ owns writes here, same pattern as
 * pharmacist_corrections. ai/src/repositories/tenantRepository.ts has the
 * read-only counterpart consumer chat sessions resolve their Host header
 * subdomain against.
 */
import { getDb } from '../infra/mongo';
import { RepositoryError } from '../common/errors';

const COLLECTION_NAME = 'tenants';

export interface TenantRecord {
  tenantId:  string;
  subdomain: string;
  name:      string;
}

/**
 * Idempotent — called once when a tenant's admin registers/updates their
 * own subdomain slug after their Clerk Organization exists. tenantId is
 * always the caller's own org id (see middleware/auth.ts), so a tenant can
 * only ever register its own mapping, never another tenant's.
 */
export async function registerTenant(input: TenantRecord): Promise<void> {
  console.log(`[tenantRepository] registerTenant tenant=${input.tenantId} subdomain=${input.subdomain} name="${input.name}"`);
  try {
    const db = await getDb();
    await db.collection<TenantRecord>(COLLECTION_NAME).updateOne(
      { tenantId: input.tenantId },
      { $set: { subdomain: input.subdomain, name: input.name } },
      { upsert: true },
    );
    console.log(`[tenantRepository] registerTenant → tenant=${input.tenantId} saved`);
  } catch (err) {
    console.error(`[tenantRepository] registerTenant failed for tenant=${input.tenantId}`, err);
    throw new RepositoryError('tenantRepository', 'Failed to register tenant', err);
  }
}

export async function findTenant(tenantId: string): Promise<TenantRecord | null> {
  try {
    const db = await getDb();
    const tenant = await db.collection<TenantRecord>(COLLECTION_NAME).findOne({ tenantId }, { projection: { _id: 0 } });
    console.log(`[tenantRepository] findTenant tenant=${tenantId} → ${tenant ? 'found' : 'not registered'}`);
    return tenant;
  } catch (err) {
    console.error(`[tenantRepository] findTenant failed for tenant=${tenantId}`, err);
    throw new RepositoryError('tenantRepository', 'Failed to look up tenant', err);
  }
}
