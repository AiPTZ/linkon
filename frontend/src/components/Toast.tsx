import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";

type ToastKind = "success" | "error" | "warning";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  toast: (kind: ToastKind, message: string) => void;
} | null>(null);

const STYLES: Record<ToastKind, { icon: typeof CheckCircle2; classes: string }> = {
  success: { icon: CheckCircle2, classes: "border-emerald-500/40 text-emerald-300" },
  warning: { icon: AlertTriangle, classes: "border-amber-500/40 text-amber-300" },
  error: { icon: XCircle, classes: "border-red-500/40 text-red-300" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-24 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => {
          const s = STYLES[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-ink-700 p-3 text-sm shadow-card ${s.classes}`}
            >
              <s.icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1 text-cream">{t.message}</span>
              <button
                type="button"
                className="text-cream/40 hover:text-cream"
                onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
                aria-label="Fechar notificação"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve ser usado dentro de ToastProvider");
  return ctx;
}

export function toastFromError(toast: (kind: ToastKind, message: string) => void, err: unknown) {
  const message = err instanceof Error ? err.message : "Erro inesperado";
  toast("error", message);
}
