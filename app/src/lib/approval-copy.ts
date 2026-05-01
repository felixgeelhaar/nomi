export type DangerSignal = "irreversible" | "network" | "shell";

export interface ApprovalCopy {
  summary: string;
  dangerSignal?: DangerSignal;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatBytes(value: unknown): string {
  const n = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n / (1024 * 1024))} MB`;
}

function isIrreversibleCommand(cmd: string): boolean {
  const lower = cmd.toLowerCase();
  return (
    lower.includes("rm -rf") ||
    lower.startsWith("rm ") ||
    lower.includes("mkfs") ||
    lower.includes("dd if=")
  );
}

export function approvalCopy(
  capability: string,
  context?: Record<string, unknown>,
  constraints?: Record<string, unknown>,
): ApprovalCopy {
  const ctx = asRecord(context);
  const input = asRecord(ctx.input);

  if (capability === "filesystem.write") {
    const path = asString(input.path || ctx.path);
    const bytes = formatBytes(input.bytes || ctx.bytes);
    if (path && bytes) {
      return { summary: `Write ${bytes} to ${path}` };
    }
    if (path) {
      return { summary: `Write file content to ${path}` };
    }
    return { summary: "Write files in your workspace" };
  }

  if (capability === "filesystem.read") {
    const path = asString(input.path || ctx.path);
    if (path) {
      return { summary: `Read files from ${path}` };
    }
    return { summary: "Read files in your workspace" };
  }

  if (capability === "command.exec") {
    const cmd = asString(input.command || ctx.command || ctx.input);
    if (cmd) {
      if (isIrreversibleCommand(cmd)) {
        return {
          summary: `Run command: ${cmd}. This action may permanently delete data.`,
          dangerSignal: "irreversible",
        };
      }
      return { summary: `Run command: ${cmd}`, dangerSignal: "shell" };
    }
    return { summary: "Run a shell command", dangerSignal: "shell" };
  }

  if (capability === "network.outgoing") {
    const host = asString(input.host || ctx.host || input.url || ctx.url);
    if (host) {
      return { summary: `Send a request to ${host}`, dangerSignal: "network" };
    }
    return { summary: "Send an outgoing network request", dangerSignal: "network" };
  }

  const constrained = constraints && Object.keys(constraints).length > 0;
  return {
    summary: constrained
      ? `Approve capability ${capability} with constraints. Ask a developer what this means before approving.`
      : `Approve capability ${capability}. Ask a developer what this means before approving.`,
  };
}
