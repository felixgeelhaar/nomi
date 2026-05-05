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
import { remoteTemplatesApi } from "@/lib/api";
import { Download, Search, Package } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RemoteTemplateBrowser({ open, onOpenChange }: Props) {
  const [filter, setFilter] = useState("");
  
  const catalog = useQuery({
    queryKey: ["remote-templates"],
    queryFn: remoteTemplatesApi.list,
    enabled: open,
    retry: false,
  });

  const filtered = useMemo(() => {
    const entries = catalog.data?.templates ?? [];
    if (!filter.trim()) return entries;
    const needle = filter.trim().toLowerCase();
    return entries.filter((e) =>
      [e.name, e.id, e.tagline ?? "", e.best_for ?? "", e.not_for ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [catalog.data, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Browse Remote Templates</DialogTitle>
          <DialogDescription>
            Assistant templates published to the Nomi marketplace. Click Install to
            materialize as a draft assistant.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by name, id, or description"
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

          {catalog.isError && (
            <div className="text-sm border rounded-md p-4 space-y-2">
              <div className="font-medium">Remote templates not configured</div>
              <p className="text-muted-foreground">
                The remote templates catalog needs the NOMI_REMOTE_TEMPLATES_ROOT_KEY
                set to verify catalog signatures.
              </p>
            </div>
          )}

          {!catalog.isLoading && !catalog.isError && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              {filter.trim() ? "No matching templates." : "No templates available."}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((entry) => (
              <div key={entry.id} className="border rounded-md p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{entry.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.id}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    <Package className="w-3 h-3 mr-1" />
                    Template
                  </Badge>
                </div>

                {entry.tagline && (
                  <p className="text-sm text-muted-foreground">
                    {entry.tagline}
                  </p>
                )}

                <div className="flex gap-2 text-xs text-muted-foreground">
                  {entry.best_for && (
                    <span>Best for: {entry.best_for}</span>
                  )}
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    remoteTemplatesApi.install(entry);
                    onOpenChange(false);
                  }}
                >
                  <Download className="w-3 h-3 mr-1" />
                  Install as Draft
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
