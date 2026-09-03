import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { ConversationMessage, ConversationSummary, InboxListResponse, MessagePage, SuggestReplyResponse } from "../types";
import { PageLoader } from "../components/Spinner";
import { useToast, toastFromError } from "../components/Toast";
import { InboxList, type InboxFilter } from "../components/inbox/InboxList";
import { InboxChat } from "../components/inbox/InboxChat";
import { LeadContextPanel } from "../components/inbox/LeadContextPanel";
import { isPro } from "../components/ProLock";

const REFRESH_MS = 8_000;
const PAGE_SIZE = 50;

export function InboxPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const aiAllowed = isPro(user);
  const [inbox, setInbox] = useState<InboxListResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestCostUsd, setSuggestCostUsd] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("ALL");

  const inboxRef = useRef<InboxListResponse | null>(null);
  const loadingMoreRef = useRef(false);
  const nextCursorRef = useRef<string | null>(null);

  useEffect(() => {
    inboxRef.current = inbox;
  }, [inbox]);

  useEffect(() => {
    nextCursorRef.current = nextCursor;
  }, [nextCursor]);

  const fetchInbox = useCallback((offset: number, limit: number, replace: boolean) => {
    return api
      .get<InboxListResponse>(`/inbox?offset=${offset}&limit=${limit}`)
      .then((r) => {
        setInbox((prev) => {
          if (!prev || replace) return r;
          const seen = new Set(prev.items.map((i) => i.id));
          return { ...r, items: [...prev.items, ...r.items.filter((i) => !seen.has(i.id))] };
        });
      });
  }, []);

  const refreshInbox = useCallback(() => {
    const current = inboxRef.current;
    const limit = Math.max(current?.items.length ?? 0, PAGE_SIZE);
    fetchInbox(0, limit, true).catch(() => {});
  }, [fetchInbox]);

  const loadMore = useCallback(() => {
    const current = inboxRef.current;
    if (!current?.hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    fetchInbox(current.items.length, PAGE_SIZE, false)
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [fetchInbox]);

  const loadMessages = useCallback(
    (conversationId: string) => {
      api
        .get<MessagePage>(`/inbox/${conversationId}/messages?limit=${PAGE_SIZE}`)
        .then((r) => {
          setMessages(r.items);
          setNextCursor(r.nextCursor);
        })
        .catch((e) => toastFromError(toast, e));
    },
    [toast],
  );

  const loadOlder = useCallback(() => {
    const cursor = nextCursorRef.current;
    if (!selectedId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    api
      .get<MessagePage>(`/inbox/${selectedId}/messages?cursor=${cursor}&limit=${PAGE_SIZE}`)
      .then((r) => {
        setMessages((prev) => [...r.items, ...(prev ?? [])]);
        setNextCursor(r.nextCursor);
      })
      .catch((e) => toastFromError(toast, e))
      .finally(() => setLoadingOlder(false));
  }, [selectedId, loadingOlder, toast]);

  useEffect(() => {
    refreshInbox();
    const t = setInterval(refreshInbox, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshInbox]);

  useEffect(() => {
    if (!selectedId) return;
    setMessages(null);
    setNextCursor(null);
    setSuggestion(null);
    setSuggestCostUsd(null);
    loadMessages(selectedId);
    const t = setInterval(() => {
      if (nextCursorRef.current === null) loadMessages(selectedId);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const pending = inbox?.needsHuman ?? 0;
    const unread = inbox?.items.reduce((s, i) => s + (i.unread ?? 0), 0) ?? 0;
    const total = pending + unread;
    document.title = total > 0 ? `(${total}) Link ON - Automação LinkedIn` : "Link ON - Automação LinkedIn";
    return () => {
      document.title = "Link ON - Automação LinkedIn";
    };
  }, [inbox]);

  if (inbox === null) return <PageLoader />;

  const selected = inbox.items.find((c) => c.id === selectedId) ?? null;

  function selectConversation(id: string) {
    setSelectedId(id);
    api.post(`/inbox/${id}/read`).catch(() => {});
    setInbox((prev) =>
      prev ? { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, unread: 0 } : i)) } : prev,
    );
  }

  async function onSend(text: string) {
    if (!selectedId) return;
    setSending(true);
    try {
      await api.post(`/inbox/${selectedId}/messages`, { text });
      loadMessages(selectedId);
      refreshInbox();
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
      refreshInbox();
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
      refreshInbox();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setReactivating(false);
    }
  }

  async function onSuggest() {
    if (!selectedId || suggesting) return;
    setSuggesting(true);
    setSuggestCostUsd(null);
    try {
      const r = await api.post<SuggestReplyResponse>(`/inbox/${selectedId}/suggest-reply`);
      setSuggestion(r.reply);
      setSuggestCostUsd(r.costUsd);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSuggesting(false);
    }
  }

  function onDiscardSuggestion() {
    setSuggestion(null);
    setSuggestCostUsd(null);
  }

  async function onSaveNote(note: string) {
    if (!selectedId) return;
    setSavingNote(true);
    try {
      const updated = await api.patch<ConversationSummary>(`/inbox/${selectedId}`, { note });
      setInbox((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.id === selectedId ? updated : i)) } : prev,
      );
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSavingNote(false);
    }
  }

  async function onToggleResolved() {
    if (!selectedId) return;
    const current = inbox?.items.find((i) => i.id === selectedId) ?? null;
    if (!current) return;
    setSavingNote(true);
    try {
      const updated = await api.patch<ConversationSummary>(`/inbox/${selectedId}`, { resolved: !current.resolved });
      setInbox((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.id === selectedId ? updated : i)) } : prev,
      );
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSavingNote(false);
    }
  }

  function onOpenProfile() {
    if (selected?.lead?.profileUrl) {
      window.open(selected.lead.profileUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Inbox</h1>
        <p className="mt-1 text-sm text-cream/50">
          Conversas transferidas pelo bot e atendimento humano.{" "}
          {inbox.needsHuman > 0 && <span className="text-gold-400">{inbox.needsHuman} aguardando atendimento.</span>}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr_300px]">
        <div className="card max-h-[70vh] p-3">
          <InboxList
            items={inbox.items}
            selectedId={selectedId}
            onSelect={selectConversation}
            filter={filter}
            onFilterChange={setFilter}
            needsHuman={inbox.needsHuman}
            hasMore={inbox.hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        </div>

        <InboxChat
          conversation={selected}
          messages={messages}
          hasOlder={nextCursor !== null}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          sending={sending}
          onSend={onSend}
          claiming={claiming}
          reactivating={reactivating}
          onClaim={onClaim}
          onReactivate={onReactivate}
          suggesting={suggesting}
          suggestion={suggestion}
          suggestCostUsd={suggestCostUsd}
          onSuggest={onSuggest}
          onDiscardSuggestion={onDiscardSuggestion}
          onOpenProfile={onOpenProfile}
          aiAllowed={aiAllowed}
        />

        <div className="max-h-[70vh] overflow-y-auto">
          <LeadContextPanel
            conversation={selected}
            savingNote={savingNote}
            onSaveNote={onSaveNote}
            onToggleResolved={onToggleResolved}
          />
        </div>
      </div>
    </div>
  );
}
