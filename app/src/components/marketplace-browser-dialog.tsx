/**
 * Marketplace browser (lifecycle-13).
 *
 * Lists every plugin in the NomiHub catalog as a card with capabilities,
 * size, publisher, and an Install button that hands off to the install
 * dialog with the entry as preset (so the trust panel pre-renders
 * with the catalog's own capability claims).
 *
 * Falls back to a friendly "marketplace not configured" panel when the
 * daemon returns 503 (NOMI_MARKETPLACE_ROOT_KEY not set). Falls back to
 * a "no entries" panel when the catalog is reachable but empty.
 *
 * Search box is local-only — filters in-memory across name/id/author/
 * description. Catalogs are small (target: <200 entries), no need for
 * server-side filtering.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { pluginsApi, ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import type { MarketplaceEntry } from "@/types/api";
import { InstallPluginDialog } from "@/components/install-plugin-dialog";
import { Download, Package, Search, ShieldCheck } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MarketplaceBrowserDialog({ open, onOpenChange }: Props) {
  const [filter, setFilter] = useState("");
  const [installPreset, setInstallPreset] = useState<MarketplaceEntry | null>(null);

  const catalog = useQuery({
    queryKey: ["plugins", "marketplace"],
    queryFn: pluginsApi.marketplace,
    enabled: open,
    retry: false,
  });

  const filtered = useMemo(() => {
    const entries = catalog.data?.entries ?? [];
    if (!filter.trim()) return entries;
    const needle = filter.trim().toLowerCase();
    return entries.filter((e) =>
      [e.name, e.plugin_id, e.author ?? "", e.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [catalog.data, filter]);

  const isUnconfigured =
    catalog.error instanceof ApiError && catalog.error.status === 503;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Browse marketplace</DialogTitle>
            <DialogDescription>
              Plugins published to NomiHub. Click Install to download, verify, and
              register a bundle into your runtime.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search by name, id, or author"
              className="pl-8"
              disabled={!catalog.data}
            />
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            {catalog.isLoading && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Loading catalog…
              </div>
            )}
            {isUnconfigured && (
              <div className="text-sm border rounded-md p-4 space-y-2">
                <div className="font-medium">Marketplace not configured</div>
                <p className="text-muted-foreground">
                  The marketplace needs the NomiHub root public key to verify
                  catalog signatures. Set <code>NOMI_MARKETPLACE_ROOT_KEY</code>{" "}
                  (base64-encoded ed25519 pubkey) before launching Nomi. Bundled
                  plugins continue to work without it.
                </p>
              </div>
            )}
            {catalog.error && !isUnconfigured && (
              <div className="text-sm text-destructive border border-destructive rounded-md p-3">
                {errorMessage(catalog.error)}
              </div>
            )}
            {catalog.data && filtered.length === 0 && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                {filter
                  ? `No plugins match "${filter}"`
                  : "No plugins in the catalog yet."}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="space-y-2">
                {filtered.map((entry) => (
                  <CatalogEntryCard
                    key={entry.plugin_id}
                    entry={entry}
                    onInstall={() => {
                      setInstallPreset(entry);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {installPreset && (
        <InstallPluginDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setInstallPreset(null);
          }}
          preset={installPreset}
        />
      )}
    </>
  );
}

function CatalogEntryCard({
  entry,
  onInstall,
}: {
  entry: MarketplaceEntry;
  onInstall: () => void;
}) {
  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">{entry.name}</span>
            <Badge variant="outline" className="text-[10px]">
              v{entry.latest_version}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {humanSize(entry.install_size_bytes)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            <code>{entry.plugin_id}</code>
            {entry.author && ` · ${entry.author}`}
          </div>
          {entry.description && (
            <p className="text-xs mt-1">{entry.description}</p>
          )}
          {entry.readme_excerpt && !entry.description && (
            <p className="text-xs mt-1 text-muted-foreground italic">
              {entry.readme_excerpt}
            </p>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            {entry.capabilities.slice(0, 4).map((c) => (
              <Badge
                key={c}
                variant="secondary"
                className="text-[10px] font-mono"
              >
                {c}
              </Badge>
            ))}
            {entry.capabilities.length > 4 && (
              <Badge variant="secondary" className="text-[10px]">
                +{entry.capabilities.length - 4}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-2">
            <ShieldCheck className="w-3 h-3" />
            Signed by <code>{entry.publisher_fingerprint}</code>
          </div>
        </div>
        <div className="flex-shrink-0">
          <Button size="sm" onClick={onInstall}>
            <Download className="w-4 h-4 mr-1" /> Install
          </Button>
        </div>
      </div>
    </div>
  );
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
