import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { approvalsApi } from "@/lib/api";
import { approvalCopy } from "@/lib/approval-copy";
import { errorMessage } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";

export function ApprovalPanel() {
  const qc = useQueryClient();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showRawDetails, setShowRawDetails] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("nomi.showRawApprovalDetails") === "true";
  });

  // Event-driven primary: EventProvider invalidates approvals.list on every
  // approval.* event. The 30s refetchInterval is a safety net in case SSE
  // drops silently and nothing invalidates — deliberately chosen as an
  // order of magnitude slower than the old 2s polling to prove the event
  // path does the real work.
  const {
    data,
    error: queryError,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: queryKeys.approvals.list(),
    queryFn: () => approvalsApi.list(),
    refetchInterval: 30_000,
  });

  const approvals = data?.approvals ?? [];
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const [armedApprovals, setArmedApprovals] = useState<Record<string, boolean>>({});
  const [rememberChoice, setRememberChoice] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timers: number[] = [];
    for (const approval of pendingApprovals) {
      const copy = approvalCopy(approval.capability, approval.context);
      if (copy.dangerSignal === "irreversible" && armedApprovals[approval.id] === undefined) {
        setArmedApprovals((prev) => ({ ...prev, [approval.id]: false }));
        const timer = window.setTimeout(() => {
          setArmedApprovals((prev) => ({ ...prev, [approval.id]: true }));
        }, 2000);
        timers.push(timer);
      }
      if (copy.dangerSignal !== "irreversible" && armedApprovals[approval.id] === undefined) {
        setArmedApprovals((prev) => ({ ...prev, [approval.id]: true }));
      }
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [pendingApprovals, armedApprovals]);

  const resolveMutation = useMutation({
    mutationFn: ({ id, approved, remember }: { id: string; approved: boolean; remember: boolean }) =>
      approvalsApi.resolve(id, approved, remember),
    onMutate: ({ id }) => setProcessingId(id),
    onSettled: () => {
      setProcessingId(null);
      // Optimistic invalidation — EventProvider will re-invalidate when
      // the backend publishes approval.resolved, but doing it here too
      // makes the UI update within the mutation's lifecycle.
      qc.invalidateQueries({ queryKey: queryKeys.approvals.list() });
    },
  });

  const setRawDetails = (value: boolean) => {
    setShowRawDetails(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("nomi.showRawApprovalDetails", value ? "true" : "false");
    }
  };

  if (isLoading && approvals.length === 0) {
    return (
      <div className="p-4 flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading approvals...</div>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-lg font-semibold">Approval Requests</h2>
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          <p className="font-medium">Error loading approvals</p>
          <p className="text-sm mt-1">{errorMessage(queryError)}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-2"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Approval Requests</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Show raw details</span>
            <ToggleSwitch checked={showRawDetails} onChange={setRawDetails} />
          </div>
          {pendingApprovals.length > 0 && (
            <Badge variant="secondary">{pendingApprovals.length} pending</Badge>
          )}
        </div>
      </div>

      {approvals.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center">
          <p>No approval requests.</p>
          <p className="text-sm mt-1">
            When a step requires confirmation, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            (() => {
              const copy = approvalCopy(approval.capability, approval.context);
              const dangerous = copy.dangerSignal === "irreversible";
              const armed = armedApprovals[approval.id] ?? !dangerous;
              return (
            <Card
              key={approval.id}
              className={`border-l-4 ${
                dangerous && approval.status === "pending"
                  ? "border-l-red-600"
                  : approval.status === "pending"
                  ? "border-l-yellow-500"
                  : approval.status === "approved"
                    ? "border-l-green-500"
                    : "border-l-red-500"
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{copy.summary}</div>
                  <Badge
                    variant={
                      approval.status === "pending"
                        ? "secondary"
                        : approval.status === "approved"
                          ? "default"
                          : "destructive"
                    }
                  >
                    {approval.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Capability: {approval.capability}</div>
                  <div>Chat: {approval.run_id?.slice(0, 8)}...</div>
                  {approval.step_id && (
                    <div>Step: {approval.step_id?.slice(0, 8)}...</div>
                  )}
                </div>

                {showRawDetails && approval.context && (
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-24">
                    {JSON.stringify(approval.context, null, 2)}
                  </pre>
                )}

                {approval.status === "pending" && (
                  <div className="space-y-2">
                    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={rememberChoice[approval.id] || false}
                        onChange={(e) =>
                          setRememberChoice((prev) => ({ ...prev, [approval.id]: e.target.checked }))
                        }
                      />
                      Remember this choice for 24 hours
                    </label>
                    <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1"
                      disabled={processingId === approval.id}
                      onClick={() =>
                        resolveMutation.mutate({
                          id: approval.id,
                          approved: false,
                          remember: rememberChoice[approval.id] || false,
                        })
                      }
                    >
                      {processingId === approval.id ? "Processing..." : "Deny"}
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={processingId === approval.id || !armed}
                      onClick={() =>
                        resolveMutation.mutate({
                          id: approval.id,
                          approved: true,
                          remember: rememberChoice[approval.id] || false,
                        })
                      }
                    >
                      {processingId === approval.id ? "Processing..." : !armed ? "Wait..." : "Approve"}
                    </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
              );
            })()
          ))}
        </div>
      )}
    </div>
  );
}
