import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdater } from "@/hooks/use-updater";

/**
 * Non-modal banner that surfaces a downloaded update waiting to be
 * installed. Renders at the top of the app shell and disappears once
 * the user clicks "Relaunch" (which triggers the install + relaunch
 * sequence) or "Later" (which defers for 24h).
 *
 * The banner is hidden during checking/downloading/idle/error so
 * users never see in-progress noise. Errors stay silent — there is no
 * meaningful action a user can take when an update download fails;
 * the next 6h poll will retry.
 */
export function UpdateBanner() {
  const { update, status, relaunch, dismiss } = useUpdater();

  if (status !== "ready" || !update) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 border-b bg-primary/5 px-4 py-2 text-sm"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Download className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <span className="truncate">
          New version <span className="font-mono">{update.version}</span> ready.
          Relaunch to install.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Later
        </Button>
        <Button size="sm" onClick={() => void relaunch()}>
          Relaunch
        </Button>
      </div>
    </div>
  );
}
