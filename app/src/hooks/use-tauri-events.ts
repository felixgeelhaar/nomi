import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Event } from "@/types/api";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  }
}

export function hasTauriBridge(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI_IPC__);
}

export interface UseTauriEventsOptions {
  runId?: string | null;
  onEvent?: (event: Event) => void;
  onError?: (error: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
}

/**
 * Subscribes to the Nomi event stream through the Tauri Rust bridge.
 *
 * Callbacks (onEvent/onError/onConnect/onDisconnect) are kept in refs so a
 * parent that passes inline arrow functions does not retrigger start/stop on
 * every render — only `runId` and `enabled` do. This avoids the
 * race-on-remount where the previous stream was torn down before the new one
 * attached its listener.
 *
 * Only one instance of this hook should be active at a time per renderer;
 * multiple consumers would race each other on the Rust-side generation
 * counter. If you need the event stream in several components, lift this
 * hook into a context provider at the app root.
 */
export function useTauriEvents(options: UseTauriEventsOptions): void {
  const { runId, onEvent, onError, onConnect, onDisconnect, enabled = true } = options;

  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);

  onEventRef.current = onEvent;
  onErrorRef.current = onError;
  onConnectRef.current = onConnect;
  onDisconnectRef.current = onDisconnect;

  // attemptRef holds the backoff counter outside React state so a
  // successful reconnect can reset it without re-running the effect (which
  // would otherwise tear down the listeners we just attached and hiccup
  // the stream right after recovery). The reconnect itself is driven by an
  // internal teardown+restart inside the same effect run.
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (!hasTauriBridge()) return;

    let unlistenEvent: UnlistenFn | null = null;
    let unlistenError: UnlistenFn | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const teardownListeners = () => {
      unlistenEvent?.();
      unlistenError?.();
      unlistenEvent = null;
      unlistenError = null;
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      // Exponential backoff capped at 30s. Attempt 0 → 1s, 1 → 2s, 2 → 4s …
      const delay = Math.min(30_000, 1_000 * 2 ** attemptRef.current);
      attemptRef.current += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (cancelled) return;
        teardownListeners();
        // Best-effort: tell the Rust side to drop its stream before we
        // start a new one. If start never ran, this is a no-op.
        invoke("stop_event_stream").catch(() => undefined);
        void start();
      }, delay);
    };

    const start = async () => {
      try {
        unlistenEvent = await listen<Event>("nomi-event", (e) => {
          onEventRef.current?.(e.payload);
        });
        unlistenError = await listen<string>("nomi-events-error", (e) => {
          onErrorRef.current?.(e.payload);
          scheduleReconnect();
        });

        if (cancelled) {
          teardownListeners();
          return;
        }

        await invoke("start_event_stream", { runId: runId ?? null });
        if (!cancelled) {
          onConnectRef.current?.();
          // Successful connect — reset the backoff counter so the next
          // failure starts at the 1s delay rather than continuing to grow.
          attemptRef.current = 0;
        }
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err.message : String(err));
        scheduleReconnect();
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      teardownListeners();
      invoke("stop_event_stream")
        .catch(() => undefined)
        .finally(() => {
          onDisconnectRef.current?.();
        });
    };
  }, [runId, enabled]);
}
