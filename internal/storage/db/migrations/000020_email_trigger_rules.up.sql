-- Trigger rules first-class: typed table behind the email plugin's
-- inbox-watch feature (task-email-plugin). Replaces the
-- JSON-only connection.config["trigger_rules"] approach so non-technical
-- users get a UI editor without raw JSON.

CREATE TABLE IF NOT EXISTS email_trigger_rules (
    id                    TEXT PRIMARY KEY,
    connection_id          TEXT NOT NULL REFERENCES plugin_connections(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    assistant_id          TEXT NOT NULL,
    from_contains         TEXT DEFAULT '',
    subject_contains      TEXT DEFAULT '',
    body_contains        TEXT DEFAULT '',
    enabled               INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_trigger_rules_connection
    ON email_trigger_rules(connection_id);

CREATE INDEX IF NOT EXISTS idx_email_trigger_rules_assistant
    ON email_trigger_rules(assistant_id);
