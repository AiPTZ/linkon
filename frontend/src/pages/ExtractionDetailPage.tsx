import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCheck,
  Download,
  ExternalLink,
  Inbox,
  Loader2,
  RefreshCw,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import type { Extraction, ExtractedLead } from "../types";
import { PageLoader } from "../components/Spinner";
import { formatDateTime, parseJsonArray, shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

const REFRESH_MS = 5_000;

const NETWORK_LABEL: Record<string, string> = {
  FIRST_DEGREE: "1º grau",
  SECOND_DEGREE: "2º grau",
  THIRD_DEGREE: "3º grau",
  OUT_OF_NETWORK: "Fora da rede",
  SELF: "Você",
};

function netLabel(value: string | null | undefined): string {
  return (value && NETWORK_LABEL[value]) || "—";
}

function joinList(raw: string | null | undefined): string {
  return parseJsonArray<string>(raw ?? "").join("; ");
}

export function ExtractionDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [leads, setLeads] = useState<ExtractedLead[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const loadExtraction = useCallback(() => {
    api
      .get<Extraction>(`/extractions/${id}`)
      .then(setExtraction)
      .catch((e) => toastFromError(toast, e));
  }, [id, toast]);

  const loadLeads = useCallback(() => {
    api
      .get<{ items: ExtractedLead[]; total: number }>(`/extractions/${id}/leads`)
      .then((r) => setLeads(r.items))
      .catch((e) => toastFromError(toast, e));
  }, [id, toast]);

  useEffect(() => {
    loadExtraction();
    loadLeads();
  }, [loadExtraction, loadLeads]);

  useEffect(() => {
    if (extraction?.status !== "PROCESSING") return;
    const t = setInterval(() => {
      loadExtraction();
      loadLeads();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [extraction?.status, loadExtraction, loadLeads]);

  const withContactIds = useMemo(
    () =>
      new Set(
        (leads ?? [])
          .filter((l) => joinList(l.emails) || joinList(l.phones) || joinList(l.socials))
          .map((l) => l.providerId),
      ),
    [leads],
  );

  const allSelected = (leads?.length ?? 0) > 0 && selected.size === (leads?.length ?? 0);

  function toggleAll() {
    if (!leads) return;
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.providerId)));
  }

  function toggle(providerId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  }

  async function onExport() {
    if (!extraction || selected.size === 0) return;
    setBusy("export");
    try {
      const ids = [...selected].join(",");
      await api.download(`/extractions/${id}/export-xlsx?providerIds=${encodeURIComponent(ids)}`);
      toast("success", `Planilha baixada com ${selected.size} selecionado(s)`);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!extraction) return;
    if (!window.confirm(`Excluir a extração "${extraction.name}" e todos os seus resultados?`)) return;
    setBusy("delete");
    try {
      await api.delete(`/extractions/${id}`);
      toast("success", "Extração excluída");
      navigate("/extracao");
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  if (!extraction) return <PageLoader />;

  const processing = extraction.status === "PROCESSING";
  const progress =
    extraction.totalFound === 0
      ? 0
      : Math.min(100, Math.round((extraction.processed / extraction.totalFound) * 100));

  return (
    <div>
      <Link to="/extracao" className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400">
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold gold-gradient-text">{extraction.name}</h1>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                processing
                  ? "border-sky-500/30 bg-sky-500/15 text-sky-400"
                  : extraction.status === "COMPLETED"
                    ? "border-gold-500/30 bg-gold-500/15 text-gold-400"
                    : "border-red-500/30 bg-red-500/15 text-red-400"
              }`}
            >
              {processing && <Loader2 className="h-3 w-3 animate-spin" />}
              {processing ? "Processando" : extraction.status === "COMPLETED" ? "Concluída" : "Falhou"}
            </span>
          </div>
          <p className="mt-1 text-sm text-cream/50">
            Conta: {shortName(extraction.account.username, "—")} · Criada em{" "}
            {formatDateTime(extraction.createdAt)} ·{" "}
            <a
              href={extraction.searchUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gold-400/90 underline-offset-2 hover:underline"
            >
              abrir busca
            </a>
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => { loadExtraction(); loadLeads(); }}>
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0 || busy !== null}
            onClick={onExport}
          >
            {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Baixar XLSX ({selected.size})
          </button>
          <button
            type="button"
            className="btn btn-secondary !border-red-500/40 !text-red-400 hover:!border-red-400 hover:!text-red-300"
            disabled={busy !== null}
            onClick={onDelete}
            title="Excluir extração"
          >
            {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Excluir
          </button>
        </div>
      </div>

      {extraction.status === "FAILED" && extraction.error && (
        <div className="card mb-6 border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
          {extraction.error}
        </div>
      )}

      <div className="card mb-6 px-5 py-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-cream/50">
          <span className="inline-flex items-center gap-1.5">
            <ScanSearch className="h-4 w-4 text-gold-500" />
            {extraction.totalFound === 0
              ? processing
                ? "Buscando resultados..."
                : "Nenhum resultado encontrado"
              : `${extraction.processed}/${extraction.totalFound} processados · ${extraction.withContact} com contato`}
          </span>
          <span className="text-gold-400">{progress}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-ink-600">
          <div
            className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-600 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {processing && (
          <p className="mt-2 text-xs text-cream/40">
            A extração roda em segundo plano. E-mails e telefones aparecem apenas para conexões de 1º
            grau (limitação do LinkedIn).
          </p>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-400 px-4 py-3">
          <button
            type="button"
            onClick={toggleAll}
            disabled={!leads || leads.length === 0}
            className="btn btn-secondary !px-3 !py-1.5 text-xs"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {allSelected ? "Desmarcar todos" : "Selecionar todos"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(withContactIds)}
            disabled={withContactIds.size === 0}
            className="btn btn-secondary !px-3 !py-1.5 text-xs"
          >
            <ScanSearch className="h-3.5 w-3.5" />
            Selecionar com contato ({withContactIds.size})
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="btn btn-secondary !px-3 !py-1.5 text-xs"
            >
              Limpar
            </button>
          )}
          <span className="ml-auto text-xs text-cream/45">
            {selected.size} selecionado{selected.size === 1 ? "" : "s"}
          </span>
        </div>

        {!leads ? (
          <PageLoader />
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Inbox className="h-8 w-8 text-cream/30" />
            <p className="text-sm text-cream/50">
              {processing ? "Buscando pessoas na pesquisa..." : "Nenhum resultado nesta extração."}
            </p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-800">
                <tr className="border-b border-ink-400">
                  <th className="table-header px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-gold-500"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="table-header px-4 py-3">Nome</th>
                  <th className="table-header px-4 py-3">Cargo</th>
                  <th className="table-header px-4 py-3">E-mail</th>
                  <th className="table-header px-4 py-3">Telefone</th>
                  <th className="table-header px-4 py-3">Redes sociais / Sites</th>
                  <th className="table-header px-4 py-3">Grau</th>
                  <th className="table-header px-4 py-3">Extraído em</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const checked = selected.has(lead.providerId);
                  const emails = joinList(lead.emails);
                  const phones = joinList(lead.phones);
                  const socials = joinList(lead.socials);
                  return (
                    <tr
                      key={lead.id}
                      className={`border-b border-ink-400/60 last:border-0 ${checked ? "bg-gold-500/5" : "hover:bg-ink-600/40"}`}
                    >
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-gold-500"
                          checked={checked}
                          onChange={() => toggle(lead.providerId)}
                          aria-label={`Selecionar ${lead.name ?? lead.providerId}`}
                        />
                      </td>
                      <td className="px-4 py-2.5 font-medium text-cream">
                        <span className="inline-flex items-center gap-1.5">
                          {shortName(lead.name, lead.providerId)}
                          {lead.profileUrl && (
                            <a href={lead.profileUrl} target="_blank" rel="noreferrer" aria-label="Abrir perfil">
                              <ExternalLink className="h-3 w-3 text-cream/35 hover:text-gold-400" />
                            </a>
                          )}
                        </span>
                      </td>
                      <td className="max-w-56 truncate px-4 py-2.5 text-cream/60">{lead.headline ?? "—"}</td>
                      <td className="max-w-48 truncate px-4 py-2.5 text-cream/80">{emails || "—"}</td>
                      <td className="max-w-36 truncate px-4 py-2.5 text-cream/80">{phones || "—"}</td>
                      <td className="max-w-48 truncate px-4 py-2.5 text-cream/60">{socials || "—"}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                            lead.networkDistance === "FIRST_DEGREE"
                              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                              : "border-ink-400 bg-ink-600/60 text-cream/50"
                          }`}
                        >
                          {netLabel(lead.networkDistance)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-cream/50">{formatDateTime(lead.scrapedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
