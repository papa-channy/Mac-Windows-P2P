// updater.ts — wrapper around @tauri-apps/plugin-updater. Exposes a single
// `checkForUpdate` entry that returns either null (already current) or an
// object with a `install()` method that downloads + replaces the .app and
// restarts the process.

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

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  let update: Update | null;
  try {
    update = await check();
  } catch (e) {
    console.warn("updater check failed:", e);
    return null;
  }
  if (!update) return null;

  return {
    version: update.version,
    notes: update.body ?? undefined,
    date: update.date ?? undefined,
    install: async (onProgress) => {
      let downloaded = 0;
      let total: number | null = null;
      await update!.downloadAndInstall((event) => {
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
