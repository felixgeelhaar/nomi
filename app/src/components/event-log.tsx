import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { eventsApi, auditApi, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useEventConnection } from "@/providers/event-provider";

export function EventLog() {
  const [filter, setFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportRedacted, setExportRedacted] = useState(true);
  const [retentionDays, setRetentionDays] = useState(30);
  const [pruning, setPruning] = useState(false);
  const { connectionMode } = useEventConnection();

  // Single source of truth: EventProvider invalidates events.all whenever an
  // event fires, so useQuery re-fetches within a tick. No setInterval here;
  // a 30s safety refetch catches cases where SSE is down AND no invalidation
  // was triggered in that window.
  const {
    data,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.events.list({ limit: 50 } as { limit?: number; type?: string }),
    queryFn: () => eventsApi.list({ limit: 50 }),
    refetchInterval: 30_000,
  });
  const events = data?.events ?? [];

  const apiError = error
    ? error instanceof ApiError
      ? error.message
      : "API unreachable"
    : null;

  const filteredEvents = events.filter((event) =>
    filter ? event.type.includes(filter) : true,
  );

  const eventTypeColors: Record<string, string> = {
    "run.created": "bg-blue-500",
    "plan.proposed": "bg-purple-500",
    "step.started": "bg-yellow-500",
    "step.completed": "bg-green-500",
    "step.failed": "bg-red-500",
    "approval.requested": "bg-orange-500",
    "approval.resolved": "bg-teal-500",
    "run.completed": "bg-green-600",
    "run.failed": "bg-red-600",
  };

  const exportAudit = async () => {
    setExporting(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      const data = await auditApi.export({
        from: from.toISOString(),
        to: to.toISOString(),
        format: "ndjson",
        redact: exportRedacted,
      });
      const blob = new Blob([data], { type: "application/x-ndjson" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nomi-audit-${new Date().toISOString().slice(0, 10)}.ndjson`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const pruneAudit = async () => {
    if (!window.confirm(`Delete events older than ${retentionDays} days? This cannot be undone.`)) {
      return;
    }
    setPruning(true);
    try {
      await auditApi.prune(retentionDays);
      await refetch();
    } finally {
      setPruning(false);
    }
  };

  return (
    <div className="p-4 space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Event Log</h2>
          <Badge
            variant={
              connectionMode === "live"
                ? "default"
                : connectionMode === "disconnected"
                  ? "destructive"
                  : "secondary"
            }
            className="text-xs flex items-center gap-1.5"
          >
            <span className={`relative flex h-2 w-2 ${connectionMode === "live" ? "" : "animate-pulse"}`}>
              <span
                className={`inline-flex rounded-full h-2 w-2 ${
                  connectionMode === "live"
                    ? "bg-green-400"
                    : connectionMode === "disconnected"
                      ? "bg-red-400"
                      : "bg-amber-400"
                }`}
              ></span>
              {connectionMode !== "live" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              )}
            </span>
            {connectionMode === "live"
              ? "Live"
              : connectionMode === "polling"
                ? "Polling"
                : "Disconnected"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={exportRedacted}
              onChange={(e) => setExportRedacted(e.target.checked)}
            />
            Redact contents
          </label>
          <input
            type="text"
            placeholder="Filter by type..."
            className="px-3 py-1 text-sm border rounded-md"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter events by type"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportAudit} disabled={exporting}>
            {exporting ? "Exporting..." : "Export Audit"}
          </Button>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              className="w-20 px-2 py-1 text-sm border rounded-md"
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value || 30))}
              aria-label="Retention days"
            />
            <Button variant="outline" size="sm" onClick={pruneAudit} disabled={pruning}>
              {pruning ? "Pruning..." : "Prune"}
            </Button>
          </div>
        </div>
      </div>

      {apiError && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-400">
          {apiError}
        </div>
      )}

      <div
        className="flex-1 overflow-auto space-y-2"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {filteredEvents.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">
            No events yet. Create a run to generate events.
          </div>
        ) : (
          filteredEvents.map((event) => (
            <Card key={event.id} className="border-l-4 border-l-transparent">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        eventTypeColors[event.type] || "bg-gray-500"
                      }`}
                    />
                    <CardTitle className="text-xs font-mono">
                      {event.type}
                    </CardTitle>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-xs text-muted-foreground">
                  Chat: {event.run_id}
                </div>
                {event.step_id && (
                  <div className="text-xs text-muted-foreground">
                    Step: {event.step_id}
                  </div>
                )}
                {event.payload && (
                  <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-32">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
