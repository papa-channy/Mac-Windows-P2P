// useDragDrop.ts — wrap Tauri v2 webview drag-drop event into a React hook.
//
// Emits: "enter" (drag entered window), "leave" (drag exited / cancelled),
// and "drop" (paths dropped). Matches the Windows behavior in app.js
// setupDragDrop() — full-window listener, no per-element zones.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";

export interface DragDropHandlers {
  onEnter?: () => void;
  onLeave?: () => void;
  onDrop?: (paths: string[]) => void;
}

export function useDragDrop(handlers: DragDropHandlers) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const wv = getCurrentWebview();
        const u = await wv.onDragDropEvent((event) => {
          if (cancelled) return;
          const p = event.payload as
            | { type: "enter"; paths: string[]; position: unknown }
            | { type: "over"; position: unknown }
            | { type: "leave" }
            | { type: "drop"; paths: string[]; position: unknown };
          if (!p) return;
          if (p.type === "enter") handlers.onEnter?.();
          else if (p.type === "leave") handlers.onLeave?.();
          else if (p.type === "drop") {
            handlers.onLeave?.();
            handlers.onDrop?.(p.paths ?? []);
          }
        });
        unlisten = u;
      } catch (e) {
        console.warn("drag-drop listener init failed:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handlers]);
}
