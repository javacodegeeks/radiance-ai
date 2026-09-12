/**
 * Local-dev-only escape hatch mirroring admin/server's DEV_BYPASS_AUTH (see
 * admin/server/src/middleware/auth.ts) — skips Clerk entirely on this side
 * too, since without it ClerkProvider/useAuth/SignedIn etc. all require a
 * real publishable key and would just throw. NEVER set this in production.
 */
export const DEV_BYPASS_AUTH = import.meta.env.VITE_DEV_BYPASS_AUTH === 'true';
