/**
 * Postgres-backed session store.
 * Persists session state to user_sessions and conversation turns to
 * conversation_history. The interface (getSession / setSession / createSession)
 * is the only contract — callers are unaware of the storage backend.
 */

import { getDb } from '../infra/db';
import { RepositoryError } from '../common/errors';

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

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSession(id: string): Promise<Session | undefined> {
  const db = getDb();
  let rows;
  try {
    ({ rows } = await db.query<{
      session_id: string;
      phase: SessionPhase;
      profile: CollectedProfile | null;
      questioning: QuestioningState | null;
      created_at: Date;
    }>(
      `SELECT session_id, phase, profile, questioning, created_at
       FROM user_sessions WHERE session_id = $1`,
      [id],
    ));
  } catch (err) {
    console.error(`[sessionStore] getSession failed session=${id}`, err);
    throw new RepositoryError('sessionStore', 'Failed to load session', err);
  }
  if (!rows.length) return undefined;
  const row = rows[0];
  return {
    id:          row.session_id,
    phase:       row.phase,
    profile:     row.profile,
    questioning: row.questioning,
    createdAt:   row.created_at,
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function setSession(id: string, session: Session): Promise<void> {
  const db = getDb();
  try {
    await db.query(
      `INSERT INTO user_sessions (session_id, phase, profile, questioning)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE
         SET phase       = EXCLUDED.phase,
             profile     = EXCLUDED.profile,
             questioning = EXCLUDED.questioning,
             updated_at  = NOW()`,
      [id, session.phase, JSON.stringify(session.profile), JSON.stringify(session.questioning)],
    );
  } catch (err) {
    console.error(`[sessionStore] setSession failed session=${id} phase=${session.phase}`, err);
    throw new RepositoryError('sessionStore', 'Failed to persist session', err);
  }
}

export async function createSession(id: string): Promise<Session> {
  const session: Session = {
    id,
    phase:       'init',
    profile:     null,
    questioning: null,
    createdAt:   new Date(),
  };
  await setSession(id, session);
  return session;
}

// ─── Conversation history ─────────────────────────────────────────────────────

export async function appendMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  const db = getDb();
  try {
    await db.query(
      `INSERT INTO conversation_history (session_id, role, content)
       VALUES ($1, $2, $3)`,
      [sessionId, role, content],
    );
  } catch (err) {
    console.error(`[sessionStore] appendMessage failed session=${sessionId} role=${role}`, err);
    throw new RepositoryError('sessionStore', 'Failed to append conversation message', err);
  }
}
