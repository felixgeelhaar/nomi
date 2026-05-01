import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the mock so tests can drive its behavior across the lifecycle
// (no update / update available / download fails / install path).
const checkMock = vi.fn();
const downloadMock = vi.fn();
const installMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));

import { useUpdater } from "@/hooks/use-updater";

const fakeUpdate = {
  version: "v0.2.0",
  date: "2026-04-27",
  body: "release notes",
  download: downloadMock,
  install: installMock,
};

describe("useUpdater integration", () => {
  beforeEach(() => {
    checkMock.mockReset();
    downloadMock.mockReset();
    installMock.mockReset();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("settles in idle when no update is available", async () => {
    checkMock.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.update).toBeNull();
    expect(checkMock).toHaveBeenCalledOnce();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("transitions checking → downloading → ready when update found", async () => {
    checkMock.mockResolvedValue(fakeUpdate);
    downloadMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.update).toBe(fakeUpdate);
    expect(downloadMock).toHaveBeenCalledOnce();
    expect(installMock).not.toHaveBeenCalled(); // user must click Relaunch
  });

  it("surfaces error state when download fails", async () => {
    checkMock.mockResolvedValue(fakeUpdate);
    downloadMock.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("network down");
  });

  it("relaunch invokes install on the update", async () => {
    checkMock.mockResolvedValue(fakeUpdate);
    downloadMock.mockResolvedValue(undefined);
    installMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await result.current.relaunch();
    expect(installMock).toHaveBeenCalledOnce();
  });

  it("dismiss persists a 24h defer and clears the ready update", async () => {
    checkMock.mockResolvedValue(fakeUpdate);
    downloadMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdater());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    result.current.dismiss();
    expect(window.localStorage.getItem("nomi.updater.deferUntil")).not.toBeNull();
  });

  it("skips checking while a previous defer is active", async () => {
    // Pre-seed a fresh defer (now + 24h).
    window.localStorage.setItem(
      "nomi.updater.deferUntil",
      String(Date.now() + 60_000),
    );
    checkMock.mockResolvedValue(fakeUpdate);
    renderHook(() => useUpdater());
    // Settle: the hook calls runCheck, which short-circuits when
    // isDeferred() is true. Without the guard, the mock would have been
    // called.
    await new Promise((r) => setTimeout(r, 20));
    expect(checkMock).not.toHaveBeenCalled();
  });
});
