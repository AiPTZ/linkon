import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCheck, Plus, Radar, Send, Trash2, Users, XCircle } from "lucide-react";
import { api } from "../lib/api";
import type { Campaign } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { PageLoader } from "../components/Spinner";
import { formatDateTime, shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

const REFRESH_MS = 5_000;

export function DisparosPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const load = () => {
      api
        .get<{ items: Campaign[] }>("/campaigns")
        .then((r) => setCampaigns(r.items.filter((c) => c.mode === "DISPARO")))
        .catch((err) => toastFromError(toast, err));
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [toast]);

  async function onDelete(c: Campaign) {
    if (!window.confirm(`Excluir o disparo "${c.name}"? Leads, logs e notificações serão removidos.`)) {
      return;
    }
    try {
      await api.delete(`/campaigns/${c.id}`);
      toast("success", "Disparo excluído");
      setCampaigns((prev) => prev?.filter((x) => x.id !== c.id) ?? null);
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  if (!campaigns) return <PageLoader />;

  const replyRate = (c: Campaign): number | null => {
    const sent = (c.stats?.COMPLETED ?? 0) + (c.stats?.RESPONDED ?? 0);
    if (sent === 0) return null;
    return Math.round(((c.stats?.RESPONDED ?? 0) / sent) * 100);
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Disparos</h1>
          <p className="mt-1 text-sm text-cream/50">
            Envie mensagens em massa para os contatos selecionados e acompanhe em tempo real
          </p>
        </div>
        <Link to="/disparos/nova" className="btn btn-primary">
          <Plus className="h-4 w-4" />
          Novo disparo
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
            <Radar className="h-7 w-7 text-gold-500" />
          </div>
          <div>
            <h2 className="font-serif text-xl text-cream">Nenhum disparo ainda</h2>
            <p className="mt-1 max-w-sm text-sm text-cream/50">
              Crie um disparo, varra a rede da sua conta, selecione os contatos e envie uma
              mensagem pré-definida em massa.
            </p>
          </div>
          <Link to="/disparos/nova" className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Criar primeiro disparo
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => {
            const rate = replyRate(c);
            return (
              <div key={c.id} className="relative">
                <Link
                  to={`/disparos/${c.id}`}
                  className="card group p-5 transition-all duration-200 hover:border-gold-500/40 hover:shadow-gold"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-serif text-lg font-medium leading-snug text-cream group-hover:text-gold-400">
                      {c.name}
                    </h2>
                    <StatusBadge status={c.status} kind="campaign" mode={c.mode} />
                  </div>
                <div className="mt-1 text-xs text-cream/40">
                  Conta: {shortName(c.account.username, "—")}
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-ink-400 pt-4">
                  <div className="flex flex-col items-center gap-1 text-center">
                    <Send className="h-4 w-4 text-gold-500/70" />
                    <span className="text-lg font-semibold text-cream">
                      {c.stats?.COMPLETED ?? 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-cream/40">
                      Enviados
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <CheckCheck className="h-4 w-4 text-gold-500/70" />
                    <span className="text-lg font-semibold text-cream">
                      {c.stats?.RESPONDED ?? 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-cream/40">
                      Respondidos
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <XCircle className="h-4 w-4 text-gold-500/70" />
                    <span className="text-lg font-semibold text-cream">
                      {c.stats?.ERROR ?? 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-cream/40">
                      Falhas
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-cream/40">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {c.stats?.selected ?? 0}/{c.stats?.total ?? 0} contatos
                  </span>
                  {rate !== null && (
                    <span className="font-medium text-gold-400">{rate}% de resposta</span>
                  )}
                </div>

                <div className="mt-3 text-[11px] text-cream/30">
                  Criado em {formatDateTime(c.createdAt)}
                </div>
                </Link>
                <button
                  type="button"
                  onClick={() => onDelete(c)}
                  className="absolute bottom-3 right-3 rounded-lg border border-ink-400 bg-ink-800/80 p-1.5 text-cream/40 transition-colors hover:border-red-500/40 hover:text-red-400"
                  aria-label={`Excluir ${c.name}`}
                  title="Excluir disparo"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
