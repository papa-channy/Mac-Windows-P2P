// useShareTopic — subscribe to a single `share-changed` topic so the
// component re-fetches its data when the watcher (or the polling
// fallback over SMB) reports an upstream change.
//
// Backend topics emitted by src-tauri/src/watcher.rs:
//   - "transfers"  → 10_Exchange/  changed
//   - "notes"      → 60_Notes/     changed
//   - "clipboard"  → 70_Clipboard/ changed
//   - "profiles"   → 10_Config/profiles/ changed
//
// Each view subscribes to exactly the topic it cares about, so unrelated
// changes don't trigger needless refetches.

import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type Topic = "transfers" | "notes" | "clipboard" | "profiles";

export function useShareTopic(topic: Topic, handler: () => void) {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await listen<{ topic: string }>("share-changed", (e) => {
          if (!cancelled && e.payload.topic === topic) handler();
        });
      } catch {
        /* watcher unavailable (no share, or fallback failed) — silently skip */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [topic, handler]);
}
