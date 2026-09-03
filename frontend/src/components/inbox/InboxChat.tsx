import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Bot, MessageCircle, Send, Sparkles, UserCheck, X } from "lucide-react";
import type { ConversationMessage, ConversationSummary } from "../../types";
import { formatDayGroup, shortName } from "../../lib/format";
import { Spinner } from "../Spinner";
import { MessageBubble } from "./MessageBubble";

export interface InboxChatProps {
  conversation: ConversationSummary | null;
  messages: ConversationMessage[] | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  sending: boolean;
  onSend: (text: string) => Promise<void>;
  claiming: boolean;
  reactivating: boolean;
  onClaim: () => void;
  onReactivate: () => void;
  suggesting: boolean;
  suggestion: string | null;
  suggestCostUsd: number | null;
  onSuggest: () => void;
  onDiscardSuggestion: () => void;
  onOpenProfile: () => void;
  aiAllowed: boolean;
}

export function InboxChat({
  conversation,
  messages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  sending,
  onSend,
  claiming,
  reactivating,
  onClaim,
  onReactivate,
  suggesting,
  suggestion,
  suggestCostUsd,
  onSuggest,
  onDiscardSuggestion,
  onOpenProfile,
  aiAllowed,
}: InboxChatProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    setDraft("");
    setStickToBottom(true);
  }, [conversation?.id]);

  useEffect(() => {
    if (suggestion) setDraft(suggestion);
  }, [suggestion]);

  useEffect(() => {
    if (stickToBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, stickToBottom]);

  const grouped = useMemo(() => {
    if (!messages) return [];
    const out: { day: string; items: ConversationMessage[] }[] = [];
    for (const m of messages) {
      const day = formatDayGroup(m.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setStickToBottom(nearBottom);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e as unknown as FormEvent);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!conversation || !draft.trim()) return;
    const text = draft.trim();
    try {
      await onSend(text);
      setDraft("");
    } catch {
      // mantém o rascunho para o usuário tentar de novo
    }
  }

  if (!conversation) {
    return (
      <div className="card flex max-h-[70vh] flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center text-cream/30">
          <MessageCircle className="mr-2 h-5 w-5" /> Selecione uma conversa
        </div>
      </div>
    );
  }

  return (
    <div className="card flex max-h-[70vh] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-ink-400 px-4 py-3">
        <div className="min-w-0">
          <div className="font-medium text-cream">{shortName(conversation.lead?.name, "Lead")}</div>
          <div className="truncate text-xs text-cream/45">
            {conversation.lead?.headline ||
              (conversation.campaign ? conversation.campaign.name : `Agente nativo · ${conversation.account.username ?? "minha conta"}`)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversation.lead?.profileUrl && (
            <button
              type="button"
              onClick={onOpenProfile}
              className="rounded-full border border-ink-400 px-3 py-1 text-xs font-medium text-cream/60 transition-colors hover:bg-ink-800 hover:text-cream"
            >
              Ver perfil
            </button>
          )}
          {conversation.booking?.meetLink && (
            <a
              href={conversation.booking.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
            >
              Abrir Meet
            </a>
          )}
          {conversation.status === "BOT" ? (
            <button
              type="button"
              onClick={onClaim}
              disabled={claiming}
              className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-60"
            >
              {claiming ? <Spinner className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
              Assumir
            </button>
          ) : aiAllowed ? (
            <button
              type="button"
              onClick={onReactivate}
              disabled={reactivating}
              className="flex items-center gap-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-xs font-medium text-gold-300 transition-colors hover:bg-gold-500/20 disabled:opacity-60"
            >
              {reactivating ? <Spinner className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              Reativar IA
            </button>
          ) : null}
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-2 overflow-y-auto p-4">
        {hasOlder && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-ink-400 px-3 py-1 text-xs text-cream/50 transition-colors hover:bg-ink-800 disabled:opacity-60"
            >
              {loadingOlder ? <Spinner className="h-3.5 w-3.5" /> : "Carregar anteriores"}
            </button>
          </div>
        )}
        {messages === null ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center text-sm text-cream/40">Sem mensagens.</div>
        ) : (
          grouped.map((g) => (
            <div key={g.day}>
              <div className="my-2 flex items-center justify-center">
                <span className="rounded-full bg-ink-800 px-3 py-0.5 text-[11px] text-cream/40">{g.day}</span>
              </div>
              <div className="space-y-2">
                {g.items.map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-ink-400 p-3">
        {suggestCostUsd != null && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-gold-500/10 px-3 py-1.5 text-xs text-gold-300">
            <span>Rascunho gerado por IA (custo ~US$ {suggestCostUsd.toFixed(5)}) — edite antes de enviar</span>
            <button
              type="button"
              onClick={() => {
                setDraft("");
                onDiscardSuggestion();
              }}
              className="flex items-center gap-1 hover:text-gold-100"
            >
              <X className="h-3 w-3" /> Descartar
            </button>
          </div>
        )}
        <div className="flex items-start gap-2">
          <textarea
            className="input min-h-[44px] flex-1 resize-none"
            placeholder="Responder como você (sai pelo LinkedIn do cliente)... Enter envia, Shift+Enter quebra linha."
            value={draft}
            maxLength={3000}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {aiAllowed && (
            <button
              type="button"
              onClick={onSuggest}
              disabled={suggesting}
              title="Sugerir resposta com IA"
              className="btn btn-secondary"
            >
              {suggesting ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
            {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
