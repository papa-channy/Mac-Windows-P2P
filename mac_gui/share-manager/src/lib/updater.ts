// updater.ts — wrapper around @tauri-apps/plugin-updater. The exported
// shape distinguishes between "no update available" and "check failed" so
// the Settings UI can show a correct status instead of misleading the
// user with "최신 버전입니다" when the endpoint is unreachable.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface AvailableUpdate {
  version: string;
  notes?: string;
  date?: string;
  install: (
    onProgress?: (downloaded: number, total: number | null) => void,
  ) => Promise<void>;
}

export type CheckResult =
  | { kind: "up_to_date" }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "error"; message: string };

function wrap(update: Update): AvailableUpdate {
  return {
    version: update.version,
    notes: update.body ?? undefined,
    date: update.date ?? undefined,
    install: async (onProgress) => {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? null;
            onProgress?.(0, total);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            onProgress?.(downloaded, total);
            break;
          case "Finished":
            onProgress?.(total ?? downloaded, total);
            break;
        }
      });
      // downloadAndInstall on macOS replaces the .app in place but does
      // NOT auto-relaunch — call relaunch() explicitly.
      await relaunch();
    },
  };
}

/** Full result form — preferred for any UI that needs to show status. */
export async function checkForUpdateDetailed(): Promise<CheckResult> {
  try {
    const update = await check();
    if (!update) return { kind: "up_to_date" };
    return { kind: "available", update: wrap(update) };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

/**
 * Backwards-compatible shim: returns null on both "up to date" AND "error"
 * so callers that just want "should I show a banner?" still work. New code
 * should prefer checkForUpdateDetailed().
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const r = await checkForUpdateDetailed();
  return r.kind === "available" ? r.update : null;
}
