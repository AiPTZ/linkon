import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, ScanSearch, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Account, Extraction } from "../types";
import { PageLoader } from "../components/Spinner";
import { formatDateTime, shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

const REFRESH_MS = 5_000;

function ExtractionStatusBadge({ status }: { status: Extraction["status"] }) {
  const styles: Record<string, string> = {
    PROCESSING: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    COMPLETED: "bg-gold-500/15 text-gold-400 border-gold-500/30",
    FAILED: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const labels: Record<string, string> = {
    PROCESSING: "Processando",
    COMPLETED: "Concluída",
    FAILED: "Falhou",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      {status === "PROCESSING" && <Loader2 className="h-3 w-3 animate-spin" />}
      {labels[status]}
    </span>
  );
}

export function ExtractionListPage() {
  const [extractions, setExtractions] = useState<Extraction[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [searchUrl, setSearchUrl] = useState("");
  const [maxResults, setMaxResults] = useState(250);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const load = () => {
    api
      .get<{ items: Extraction[] }>("/extractions")
      .then((r) => setExtractions(r.items))
      .catch((err) => toastFromError(toast, err));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) {
      toast("error", "Selecione uma conta LinkedIn conectada.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<Extraction>("/extractions", {
        name: name || undefined,
        searchUrl,
        accountId,
        maxResults,
      });
      toast("success", "Extração iniciada");
      setName("");
      setSearchUrl("");
      load();
      window.location.assign(`/extracao/${created.id}`);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(x: Extraction) {
    if (!window.confirm(`Excluir a extração "${x.name}" e todos os seus resultados?`)) return;
    try {
      await api.delete(`/extractions/${x.id}`);
      toast("success", "Extração excluída");
      load();
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  if (!extractions) return <PageLoader />;

  const progress = (x: Extraction): number => {
    if (x.totalFound === 0) return 0;
    return Math.round((x.processed / x.totalFound) * 100);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Extração</h1>
        <p className="mt-1 text-sm text-cream/50">
          Cole o link de uma pesquisa de pessoas do LinkedIn, extraia e-mails, telefones e redes
          sociais e exporte os selecionados em planilha XLSX
        </p>
      </div>

      <form onSubmit={onSubmit} className="card mb-8 p-5">
        <h2 className="mb-4 flex items-center gap-2 font-serif text-lg text-gold-400">
          <ScanSearch className="h-5 w-5" />
          Nova extração
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="url" className="label">Link da pesquisa de pessoas</label>
            <input
              id="url"
              className="input"
              placeholder="https://www.linkedin.com/search/results/people/?keywords=..."
              value={searchUrl}
              onChange={(e) => setSearchUrl(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="account" className="label">Conta LinkedIn</label>
            <select
              id="account"
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              {accounts.length === 0 && <option value="">Nenhuma conta conectada</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {shortName(a.username, a.unipileAccountId)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="max" className="label">Máximo de resultados</label>
              <input
                id="max"
                type="number"
                min={1}
                max={500}
                className="input"
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value) || 250)}
              />
            </div>
            <div>
              <label htmlFor="name" className="label">Nome (opcional)</label>
              <input
                id="name"
                className="input"
                placeholder="Ex.: Gerentes bancários SP"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-cream/45">
            E-mails e telefones só são retornados para conexões de 1º grau — é uma limitação do LinkedIn.
          </p>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Iniciar extração
          </button>
        </div>
      </form>

      {extractions.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
            <ScanSearch className="h-7 w-7 text-gold-500" />
          </div>
          <div>
            <h2 className="font-serif text-xl text-cream">Nenhuma extração ainda</h2>
            <p className="mt-1 max-w-md text-sm text-cream/50">
              Cole o link de uma busca de pessoas acima para começar a extrair contatos e montar
              sua base de e-mails, telefones e redes sociais.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {extractions.map((x) => (
            <div key={x.id} className="relative">
              <Link
                to={`/extracao/${x.id}`}
                className="card group flex h-full flex-col p-5 transition-all duration-200 hover:border-gold-500/40 hover:shadow-gold"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-serif text-lg font-medium leading-snug text-cream group-hover:text-gold-400">
                    {x.name}
                  </h2>
                  <ExtractionStatusBadge status={x.status} />
                </div>
                <div className="mt-1 text-xs text-cream/40">
                  Conta: {shortName(x.account.username, "—")} · Criada em {formatDateTime(x.createdAt)}
                </div>

                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-cream/50">
                    <span>
                      {x.totalFound === 0
                        ? x.status === "PROCESSING"
                          ? "Buscando resultados..."
                          : "Nenhum resultado"
                        : `${x.processed}/${x.totalFound} processados`}
                    </span>
                    <span className="font-medium text-gold-400">{x.withContact} com contato</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-600">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-600 transition-all duration-500"
                      style={{ width: `${progress(x)}%` }}
                    />
                  </div>
                </div>

                {x.status === "FAILED" && x.error && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {x.error}
                  </div>
                )}

                <div className="mt-auto pt-3 text-xs text-cream/40">
                  {x.leadsCount} resultados encontrados
                </div>
              </Link>
              <button
                type="button"
                onClick={() => onDelete(x)}
                className="absolute bottom-3 right-3 rounded-lg border border-ink-400 bg-ink-800/80 p-1.5 text-cream/40 transition-colors hover:border-red-500/40 hover:text-red-400"
                aria-label={`Excluir ${x.name}`}
                title="Excluir extração"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
