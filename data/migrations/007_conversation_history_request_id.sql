-- Correlation ID for the HTTP request that produced each conversation turn.
-- Nullable: rows written before this migration (or by any future caller
-- outside an HTTP request context) simply have no request_id.
ALTER TABLE conversation_history ADD COLUMN IF NOT EXISTS request_id VARCHAR(16);
