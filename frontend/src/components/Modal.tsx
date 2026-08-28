import type { ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mt-8 w-full max-w-2xl rounded-2xl border border-ink-400 bg-ink-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-ink-400 px-5 py-4">
          <h2 className="font-serif text-xl font-semibold text-gold-400">{title}</h2>
          <button
            type="button"
            className="rounded-lg p-1.5 text-cream/50 transition-colors hover:bg-ink-700 hover:text-cream"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
