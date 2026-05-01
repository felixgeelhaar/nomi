/**
 * Install Plugin dialog (lifecycle-12).
 *
 * The user-facing entry point for installing marketplace plugins.
 * Two install paths share one trust panel:
 *
 *   - URL — paste a NomiHub bundle URL or any signed .nomi-plugin URL.
 *   - File — pick a local .nomi-plugin (the dev/sideload path; the
 *     daemon still verifies the signature).
 *
 * The trust panel is the security UX that ADR 0002 §2 calls out: every
 * install dialog must surface what the bundle is asking for (capabilities,
 * network allowlist) before the user confirms. A "best effort" preview is
 * derived from the catalog entry when the URL matches a known marketplace
 * plugin; otherwise the user installs blind and trusts the daemon's
 * signature verification to catch a hostile bundle. (Future iteration:
 * download → parse bundle client-side and surface real manifest before
 * install — punted because v1 daemon-side verification is the security
 * truth, the UI panel is courtesy.)
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { pluginsApi } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import type { MarketplaceEntry } from "@/types/api";
import { AlertTriangle, Globe, ShieldCheck, Upload } from "lucide-react";

type Mode = "url" | "file";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Optional: pre-select an entry (e.g. when triggered from a future
  // marketplace browser card). Bypasses the URL field.
  preset?: MarketplaceEntry;
};

export function InstallPluginDialog({ open, onOpenChange, preset }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(preset ? "url" : "url");
  const [url, setUrl] = useState(preset?.bundle_url ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch the catalog so we can show the trust panel when the user's
  // URL matches a known marketplace entry. Catalog is small (cached
  // server-side too) so the cost is negligible. 503 is non-fatal —
  // means the daemon hasn't been configured for marketplace yet, in
  // which case the URL install is still allowed via raw bytes.
  const catalogQuery = useQuery({
    queryKey: ["plugins", "marketplace"],
    queryFn: pluginsApi.marketplace,
    enabled: open,
    retry: false,
  });

  const matchedEntry = useMemo(() => {
    if (preset) return preset;
    if (!catalogQuery.data) return undefined;
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    return catalogQuery.data.entries.find(
      (e) => e.bundle_url === trimmed || e.plugin_id === trimmed,
    );
  }, [preset, catalogQuery.data, url]);

  const reset = () => {
    setUrl(preset?.bundle_url ?? "");
    setFile(null);
    setError(null);
    setMode("url");
  };

  const install = useMutation({
    mutationFn: async () => {
      if (mode === "url") {
        if (!url.trim()) throw new Error("Bundle URL is required");
        return pluginsApi.installFromURL(url.trim());
      }
      if (!file) throw new Error("Choose a .nomi-plugin file to upload");
      return pluginsApi.installFromFile(file);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plugins"] });
      qc.invalidateQueries({ queryKey: ["plugins", "marketplace"] });
      reset();
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Install plugin</DialogTitle>
          <DialogDescription>
            Marketplace bundles are downloaded, signature-verified, and registered into Nomi.
            The plugin starts disabled — enable it from the Plugins tab once you&apos;ve reviewed
            permissions.
          </DialogDescription>
        </DialogHeader>

        {/* Mode selector. Tabs would be heavier than needed — just two pills. */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === "url" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("url")}
            disabled={!!preset}
          >
            <Globe className="w-4 h-4 mr-1" /> From URL
          </Button>
          <Button
            type="button"
            variant={mode === "file" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("file")}
            disabled={!!preset}
          >
            <Upload className="w-4 h-4 mr-1" /> Upload file
          </Button>
        </div>

        {mode === "url" ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">Bundle URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hub.nomi.ai/bundles/example.nomi-plugin"
              disabled={!!preset}
            />
            {!preset && (
              <p className="text-xs text-muted-foreground">
                Paste a NomiHub bundle URL or any HTTPS link to a signed .nomi-plugin file.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium">Plugin bundle</label>
            <Input
              type="file"
              accept=".nomi-plugin"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Local .nomi-plugin files still go through signature verification — Nomi rejects
              unsigned bundles unless you&apos;ve enabled dev mode in Settings.
            </p>
          </div>
        )}

        <TrustPanel entry={matchedEntry} />

        {error && (
          <div className="text-sm text-destructive border border-destructive rounded-md p-2">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
            disabled={install.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => install.mutate()} disabled={install.isPending}>
            {install.isPending ? "Installing…" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// TrustPanel surfaces the bundle's declared capabilities + network
// allowlist. When `entry` is undefined (unknown URL or pre-fetch
// catalog), shows a generic "we'll verify on the daemon" notice.
// When known, breaks out the permission claims so the user can decide
// whether they trust them before clicking Install.
function TrustPanel({ entry }: { entry?: MarketplaceEntry }) {
  if (!entry) {
    return (
      <div className="text-xs text-muted-foreground border rounded-md p-3 flex gap-2">
        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          Nomi will verify the bundle&apos;s Ed25519 signature against the embedded NomiHub root
          key before installation. Capabilities and network allowlist will be visible on the
          Plugins tab once installed.
        </p>
      </div>
    );
  }
  return (
    <div className="border rounded-md p-3 space-y-2 text-sm">
      <div>
        <div className="font-medium">{entry.name}</div>
        <div className="text-xs text-muted-foreground">
          v{entry.latest_version}
          {entry.author && ` · ${entry.author}`}
          {" · "}
          {humanSize(entry.install_size_bytes)}
        </div>
      </div>
      {entry.description && <p className="text-xs">{entry.description}</p>}
      {entry.capabilities.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium">Capabilities requested</div>
          <div className="flex flex-wrap gap-1">
            {entry.capabilities.map((c) => (
              <Badge key={c} variant="secondary" className="text-[10px] font-mono">
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {entry.network_allowlist && entry.network_allowlist.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium">Network hosts</div>
          <div className="flex flex-wrap gap-1">
            {entry.network_allowlist.map((h) => (
              <Badge key={h} variant="outline" className="text-[10px] font-mono">
                {h}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-start gap-2 text-xs text-muted-foreground border-t pt-2">
        <ShieldCheck className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <p>
          Signed by <code>{entry.publisher_fingerprint}</code>. This fingerprint is verified
          to chain to the NomiHub root key before install.
        </p>
      </div>
      {entry.capabilities.includes("command.exec") && (
        <div className="flex items-start gap-2 text-xs text-amber-700 border-t pt-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <p>
            This plugin requests <code>command.exec</code> — it can run shell commands
            (within the allowed_binaries policy). Only install from publishers you trust.
          </p>
        </div>
      )}
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
