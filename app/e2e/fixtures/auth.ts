import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the Nomi data directory for the current platform. Must stay in
 * sync with the Go daemon's appDataDir() in internal/storage/db/db.go.
 */
function nomiDataDir(): string {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "Nomi");
    case "win32":
      return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "Nomi");
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Nomi");
  }
}

function readAuthToken(): string {
  const tokenPath = join(nomiDataDir(), "auth.token");
  try {
    const raw = readFileSync(tokenPath, "utf8").trim();
    if (raw.length < 32) {
      throw new Error(`token at ${tokenPath} is shorter than 32 chars`);
    }
    return raw;
  } catch (err) {
    throw new Error(
      `Cannot read auth.token at ${tokenPath}. Is the nomid daemon running? Underlying error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

const API_BASE = "http://127.0.0.1:8080";

export interface NomiFixtures {
  /**
   * A Playwright request context pre-loaded with the bearer token. Use this
   * to seed test state (create assistants, runs, approvals) via the REST
   * API before exercising the UI. This is the daemon-authoritative path;
   * the browser fixture below also has the token but the API context
   * avoids any UI noise.
   */
  api: APIRequestContext;

  /**
   * A Playwright page with `window.__NOMI_DEV_TOKEN__` already injected
   * before any script runs, so the React app's getAuthToken fallback finds
   * it on the very first fetch. Use this instead of the bare `page`
   * fixture in every test that loads the UI.
   */
  authedPage: Page;

  /**
   * The token value itself, in case a test needs it directly.
   */
  authToken: string;
}

export const test = base.extend<NomiFixtures>({
  authToken: async ({}, use) => {
    const token = readAuthToken();
    await use(token);
  },

  api: async ({ playwright, authToken }, use) => {
    const ctx = await playwright.request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
    });
    // Sanity: if the token is wrong (or the daemon is unreachable), fail
    // immediately with a clear message rather than letting every test fail
    // in its own opaque way.
    const health = await ctx.get("/health");
    if (!health.ok()) {
      throw new Error(
        `daemon health check failed: ${health.status()} ${health.statusText()}`,
      );
    }
    await use(ctx);
    await ctx.dispose();
  },

  authedPage: async ({ page, authToken }, use) => {
    // Inject the token BEFORE any page script runs. addInitScript fires
    // once per navigation in this context, so the token survives across
    // page.goto calls within the test.
    await page.addInitScript((token) => {
      (window as unknown as { __NOMI_DEV_TOKEN__: string }).__NOMI_DEV_TOKEN__ = token;
    }, authToken);
    await use(page);
  },
});

export { expect };

/**
 * Helpers used across specs to seed and tear down state deterministically.
 * Each returns the created resource so tests can use its ID.
 */

export interface SeededAssistant {
  id: string;
  name: string;
}

export interface SeededRun {
  id: string;
}

export async function seedAssistant(
  api: APIRequestContext,
  overrides: Partial<{
    name: string;
    role: string;
    systemPrompt: string;
    mode: "allow" | "confirm" | "deny";
  }> = {},
): Promise<SeededAssistant> {
  const name = overrides.name ?? `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const res = await api.post("/assistants", {
    data: {
      name,
      role: overrides.role ?? "dev",
      system_prompt: overrides.systemPrompt ?? "e2e test assistant",
      permission_policy: {
        rules: [
          { capability: "command.exec", mode: overrides.mode ?? "confirm" },
          { capability: "filesystem.read", mode: "allow" },
        ],
      },
    },
  });
  if (!res.ok()) {
    throw new Error(`seedAssistant failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id, name };
}

export async function seedRun(
  api: APIRequestContext,
  assistantId: string,
  goal: string,
): Promise<SeededRun> {
  const res = await api.post("/runs", {
    data: { goal, assistant_id: assistantId },
  });
  if (!res.ok()) {
    throw new Error(`seedRun failed: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}

/**
 * Poll the runs list until a run with the given goal appears, or the
 * deadline passes. Returns the run ID. Used by tests that create a run via
 * the UI and want to know when the backend registered it (and when the
 * event-driven invalidation has propagated to the client).
 */
export async function waitForRun(
  api: APIRequestContext,
  goal: string,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api.get("/runs");
    if (res.ok()) {
      const body = (await res.json()) as { runs: Array<{ id: string; goal: string }> };
      const match = body.runs.find((r) => r.goal === goal);
      if (match) return match.id;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`waitForRun: no run with goal ${JSON.stringify(goal)} within ${timeoutMs}ms`);
}
