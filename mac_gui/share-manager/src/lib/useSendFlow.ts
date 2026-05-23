// useSendFlow.ts — central state machine for the "send to Windows" flow.
//
// Three entry points all converge here:
//   1) Tree row → 전송 button       (single path, opens picker)
//   2) Window-level drop event       (1 path → picker, ≥2 → batch unclassified)
//   3) Drop-zone "파일 선택" button  (multiple via dialog → same as drop)
//
// Each batch also flows through the HTML asset gate (T6): any .html /
// .htm file that references local sibling assets prompts the user to
// either ship the parent folder, send the .html alone, or cancel the
// whole batch. Mirror of windows_gui/.../app.js htmlAssetGate.
//
// State exposed to consumers:
//   - pickerPaths: opens CategoryPickerModal when non-empty
//   - openPicker(paths): manual entry point (tree send button)
//   - handleDropped(paths): drop / pick entry point — 1=picker, n=batch
//   - closePicker(): dismiss without sending
//   - htmlGate / resolveHtmlGate: HtmlInspectorModal wiring

import { useCallback, useRef, useState } from "react";
import { api } from "./api";
import { useToast } from "./toast";
import { MULTI_DROP_CATEGORY, categoryByKey } from "./categories";
import type {
  FlaggedHtml,
  HtmlInspectorChoice,
} from "../components/HtmlInspectorModal";

interface HtmlGateState {
  flagged: FlaggedHtml[];
}

export function useSendFlow(onSent: () => void) {
  const [pickerPaths, setPickerPaths] = useState<string[]>([]);
  const [htmlGate, setHtmlGate] = useState<HtmlGateState | null>(null);
  const resolveRef = useRef<((c: HtmlInspectorChoice) => void) | null>(null);
  const toast = useToast();

  const closePicker = useCallback(() => setPickerPaths([]), []);
  const openPicker = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setPickerPaths(paths);
  }, []);

  const resolveHtmlGate = useCallback((choice: HtmlInspectorChoice) => {
    const r = resolveRef.current;
    resolveRef.current = null;
    setHtmlGate(null);
    r?.(choice);
  }, []);

  const runHtmlGate = useCallback(
    async (
      paths: string[],
    ): Promise<{ action: "proceed" | "cancel"; paths: string[] }> => {
      const flagged: FlaggedHtml[] = [];
      for (const p of paths) {
        if (!/\.html?$/i.test(p)) continue;
        try {
          const info = await api.inspectHtmlAssets(p);
          if (info.is_html && info.assets.length > 0) {
            flagged.push({ path: p, info });
          }
        } catch (e) {
          console.warn("html inspect:", e);
        }
      }
      if (flagged.length === 0) return { action: "proceed", paths };

      const choice = await new Promise<HtmlInspectorChoice>((resolve) => {
        resolveRef.current = resolve;
        setHtmlGate({ flagged });
      });

      if (choice === "cancel") return { action: "cancel", paths };
      if (choice === "folder") {
        const flaggedSet = new Set(flagged.map((f) => f.path));
        const seenDirs = new Set<string>();
        const out: string[] = [];
        for (const p of paths) {
          if (flaggedSet.has(p)) {
            const dir = p.replace(/[\\/][^\\/]+$/, "");
            if (!seenDirs.has(dir)) {
              seenDirs.add(dir);
              out.push(dir);
            }
          } else {
            out.push(p);
          }
        }
        return { action: "proceed", paths: out };
      }
      return { action: "proceed", paths };
    },
    [],
  );

  const sendBatch = useCallback(
    async (paths: string[], categoryKey: string) => {
      if (paths.length === 0) return;
      const gate = await runHtmlGate(paths);
      if (gate.action === "cancel") {
        toast("전송 취소됨", "info");
        return;
      }
      paths = gate.paths;
      const cat = categoryByKey(categoryKey);
      const label = cat ? `${cat.emoji} ${cat.label}` : categoryKey;
      let ok = 0;
      const errors: string[] = [];
      for (const p of paths) {
        try {
          await api.sendPath(p, categoryKey);
          ok++;
        } catch (e) {
          errors.push(`${p}: ${e}`);
        }
      }
      if (errors.length === 0) {
        toast(`${label}으로 ${ok}개 항목 전송 완료`, "success");
      } else {
        toast(`${ok}개 성공 · ${errors.length}개 실패 (${errors[0]})`, "error");
        console.error("batch send errors:", errors);
      }
      onSent();
    },
    [toast, onSent, runHtmlGate],
  );

  const handleDropped = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      if (paths.length === 1) {
        openPicker(paths);
      } else {
        sendBatch(paths, MULTI_DROP_CATEGORY);
      }
    },
    [openPicker, sendBatch],
  );

  const submitPicker = useCallback(
    async (categoryKey: string) => {
      await sendBatch(pickerPaths, categoryKey);
    },
    [sendBatch, pickerPaths],
  );

  return {
    pickerPaths,
    openPicker,
    closePicker,
    submitPicker,
    handleDropped,
    htmlGate,
    resolveHtmlGate,
  };
}
