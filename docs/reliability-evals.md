# Reliability Evals Baseline

This baseline defines the initial reliability evaluation harness for runtime/planner/tool failures.

## Current Scope

- Failure taxonomy with stable buckets (`internal/runtime/evals/failure_taxonomy.go`)
- Deterministic classifier for:
  - planner failures
  - tool not found
  - tool execution failures
  - permission/approval denials
  - rate limits
  - context-too-long
  - no-provider configured
- Table-driven tests for code and message-path classification.

Run with:

```bash
make reliability-evals
```

## Why this exists

Without stable failure classes, reliability metrics drift across feature teams and plugins.
This taxonomy gives us one vocabulary for dashboards and regressions.

## Next Iterations

1. Persist classification on run/step terminal failures (failed/cancelled) for aggregation.
2. Add cross-plugin contract failure scenarios:
   - missing connection binding
   - plugin disabled
   - credential lookup failures
3. Add planner robustness scenarios:
   - malformed JSON output
   - empty step plans
   - capability/tool mismatches
4. Add chaos-style tests:
   - dependency timeouts
   - transient connector failures
   - event stream interruption and recovery
