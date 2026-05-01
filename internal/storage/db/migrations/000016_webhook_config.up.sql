-- Webhook configuration columns for plugin_connections.
-- Per-connection webhook secrets are stored as secret:// references
-- in credential_refs (existing column); these columns hold the
-- non-secret webhook configuration.
ALTER TABLE plugin_connections ADD COLUMN webhook_url TEXT;
ALTER TABLE plugin_connections ADD COLUMN webhook_event_allowlist TEXT NOT NULL DEFAULT '[]';
ALTER TABLE plugin_connections ADD COLUMN webhook_enabled INTEGER NOT NULL DEFAULT 0;
