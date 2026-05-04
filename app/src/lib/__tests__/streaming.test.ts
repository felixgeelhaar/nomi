import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  appendStreamDelta,
  clearStreamDelta,
  dropStream,
  useStepStream,
} from "@/lib/streaming";

afterEach(() => {
  // Drop any test-local buffers; the store is module-singleton so leakage
  // between tests would mask ordering bugs.
  for (const id of ["s1", "s2", "s3", "s-out-of-order", "s-clear", "s-drop"]) {
    clearStreamDelta(id);
    dropStream(id);
  }
});

describe("streaming store", () => {
  it("accumulates deltas in order and notifies subscribers", () => {
    const { result } = renderHook(() => useStepStream("s1"));
    expect(result.current).toBe("");

    act(() => appendStreamDelta("s1", "Hello", 1));
    expect(result.current).toBe("Hello");

    act(() => appendStreamDelta("s1", ", world", 2));
    expect(result.current).toBe("Hello, world");
  });

  it("ignores deltas with a non-monotonic seq", () => {
    const { result } = renderHook(() => useStepStream("s-out-of-order"));
    act(() => appendStreamDelta("s-out-of-order", "first", 5));
    // Out-of-order packet from a flaky transport: must be dropped.
    act(() => appendStreamDelta("s-out-of-order", "second", 3));
    expect(result.current).toBe("first");
    act(() => appendStreamDelta("s-out-of-order", "third", 6));
    expect(result.current).toBe("firstthird");
  });

  it("isolates streams by stepId", () => {
    const { result: a } = renderHook(() => useStepStream("s1"));
    const { result: b } = renderHook(() => useStepStream("s2"));

    act(() => {
      appendStreamDelta("s1", "AAA", 1);
      appendStreamDelta("s2", "BBB", 1);
    });

    expect(a.current).toBe("AAA");
    expect(b.current).toBe("BBB");
  });

  it("clears the buffer for a step (used on retry)", () => {
    const { result } = renderHook(() => useStepStream("s-clear"));
    act(() => appendStreamDelta("s-clear", "stale", 1));
    expect(result.current).toBe("stale");
    act(() => clearStreamDelta("s-clear"));
    expect(result.current).toBe("");
    // Counter resets so a new stream starting at seq=1 isn't filtered.
    act(() => appendStreamDelta("s-clear", "fresh", 1));
    expect(result.current).toBe("fresh");
  });

  it("does not notify when delta is empty or stepId is empty", () => {
    const listener = vi.fn();
    const { result, rerender } = renderHook(({ id }: { id: string }) =>
      useStepStream(id), { initialProps: { id: "s1" } });
    listener.mockClear();
    act(() => {
      appendStreamDelta("", "anything", 1);
      appendStreamDelta("s1", "", 2);
    });
    expect(result.current).toBe("");

    rerender({ id: "" });
    expect(result.current).toBe("");
  });

  it("dropStream is a no-op while subscribers are still mounted", () => {
    const { result } = renderHook(() => useStepStream("s-drop"));
    act(() => appendStreamDelta("s-drop", "kept", 1));
    act(() => dropStream("s-drop"));
    // Subscriber still sees the buffered text — drop only removes the
    // entry once nothing is listening to it.
    expect(result.current).toBe("kept");
  });
});
