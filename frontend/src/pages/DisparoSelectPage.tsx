import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckSquare,
  Inbox,
  Loader2,
  Radar,
  Search,
  Send,
  Square,
} from "lucide-react";
import { api } from "../lib/api";
import type { Campaign, Lead, Paginated } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { Pagination } from "../components/Pagination";
import { PageLoader } from "../components/Spinner";
import { shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

export function DisparoSelectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [selection, setSelection] = useState<{ selected: number; total: number }>({
    selected: 0,
    total: 0,
  });
  const [leads, setLeads] = useState<Paginated<Lead> | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadCampaign = useCallback(() => {
    api
      .get<Campaign>(`/campaigns/${id}`)
      .then(setCampaign)
      .catch((e) => toastFromError(toast, e));
  }, [id, toast]);

  const loadSelection = useCallback(() => {
    api
      .get<{ selected: number; total: number }>(`/campaigns/${id}/leads/selection`)
      .then(setSelection)
      .catch(() => {});
  }, [id]);

  const loadLeads = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), pageSize: "50", selected: "all" });
    if (appliedQuery.trim()) qs.set("q", appliedQuery.trim());
    api
      .get<Paginated<Lead>>(`/campaigns/${id}/leads?${qs.toString()}`)
      .then(setLeads)
      .catch((e) => toastFromError(toast, e));
  }, [id, page, appliedQuery, toast]);

  useEffect(() => {
    loadCampaign();
    loadSelection();
  }, [loadCampaign, loadSelection]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const canEdit = campaign ? ["DRAFT", "PAUSED", "ERROR"].includes(campaign.status) : false;
  const started = campaign ? ["RUNNING", "IMPORTING", "COMPLETED"].includes(campaign.status) : false;

  const reload = () => {
    loadSelection();
    loadLeads();
    loadCampaign();
  };

  async function onSweep() {
    setBusy("sweep");
    try {
      const r = await api.post<{ imported: number }>(`/campaigns/${id}/sweep`);
      toast("success", `${r.imported} conexões importadas da rede`);
      reload();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  async function onSelect(action: "all" | "none" | "toggle", providerIds: string[] = []) {
    setBusy("select");
    try {
      const r = await api.post<{ selected: number }>(`/campaigns/${id}/leads/select`, {
        action,
        providerIds,
      });
      setSelection((s) => ({ ...s, selected: r.selected }));
      loadLeads();
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  async function onStart() {
    setBusy("start");
    try {
      await api.post(`/campaigns/${id}/start`);
      toast("success", "Disparo iniciado. Acompanhe o progresso no detalhe.");
      navigate(`/disparos/${id}`);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setBusy(null);
    }
  }

  if (!campaign) return <PageLoader />;

  return (
    <div>
      <Link
        to="/disparos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para disparos
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold gold-gradient-text">
              {campaign.name}
            </h1>
            <StatusBadge status={campaign.status} kind="campaign" mode={campaign.mode} />
          </div>
          <p className="mt-1 text-sm text-cream/50">
            Selecione os contatos da rede que receberão o disparo
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canEdit || busy !== null}
            onClick={onSweep}
          >
            {busy === "sweep" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
            Varrer rede
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canEdit || selection.selected === 0 || busy !== null}
            onClick={onStart}
          >
            {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Disparar ({selection.selected})
          </button>
        </div>
      </div>

      {started && (
        <div className="card mb-6 border-amber-500/25 px-5 py-4 text-sm text-amber-400">
          Disparo já iniciado. A seleção está bloqueada; pause o disparo para alterar.
        </div>
      )}

      <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-sm">
        <span className="inline-flex items-center gap-2 text-cream/70">
          <Radar className="h-4 w-4 text-gold-500" />
          {selection.total.toLocaleString("pt-BR")} contatos na campanha
        </span>
        <span className="inline-flex items-center gap-2 text-cream/70">
          <CheckSquare className="h-4 w-4 text-gold-500" />
          {selection.selected.toLocaleString("pt-BR")} selecionados
        </span>
        <button
          type="button"
          className="btn btn-secondary !px-2.5 !py-1.5"
          disabled={!canEdit || busy !== null}
          onClick={() => onSelect("all")}
        >
          <CheckSquare className="h-3.5 w-3.5" />
          Selecionar todos
        </button>
        <button
          type="button"
          className="btn btn-secondary !px-2.5 !py-1.5"
          disabled={!canEdit || busy !== null}
          onClick={() => onSelect("none")}
        >
          <Square className="h-3.5 w-3.5" />
          Nenhum
        </button>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-400 px-4 py-3">
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedQuery(searchInput.trim());
              setPage(1);
            }}
          >
            <Search className="h-4 w-4 text-cream/40" />
            <input
              className="input flex-1"
              placeholder="Buscar por nome..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary">
              Buscar
            </button>
            {appliedQuery && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setAppliedQuery("");
                  setSearchInput("");
                  setPage(1);
                }}
              >
                Limpar
              </button>
            )}
          </form>
        </div>

        {!leads ? (
          <PageLoader />
        ) : leads.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Inbox className="h-8 w-8 text-cream/30" />
            <p className="text-sm text-cream/50">
              {selection.total > 0
                ? "Nenhum contato encontrado para a busca."
                : "Nenhum contato ainda. Clique em \"Varrer rede\" para importar as conexões da conta."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-400">
                    <th className="table-header w-10 px-4 py-3">Sel.</th>
                    <th className="table-header px-4 py-3">Nome</th>
                    <th className="table-header px-4 py-3">Cargo</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.items.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b border-ink-400/60 last:border-0 hover:bg-ink-600/40"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-gold-500"
                          checked={lead.selected}
                          disabled={!canEdit || busy !== null}
                          onChange={() => onSelect("toggle", [lead.providerId])}
                          aria-label={`Selecionar ${shortName(lead.name, lead.providerId)}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-cream">
                        {shortName(lead.name, lead.providerId)}
                      </td>
                      <td className="max-w-64 truncate px-4 py-3 text-cream/60">
                        {lead.headline ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 pb-4">
              <Pagination page={page} pageSize={50} total={leads.total} onChange={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
