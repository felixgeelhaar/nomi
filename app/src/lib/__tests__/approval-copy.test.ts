import { describe, expect, it } from "vitest";

import { approvalCopy } from "@/lib/approval-copy";

describe("approvalCopy", () => {
  it("renders command approvals with shell danger", () => {
    const copy = approvalCopy("command.exec", { input: "git status" });
    expect(copy.summary).toContain("Run command: git status");
    expect(copy.dangerSignal).toBe("shell");
  });

  it("flags irreversible delete commands", () => {
    const copy = approvalCopy("command.exec", { input: "rm -rf /tmp/junk" });
    expect(copy.dangerSignal).toBe("irreversible");
  });

  it("summarizes filesystem write with byte size", () => {
    const copy = approvalCopy("filesystem.write", {
      input: { path: "/tmp/readme.md", bytes: 2048 },
    });
    expect(copy.summary).toContain("Write 2 KB to /tmp/readme.md");
  });

  it("falls back to conservative unknown capability guidance", () => {
    const copy = approvalCopy("unknown.capability", {});
    expect(copy.summary).toContain("Ask a developer");
  });
});
