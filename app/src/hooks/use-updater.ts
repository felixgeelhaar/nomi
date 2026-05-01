import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  checkForUpdate,
  defer as deferUpdate,
  downloadUpdate,
  installAndRelaunch,
  isDeferred,
} from "@/lib/updater";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "error";

export interface UseUpdaterResult {
  update: Update | null;
  status: UpdaterStatus;
  error: string | null;
  relaunch: () => Promise<void>;
  dismiss: () => void;
}

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Periodically checks the configured update endpoint, silently downloads
 * any newer version, and surfaces a `ready` state for the banner to
 * render. The hook is single-instance — mount it at the App root only.
 *
 * Defer behavior: if the user clicks "Later", a 24h ban is recorded in
 * localStorage and subsequent checks short-circuit until the ban
 * expires. Avoids nagging the user every poll cycle.
 *
 * Network or signature failures land in `error` state but do not crash
 * the renderer; users always have the option to relaunch manually.
 */
export function useUpdater(): UseUpdaterResult {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Guard against overlapping checks if the interval fires while a
  // previous run is still downloading.
  const inFlight = useRef(false);

  const runCheck = useCallback(async () => {
    if (inFlight.current) return;
    if (isDeferred()) return;
    inFlight.current = true;
    setError(null);
    setStatus("checking");
    try {
      const u = await checkForUpdate();
      if (!u) {
        setStatus("idle");
        return;
      }
      setUpdate(u);
      setStatus("downloading");
      await downloadUpdate(u);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void runCheck();
    const interval = setInterval(() => {
      void runCheck();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runCheck]);

  const relaunch = useCallback(async () => {
    if (!update) return;
    try {
      await installAndRelaunch(update);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, [update]);

  const dismiss = useCallback(() => {
    deferUpdate();
    setUpdate(null);
    setStatus("idle");
  }, []);

  return { update, status, error, relaunch, dismiss };
}
