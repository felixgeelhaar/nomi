DROP INDEX IF EXISTS idx_runs_conversation;
-- SQLite < 3.35 doesn't support DROP COLUMN; tolerate its absence.
-- For pre-3.35 hosts the column is simply orphaned on rollback.
ALTER TABLE runs DROP COLUMN conversation_id;

DROP INDEX IF EXISTS idx_plugin_conversations_updated;
DROP INDEX IF EXISTS idx_plugin_conversations_assistant;
DROP INDEX IF EXISTS idx_plugin_conversations_connection;
DROP TABLE IF EXISTS plugin_conversations;
