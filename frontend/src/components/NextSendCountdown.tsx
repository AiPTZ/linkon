import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function NextSendCountdown({
  at,
  sending = true,
}: {
  at: string | null;
  sending?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  if (!at) return null;
  const target = new Date(at).getTime();
  if (target <= now) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-cream/60">
        <Timer className="h-3.5 w-3.5" />
        {sending ? "Enviando agora..." : "Agora"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-gold-400 tabular-nums">
      <Timer className="h-3.5 w-3.5" />
      {formatCountdown(target - now)}
    </span>
  );
}
