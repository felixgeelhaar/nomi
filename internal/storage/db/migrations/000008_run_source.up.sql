-- Add source column to runs: identifies which connector (or "desktop") the
-- run was initiated from so the runtime can intersect assistant permissions
-- with the connector manifest. Nullable for backfill; runtime treats NULL as
-- "desktop".
ALTER TABLE runs ADD COLUMN source TEXT;
CREATE INDEX IF NOT EXISTS idx_runs_source ON runs(source);
