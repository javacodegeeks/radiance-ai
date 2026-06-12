/**
 * Server-side in-memory session store.
 *
 * Swap this for Redis / a database when moving out of monorepo mode:
 *   - Replace `sessions` Map with a Redis client
 *   - Keep the same get/set/create interface — no other files need changing
 */

export interface CollectedProfile {
  userQuery: string;
  questionIndex: number;
  answers: Record<string, string>;
}

export type SessionPhase = 'init' | 'collecting' | 'processing' | 'done' | 'error';

export interface Session {
  id: string;
  phase: SessionPhase;
  profile: CollectedProfile | null;
  createdAt: Date;
}

// Module-level Map survives across requests within the same Node.js process.
const sessions = new Map<string, Session>();

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function setSession(id: string, session: Session): void {
  sessions.set(id, session);
}

export function createSession(id: string): Session {
  const session: Session = {
    id,
    phase: 'init',
    profile: null,
    createdAt: new Date(),
  };
  sessions.set(id, session);
  return session;
}
