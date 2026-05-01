import { check, type Update } from "@tauri-apps/plugin-updater";

/**
 * Wire shape of the `latest.json` manifest the desktop app fetches from
 * the configured update endpoint (a GitHub Releases asset, see
 * `tauri.conf.json` → `plugins.updater.endpoints`).
 *
 * Tauri's updater plugin owns the actual deserialization; this type is a
 * documentation-only mirror of the format CI must produce. Keep it in
 * sync with the release workflow (signing-04) and the e2e fixture
 * (signing-09).
 *
 * Example:
 * ```json
 * {
 *   "version": "v0.2.0",
 *   "notes": "First signed release.",
 *   "pub_date": "2026-04-27T12:00:00Z",
 *   "platforms": {
 *     "darwin-aarch64": {
 *       "signature": "...",
 *       "url": "https://github.com/nomiai/nomi/releases/download/v0.2.0/Nomi_0.2.0_aarch64.app.tar.gz"
 *     },
 *     "darwin-x86_64":  { "signature": "...", "url": "..." },
 *     "linux-x86_64":   { "signature": "...", "url": "..." },
 *     "windows-x86_64": { "signature": "...", "url": "..." }
 *   }
 * }
 * ```
 */
export interface LatestManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<
    "darwin-aarch64" | "darwin-x86_64" | "linux-x86_64" | "windows-x86_64",
    { signature: string; url: string }
  >;
}

const DEFER_KEY = "nomi.updater.deferUntil";
const DEFER_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Read the deferral timestamp set by the user clicking "Later" on the
 * update banner. Defers are persisted in localStorage so they survive
 * relaunches without nagging the user.
 */
export function getDeferredUntil(): number | null {
  try {
    const raw = window.localStorage.getItem(DEFER_KEY);
    if (!raw) return null;
    const ts = Number.parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

export function isDeferred(now: number = Date.now()): boolean {
  const until = getDeferredUntil();
  return until !== null && until > now;
}

export function defer(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(DEFER_KEY, String(now + DEFER_DURATION_MS));
  } catch {
    // Storage may be unavailable in some test envs; deferral is best-effort.
  }
}

export function clearDeferral(): void {
  try {
    window.localStorage.removeItem(DEFER_KEY);
  } catch {
    // Best effort.
  }
}

/**
 * Check the configured endpoint for an available update. Returns null
 * when up-to-date, or in non-Tauri environments where `check()` can't
 * reach the Rust bridge (vite preview, Playwright). The plugin throws
 * synchronously in those envs, so wrap defensively.
 */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    return null;
  }
}

/**
 * Download the update bytes silently (no UI). The promise resolves once
 * the bundle is on disk and ready to install. Throws on network or
 * signature failures — callers surface those to the user.
 */
export async function downloadUpdate(update: Update): Promise<void> {
  await update.download();
}

/**
 * Install the previously-downloaded update. On macOS and most Linux
 * targets this replaces the running binary and relaunches; on Windows
 * the MSI installer takes over and the app exits. Either way the user
 * is on the new version next time they see the window.
 */
export async function installAndRelaunch(update: Update): Promise<void> {
  await update.install();
}
