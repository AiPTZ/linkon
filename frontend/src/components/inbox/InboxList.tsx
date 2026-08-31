import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Inbox as InboxIcon, Search } from "lucide-react";
import type { ConversationSummary } from "../../types";
import { formatDateTime, shortName } from "../../lib/format";
import { Spinner } from "../Spinner";

export type InboxFilter = "ALL" | "DISPARO" | "CONVITE" | "NEEDS_HUMAN";

const FILTER_TABS: { key: InboxFilter; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "DISPARO", label: "Disparos" },
  { key: "CONVITE", label: "Convites" },
  { key: "NEEDS_HUMAN", label: "Precisa humano" },
];

const CONVERSATION_LABEL: Record<string, string> = {
  BOT: "Bot",
  NEEDS_HUMAN: "Precisa humano",
  HUMAN: "Humano",
  CLOSED: "Fechada",
};

export interface InboxListProps {
  items: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  needsHuman: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function InboxList({
  items,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  needsHuman,
  hasMore,
  loadingMore,
  onLoadMore,
}: InboxListProps) {
  const [search, setSearch] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { root: null, rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, onLoadMore]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((c) => {
      const isDisparo = c.campaign ? c.campaign.mode === "DISPARO" : false;
      if (filter === "DISPARO" && !isDisparo) return false;
      if (filter === "CONVITE" && isDisparo) return false;
      if (filter === "NEEDS_HUMAN" && c.status !== "NEEDS_HUMAN") return false;
      if (!q) return true;
      return (
        (c.lead?.name ?? "").toLowerCase().includes(q) ||
        (c.lead?.headline ?? "").toLowerCase().includes(q) ||
        (c.lastMessage ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, filter, search]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cream/30" />
        <input
          className="input w-full pl-9"
          placeholder="Buscar por lead ou mensagem..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === t.key
                ? "border-gold-500 bg-gold-500/15 text-gold-400"
                : "border-ink-400 bg-ink-800 text-cream/50 hover:text-cream/80"
            }`}
            onClick={() => onFilterChange(t.key)}
          >
            {t.label}
            {t.key === "NEEDS_HUMAN" && needsHuman > 0 && (
              <span className="ml-1 text-gold-400">{needsHuman}</span>
            )}
          </button>
        ))}
      </div>
      <div className="max-h-[calc(70vh-7rem)] overflow-y-auto">
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-cream/40">
            <InboxIcon className="h-8 w-8" />
            <span className="text-sm">Nenhuma conversa ainda.</span>
          </div>
        )}
        {visible.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={`mb-1 flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all ${
              selectedId === c.id
                ? "border-gold-500/50 bg-gold-500/10"
                : c.unread > 0
                  ? "border-gold-500/30 bg-gold-500/5"
                  : "border-transparent hover:bg-ink-800"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-cream">
                  {shortName(c.lead?.name, "Lead")}
                </span>
                <span className="whitespace-nowrap text-[11px] text-cream/30">
                  {formatDateTime(c.lastMessageAt)}
                </span>
              </div>
              <div className="truncate text-xs text-cream/45">
                {c.lead?.headline || (c.campaign ? c.campaign.name : `Agente nativo · ${c.account.username ?? "minha conta"}`)}
              </div>
              <div className="mt-1 truncate text-xs text-cream/60">{c.lastMessage}</div>
              {c.booking && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 text-xs text-gold-400">
                  <CalendarDays className="h-3 w-3" />
                  Reunião: {formatDateTime(c.booking.startTime)}
                </span>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  c.campaign && c.campaign.mode === "DISPARO"
                    ? "bg-sky-500/15 text-sky-400"
                    : c.campaign
                      ? "bg-ink-500 text-cream/50"
                      : "bg-emerald-500/15 text-emerald-400"
                }`}
              >
                {c.campaign ? (c.campaign.mode === "DISPARO" ? "Disparo" : "Convite") : "Agente"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  c.status === "NEEDS_HUMAN" ? "bg-amber-500/15 text-amber-400" : "bg-ink-500 text-cream/50"
                }`}
              >
                {CONVERSATION_LABEL[c.status] ?? c.status}
                {c.unread > 0 && ` · ${c.unread}`}
              </span>
            </div>
          </button>
        ))}
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-3">
            {loadingMore ? <Spinner className="h-4 w-4" /> : <span className="text-xs text-cream/40">Carregar mais...</span>}
          </div>
        )}
      </div>
    </div>
  );
}
