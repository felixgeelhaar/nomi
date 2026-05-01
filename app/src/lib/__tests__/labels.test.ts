import { describe, expect, it } from "vitest";

import { labels } from "@/lib/labels";

describe("labels", () => {
  it("maps run terminology to task in UI copy", () => {
    expect(labels.entity.run.singular).toBe("task");
    expect(labels.entity.run.plural).toBe("tasks");
    expect(labels.entity.run.singularTitle).toBe("Task");
    expect(labels.entity.run.pluralTitle).toBe("Tasks");
  });

  it("uses task wording for plan review actions", () => {
    expect(labels.actions.cancelRun).toBe("Cancel task");
    expect(labels.actions.approveAndRun).toBe("Approve & start task");
  });
});
