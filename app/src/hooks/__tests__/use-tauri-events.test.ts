import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the listener callback so tests can drive events into the hook.
let capturedEventCallback: ((e: { payload: unknown }) => void) | null = null;
let capturedErrorCallback: ((e: { payload: unknown }) => void) | null = null;
const unlistenEvent = vi.fn();
const unlistenError = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((channel: string, cb: (e: { payload: unknown }) => void) => {
    if (channel === "nomi-event") {
      capturedEventCallback = cb;
      return Promise.resolve(unlistenEvent);
    }
    if (channel === "nomi-events-error") {
      capturedErrorCallback = cb;
      return Promise.resolve(unlistenError);
    }
    return Promise.resolve(vi.fn());
  }),
}));

const invokeMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useTauriEvents } from "@/hooks/use-tauri-events";
import type { Event as NomiEvent } from "@/types/api";

describe("useTauriEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedEventCallback = null;
    capturedErrorCallback = null;
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  const sampleEvent: NomiEvent = {
    id: "e1",
    type: "run.created",
    run_id: "r1",
    payload: { goal: "test" },
    timestamp: "2026-04-24T12:00:00Z",
  };

  it("calls onConnect after start_event_stream resolves, then forwards events", async () => {
    const onEvent = vi.fn();
    const onConnect = vi.fn();

    await act(async () => {
      renderHook(() =>
        useTauriEvents({
          runId: null,
          onEvent,
          onConnect,
        })
      );
      // Let the async setup inside the effect resolve.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("start_event_stream", {
      runId: null,
    });
    expect(onConnect).toHaveBeenCalled();

    // Drive an event through the captured listener — this exercises the
    // callback-ref path.
    act(() => {
      capturedEventCallback?.({ payload: sampleEvent });
    });
    expect(onEvent).toHaveBeenCalledWith(sampleEvent);
  });

  it("does not remount the stream when only the onEvent identity changes", async () => {
    const firstOnEvent = vi.fn();
    const secondOnEvent = vi.fn();

    const { rerender } = renderHook(
      ({ onEvent }: { onEvent: (e: NomiEvent) => void }) =>
        useTauriEvents({ runId: "r1", onEvent }),
      { initialProps: { onEvent: firstOnEvent } }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("start_event_stream", {
      runId: "r1",
    });
    invokeMock.mockClear();

    // Re-render with a brand-new inline callback identity.
    await act(async () => {
      rerender({ onEvent: secondOnEvent });
      await Promise.resolve();
    });

    // No remount: start_event_stream must not be called again and the old
    // listener must not be torn down.
    expect(invokeMock).not.toHaveBeenCalled();
    expect(unlistenEvent).not.toHaveBeenCalled();

    // The new callback sees subsequent events — ref was swapped in place.
    act(() => {
      capturedEventCallback?.({ payload: sampleEvent });
    });
    expect(secondOnEvent).toHaveBeenCalledWith(sampleEvent);
    expect(firstOnEvent).not.toHaveBeenCalled();
  });

  it("does restart when runId changes", async () => {
    const { rerender } = renderHook(
      ({ runId }: { runId: string | null }) =>
        useTauriEvents({ runId, onEvent: vi.fn() }),
      { initialProps: { runId: "r1" as string | null } }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    invokeMock.mockClear();
    unlistenEvent.mockClear();

    await act(async () => {
      rerender({ runId: "r2" });
      await Promise.resolve();
      await Promise.resolve();
    });

    // stop on the old stream, then start on the new one.
    expect(invokeMock).toHaveBeenCalledWith("stop_event_stream");
    expect(invokeMock).toHaveBeenCalledWith("start_event_stream", {
      runId: "r2",
    });
  });

  it("cleans up listeners and calls stop_event_stream on unmount", async () => {
    const onDisconnect = vi.fn();
    const { unmount } = renderHook(() =>
      useTauriEvents({ runId: null, onEvent: vi.fn(), onDisconnect })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(unlistenEvent).toHaveBeenCalled();
    expect(unlistenError).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("stop_event_stream");
    expect(onDisconnect).toHaveBeenCalled();
  });

  it("honors enabled=false by skipping setup entirely", async () => {
    renderHook(() =>
      useTauriEvents({ runId: null, onEvent: vi.fn(), enabled: false })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("forwards SSE errors via onError", async () => {
    const onError = vi.fn();
    renderHook(() =>
      useTauriEvents({ runId: null, onEvent: vi.fn(), onError })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      capturedErrorCallback?.({ payload: "connection lost" });
    });

    expect(onError).toHaveBeenCalledWith("connection lost");
  });

  it("is a no-op outside Tauri bridge", async () => {
    const onError = vi.fn();
    const onConnect = vi.fn();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__;

    renderHook(() => useTauriEvents({ runId: null, onEvent: vi.fn(), onError, onConnect }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
