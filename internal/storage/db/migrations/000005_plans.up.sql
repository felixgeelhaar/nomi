-- Plans table for collaborative planning
create table if not exists plans (
    id text primary key,
    run_id text not null references runs(id) on delete cascade,
    version integer not null default 1,
    created_at datetime not null default current_timestamp
);

-- Step definitions (planned steps)
create table if not exists step_definitions (
    id text primary key,
    plan_id text not null references plans(id) on delete cascade,
    title text not null,
    description text,
    expected_tool text,
    expected_capability text,
    step_order integer not null default 0,
    created_at datetime not null default current_timestamp
);

-- Add step_definition_id to steps to link executed steps to their plan
alter table steps add column step_definition_id text references step_definitions(id);

-- Index for fast plan lookup by run
CREATE INDEX IF NOT EXISTS idx_plans_run_id ON plans(run_id);
CREATE INDEX IF NOT EXISTS idx_step_definitions_plan_id ON step_definitions(plan_id);
