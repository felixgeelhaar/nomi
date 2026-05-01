-- Channel Identity Allowlist (ADR 0001 §9)
--
-- Scoped to a specific (plugin, connection) so an identity allowed on one
-- bot isn't automatically allowed on another. Channel plugins consult
-- this table before creating a Run from an inbound message: unknown
-- senders get the connection's first-contact policy applied (drop,
-- reply-request-access, or queue-for-approval).

CREATE TABLE IF NOT EXISTS channel_identities (
    id                  TEXT PRIMARY KEY,
    plugin_id           TEXT NOT NULL,             -- "com.nomi.telegram"
    connection_id       TEXT NOT NULL,             -- plugin_connections(id)
    external_identifier TEXT NOT NULL,             -- phone/email/Slack user id/Telegram user id
    display_name        TEXT NOT NULL DEFAULT '',
    allowed_assistants  TEXT NOT NULL DEFAULT '[]',-- JSON array of assistant IDs
    enabled             INTEGER NOT NULL DEFAULT 1,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (connection_id) REFERENCES plugin_connections(id) ON DELETE CASCADE,

    UNIQUE (plugin_id, connection_id, external_identifier)
);

CREATE INDEX idx_channel_identities_connection ON channel_identities(connection_id);
CREATE INDEX idx_channel_identities_enabled    ON channel_identities(enabled);

-- Per-connection first-contact policy. Stored on the connection's
-- config JSON rather than as a separate table to keep the schema simple
-- — the plugin's Configure hook reads it from the existing config blob.
-- Recognized values: "drop" | "reply_request_access" | "queue_approval".
-- Unknown values are treated as "drop" (safe default).
