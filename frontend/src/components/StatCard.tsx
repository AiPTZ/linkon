import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`card group relative overflow-hidden p-4 ${
        accent ? "border-gold-500/40" : ""
      }`}
    >
      {accent && (
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gold-500/15 blur-2xl"
          aria-hidden="true"
        />
      )}
      <div className="relative">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-cream/40">
          {label}
        </div>
        <div
          className={`mt-1 font-serif text-3xl font-semibold leading-tight ${
            accent ? "gold-gradient-text" : "text-cream"
          }`}
        >
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-cream/40">{hint}</div>}
      </div>
    </div>
  );
}
