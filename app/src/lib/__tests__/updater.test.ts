import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearDeferral,
  defer,
  getDeferredUntil,
  isDeferred,
} from "@/lib/updater";

describe("updater defer logic", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns null when no defer has been set", () => {
    expect(getDeferredUntil()).toBeNull();
    expect(isDeferred()).toBe(false);
  });

  it("records a 24h deferral and reports it as active", () => {
    const now = 1_000_000;
    defer(now);
    const until = getDeferredUntil();
    expect(until).not.toBeNull();
    // 24h after `now`.
    expect(until).toBe(now + 24 * 60 * 60 * 1000);
    expect(isDeferred(now)).toBe(true);
  });

  it("considers the deferral expired after 24h + 1ms", () => {
    const now = 1_000_000;
    defer(now);
    expect(isDeferred(now + 24 * 60 * 60 * 1000)).toBe(false);
    expect(isDeferred(now + 24 * 60 * 60 * 1000 + 1)).toBe(false);
  });

  it("clearDeferral removes the persisted timestamp", () => {
    defer(1_000_000);
    expect(isDeferred(1_000_000)).toBe(true);
    clearDeferral();
    expect(isDeferred(1_000_000)).toBe(false);
    expect(getDeferredUntil()).toBeNull();
  });

  it("ignores a corrupt stored value", () => {
    window.localStorage.setItem("nomi.updater.deferUntil", "not-a-number");
    expect(getDeferredUntil()).toBeNull();
    expect(isDeferred()).toBe(false);
  });
});
