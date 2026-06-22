/**
 * In-memory session store.
 * Swap the Map for Redis or a DB client without changing any other file —
 * the interface (getSession / setSession / createSession) is the only contract.
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
