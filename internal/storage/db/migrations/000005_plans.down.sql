-- Revert 000005_plans: drop the added step_definition_id column on steps,
-- then drop the two new tables. SQLite 3.35+ (bundled by modernc.org/sqlite)
-- supports ALTER TABLE DROP COLUMN.

DROP INDEX IF EXISTS idx_step_definitions_plan_id;
DROP INDEX IF EXISTS idx_plans_run_id;

ALTER TABLE steps DROP COLUMN step_definition_id;

DROP TABLE IF EXISTS step_definitions;
DROP TABLE IF EXISTS plans;
