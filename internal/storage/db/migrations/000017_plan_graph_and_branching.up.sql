-- Collaborative Planning V2: branching runs + step dependencies
--
-- depends_on enables DAG plan visualization (not just linear sequences).
-- run_parent_id + branched_from_step_id enable fork-a-run-from-a-step.

-- Step dependency edges
CREATE TABLE IF NOT EXISTS step_dependencies (
    step_id TEXT NOT NULL REFERENCES step_definitions(id) ON DELETE CASCADE,
    depends_on_step_id TEXT NOT NULL REFERENCES step_definitions(id) ON DELETE CASCADE,
    PRIMARY KEY (step_id, depends_on_step_id)
);
CREATE INDEX IF NOT EXISTS idx_step_dependencies_step ON step_dependencies(step_id);
CREATE INDEX IF NOT EXISTS idx_step_dependencies_depends ON step_dependencies(depends_on_step_id);

-- Run branching columns
ALTER TABLE runs ADD COLUMN run_parent_id TEXT REFERENCES runs(id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN branched_from_step_id TEXT REFERENCES step_definitions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(run_parent_id);
