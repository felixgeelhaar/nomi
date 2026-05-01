-- Plugin lifecycle state (ADR 0002).
--
-- One row per plugin known to the daemon. System plugins are seeded
-- at first boot by cmd/nomid/main.go (one row per registered plugin
-- marked distribution=system, installed=true, enabled=true). Marketplace
-- and dev plugins write their own rows when installed.
--
-- The schema carries enough to support the full lifecycle (install /
-- uninstall / enable / disable / update) even though only enabled is
-- exercised in this task — the rest of the columns ship now so the
-- table doesn't need a migration in lifecycle-07/10.

CREATE TABLE IF NOT EXISTS plugin_state (
    plugin_id              TEXT PRIMARY KEY,
    distribution           TEXT NOT NULL,                          -- "system" | "marketplace" | "dev"
    installed              INTEGER NOT NULL DEFAULT 1,
    enabled                INTEGER NOT NULL DEFAULT 1,
    version                TEXT NOT NULL DEFAULT '',
    available_version      TEXT NOT NULL DEFAULT '',               -- populated by the catalog poller (lifecycle-10)
    source_url             TEXT NOT NULL DEFAULT '',               -- where this plugin was installed from
    signature_fingerprint  TEXT NOT NULL DEFAULT '',
    installed_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_checked_at        DATETIME                                -- nullable until the first catalog check
);

CREATE INDEX idx_plugin_state_enabled      ON plugin_state(enabled);
CREATE INDEX idx_plugin_state_distribution ON plugin_state(distribution);
