import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Contact as ContactIcon,
  Download,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
import { api } from "../lib/api";
import type { Account, Contact, ContactListResponse } from "../types";
import { PageLoader } from "../components/Spinner";
import { formatDateTime, shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

function contactList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const NETWORK_LABEL: Record<string, string> = {
  SELF: "Você",
  FIRST_DEGREE: "1º grau",
  SECOND_DEGREE: "2º grau",
  THIRD_DEGREE: "3º grau",
  OUT_OF_NETWORK: "Fora da rede",
};

function networkLabel(value: string | null | undefined): string {
  return (value && NETWORK_LABEL[value]) || "—";
}

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [q, setQ] = useState("");
  const [onlyWithContact, setOnlyWithContact] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Contact | null>(null);
  const { toast } = useToast();

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (onlyWithContact) params.set("onlyWithContact", "1");
    if (accountId) params.set("accountId", accountId);
    api
      .get<ContactListResponse>(`/contacts?${params.toString()}`)
      .then((r) => {
        setContacts(r.items);
        setTotal(r.total);
      })
      .catch((err) => toastFromError(toast, err));
  }, [q, onlyWithContact, accountId, toast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, onlyWithContact]);

  useEffect(() => {
    api
      .get<{ items: Account[] }>("/accounts")
      .then((r) => {
        const ok = r.items.filter((a) => a.status === "OK");
        setAccounts(ok);
        setAccountId((prev) => prev || ok[0]?.id || "");
      })
      .catch((err) => toastFromError(toast, err));
  }, [toast]);

  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function onSync() {
    if (!accountId) {
      toast("error", "Selecione uma conta LinkedIn conectada.");
      return;
    }
    setBusy("sync");
    try {
      await api.post<{ ok: boolean }>("/contacts/sync", { accountId });
      toast("success", "Sincronização da rede iniciada");
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  async function onScrape() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      toast("error", "Selecione ao menos um contato.");
      return;
    }
    setBusy("scrape");
    try {
      await api.post<{ ok: boolean; scheduled: number }>("/contacts/scrape", { contactIds: ids });
      toast("success", `Scraping de ${ids.length} contato(s) agendado`);
      setSelected(new Set());
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  function onExport() {
    const params = new URLSearchParams();
    if (accountId) params.set("accountId", accountId);
    if (selectionIds.size > 0) params.set("providerIds", Array.from(selectionIds).join(","));
    api
      .download(`/contacts/export-xlsx?${params.toString()}`)
      .then(() => toast("success", "Planilha exportada"))
      .catch((err) => toastFromError(toast, err));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectionIds = useMemo(() => {
    const selectedSet = new Set<string>();
    contacts?.forEach((c) => {
      if (selected.has(c.id)) selectedSet.add(c.providerId);
    });
    return selectedSet;
  }, [contacts, selected]);

  if (!contacts) return <PageLoader />;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Contatos</h1>
        <p className="mt-1 text-sm text-cream/50">
          Sua rede de conexões do LinkedIn, armazenada automaticamente conforme a conta é conectada.
          Contatos das campanhas de convite aceitos entram aqui também.
        </p>
      </div>

      <div className="card mb-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cream/40" />
            <input
              className="input !pl-9"
              placeholder="Buscar por nome ou cargo..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="input !w-auto" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.length === 0 && <option value="">Nenhuma conta conectada</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {shortName(a.username, a.unipileAccountId)}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-cream/70">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              checked={onlyWithContact}
              onChange={(e) => setOnlyWithContact(e.target.checked)}
            />
            Com contato
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={onSync} disabled={busy !== null}>
            {busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sincronizar rede
          </button>
          <button type="button" className="btn" onClick={onScrape} disabled={busy !== null || selected.size === 0}>
            {busy === "scrape" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
            Raspar contatos ({selected.size})
          </button>
          <button type="button" className="btn" onClick={onExport} disabled={busy !== null}>
            <Download className="h-4 w-4" />
            Exportar XLSX
          </button>
          <span className="ml-auto text-xs text-cream/50">{total} contato(s)</span>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
            <ContactIcon className="h-7 w-7 text-gold-500" />
          </div>
          <div>
            <h2 className="font-serif text-xl text-cream">Nenhum contato ainda</h2>
            <p className="mt-1 max-w-md text-sm text-cream/50">
              Conecte sua conta do LinkedIn e clique em "Sincronizar rede" para armazenar suas
              conexões. Os convites aceitos pelas campanhas entram automaticamente.
            </p>
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink-600/60 text-xs uppercase tracking-wide text-cream/40">
              <tr>
                <th className="px-4 py-3" />
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Cargo</th>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3">E-mail</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Grau</th>
                <th className="px-4 py-3">Contato extraído</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-600/40">
              {contacts.map((c) => {
                const emails = contactList(c.emails);
                const phones = contactList(c.phones);
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-colors hover:bg-ink-700/40"
                    onClick={() => setDetail(c)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-gold-500"
                        checked={selected.has(c.id)}
                        onChange={() => toggle(c.id)}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-cream">{c.name ?? "—"}</td>
                    <td className="max-w-60 truncate px-4 py-3 text-cream/60">{c.headline ?? "—"}</td>
                    <td className="px-4 py-3 text-cream/60">
                      {c.account ? shortName(c.account.username, "—") : "—"}
                    </td>
                    <td className="max-w-44 truncate px-4 py-3 text-cream/60">
                      {emails.length > 0 ? emails[0] : "—"}
                    </td>
                    <td className="max-w-44 truncate px-4 py-3 text-cream/60">
                      {phones.length > 0 ? phones[0] : "—"}
                    </td>
                    <td className="px-4 py-3 text-cream/60">{networkLabel(c.networkDistance)}</td>
                    <td className="px-4 py-3 text-cream/60">
                      {c.scrapedAt ? formatDateTime(c.scrapedAt) : "Pendente"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetail(null)}>
          <div className="card max-h-[85vh] w-full max-w-lg overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 className="font-serif text-xl text-cream">{detail.name ?? "Contato"}</h2>
              <button
                type="button"
                className="rounded-lg border border-ink-400 px-2 py-1 text-sm text-cream/60 hover:text-cream"
                onClick={() => setDetail(null)}
              >
                Fechar
              </button>
            </div>
            <div className="space-y-3 text-sm">
              {detail.headline && (
                <p className="text-cream/60">{detail.headline}</p>
              )}
              {detail.profileUrl && (
                <a
                  href={detail.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-gold-400 underline"
                >
                  Ver perfil no LinkedIn
                </a>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase text-cream/40">E-mail</p>
                  <p className="break-words text-cream">{contactList(detail.emails).join("; ") || "—"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-cream/40">Telefone</p>
                  <p className="break-words text-cream">{contactList(detail.phones).join("; ") || "—"}</p>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-cream/40">Redes sociais / Sites</p>
                <p className="break-words text-cream">{contactList(detail.socials).join("; ") || "—"}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase text-cream/40">Grau de rede</p>
                  <p className="text-cream">{networkLabel(detail.networkDistance)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-cream/40">Conta de origem</p>
                  <p className="text-cream">
                    {detail.account ? shortName(detail.account.username, "—") : "—"}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase text-cream/40">Contato extraído em</p>
                  <p className="text-cream">{detail.scrapedAt ? formatDateTime(detail.scrapedAt) : "Pendente"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-cream/40">Adicionado em</p>
                  <p className="text-cream">{formatDateTime(detail.createdAt)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
