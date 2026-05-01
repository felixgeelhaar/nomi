-- Plugin Architecture domain tables (ADR 0001 §3–4)
--
-- plugin_connections holds one row per configured instance of a plugin
-- (a Telegram bot, a Gmail account, a Slack workspace). Credentials
-- themselves live in secrets.Store; only logical-key → secret:// references
-- land in credential_refs.
--
-- assistant_connection_bindings is the junction that expresses "this
-- assistant uses this connection in this role." One connection can be
-- used by multiple assistants; one assistant can bind multiple connections
-- of the same plugin. The role column tracks which contribution slot
-- this binding occupies, so the same (assistant, connection) pair can
-- appear up to four times (channel + tool + trigger + context_source).

CREATE TABLE IF NOT EXISTS plugin_connections (
    id              TEXT PRIMARY KEY,
    plugin_id       TEXT NOT NULL,                        -- e.g. "com.nomi.telegram"
    name            TEXT NOT NULL,                        -- user-picked display name
    config          TEXT NOT NULL DEFAULT '{}',           -- JSON: non-secret plugin-specific settings
    credential_refs TEXT NOT NULL DEFAULT '{}',           -- JSON: {logical_key: "secret://..."}
    enabled         INTEGER NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_plugin_connections_plugin ON plugin_connections(plugin_id);
CREATE INDEX idx_plugin_connections_enabled ON plugin_connections(enabled);

CREATE TABLE IF NOT EXISTS assistant_connection_bindings (
    assistant_id  TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    role          TEXT NOT NULL,                          -- "channel" | "tool" | "trigger" | "context_source"
    enabled       INTEGER NOT NULL DEFAULT 1,
    is_primary    INTEGER NOT NULL DEFAULT 0,             -- disambiguator when N bindings exist
    priority      INTEGER NOT NULL DEFAULT 0,             -- ordering hint; higher wins ties
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (assistant_id, connection_id, role),
    FOREIGN KEY (assistant_id)  REFERENCES assistants(id)         ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES plugin_connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_assistant_bindings_connection ON assistant_connection_bindings(connection_id);
CREATE INDEX idx_assistant_bindings_role       ON assistant_connection_bindings(role);

-- Enforce "only one primary binding per (assistant, plugin, role)" at the
-- application layer rather than as a DB check: the DB can't know plugin_id
-- without a join, and SQLite's CHECK doesn't support subqueries. The
-- AssistantBindingRepository enforces this invariant.
