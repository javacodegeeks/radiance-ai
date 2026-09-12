/**
 * Shared by every feature — introduced here since Feature A is the first
 * to need it. Parses the incoming Host header, extracts the subdomain
 * label, and resolves it to a tenantId via the read-only tenantRepository.
 *
 * Fails open to the shared base catalog on an unrecognized/missing
 * subdomain, consistent with ai/'s existing "never block on failure"
 * pattern — this middleware never returns a 4xx/5xx itself.
 *
 * Local dev: send a custom Host header (curl -H "Host: tenant1.radiance.ai")
 * or use a wildcard-to-loopback domain (tenant1.lvh.me). Production: one
 * wildcard DNS record + wildcard TLS cert for *.radiance.ai. Either way this
 * middleware only ever looks at the Host header value it's given.
 */
import { Request, Response, NextFunction } from 'express';
import { findBySubdomain } from '../repositories/tenantRepository';
import { runWithTenantId } from '../common/tenantContext';
import { RepositoryError } from '../common/errors';

function extractSubdomain(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const label = host.split(':')[0].split('.')[0];
  // A bare hostname (localhost, an IP, or a single-label host) has no
  // subdomain to resolve — treat it the same as "no tenant".
  return label && label !== 'localhost' && host.includes('.') ? label : undefined;
}

export async function resolveTenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const subdomain = extractSubdomain(req.headers.host);
  let tenantId: string | undefined;

  if (subdomain) {
    try {
      tenantId = await findBySubdomain(subdomain);
      console.log(`[tenantResolution] subdomain=${subdomain} → tenantId=${tenantId ?? '(none, base catalog only)'}`);
    } catch (err) {
      const label = err instanceof RepositoryError ? 'DB lookup failed' : 'lookup failed';
      console.error(`[tenantResolution] ${label} for subdomain=${subdomain} — failing open to base catalog`, err);
    }
  }

  runWithTenantId(tenantId, next);
}
