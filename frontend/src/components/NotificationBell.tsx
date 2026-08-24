import { useEffect, useState } from "react";
import { Bell, CheckCheck, Info, XCircle } from "lucide-react";
import { api } from "../lib/api";
import type { NotificationsResponse } from "../types";
import { formatDateTime } from "../lib/format";

export function NotificationBell({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<NotificationsResponse["items"]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const load = () => {
      api
        .get<NotificationsResponse>("/notifications?limit=20")
        .then((r) => {
          setItems(r.items);
          setUnread(r.unread);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      api.post("/notifications/read-all").catch(() => {});
      setUnread(0);
    }
  }

  return (
    <div className="relative">
      {compact ? (
        <button
          type="button"
          className="btn btn-secondary relative !p-2"
          onClick={toggle}
          aria-label="Notificações"
          title="Notificações"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unread}
            </span>
          )}
        </button>
      ) : (
        <button type="button" className="btn btn-secondary w-full" onClick={toggle}>
          <span className="flex w-full items-center justify-between">
            <span className="inline-flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notificações
            </span>
            {unread > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
                {unread}
              </span>
            )}
          </span>
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-ink-400 bg-ink-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-ink-400 px-4 py-3">
              <span className="font-serif text-sm font-semibold text-gold-400">Notificações</span>
              <button
                type="button"
                className="text-xs text-cream/40 hover:text-gold-400"
                onClick={() => {
                  api.post("/notifications/read-all").catch(() => {});
                  setUnread(0);
                }}
              >
                Marcar todas como lidas
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-cream/40">Nenhuma notificação</p>
              ) : (
                <ul className="divide-y divide-ink-400/60">
                  {items.map((n) => (
                    <li key={n.id} className="flex items-start gap-2.5 px-4 py-3">
                      {n.level === "ERROR" ? (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                      ) : n.level === "WARN" ? (
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      ) : (
                        <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-500/70" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-cream/80">{n.message}</p>
                        <p className="mt-0.5 text-xs text-cream/35">{formatDateTime(n.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
