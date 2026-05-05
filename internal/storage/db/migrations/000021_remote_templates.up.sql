-- Remote assistant templates marketplace.
-- Mirrors the plugin store schema: provenance fields (signature, catalog_hash, source_url).
-- Installed templates become draft Assistants (not auto-activated).

CREATE TABLE IF NOT EXISTS remote_templates (
    id               TEXT PRIMARY KEY,
    catalog_hash     TEXT NOT NULL,
    source_url       TEXT NOT NULL,
    signature        TEXT,
    name             TEXT NOT NULL,
    tagline          TEXT,
    role             TEXT,
    best_for         TEXT,
    not_for          TEXT,
    suggested_model  TEXT,
    system_prompt    TEXT,
    channels         TEXT,  -- JSON array
    capabilities     TEXT,  -- JSON array
    contexts         TEXT,  -- JSON array
    memory_policy    TEXT,  -- JSON object
    permission_policy TEXT,  -- JSON object
    recommended_bindings TEXT,  -- JSON array
    installed_at     TEXT NOT NULL,
    local_assistant_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_remote_templates_catalog
    ON remote_templates(catalog_hash);
