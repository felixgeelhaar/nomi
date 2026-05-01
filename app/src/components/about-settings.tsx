import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { versionApi, type BuildInfo } from "@/lib/api";

interface VersionState {
  shell: BuildInfo | null;
  daemon: BuildInfo | null;
  daemonError: string | null;
}

const PLACEHOLDER: BuildInfo = { version: "—", commit: "—", build_date: "—" };

export function AboutSettings() {
  const [state, setState] = useState<VersionState>({
    shell: null,
    daemon: null,
    daemonError: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const shell = await versionApi.shell();
      let daemon: BuildInfo | null = null;
      let daemonError: string | null = null;
      try {
        daemon = await versionApi.daemon();
      } catch (err) {
        daemonError = err instanceof Error ? err.message : String(err);
      }
      if (!cancelled) {
        setState({ shell, daemon, daemonError });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>About Nomi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <BuildSection
            heading="Desktop app"
            subtitle="The Tauri shell process"
            info={state.shell ?? PLACEHOLDER}
            loading={state.shell === null}
          />
          <BuildSection
            heading="Runtime daemon"
            subtitle="The nomid process serving the local HTTP API"
            info={state.daemon ?? PLACEHOLDER}
            loading={state.daemon === null && state.daemonError === null}
            error={state.daemonError}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BuildSection({
  heading,
  subtitle,
  info,
  loading,
  error,
}: {
  heading: string;
  subtitle: string;
  info: BuildInfo;
  loading: boolean;
  error?: string | null;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{heading}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
      {error ? (
        <div className="text-sm text-destructive">Failed to load: {error}</div>
      ) : (
        <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="font-mono">{loading ? "…" : info.version}</dd>
          <dt className="text-muted-foreground">Commit</dt>
          <dd className="font-mono">{loading ? "…" : info.commit}</dd>
          <dt className="text-muted-foreground">Built</dt>
          <dd className="font-mono">{loading ? "…" : info.build_date}</dd>
        </dl>
      )}
    </div>
  );
}
