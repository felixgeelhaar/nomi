DROP INDEX IF EXISTS idx_runs_parent;
ALTER TABLE runs DROP COLUMN run_parent_id;
ALTER TABLE runs DROP COLUMN branched_from_step_id;
DROP INDEX IF EXISTS idx_step_dependencies_step;
DROP INDEX IF EXISTS idx_step_dependencies_depends;
DROP TABLE IF EXISTS step_dependencies;
