/**
 * Read-only — admin/server/'s tenantRepository.ts owns writes to this same
 * `tenants` collection ({ tenantId, subdomain, name }), same
 * write-side-owns-it pattern as pharmacist_corrections. No write function
 * exists in this file, by design.
 */
import { getDb } from '../infra/mongo';
import { RepositoryError } from '../common/errors';

const COLLECTION_NAME = 'tenants';

interface TenantDoc {
  tenantId: string;
}

/**
 * Resolves a consumer chat session's subdomain to a tenantId. Returns
 * undefined (not a thrown error) for an unrecognized/missing subdomain —
 * see middleware/tenantResolution.ts, which fails open to the shared base
 * catalog rather than blocking the request.
 */
export async function findBySubdomain(subdomain: string): Promise<string | undefined> {
  try {
    const db  = await getDb();
    const doc = await db.collection<TenantDoc>(COLLECTION_NAME).findOne({ subdomain });
    return doc?.tenantId;
  } catch (err) {
    throw new RepositoryError('tenantRepository', 'Failed to resolve tenant by subdomain', err);
  }
}
