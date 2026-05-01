// Zod schemas for the API boundary. We keep the wire types narrow so a
// breaking change on the daemon side surfaces as a parse error in the UI
// rather than as a confused render or a silent NaN. TypeScript types are
// inferred from the schemas (z.infer) so the static + runtime contracts
// can never drift.
//
// Migration plan: progressively replace plain `interface Foo` declarations
// in `app/src/types/api.ts` with `z.infer<typeof FooSchema>` and have the
// fetcher run `Schema.parse(response)` for the relevant calls. Anything
// not yet migrated keeps working off the hand-written interfaces.

import { z } from "zod";

// ---- run + step state machines ------------------------------------------

export const RunStatusSchema = z.enum([
  "created",
  "planning",
  "plan_review",
  "awaiting_approval",
  "executing",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "retrying",
  "blocked",
  "done",
  "failed",
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const PermissionModeSchema = z.enum(["allow", "confirm", "deny"]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

// ---- core run / step / plan shapes --------------------------------------

export const RunSchema = z.object({
  id: z.string(),
  goal: z.string(),
  assistant_id: z.string(),
  source: z.string().optional(),
  conversation_id: z.string().optional(),
  status: RunStatusSchema,
  current_step_id: z.string().optional(),
  plan_version: z.number(),
  run_parent_id: z.string().optional(),
  branched_from_step_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

export const StepSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  step_definition_id: z.string().optional().nullable(),
  title: z.string(),
  status: StepStatusSchema,
  input: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional().nullable(),
  retry_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Step = z.infer<typeof StepSchema>;

// Planner-emitted arguments are tool-specific. The schema-time shape stays
// loose (record of unknown) because per-tool validation lives in the
// runtime; the UI only displays them.
export const StepDefinitionSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  expected_tool: z.string().optional(),
  expected_capability: z.string().optional(),
  why: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional().nullable(),
  order: z.number(),
  depends_on: z.array(z.string()).optional().nullable(),
  created_at: z.string(),
});
export type StepDefinition = z.infer<typeof StepDefinitionSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  version: z.number(),
  steps: z.array(StepDefinitionSchema),
  created_at: z.string(),
});
export type Plan = z.infer<typeof PlanSchema>;

// GET /runs/:id wraps run + steps + plan together; the chat detail panel
// needs all three at once, so the envelope is the natural parse target.
export const RunDetailSchema = z.object({
  run: RunSchema,
  steps: z.array(StepSchema),
  plan: PlanSchema.optional().nullable(),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const RunListSchema = z.object({
  runs: z.array(RunSchema),
});
export type RunList = z.infer<typeof RunListSchema>;

// ---- approvals ----------------------------------------------------------

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  step_id: z.string().optional().nullable(),
  capability: z.string(),
  status: ApprovalStatusSchema,
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  resolved_at: z.string().optional().nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ApprovalListSchema = z.object({
  approvals: z.array(ApprovalSchema),
});
export type ApprovalList = z.infer<typeof ApprovalListSchema>;

// ---- memory -------------------------------------------------------------

export const MemoryScopeSchema = z.enum(["workspace", "profile", "preferences"]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryEntrySchema = z.object({
  id: z.string(),
  scope: MemoryScopeSchema,
  content: z.string(),
  assistant_id: z.string().optional().nullable(),
  run_id: z.string().optional().nullable(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const MemoryListSchema = z.object({
  memories: z.array(MemoryEntrySchema),
});
export type MemoryList = z.infer<typeof MemoryListSchema>;

// ---- safety profile -----------------------------------------------------

export const SafetyProfileSchema = z.enum(["cautious", "balanced", "fast"]);
export type SafetyProfile = z.infer<typeof SafetyProfileSchema>;
