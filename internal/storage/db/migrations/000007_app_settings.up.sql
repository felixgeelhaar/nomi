-- Create app_settings table for runtime application configuration
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('api_port', '8080');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('app_version', '0.1.0');
