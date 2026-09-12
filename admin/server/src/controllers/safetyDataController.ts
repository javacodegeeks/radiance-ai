/**
 * Read-only admin console access to the EU CosIng / ingredient safety
 * reference tables (Postgres, cosmetic_rai db) — seeded by data/pipeline's
 * offline ingestion, never written to here. Open to either staff role, same
 * as product search (see productController.ts) — a pharmacist reviewing a
 * correction may need to check the same reference data an admin would.
 */
import { Router, Response } from 'express';
import {
  listIngredients,
  listCosingFunctions,
  listProhibitedSubstances,
  listRestrictions,
  listSafetyRules,
} from '../repositories/safetyDataRepository';
import { requireAnyStaffRole, AuthedRequest } from '../middleware/auth';
import { RepositoryError } from '../common/errors';

export const safetyDataRouter = Router();

function parsePaging(req: AuthedRequest): { q: string; page: number; limit: number } {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  return { q, page, limit };
}

function registerListRoute(
  path: string,
  list: (q: string, page: number, limit: number) => Promise<{ rows: unknown[]; total: number }>,
) {
  safetyDataRouter.get(path, requireAnyStaffRole(), async (req: AuthedRequest, res: Response) => {
    const { q, page, limit } = parsePaging(req);
    try {
      const { rows, total } = await list(q, page, limit);
      console.log(`[safetyData] GET ${path}?q="${q}"&page=${page}&limit=${limit} → 200 (${rows.length}/${total} result(s))`);
      res.json({ items: rows, total, page, limit });
    } catch (error) {
      console.error(`[safetyData] GET ${path} → ERROR`, error);
      const status = error instanceof RepositoryError ? 503 : 500;
      res.status(status).json({ error: 'Failed to load safety data. Please try again.' });
    }
  });
}

registerListRoute('/ingredients', listIngredients);
registerListRoute('/cosing/functions', listCosingFunctions);
registerListRoute('/cosing/prohibited-substances', listProhibitedSubstances);
registerListRoute('/cosing/restrictions', listRestrictions);
registerListRoute('/safety-rules', listSafetyRules);
