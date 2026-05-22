// toast.tsx — minimal toast notification system. Matches Windows app.js's
// toast(message, kind) API (style.css .toast / .toasts).
//
// Usage:
//   const toast = useToast();
//   toast("저장 완료", "success");
//   toast("실패: " + e, "error");
//
// One <ToastProvider/> at the App root; portals into <div class="toasts"/>.

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ToastKind = "info" | "success" | "error";

interface ToastEntry {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastCtx {
  push: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastCtx>({ push: () => void 0 });

export function useToast() {
  return useContext(Ctx).push;
}

const TTL_MS = 4200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TTL_MS);
  }, []);

  // Listen for ESC to dismiss all (Windows parity)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToasts([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.kind} style={{ pointerEvents: "auto" }}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
