-- Connector configurations table
CREATE TABLE IF NOT EXISTS connector_configs (
    connector_name TEXT PRIMARY KEY,
    config TEXT NOT NULL DEFAULT '{}', -- JSON object
    enabled BOOLEAN NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
