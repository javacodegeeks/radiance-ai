import { Pool } from 'pg';
import { getDb } from '../db';

export interface UserSessionRow {
  id: string;
  session_id: string;
  country?: string;
  skin_type?: string;
  allergies?: string[];
  conditions?: string[];
  concerns?: string[];
  consent_given: boolean;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: Date;
}

type SessionUpsertData = Partial<
  Omit<UserSessionRow, 'id' | 'session_id' | 'created_at' | 'updated_at'>
>;

export class UserProfileRepository {
  private db: Pool;

  constructor(db?: Pool) {
    this.db = db ?? getDb();
  }

  async findBySessionId(sessionId: string): Promise<UserSessionRow | null> {
    const result = await this.db.query<UserSessionRow>(
      'SELECT * FROM user_sessions WHERE session_id = $1',
      [sessionId],
    );
    return result.rows[0] ?? null;
  }

  async upsert(sessionId: string, data: SessionUpsertData): Promise<UserSessionRow> {
    const result = await this.db.query<UserSessionRow>(
      `INSERT INTO user_sessions
         (session_id, country, skin_type, allergies, conditions, concerns, consent_given, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_id) DO UPDATE SET
         country       = COALESCE(EXCLUDED.country,       user_sessions.country),
         skin_type     = COALESCE(EXCLUDED.skin_type,     user_sessions.skin_type),
         allergies     = COALESCE(EXCLUDED.allergies,     user_sessions.allergies),
         conditions    = COALESCE(EXCLUDED.conditions,    user_sessions.conditions),
         concerns      = COALESCE(EXCLUDED.concerns,      user_sessions.concerns),
         consent_given = EXCLUDED.consent_given,
         expires_at    = COALESCE(EXCLUDED.expires_at,    user_sessions.expires_at),
         updated_at    = NOW()
       RETURNING *`,
      [
        sessionId,
        data.country       ?? null,
        data.skin_type     ?? null,
        data.allergies     ?? null,
        data.conditions    ?? null,
        data.concerns      ?? null,
        data.consent_given ?? false,
        data.expires_at    ?? null,
      ],
    );
    return result.rows[0];
  }

  async addMessage(sessionId: string, role: MessageRow['role'], content: string): Promise<void> {
    await this.db.query(
      'INSERT INTO conversation_history (session_id, role, content) VALUES ($1, $2, $3)',
      [sessionId, role, content],
    );
  }

  async getConversationHistory(sessionId: string, limit = 20): Promise<MessageRow[]> {
    const result = await this.db.query<MessageRow>(
      `SELECT role, content, created_at
       FROM conversation_history
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit],
    );
    return result.rows.reverse();
  }
}
