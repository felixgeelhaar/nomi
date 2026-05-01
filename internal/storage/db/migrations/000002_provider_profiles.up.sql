-- Provider profiles table
CREATE TABLE IF NOT EXISTS provider_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'remote', -- 'local' | 'remote'
    endpoint TEXT,
    model_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of supported model IDs
    secret_ref TEXT, -- reference to encrypted credential storage (not the actual secret)
    enabled BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_provider_profiles_enabled ON provider_profiles(enabled);

-- Global settings table for app-wide configuration
CREATE TABLE IF NOT EXISTS global_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert default LLM setting placeholder
INSERT OR IGNORE INTO global_settings (key, value) VALUES ('llm.default_provider_id', '');
INSERT OR IGNORE INTO global_settings (key, value) VALUES ('llm.default_model_id', '');
