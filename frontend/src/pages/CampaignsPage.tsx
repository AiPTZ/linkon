import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, Users, Send, CheckCheck, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import type { Campaign } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { NextSendCountdown } from "../components/NextSendCountdown";
import { PageLoader } from "../components/Spinner";
import { formatDateTime, shortName } from "../lib/format";
import { useToast, toastFromError } from "../components/Toast";

const REFRESH_MS = 10_000;

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const load = () => {
      api
        .get<{ items: Campaign[] }>("/campaigns")
        .then((r) => setCampaigns(r.items))
        .catch((err) => toastFromError(toast, err));
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [toast]);

  async function onDelete(c: Campaign) {
    if (!window.confirm(`Excluir a campanha "${c.name}"? Leads, logs e notificações serão removidos.`)) {
      return;
    }
    try {
      await api.delete(`/campaigns/${c.id}`);
      toast("success", "Campanha excluída");
      setCampaigns((prev) => prev?.filter((x) => x.id !== c.id) ?? null);
    } catch (err) {
      toastFromError(toast, err);
    }
  }

  if (!campaigns) return <PageLoader />;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Campanhas</h1>
          <p className="mt-1 text-sm text-cream/50">
            Gerencie suas campanhas de prospecção no LinkedIn
          </p>
        </div>
        <Link to="/campanhas/nova" className="btn btn-primary">
          <Plus className="h-4 w-4" />
          Nova campanha
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
            <TrendingUp className="h-7 w-7 text-gold-500" />
          </div>
          <div>
            <h2 className="font-serif text-xl text-cream">Nenhuma campanha ainda</h2>
            <p className="mt-1 max-w-sm text-sm text-cream/50">
              Conecte sua conta LinkedIn e crie sua primeira campanha para começar a enviar
              convites personalizados de forma automática.
            </p>
          </div>
          <Link to="/campanhas/nova" className="btn btn-primary">
            <Plus className="h-4 w-4" />
            Criar primeira campanha
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <div key={c.id} className="relative">
              <Link
                to={`/campanhas/${c.id}`}
                className="card group flex h-full flex-col p-5 transition-all duration-200 hover:border-gold-500/40 hover:shadow-gold"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="font-serif text-lg font-medium leading-snug text-cream group-hover:text-gold-400">
                      {c.name}
                    </h2>
                    {c.mode === "SWEEP" && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gold-400">
                        <TrendingUp className="h-3 w-3" />
                        Rede
                      </span>
                    )}
                  </div>
                  <StatusBadge status={c.status} kind="campaign" mode={c.mode} />
                </div>
              <div className="mt-1 text-xs text-cream/40">
                Conta: {shortName(c.account.username, "—")}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 border-t border-ink-400 pt-4">
                <div className="flex flex-col items-center gap-1 text-center">
                  <Users className="h-4 w-4 text-gold-500/70" />
                  <span className="text-lg font-semibold text-cream">
                    {c.stats?.total ?? 0}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-cream/40">Leads</span>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <Send className="h-4 w-4 text-gold-500/70" />
                  <span className="text-lg font-semibold text-cream">
                    {c.stats?.INVITED ?? 0}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-cream/40">
                    Hoje {c.invitesSentToday}/{c.dailyLimit}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <CheckCheck className="h-4 w-4 text-gold-500/70" />
                  <span className="text-lg font-semibold text-cream">
                    {c.stats?.ACCEPTED ?? 0}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-cream/40">Aceitos</span>
                </div>
              </div>

              <div className="mt-auto pt-3">
                <div className="text-[11px] text-cream/30">
                  Criada em {formatDateTime(c.createdAt)}
                </div>
                {c.nextInviteAt && ["RUNNING", "IMPORTING"].includes(c.status) && (
                  <div className="mt-2 flex items-center gap-2 border-t border-ink-400 pt-2 text-[11px]">
                    <span className="uppercase tracking-wide text-cream/40">Próximo envio</span>
                    <NextSendCountdown at={c.nextInviteAt} />
                  </div>
                )}
              </div>
              </Link>
              <button
                type="button"
                onClick={() => onDelete(c)}
                className="absolute bottom-3 right-3 rounded-lg border border-ink-400 bg-ink-800/80 p-1.5 text-cream/40 transition-colors hover:border-red-500/40 hover:text-red-400"
                aria-label={`Excluir ${c.name}`}
                title="Excluir campanha"
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
