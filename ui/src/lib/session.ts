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

export interface QuestioningState {
  userQuery: string;
  existingProfile: {
    country?: string;
    skinType?: string;
    allergies?: string[];
    conditions?: string[];
  };
  pendingQuestions: string[];
  questionIndex: number;
  conversationHistory: Array<{ role: 'assistant' | 'user'; content: string }>;
}

export type SessionPhase = 'init' | 'collecting' | 'questioning' | 'processing' | 'done' | 'error';

export interface Session {
  id: string;
  phase: SessionPhase;
  profile: CollectedProfile | null;
  questioning: QuestioningState | null;
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
    questioning: null,
    createdAt: new Date(),
  };
  sessions.set(id, session);
  return session;
}
