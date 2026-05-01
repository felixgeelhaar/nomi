-- Conversation model (ADR 0001 §8)
--
-- One Conversation = one persistent thread on a specific (plugin, connection)
-- pair. Example: a Telegram chat_id with a specific bot, a Slack DM with a
-- specific workspace user, an email thread identified by its root
-- Message-ID. Runs link to conversations so multi-turn chat feels like a
-- real conversation rather than a pile of disjoint goals.
--
-- The (plugin_id, connection_id, external_conversation_id) tuple is the
-- natural key — the channel-side identifier is whatever the plugin uses
-- to disambiguate threads on that connection.

CREATE TABLE IF NOT EXISTS plugin_conversations (
    id                        TEXT PRIMARY KEY,
    plugin_id                 TEXT NOT NULL,   -- "com.nomi.telegram"
    connection_id             TEXT NOT NULL,   -- references plugin_connections(id)
    external_conversation_id  TEXT NOT NULL,   -- chat_id / Message-ID / Slack channel id
    identity_id               TEXT,            -- optional — channel_identities(id), null pre-identity-allowlist
    assistant_id              TEXT NOT NULL,   -- resolved at thread creation, stable after
    created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (connection_id) REFERENCES plugin_connections(id) ON DELETE CASCADE,
    FOREIGN KEY (assistant_id)  REFERENCES assistants(id)         ON DELETE CASCADE,

    UNIQUE (plugin_id, connection_id, external_conversation_id)
);

CREATE INDEX idx_plugin_conversations_connection ON plugin_conversations(connection_id);
CREATE INDEX idx_plugin_conversations_assistant  ON plugin_conversations(assistant_id);
CREATE INDEX idx_plugin_conversations_updated    ON plugin_conversations(updated_at DESC);

-- Runs gain a nullable conversation_id. Desktop-initiated runs (the current
-- REST API default) stay nil; channel-originated runs populate it so the
-- UI can group them into threads. Nullable (not NOT NULL) keeps existing
-- rows untouched on migrate-up.
ALTER TABLE runs ADD COLUMN conversation_id TEXT REFERENCES plugin_conversations(id) ON DELETE SET NULL;

CREATE INDEX idx_runs_conversation ON runs(conversation_id);
