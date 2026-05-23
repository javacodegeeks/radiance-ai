CREATE TABLE user_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id     VARCHAR(255) UNIQUE NOT NULL,
  country        VARCHAR(100),
  skin_type      VARCHAR(100),
  allergies      TEXT[],
  conditions     TEXT[],
  concerns       TEXT[],
  consent_given  BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversation_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  VARCHAR(255) NOT NULL REFERENCES user_sessions (session_id) ON DELETE CASCADE,
  role        VARCHAR(20)  NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_session_id      ON user_sessions (session_id);
CREATE INDEX idx_conversation_history_session  ON conversation_history (session_id);
