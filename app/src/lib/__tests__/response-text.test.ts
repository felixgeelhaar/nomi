import { describe, expect, it } from "vitest";

import { pickResponseText } from "@/lib/response-text";
import type { Plan, Step } from "@/types/api";

const baseStep = (overrides: Partial<Step>): Step => ({
  id: overrides.id ?? "s",
  run_id: "r",
  title: overrides.title ?? "step",
  status: overrides.status ?? "done",
  retry_count: 0,
  created_at: overrides.created_at ?? "2026-05-03T10:00:00Z",
  updated_at: overrides.updated_at ?? "2026-05-03T10:00:00Z",
  ...overrides,
});

const plan = (defs: { id: string; expected_tool: string }[]): Plan => ({
  id: "p",
  run_id: "r",
  version: 1,
  created_at: "2026-05-03T09:00:00Z",
  steps: defs.map((d, i) => ({
    id: d.id,
    plan_id: "p",
    title: `Step ${i + 1}`,
    expected_tool: d.expected_tool,
    expected_capability: d.expected_tool,
    order: i,
    depends_on: i > 0 ? [defs[i - 1].id] : [],
    created_at: "2026-05-03T09:00:00Z",
  })),
});

describe("pickResponseText", () => {
  it("returns empty string when there are no steps", () => {
    expect(pickResponseText([], undefined)).toBe("");
    expect(pickResponseText(undefined, undefined)).toBe("");
  });

  it("returns empty string when no step is completed with output", () => {
    const steps = [baseStep({ id: "s1", status: "running" })];
    expect(pickResponseText(steps, undefined)).toBe("");
  });

  it("returns the only completed step's output when no plan is provided", () => {
    const steps = [
      baseStep({ id: "s1", status: "done", output: "single-step answer" }),
    ];
    expect(pickResponseText(steps, undefined)).toBe("single-step answer");
  });

  it("prefers the latest llm.chat step output over a later non-llm step in a multi-step plan", () => {
    // 3-step plan: llm.chat (the conclusion) -> filesystem.write -> command.exec
    // The user-facing answer is the llm.chat output. The literal last
    // completed step's output ("wrote 4123 bytes to README.md") must NOT win.
    const p = plan([
      { id: "d1", expected_tool: "llm.chat" },
      { id: "d2", expected_tool: "filesystem.write" },
      { id: "d3", expected_tool: "command.exec" },
    ]);
    const steps = [
      baseStep({
        id: "s1",
        step_definition_id: "d1",
        status: "done",
        output: "Here is your README, summarised in three bullets...",
        updated_at: "2026-05-03T10:00:00Z",
      }),
      baseStep({
        id: "s2",
        step_definition_id: "d2",
        status: "done",
        output: "wrote 4123 bytes to README.md",
        updated_at: "2026-05-03T10:00:01Z",
      }),
      baseStep({
        id: "s3",
        step_definition_id: "d3",
        status: "done",
        output: "exit 0",
        updated_at: "2026-05-03T10:00:02Z",
      }),
    ];
    expect(pickResponseText(steps, p)).toBe(
      "Here is your README, summarised in three bullets...",
    );
  });

  it("returns the latest llm.chat output when multiple llm.chat steps exist", () => {
    const p = plan([
      { id: "d1", expected_tool: "llm.chat" },
      { id: "d2", expected_tool: "filesystem.write" },
      { id: "d3", expected_tool: "llm.chat" },
    ]);
    const steps = [
      baseStep({
        id: "s1",
        step_definition_id: "d1",
        status: "done",
        output: "intermediate analysis",
        updated_at: "2026-05-03T10:00:00Z",
      }),
      baseStep({
        id: "s2",
        step_definition_id: "d2",
        status: "done",
        output: "wrote 100 bytes",
        updated_at: "2026-05-03T10:00:01Z",
      }),
      baseStep({
        id: "s3",
        step_definition_id: "d3",
        status: "done",
        output: "final synthesised conclusion",
        updated_at: "2026-05-03T10:00:02Z",
      }),
    ];
    expect(pickResponseText(steps, p)).toBe("final synthesised conclusion");
  });

  it("falls back to last completed step when the plan has no llm.chat step", () => {
    const p = plan([
      { id: "d1", expected_tool: "command.exec" },
      { id: "d2", expected_tool: "filesystem.write" },
    ]);
    const steps = [
      baseStep({
        id: "s1",
        step_definition_id: "d1",
        status: "done",
        output: "first cmd output",
        updated_at: "2026-05-03T10:00:00Z",
      }),
      baseStep({
        id: "s2",
        step_definition_id: "d2",
        status: "done",
        output: "wrote 100 bytes",
        updated_at: "2026-05-03T10:00:01Z",
      }),
    ];
    expect(pickResponseText(steps, p)).toBe("wrote 100 bytes");
  });

  it("ignores incomplete llm.chat steps and uses the last completed one", () => {
    const p = plan([
      { id: "d1", expected_tool: "llm.chat" },
      { id: "d2", expected_tool: "llm.chat" },
    ]);
    const steps = [
      baseStep({
        id: "s1",
        step_definition_id: "d1",
        status: "done",
        output: "partial answer",
        updated_at: "2026-05-03T10:00:00Z",
      }),
      baseStep({
        id: "s2",
        step_definition_id: "d2",
        status: "running",
        output: undefined,
        updated_at: "2026-05-03T10:00:01Z",
      }),
    ];
    expect(pickResponseText(steps, p)).toBe("partial answer");
  });

  it("orders by updated_at, not array order", () => {
    const p = plan([
      { id: "d1", expected_tool: "llm.chat" },
      { id: "d2", expected_tool: "llm.chat" },
    ]);
    const steps = [
      baseStep({
        id: "s2",
        step_definition_id: "d2",
        status: "done",
        output: "newer",
        updated_at: "2026-05-03T10:00:05Z",
      }),
      baseStep({
        id: "s1",
        step_definition_id: "d1",
        status: "done",
        output: "older",
        updated_at: "2026-05-03T10:00:00Z",
      }),
    ];
    expect(pickResponseText(steps, p)).toBe("newer");
  });
});
