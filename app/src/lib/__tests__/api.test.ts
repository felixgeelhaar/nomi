import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/api/core before importing the module under test so the
// lazy-loaded auth token never hits the real invoke bridge.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockedInvoke = vi.mocked(invoke);

// Factory: every `fetch` call gets a *fresh* Response so body stream isn't
// reused across the three .json() consumers in the "fetches once" test.
function okJSON(body: unknown) {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
}

// Each `describe` that resets module state must re-import both the module
// under test and its `ApiError` class so instanceof checks line up with the
// fresh module instance.
async function freshApi() {
  vi.resetModules();
  return await import("@/lib/api");
}

describe("fetchApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Distinct return per command so a token can't accidentally get used as
    // a URL. invoke() is called for both get_auth_token and the (newer)
    // get_api_endpoint discovery command.
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_auth_token") return "test-token-abcdef";
      if (cmd === "get_api_endpoint") return "http://127.0.0.1:8080";
      return "";
    });
  });

  it("attaches Bearer token and Content-Type to every request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(okJSON({ status: "ok" }));

    const { healthApi } = await freshApi();
    await healthApi.check();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token-abcdef");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("only fetches the token and endpoint once across multiple requests", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(okJSON({ status: "ok" }));

    const { healthApi } = await freshApi();
    await Promise.all([healthApi.check(), healthApi.check(), healthApi.check()]);

    // Both get_auth_token and get_api_endpoint resolve once and are cached
    // for the lifetime of the renderer; three healthApi.check() calls do
    // not refetch them.
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(mockedInvoke).toHaveBeenCalledWith("get_auth_token");
    expect(mockedInvoke).toHaveBeenCalledWith("get_api_endpoint");
  });

  it("surfaces network errors as ApiError(0)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );

    const { healthApi, ApiError } = await freshApi();
    await expect(healthApi.check()).rejects.toBeInstanceOf(ApiError);
    await expect(healthApi.check()).rejects.toMatchObject({ status: 0 });
  });

  it("surfaces JSON error-body 4xx responses with the server message", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "invalid goal" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const { runsApi, ApiError } = await freshApi();
    const err = await runsApi
      .create({ goal: "", assistant_id: "a1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: "invalid goal" });
  });

  it("falls back to HTTP status when the error body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response("<html>500</html>", {
          status: 500,
          statusText: "Internal Server Error",
        })
      )
    );

    const { runsApi, ApiError } = await freshApi();
    const err = await runsApi.list().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  it("wraps token-load failures in ApiError(0) without calling fetch", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("keyring locked"));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { healthApi, ApiError } = await freshApi();
    await expect(healthApi.check()).rejects.toBeInstanceOf(ApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("module-level exports", () => {
  it("exposes the expected API namespaces", async () => {
    const api = await import("@/lib/api");
    expect(api.runsApi.create).toBeTypeOf("function");
    expect(api.assistantsApi.list).toBeTypeOf("function");
    expect(api.providersApi.list).toBeTypeOf("function");
    expect(api.connectorsApi.listConfigs).toBeTypeOf("function");
    expect(api.healthApi.check).toBeTypeOf("function");
  });
});
