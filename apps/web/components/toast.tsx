"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Kind = "ok" | "error";
const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ id: number; msg: string; kind: Kind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((msg: string, kind: Kind = "ok") => {
    clearTimeout(timer.current);
    setT({ id: Date.now(), msg, kind });
    timer.current = setTimeout(() => setT(null), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {t && (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex max-w-xl items-center gap-3 rounded-lg border-2 px-4 py-3 text-base font-bold shadow-lg",
              t.kind === "error" ? "border-crit-text bg-crit-tint text-crit-text" : "border-ink bg-ink text-sheet",
            )}
          >
            {t.kind === "error" ? <AlertTriangle className="size-5 shrink-0" aria-hidden /> : <CheckCircle2 className="size-5 shrink-0" aria-hidden />}
            <span>{t.msg}</span>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
