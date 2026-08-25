import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCheck,
  ExternalLink,
  Inbox,
  ListChecks,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  ScrollText,
  Send,
  Timer,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import { api } from "../lib/api";
import type { Campaign, Lead, LogEvent, Paginated } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { StatCard } from "../components/StatCard";
import { Pagination } from "../components/Pagination";
import { PageLoader } from "../components/Spinner";
import { formatDateTime, LEAD_STATUS_LABEL, shortName } from "../lib/format";
import { BLOCK_DEFS, parseFlow } from "../lib/flow";
import { useToast, toastFromError } from "../components/Toast";

type Tab = "leads" | "logs";

const LEAD_OPTIONS = ["", "PENDING", "INVITED", "ACCEPTED", "RESPONDED", "ERROR", "COMPLETED"] as const;

const REFRESH_MS = 5_000;

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Countdown({ at, now }: { at: string | null; now: number }) {
  if (!at) return <span className="text-cream/30">—</span>;
  const target = new Date(at).getTime();
  if (target <= now) return <span className="text-cream/40">{formatDateTime(at)}</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-gold-400">
      <Timer className="h-3.5 w-3.5" />
      {formatCountdown(target - now)}
    </span>
  );
}

export function CampaignDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [tab, setTab] = useState<Tab>("leads");

  const [leadPage, setLeadPage] = useState(1);
  const [leadStatus, setLeadStatus] = useState<string>("");
  const [leads, setLeads] = useState<Paginated<Lead> | null>(null);

  const [logPage, setLogPage] = useState(1);
  const [logs, setLogs] = useState<Paginated<LogEvent> | null>(null);

  const [busy, setBusy] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());

  const loadCampaign = useCallback(() => {
    api.get<Campaign>(`/campaigns/${id}`).then(setCampaign).catch((e) => toastFromError(toast, e));
  }, [id, toast]);

  const loadLeads = useCallback(() => {
    api
      .get<Paginated<Lead>>(
        `/campaigns/${id}/leads?page=${leadPage}&pageSize=50${leadStatus ? `&status=${leadStatus}` : ""}`,
      )
      .then(setLeads)
      .catch((e) => toastFromError(toast, e));
  }, [id, leadPage, leadStatus, toast]);

  const loadLogs = useCallback(() => {
    api
      .get<Paginated<LogEvent>>(`/campaigns/${id}/logs?page=${logPage}&pageSize=50`)
      .then(setLogs)
      .catch((e) => toastFromError(toast, e));
  }, [id, logPage, toast]);

  useEffect(() => {
    loadCampaign();
  }, [loadCampaign]);

  useEffect(() => {
    if (tab === "leads") loadLeads();
    else loadLogs();
  }, [tab, loadLeads, loadLogs]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      loadCampaign();
      if (tab === "leads") loadLeads();
      else loadLogs();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [tab, loadCampaign, loadLeads, loadLogs]);

  const action = useCallback(
    async (name: "start" | "pause" | "resume") => {
      setBusy(name);
      try {
        await api.post(`/campaigns/${id}/${name}`);
        toast("success", name === "pause" ? "Campanha pausada" : "Campanha iniciada");
        loadCampaign();
      } catch (err) {
        toastFromError(toast, err);
      } finally {
        setBusy(null);
      }
    },
    [id, loadCampaign, toast],
  );

  const stats = useMemo(() => {
    const s = campaign?.stats ?? {};
    return {
      total: s.total ?? 0,
      pending: s.PENDING ?? 0,
      invited: s.INVITED ?? 0,
      accepted: s.ACCEPTED ?? 0,
      responded: s.RESPONDED ?? 0,
      error: s.ERROR ?? 0,
      completed: s.COMPLETED ?? 0,
    };
  }, [campaign]);

  const isBroadcast = campaign?.mode === "DISPARO";
  const sentCount = (stats.completed ?? 0) + (stats.responded ?? 0);
  const replyRate = sentCount > 0 ? Math.round(((stats.responded ?? 0) / sentCount) * 100) : 0;

  const flow = useMemo(() => (campaign ? parseFlow(campaign.flow) : null), [campaign]);
  const hasFlowBlocks = (flow?.nodes.length ?? 0) > 0;

  const nextAtMs = campaign?.nextInviteAt ? new Date(campaign.nextInviteAt).getTime() : null;
  const countdownMs = nextAtMs ? Math.max(0, nextAtMs - now) : 0;
  const showCountdown = ["RUNNING", "IMPORTING"].includes(campaign?.status ?? "");

  if (!campaign) return <PageLoader />;

  const canStart = campaign.status === "DRAFT" || campaign.status === "ERROR";
  const canPause = campaign.status === "RUNNING" || campaign.status === "IMPORTING";
  const canResume =
    campaign.status === "PAUSED" || campaign.status === "LIMIT_HIT" || campaign.status === "COMPLETED";
  const canSelect = isBroadcast && ["DRAFT", "PAUSED", "ERROR"].includes(campaign.status);

  return (
    <div>
      <Link to={isBroadcast ? "/disparos" : "/campanhas"} className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400">
        <ArrowLeft className="h-4 w-4" />
        Voltar
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold gold-gradient-text">{campaign.name}</h1>
            <StatusBadge status={campaign.status} kind="campaign" />
          </div>
          <p className="mt-1 text-sm text-cream/50">
            Conta: {shortName(campaign.account.username, "—")} · Criada em{" "}
            {formatDateTime(campaign.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(`/campanhas/${id}/fluxo`)}
          >
            <Workflow className="h-4 w-4" />
            Fluxo
          </button>
          {canSelect && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(`/disparos/${id}/selecionar`)}
            >
              <ListChecks className="h-4 w-4" />
              Selecionar contatos
            </button>
          )}
          {canStart && (
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => action("start")}>
              {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Iniciar
            </button>
          )}
          {canPause && (
            <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => action("pause")}>
              {busy === "pause" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              Pausar
            </button>
          )}
          {canResume && (
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => action("resume")}>
              {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Retomar
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {isBroadcast ? (
          <>
            <StatCard label="Contatos" value={stats.total} accent />
            <StatCard label="Selecionados" value={campaign.stats?.selected ?? 0} />
            <StatCard label="Enviados" value={stats.completed} />
            <StatCard label="Respondidos" value={stats.responded} />
            <StatCard label="Falhas" value={stats.error} />
            <StatCard label="Resposta" value={replyRate > 0 ? `${replyRate}%` : "—"} accent />
          </>
        ) : (
          <>
            <StatCard label="Leads" value={stats.total} accent />
            <StatCard label="Pendentes" value={stats.pending} />
            <StatCard label="Convidados" value={stats.invited} hint={`Hoje ${campaign.invitesSentToday}/${campaign.dailyLimit}`} />
            <StatCard label="Aceitos" value={stats.accepted} hint={`Semana ${campaign.invitesSentWeek}/${campaign.weeklyLimit}`} />
            <StatCard label="Respondidos" value={stats.responded} />
            <StatCard label="Concluídos" value={stats.completed} />
          </>
        )}
      </div>

      {showCountdown && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-gold-500/25 px-5 py-4">
          <div className="flex items-center gap-3">
            <Timer className="h-5 w-5 text-gold-400" />
            {nextAtMs && countdownMs > 0 ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-cream/40">Próximo envio</div>
                <div className="font-serif text-2xl font-semibold text-gold-400 tabular-nums">
                  {formatCountdown(countdownMs)}
                </div>
              </div>
            ) : nextAtMs && countdownMs === 0 ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-cream/40">Próximo envio</div>
                <div className="font-serif text-2xl font-semibold text-gold-400">Enviando agora...</div>
              </div>
            ) : stats.pending > 0 ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-cream/40">Aguardando agendamento</div>
                <div className="font-serif text-lg font-semibold text-cream/70">
                  {campaign.status === "IMPORTING" ? "Importando leads..." : "O ciclo verifica a cada 5 min"}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-xs uppercase tracking-wide text-cream/40">Status</div>
                <div className="font-serif text-lg font-semibold text-cream/70">Todos os leads processados</div>
              </div>
            )}
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-cream/40">
            <RefreshCw className="h-3.5 w-3.5 animate-[spin_3s_linear_infinite]" />
            Atualização automática a cada {REFRESH_MS / 1000}s
          </span>
        </div>
      )}

      {hasFlowBlocks && flow && (
        <div className="card mb-6 px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 font-serif text-sm text-gold-400">
              <Workflow className="h-4 w-4" />
              Fluxo de mensagens
            </span>
            <Link
              to={`/campanhas/${id}/fluxo`}
              className="text-xs text-cream/50 underline-offset-2 hover:text-gold-400 hover:underline"
            >
              Editar
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {flow.nodes.map((n, i) => {
              const def = BLOCK_DEFS[n.type];
              const Icon = def.icon;
              return (
                <span key={n.id} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-cream/25">→</span>}
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium"
                    style={{ borderColor: `${def.color}44`, color: def.color, background: `${def.color}14` }}
                  >
                    <Icon className="h-3 w-3" />
                    {def.label}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 text-sm">
        <span className="inline-flex items-center gap-2 text-cream/70">
          <Users className="h-4 w-4 text-gold-500" />
          Janela de envio: {String(campaign.workStartHour).padStart(2, "0")}h–{String(campaign.workEndHour).padStart(2, "0")}h
        </span>
        <span className="inline-flex items-center gap-2 text-cream/70">
          <Send className="h-4 w-4 text-gold-500" />
          Atraso: {campaign.minDelayMin}–{campaign.maxDelayMin} min
        </span>
        <span className="inline-flex items-center gap-2 text-cream/70">
          <MessageCircle className="h-4 w-4 text-gold-500" />
          Chatbot: {campaign.chatbotEnabled ? "ativo" : "desativado"}
        </span>
        {campaign.mode === "DISPARO" ? (
          <span className="inline-flex items-center gap-1.5 text-cream/70">
            <Workflow className="h-4 w-4 text-gold-500" />
            Disparo em massa (envia para os contatos selecionados)
          </span>
        ) : campaign.mode === "SWEEP" ? (
          <span className="inline-flex items-center gap-1.5 text-cream/70">
            <Workflow className="h-4 w-4 text-gold-500" />
            Varredura da rede (envia mensagem para as conexões)
          </span>
        ) : (
          <a
            href={campaign.searchUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-cream/50 hover:text-gold-400"
          >
            Abrir busca <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="mb-4 flex gap-1 border-b border-ink-400">
        {(
          [
            { key: "leads", label: "Leads", icon: Users },
            { key: "logs", label: "Logs", icon: ScrollText },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-gold-500 text-gold-400"
                : "border-transparent text-cream/50 hover:text-cream"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "leads" && (
        <div className="card">
          <div className="flex items-center gap-2 border-b border-ink-400 px-4 py-3">
            <label htmlFor="leadFilter" className="label !mb-0">Filtrar</label>
            <select
              id="leadFilter"
              className="input !w-auto"
              value={leadStatus}
              onChange={(e) => {
                setLeadStatus(e.target.value);
                setLeadPage(1);
              }}
            >
              {LEAD_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? "Todos os status" : LEAD_STATUS_LABEL[s as keyof typeof LEAD_STATUS_LABEL]}
                </option>
              ))}
            </select>
          </div>

          {!leads ? (
            <PageLoader />
          ) : leads.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <Inbox className="h-8 w-8 text-cream/30" />
              <p className="text-sm text-cream/50">
                {leadStatus ? "Nenhum lead neste status." : "Nenhum lead ainda. Inicie a campanha para importar os resultados da busca."}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-400">
                      <th className="table-header px-4 py-3">Nome</th>
                      <th className="table-header px-4 py-3">Cargo</th>
                      <th className="table-header px-4 py-3">Status</th>
                      <th className="table-header px-4 py-3">{isBroadcast ? "Enviado em" : "Convidado"}</th>
                      <th className="table-header px-4 py-3">Próximo envio</th>
                      <th className="table-header px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.items.map((lead) => (
                      <tr key={lead.id} className="border-b border-ink-400/60 last:border-0 hover:bg-ink-600/40">
                        <td className="px-4 py-3 font-medium text-cream">
                          {shortName(lead.name, lead.providerId)}
                        </td>
                        <td className="max-w-56 truncate px-4 py-3 text-cream/60">
                          {lead.headline ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={lead.status} kind="lead" />
                        </td>
                        <td className="px-4 py-3 text-cream/50">
                          {formatDateTime(isBroadcast ? lead.lastMessageAt : lead.invitedAt)}
                        </td>
                        <td className="px-4 py-3"><Countdown at={lead.nextInviteAt} now={now} /></td>
                        <td className="px-4 py-3 text-right">
                          {lead.profileUrl && (
                            <a
                              href={lead.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-secondary !px-2.5 !py-1.5"
                              aria-label="Abrir perfil"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-4">
                <Pagination page={leadPage} pageSize={50} total={leads.total} onChange={setLeadPage} />
              </div>
            </>
          )}
        </div>
      )}

      {tab === "logs" && (
        <div className="card">
          {!logs ? (
            <PageLoader />
          ) : logs.items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <ScrollText className="h-8 w-8 text-cream/30" />
              <p className="text-sm text-cream/50">Nenhum registro de atividade ainda.</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-ink-400/60">
                {logs.items.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                    {log.level === "ERROR" ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                    ) : log.level === "WARN" ? (
                      <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    ) : (
                      <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-500/70" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-cream/80">{log.message}</p>
                      <p className="mt-0.5 text-xs text-cream/35">{formatDateTime(log.createdAt)} · {log.type}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="px-4 pb-4">
                <Pagination page={logPage} pageSize={50} total={logs.total} onChange={setLogPage} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
