import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState } from "react";
import { hasTauriBridge, useTauriEvents } from "@/hooks/use-tauri-events";
import { queryKeys } from "@/lib/query-keys";
import type { Event as NomiEvent } from "@/types/api";

export interface EventConnectionState {
  sseConnected: boolean;
  connectionMode: "live" | "polling" | "disconnected";
  lastError: string | null;
}

const EventConnectionContext = createContext<EventConnectionState>({
  sseConnected: false,
  connectionMode: "polling",
  lastError: null,
});

/**
 * useEventConnection is the read-only hook children use to surface the SSE
 * "Live" badge without opening their own subscription. There is only ever
 * ONE Tauri SSE subscription in the renderer — owned by EventProvider at
 * the app root — because the Rust-side generation counter makes concurrent
 * subscriptions clobber each other.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook intentionally colocated with its provider
export function useEventConnection(): EventConnectionState {
  return useContext(EventConnectionContext);
}

/**
 * Mounts the single Tauri SSE subscription at the app root and invalidates
 * the React Query cache keys relevant to each incoming event type. This is
 * the mechanism that makes the UI reflect backend state changes within
 * ~100ms instead of waiting for the next poll tick.
 *
 * Event-type → invalidation map:
 *   run.*           → runs.list + runs.detail(runID) + events.list
 *   step.*          → runs.detail(runID) + events.list
 *   approval.*      → approvals.list + runs.approvals(runID) + events.list
 *   memory.*        → memory.all
 *   plan.*          → runs.detail(runID)
 *   connector.*     → connectors.all
 */
export function EventProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const bridgeAvailable = hasTauriBridge();
  const [state, setState] = useState<EventConnectionState>({
    sseConnected: false,
    connectionMode: bridgeAvailable ? "disconnected" : "polling",
    lastError: null,
  });

  useTauriEvents({
    onEvent: (ev: NomiEvent) => {
      handleEventInvalidations(qc, ev);
    },
    onConnect: () =>
      setState({ sseConnected: true, connectionMode: "live", lastError: null }),
    onDisconnect: () =>
      setState({
        sseConnected: false,
        connectionMode: hasTauriBridge() ? "disconnected" : "polling",
        lastError: null,
      }),
    onError: (msg) =>
      setState({
        sseConnected: false,
        connectionMode: hasTauriBridge() ? "disconnected" : "polling",
        lastError: msg,
      }),
  });

  return (
    <EventConnectionContext.Provider value={state}>
      {children}
    </EventConnectionContext.Provider>
  );
}

function handleEventInvalidations(
  qc: ReturnType<typeof useQueryClient>,
  ev: NomiEvent,
) {
  // Events list is invalidated for every event type; polling UIs that show
  // the raw log update without a manual refresh.
  qc.invalidateQueries({ queryKey: queryKeys.events.all });

  if (ev.type.startsWith("run.")) {
    qc.invalidateQueries({ queryKey: queryKeys.runs.list() });
    qc.invalidateQueries({ queryKey: queryKeys.runs.detail(ev.run_id) });
    return;
  }

  if (ev.type.startsWith("step.")) {
    // step.streaming fires once per token, which would invalidate the
    // run detail query 50+ times per llm.chat call and flood the UI.
    // Live token rendering is consumed off the event payload by the
    // chat panel directly; the run detail still refreshes on
    // step.completed.
    if (ev.type === "step.streaming") return;
    qc.invalidateQueries({ queryKey: queryKeys.runs.detail(ev.run_id) });
    return;
  }

  if (ev.type.startsWith("approval.")) {
    qc.invalidateQueries({ queryKey: queryKeys.approvals.list() });
    qc.invalidateQueries({ queryKey: queryKeys.runs.approvals(ev.run_id) });
    return;
  }

  if (ev.type.startsWith("memory.")) {
    qc.invalidateQueries({ queryKey: queryKeys.memory.all });
    return;
  }

  if (ev.type.startsWith("plan.")) {
    qc.invalidateQueries({ queryKey: queryKeys.runs.detail(ev.run_id) });
    return;
  }

  if (ev.type.startsWith("connector.")) {
    qc.invalidateQueries({ queryKey: queryKeys.connectors.all });
    return;
  }
}
