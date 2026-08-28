import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Inbox, MessageCircle, Send, Bot, UserCheck } from "lucide-react";
import { api } from "../lib/api";
import type { ConversationMessage, InboxListResponse } from "../types";
import { formatDateTime, shortName } from "../lib/format";
import { Spinner, PageLoader } from "../components/Spinner";
import { useToast, toastFromError } from "../components/Toast";

const CONVERSATION_LABEL: Record<string, string> = {
  BOT: "Bot",
  NEEDS_HUMAN: "Precisa humano",
  HUMAN: "Humano",
  CLOSED: "Fechada",
};

const REFRESH_MS = 8_000;

type InboxFilter = "ALL" | "DISPARO" | "CONVITE";

const FILTER_TABS: { key: InboxFilter; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "DISPARO", label: "Disparos" },
  { key: "CONVITE", label: "Convites" },
];

function roleColor(role: ConversationMessage["role"]): string {
  switch (role) {
    case "LEAD":
      return "bg-ink-700 text-cream";
    case "BOT":
      return "bg-gold-500/15 text-gold-300";
    case "HUMAN":
      return "bg-emerald-500/15 text-emerald-300";
    case "SYSTEM":
      return "bg-amber-500/15 text-amber-300";
    default:
      return "bg-ink-700 text-cream";
  }
}

const ROLE_LABEL: Record<ConversationMessage["role"], string> = {
  LEAD: "Lead",
  BOT: "Bot",
  HUMAN: "Você",
  SYSTEM: "Sistema",
};

export function InboxPage() {
  const { toast } = useToast();
  const [inbox, setInbox] = useState<InboxListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("ALL");

  const loadInbox = useCallback(() => {
    api
      .get<InboxListResponse>("/inbox")
      .then(setInbox)
      .catch(() => {});
  }, []);

  const loadMessages = useCallback((conversationId: string) => {
    api
      .get<{ items: ConversationMessage[] }>(`/inbox/${conversationId}/messages`)
      .then((r) => setMessages(r.items))
      .catch((e) => toastFromError(toast, e));
  }, [toast]);

  useEffect(() => {
    loadInbox();
    const t = setInterval(loadInbox, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadInbox]);

  useEffect(() => {
    if (!selectedId) return;
    setMessages(null);
    loadMessages(selectedId);
    const t = setInterval(() => loadMessages(selectedId), REFRESH_MS);
    return () => clearInterval(t);
  }, [selectedId, loadMessages]);

  function selectConversation(id: string) {
    setSelectedId(id);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true);
    try {
      await api.post(`/inbox/${selectedId}/messages`, { text: draft.trim() });
      setDraft("");
      loadMessages(selectedId);
      loadInbox();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSending(false);
    }
  }

  async function onClaim() {
    if (!selectedId) return;
    setClaiming(true);
    try {
      await api.post(`/inbox/${selectedId}/claim`);
      toast("success", "Conversa assumida por você.");
      loadMessages(selectedId);
      loadInbox();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setClaiming(false);
    }
  }

  async function onReactivate() {
    if (!selectedId) return;
    setReactivating(true);
    try {
      await api.post(`/inbox/${selectedId}/reactivate`);
      toast("success", "IA reativada nesta conversa.");
      loadMessages(selectedId);
      loadInbox();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setReactivating(false);
    }
  }

  if (inbox === null) return <PageLoader />;

  const selected = inbox.items.find((c) => c.id === selectedId) ?? null;

  const items = inbox.items.filter((c) => {
    if (filter === "ALL") return true;
    const isDisparo = c.campaign.mode === "DISPARO";
    return filter === "DISPARO" ? isDisparo : !isDisparo;
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Inbox</h1>
        <p className="mt-1 text-sm text-cream/50">
          Conversas transferidas pelo bot e atendimento humano.{" "}
          {inbox.needsHuman > 0 && (
            <span className="text-gold-400">{inbox.needsHuman} aguardando atendimento.</span>
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {FILTER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === t.key
                  ? "border-gold-500 bg-gold-500/15 text-gold-400"
                  : "border-ink-400 bg-ink-800 text-cream/50 hover:text-cream/80"
              }`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="card max-h-[70vh] overflow-y-auto p-3">
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-cream/40">
              <Inbox className="h-8 w-8" />
              <span className="text-sm">Nenhuma conversa ainda.</span>
            </div>
          )}
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectConversation(c.id)}
              className={`mb-1 flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all ${selectedId === c.id ? "border-gold-500/50 bg-gold-500/10" : "border-transparent hover:bg-ink-800"}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-cream">
                    {shortName(c.lead.name, "Lead")}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-cream/30">
                    {formatDateTime(c.lastMessageAt)}
                  </span>
                </div>
                <div className="truncate text-xs text-cream/45">{c.lead.headline || c.campaign.name}</div>
                <div className="mt-1 truncate text-xs text-cream/60">{c.lastMessage}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    c.campaign.mode === "DISPARO"
                      ? "bg-sky-500/15 text-sky-400"
                      : "bg-ink-500 text-cream/50"
                  }`}
                >
                  {c.campaign.mode === "DISPARO" ? "Disparo" : "Convite"}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.status === "NEEDS_HUMAN" ? "bg-amber-500/15 text-amber-400" : "bg-ink-500 text-cream/50"}`}
                >
                  {CONVERSATION_LABEL[c.status] ?? c.status}
                  {c.unread > 0 && ` · ${c.unread}`}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="card flex max-h-[70vh] flex-col overflow-hidden">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-cream/30">
              <MessageCircle className="mr-2 h-5 w-5" /> Selecione uma conversa
            </div>
          ) : (
            <>
              <div className="border-b border-ink-400 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-cream">{shortName(selected.lead.name, "Lead")}</div>
                    <div className="truncate text-xs text-cream/45">
                      {selected.lead.headline || selected.campaign.name}
                    </div>
                  </div>
                  {selected.status === "BOT" ? (
                    <button
                      type="button"
                      onClick={onClaim}
                      disabled={claiming}
                      className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-60"
                    >
                      {claiming ? <Spinner className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                      Assumir
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onReactivate}
                      disabled={reactivating}
                      className="flex items-center gap-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-xs font-medium text-gold-300 transition-colors hover:bg-gold-500/20 disabled:opacity-60"
                    >
                      {reactivating ? <Spinner className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                      Reativar IA
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {messages === null ? (
                  <div className="flex justify-center py-8">
                    <Spinner className="h-6 w-6" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="py-8 text-center text-sm text-cream/40">Sem mensagens.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === "LEAD" ? "justify-start" : "justify-end"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${roleColor(m.role)}`}>
                        <div className="mb-0.5 text-[10px] text-cream/40">{ROLE_LABEL[m.role]}</div>
                        <div className="whitespace-pre-wrap break-words text-sm text-cream">{m.content}</div>
                        {m.costUsd != null && m.role === "BOT" && (
                          <div className="mt-1 text-[10px] text-cream/30">custo ~US$ {m.costUsd.toFixed(5)}</div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-ink-400 p-3">
                <input
                  className="input flex-1"
                  placeholder="Responder como você (sai pelo LinkedIn do cliente)..."
                  value={draft}
                  maxLength={3000}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
                  {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
