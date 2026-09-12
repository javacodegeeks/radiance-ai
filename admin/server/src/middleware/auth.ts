/**
 * Clerk-backed auth + role + tenant middleware — shared by every feature
 * (A/B/C), introduced here since Feature A is the first to need it.
 *
 * tenantId always comes from the caller's active Clerk Organization
 * (req.auth.orgId), never from a request body/query field — this is the
 * one rule every write handler in admin/server/ must follow, so tenant 1's
 * admin can never write into tenant 2's data by passing a different id.
 */
import { Request, Response, NextFunction } from 'express';
import { getAuth } from '@clerk/express';

export type StaffRole = 'admin' | 'pharmacist';

export interface AuthedRequest extends Request {
  tenantId?: string;
  clerkUserId?: string;
}

/**
 * Local-dev-only escape hatch — lets admin/server (and admin/web, see
 * admin/web/src/lib/devConfig.ts) run without a real Clerk account/keys.
 * Every request is treated as an authenticated staff member of a fixed
 * fake tenant. NEVER set DEV_BYPASS_AUTH=true outside local development —
 * there is no check here that this isn't production, by design keep this
 * out of any deployed environment's env vars.
 */
export function isDevBypassAuth(): boolean {
  return process.env.DEV_BYPASS_AUTH === 'true';
}

const DEV_TENANT_ID = process.env.DEV_TENANT_ID ?? 'dev-tenant';
const DEV_USER_ID   = process.env.DEV_USER_ID ?? 'dev-user';

function normalizeOrgRole(orgRole: string | null | undefined): string | undefined {
  // Clerk org roles are namespaced (e.g. "org:admin") — strip the prefix.
  return orgRole?.replace(/^org:/, '');
}

/** Authenticated + belongs to an active Clerk Organization, but no specific role required. Used by read endpoints both roles need (e.g. product search). */
export function requireAnyStaffRole() {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (isDevBypassAuth()) {
      console.log(`[auth] DEV_BYPASS_AUTH — treating ${req.method} ${req.originalUrl} as tenant=${DEV_TENANT_ID}`);
      req.tenantId    = DEV_TENANT_ID;
      req.clerkUserId = DEV_USER_ID;
      next();
      return;
    }

    const auth = getAuth(req);
    if (!auth.userId || !auth.orgId) {
      console.warn(`[auth] 401 unauthenticated on ${req.method} ${req.originalUrl}`);
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.tenantId     = auth.orgId;
    req.clerkUserId  = auth.userId;
    next();
  };
}

/** Authenticated, belongs to an active Clerk Organization, AND holds the exact org role required. */
export function requireRole(role: StaffRole) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (isDevBypassAuth()) {
      console.log(`[auth] DEV_BYPASS_AUTH — treating ${req.method} ${req.originalUrl} as tenant=${DEV_TENANT_ID}, role=${role}`);
      req.tenantId    = DEV_TENANT_ID;
      req.clerkUserId = DEV_USER_ID;
      next();
      return;
    }

    const auth = getAuth(req);
    if (!auth.userId || !auth.orgId) {
      console.warn(`[auth] 401 unauthenticated on ${req.method} ${req.originalUrl}`);
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (normalizeOrgRole(auth.orgRole) !== role) {
      console.warn(`[auth] 403 role mismatch on ${req.method} ${req.originalUrl} — required '${role}', got '${normalizeOrgRole(auth.orgRole)}'`);
      res.status(403).json({ error: `This action requires the '${role}' role` });
      return;
    }
    req.tenantId     = auth.orgId;
    req.clerkUserId  = auth.userId;
    next();
  };
}
