-- Migrate existing Telegram connector_configs rows into plugin_connections
-- + assistant_connection_bindings (ADR 0001 §3–4, migration-plan step 3).
--
-- The old shape stored an array of Connections inside connector_configs.config
-- as JSON. SQLite ≥3.38 ships json1 builtin, so we can unroll that array
-- with json_each and fan out into the new tables.
--
-- Idempotent: INSERT OR IGNORE on plugin_connections skips rows whose id
-- already lands in the new table (safe re-runs during iterative dev).

-- Rows only exist if connector_configs has a telegram row with a non-empty
-- connections array.
INSERT OR IGNORE INTO plugin_connections (id, plugin_id, name, config, credential_refs, enabled, created_at, updated_at)
SELECT
    json_extract(conn.value, '$.id')                                          AS id,
    'com.nomi.telegram'                                                       AS plugin_id,
    COALESCE(json_extract(conn.value, '$.name'), 'Telegram Bot')              AS name,
    '{}'                                                                      AS config,
    json_object('bot_token', json_extract(conn.value, '$.bot_token'))         AS credential_refs,
    CASE WHEN json_extract(conn.value, '$.enabled') = 1 THEN 1 ELSE 0 END     AS enabled,
    cc.updated_at                                                             AS created_at,
    cc.updated_at                                                             AS updated_at
FROM connector_configs cc, json_each(cc.config, '$.connections') conn
WHERE cc.connector_name = 'telegram'
  AND json_extract(conn.value, '$.id') IS NOT NULL;

-- Each connection's default_assistant_id becomes a channel-role binding
-- marked primary (preserving today's 1:1 inbound routing semantics).
INSERT OR IGNORE INTO assistant_connection_bindings (assistant_id, connection_id, role, enabled, is_primary, priority, created_at)
SELECT
    json_extract(conn.value, '$.default_assistant_id') AS assistant_id,
    json_extract(conn.value, '$.id')                   AS connection_id,
    'channel'                                          AS role,
    1                                                  AS enabled,
    1                                                  AS is_primary,
    0                                                  AS priority,
    cc.updated_at                                      AS created_at
FROM connector_configs cc, json_each(cc.config, '$.connections') conn
WHERE cc.connector_name = 'telegram'
  AND json_extract(conn.value, '$.default_assistant_id') IS NOT NULL
  AND json_extract(conn.value, '$.default_assistant_id') != '';

-- Leave the old connector_configs row in place for now — UI/REST still
-- reads from it until the plugin UI lands. The new plugin registry
-- queries plugin_connections, which is the authoritative runtime state
-- going forward. A later task deletes the legacy row once the UI cuts
-- over.
