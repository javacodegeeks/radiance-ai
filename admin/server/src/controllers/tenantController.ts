/**
 * Tenant controller — HTTP layer only. Lets a tenant's admin register the
 * subdomain slug consumer chat sessions resolve to their org (see
 * ai/src/repositories/tenantRepository.ts + ai/src/middleware/tenantResolution.ts).
 */
import { Router, Response } from 'express';
import { registerTenant, findTenant } from '../repositories/tenantRepository';
import { requireRole, AuthedRequest } from '../middleware/auth';
import { RepositoryError } from '../common/errors';

export const tenantRouter = Router();

tenantRouter.post('/tenants', requireRole('admin'), async (req: AuthedRequest, res: Response) => {
  const { subdomain, name } = req.body as { subdomain?: string; name?: string };

  if (!subdomain || !name) {
    res.status(400).json({ error: 'subdomain and name are required' });
    return;
  }

  try {
    await registerTenant({ tenantId: req.tenantId!, subdomain, name });
    console.log(`[tenants] POST /tenants → 204 tenant=${req.tenantId} subdomain=${subdomain}`);
    res.status(204).end();
  } catch (error) {
    console.error('[tenants] → ERROR', error);
    const status = error instanceof RepositoryError ? 503 : 500;
    res.status(status).json({ error: 'Failed to register tenant. Please try again.' });
  }
});

tenantRouter.get('/tenants/me', requireRole('admin'), async (req: AuthedRequest, res: Response) => {
  try {
    const tenant = await findTenant(req.tenantId!);
    console.log(`[tenants] GET /tenants/me → 200 tenant=${req.tenantId} ${tenant ? 'registered' : 'not registered'}`);
    res.json({ tenant });
  } catch (error) {
    console.error('[tenants] → ERROR', error);
    const status = error instanceof RepositoryError ? 503 : 500;
    res.status(status).json({ error: 'Failed to look up tenant. Please try again.' });
  }
});
