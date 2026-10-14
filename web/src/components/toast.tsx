import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type Toast = { id: number; tone: "ok" | "error" | "info"; message: string; action?: { label: string; onClick: () => void } };
type ToastFn = (message: string, opts?: { tone?: Toast["tone"]; action?: Toast["action"] }) => void;

const Ctx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const show = useCallback<ToastFn>((message, opts) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone: opts?.tone ?? "ok", action: opts?.action }]);
    setTimeout(() => dismiss(id), opts?.tone === "error" ? 8000 : 4000);
  }, []);
  const icons = { ok: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-soft"
            >
              <Icon className={`mt-0.5 size-4 shrink-0 ${t.tone === "error" ? "text-danger" : t.tone === "ok" ? "text-ok" : "text-accent"}`} />
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button className="font-medium text-accent-text hover:underline" onClick={() => (t.action!.onClick(), dismiss(t.id))}>
                  {t.action.label}
                </button>
              )}
              <button aria-label="Dismiss" className="text-faint hover:text-ink" onClick={() => dismiss(t.id)}>
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
