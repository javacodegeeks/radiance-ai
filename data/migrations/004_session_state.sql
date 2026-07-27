-- Adds runtime session state columns to user_sessions so the ai layer
-- can persist phase transitions and collected profile/questioning data.

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS phase       VARCHAR(20)  NOT NULL DEFAULT 'init',
  ADD COLUMN IF NOT EXISTS profile     JSONB,
  ADD COLUMN IF NOT EXISTS questioning JSONB;
