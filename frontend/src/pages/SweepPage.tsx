import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Clock,
  Loader2,
  MessageSquare,
  Radar,
  Rocket,
  Send,
  ShieldAlert,
  Users,
  Workflow,
} from "lucide-react";
import { api } from "../lib/api";
import type { Account, CampaignPayload, Flow, RelationsPreview } from "../types";
import { FlowEditor } from "../components/FlowEditor";
import { emptyFlow } from "../lib/flow";
import { PageLoader } from "../components/Spinner";
import { useToast, toastFromError } from "../components/Toast";

const DEFAULT_MESSAGE =
  "Olá {nome}! Vi que já somos conectados aqui no LinkedIn e queria compartilhar uma oportunidade que pode ser interessante para você.";

export function SweepPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState("");
  const [counting, setCounting] = useState(false);
  const [preview, setPreview] = useState<RelationsPreview | null>(null);

  const [name, setName] = useState("");
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [strategy, setStrategy] = useState({
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    maxLeads: 2000,
  });
  const [useFlow, setUseFlow] = useState(false);
  const [flow, setFlow] = useState<Flow>(emptyFlow());
  const [flowOpen, setFlowOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const connected = useMemo(
    () => (accounts ?? []).filter((a) => a.status === "OK"),
    [accounts],
  );

  useEffect(() => {
    api
      .get<{ items: Account[] }>("/accounts")
      .then((r) => {
        setAccounts(r.items);
        const ok = r.items.filter((a) => a.status === "OK");
        if (ok.length > 0) setAccountId((cur) => cur || ok[0].id);
      })
      .catch(() => setAccounts([]));
  }, []);

  const setStrategyField = <K extends keyof typeof strategy>(key: K, value: number) =>
    setStrategy((s) => ({ ...s, [key]: value }));

  async function onCount() {
    if (!accountId) {
      toast("warning", "Selecione uma conta primeiro");
      return;
    }
    setCounting(true);
    try {
      const r = await api.get<RelationsPreview>(`/accounts/${accountId}/relations?cap=5000`);
      setPreview(r);
      toast(
        "success",
        `${r.total.toLocaleString("pt-BR")} conexões encontradas${r.capped ? " (contagem limitada)" : ""}`,
      );
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setCounting(false);
    }
  }

  const estimatedDays = useMemo(() => {
    if (!preview || preview.total === 0 || strategy.dailyLimit <= 0) return null;
    return Math.ceil(preview.total / strategy.dailyLimit);
  }, [preview, strategy.dailyLimit]);

  async function onCreate() {
    if (!accountId) {
      toast("error", "Selecione uma conta LinkedIn");
      return;
    }
    if (!message.trim() && !useFlow) {
      toast("error", "Escreva a mensagem que será enviada para a rede");
      return;
    }
    setSubmitting(true);
    try {
      const payload: CampaignPayload = {
        name:
          name.trim() ||
          `Varredura de rede · ${new Date().toLocaleDateString("pt-BR")} · ${new Date().toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
        mode: "SWEEP",
        accountId,
        inviteMessage: message,
        dailyLimit: strategy.dailyLimit,
        weeklyLimit: strategy.weeklyLimit,
        minDelayMin: strategy.minDelayMin,
        maxDelayMin: strategy.maxDelayMin,
        workStartHour: strategy.workStartHour,
        workEndHour: strategy.workEndHour,
        maxLeads: strategy.maxLeads,
        flow: useFlow ? flow : undefined,
      };
      const created = await api.post<{ id: string }>("/campaigns", payload);
      await api.post(`/campaigns/${created.id}/start`);
      toast("success", "Varredura da rede criada e iniciada");
      navigate(`/campanhas/${created.id}`);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setSubmitting(false);
    }
  }

  if (accounts === null) return <PageLoader />;

  return (
    <div className="max-w-3xl">
      <Link
        to="/campanhas"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para campanhas
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
          <Radar className="h-5 w-5 text-gold-500" />
        </div>
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Varrer rede</h1>
          <p className="mt-0.5 text-sm text-cream/50">
            Envie uma mensagem pré-definida para todas as conexões do LinkedIn da conta
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">1. Conta e alcance</h2>
          <div>
            <label htmlFor="accountId" className="label">
              Conta LinkedIn *
            </label>
            <select
              id="accountId"
              className="input"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setPreview(null);
              }}
            >
              {connected.length === 0 && <option value="">Nenhuma conta conectada</option>}
              {connected.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username ?? a.unipileAccountId}
                </option>
              ))}
            </select>
            {connected.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-400">
                Conecte sua conta LinkedIn primeiro.{" "}
                <Link to="/conectar" className="underline hover:text-gold-400">
                  Ir para contas
                </Link>
                .
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!accountId || counting}
              onClick={onCount}
            >
              {counting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Contar conexões
            </button>
            {preview && (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                <Radar className="h-4 w-4" />
                {preview.total.toLocaleString("pt-BR")} conexões
                {preview.capped ? "+" : ""}
              </span>
            )}
          </div>

          {preview && (
            <div className="rounded-lg border border-ink-400 bg-ink-800/70 p-4">
              {preview.sample.length > 0 ? (
                <>
                  <div className="text-xs uppercase tracking-wide text-cream/40">
                    Algumas conexões encontradas
                  </div>
                  <ul className="mt-2 space-y-1">
                    {preview.sample.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-cream/80">
                        <span className="h-1.5 w-1.5 rounded-full bg-gold-500" aria-hidden="true" />
                        <span className="font-medium">{s.name ?? "Perfil sem nome"}</span>
                        {s.headline && <span className="truncate text-cream/40">· {s.headline}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-cream/50">Nenhuma conexão encontrada para esta conta.</p>
              )}
              {estimatedDays && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-cream/50">
                  <Clock className="h-3.5 w-3.5" />
                  Estimativa: ~{estimatedDays} dia(s) a {strategy.dailyLimit} mensagens/dia
                </p>
              )}
            </div>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">2. Mensagem</h2>
          <div>
            <label htmlFor="message" className="label">
              Mensagem para a rede *
            </label>
            <textarea
              id="message"
              className="input min-h-32 resize-y"
              maxLength={1000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Olá {nome}, ..."
            />
            <p className="mt-1 text-right text-xs text-cream/40">{message.length}/1000</p>
          </div>
          <p className="text-xs text-cream/40">
            Dica: use <code className="rounded bg-ink-700 px-1 py-0.5 text-gold-400">{"{nome}"}</code> e{" "}
            <code className="rounded bg-ink-700 px-1 py-0.5 text-gold-400">{"{cargo}"}</code> para
            personalizar com o nome e o cargo de cada conexão. Só são enviadas mensagens para
            contatos que ainda não receberam.
          </p>
        </section>

        <section className="card">
          <button
            type="button"
            className="flex w-full items-center justify-between p-5 text-left"
            onClick={() => setFlowOpen((v) => !v)}
            aria-expanded={flowOpen}
          >
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 font-serif text-lg text-gold-400">
                <Workflow className="h-5 w-5" />
                Fluxo personalizado (opcional)
              </span>
              <span className="text-xs text-cream/40">
                {useFlow ? "Fluxo ativo: comanda os envios" : "Sem fluxo: envia a mensagem única acima"}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-gold-500"
                checked={useFlow}
                onChange={(e) => {
                  setUseFlow(e.target.checked);
                  setFlowOpen(e.target.checked);
                }}
                aria-label="Usar fluxo personalizado"
              />
              <ChevronDown
                className={`h-4 w-4 text-cream/40 transition-transform ${flowOpen ? "rotate-180" : ""}`}
              />
            </span>
          </button>

          {flowOpen && (
            <div className="space-y-3 border-t border-ink-400 p-5">
              <p className="text-xs text-cream/40">
                Na varredura, os contatos já são conexões: o bloco{" "}
                <span className="text-gold-400">Convite</span> envia uma mensagem direta e o{" "}
                <span className="text-gold-400">Quando aceitar</span> passa direto. Um fluxo simples
                seria: Início → Mensagem → Parar.
              </p>
              <FlowEditor
                initialFlow={flow}
                onSave={(f) => {
                  setFlow(f);
                  setUseFlow(f.nodes.length > 0);
                  toast("success", "Fluxo aplicado à varredura");
                }}
              />
            </div>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">3. Estratégia de envio</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dailyLimit" className="label">
                Limite diário
              </label>
              <input
                id="dailyLimit"
                className="input"
                type="number"
                min={1}
                max={100}
                value={strategy.dailyLimit}
                onChange={(e) => setStrategyField("dailyLimit", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="weeklyLimit" className="label">
                Limite semanal
              </label>
              <input
                id="weeklyLimit"
                className="input"
                type="number"
                min={1}
                max={200}
                value={strategy.weeklyLimit}
                onChange={(e) => setStrategyField("weeklyLimit", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="minDelayMin" className="label">
                Atraso mínimo (min)
              </label>
              <input
                id="minDelayMin"
                className="input"
                type="number"
                min={1}
                max={180}
                value={strategy.minDelayMin}
                onChange={(e) => setStrategyField("minDelayMin", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="maxDelayMin" className="label">
                Atraso máximo (min)
              </label>
              <input
                id="maxDelayMin"
                className="input"
                type="number"
                min={1}
                max={180}
                value={strategy.maxDelayMin}
                onChange={(e) => setStrategyField("maxDelayMin", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="workStartHour" className="label">
                Início do horário (h)
              </label>
              <input
                id="workStartHour"
                className="input"
                type="number"
                min={0}
                max={23}
                value={strategy.workStartHour}
                onChange={(e) => setStrategyField("workStartHour", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="workEndHour" className="label">
                Fim do horário (h)
              </label>
              <input
                id="workEndHour"
                className="input"
                type="number"
                min={0}
                max={23}
                value={strategy.workEndHour}
                onChange={(e) => setStrategyField("workEndHour", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="maxLeads" className="label">
                Máximo de contatos a importar
              </label>
              <input
                id="maxLeads"
                className="input"
                type="number"
                min={10}
                max={10000}
                value={strategy.maxLeads}
                onChange={(e) => setStrategyField("maxLeads", Number(e.target.value))}
              />
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-xs text-cream/40">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Varrer a rede inteira é agressivo para o LinkedIn. Respeite limites baixos (ex.: 20–40
            por dia) e intervalos de 5 a 15 minutos para proteger a conta de bloqueios.
          </p>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">Confirmar</h2>
          <div>
            <label htmlFor="name" className="label">
              Nome da campanha (opcional)
            </label>
            <input
              id="name"
              className="input"
              maxLength={200}
              placeholder={`Varredura de rede · ${new Date().toLocaleDateString("pt-BR")}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={submitting || connected.length === 0}
            onClick={onCreate}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : preview ? (
              <Rocket className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {submitting
              ? "Criando..."
              : preview
                ? `Criar e iniciar varredura (${preview.total.toLocaleString("pt-BR")} conexões)`
                : "Criar e iniciar varredura"}
          </button>
          {!preview && (
            <p className="flex items-start gap-1.5 text-xs text-cream/40">
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Dica: clique em "Contar conexões" para ver o tamanho da sua rede antes de iniciar.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
