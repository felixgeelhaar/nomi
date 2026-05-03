import type { Plan, Step } from "@/types/api";

// pickResponseText returns the text the chat bubble should display for a
// completed (or partially completed) run.
//
// In multi-step plans the literal last completed step is often a non-LLM
// tool whose output is a path or byte count ("wrote 4123 bytes to
// README.md"), not the user-facing conclusion. The synthesizing answer
// lives in the latest llm.chat step. This helper prefers that and falls
// back to the literal last completed step only when no llm.chat step has
// produced output yet — which keeps single-step legacy plans working.
export function pickResponseText(
  steps: Step[] | undefined,
  plan: Plan | undefined,
): string {
  if (!steps || steps.length === 0) return "";
  const completed = steps.filter((s) => s.status === "done" && s.output);
  if (completed.length === 0) return "";

  const toolByDef = new Map<string, string | undefined>();
  for (const def of plan?.steps ?? []) {
    toolByDef.set(def.id, def.expected_tool);
  }
  const llmSteps = completed.filter(
    (s) => s.step_definition_id && toolByDef.get(s.step_definition_id) === "llm.chat",
  );

  const pickLatest = (arr: Step[]): Step | undefined =>
    [...arr].sort((a, b) => a.updated_at.localeCompare(b.updated_at)).pop();

  return (pickLatest(llmSteps) ?? pickLatest(completed))?.output || "";
}
