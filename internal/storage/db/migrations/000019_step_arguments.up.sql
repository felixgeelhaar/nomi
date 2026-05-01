-- Per-step arguments emitted by the planner. Stored as JSON so the runtime
-- can merge them into tool input without the planner having to encode every
-- tool's specific contract into a string. Nullable so older plans (without
-- arguments) keep working as natural-language descriptions.
ALTER TABLE step_definitions ADD COLUMN arguments TEXT;
