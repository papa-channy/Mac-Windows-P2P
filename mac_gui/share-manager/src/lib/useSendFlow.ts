// useSendFlow.ts — central state machine for the "send to Windows" flow.
//
// Three entry points all converge here:
//   1) Tree row → 전송 button       (single path, opens picker)
//   2) Window-level drop event       (1 path → picker, ≥2 → batch unclassified)
//   3) Drop-zone "파일 선택" button  (multiple via dialog → same as drop)
//
// State exposed to consumers:
//   - pickerPaths: opens CategoryPickerModal when non-empty
//   - openPicker(paths): manual entry point (tree send button)
//   - handleDropped(paths): drop / pick entry point — 1=picker, n=batch
//   - closePicker(): dismiss without sending

import { useCallback, useState } from "react";
import { api } from "./api";
import { useToast } from "./toast";
import { MULTI_DROP_CATEGORY, categoryByKey } from "./categories";

export function useSendFlow(onSent: () => void) {
  const [pickerPaths, setPickerPaths] = useState<string[]>([]);
  const toast = useToast();

  const closePicker = useCallback(() => setPickerPaths([]), []);
  const openPicker = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setPickerPaths(paths);
  }, []);

  const sendBatch = useCallback(
    async (paths: string[], categoryKey: string) => {
      if (paths.length === 0) return;
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
    [toast, onSent],
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

  return {
    pickerPaths,
    openPicker,
    closePicker,
    handleDropped,
  };
}
