import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  MessageSquare,
  Radar,
  Rocket,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { api } from "../lib/api";
import type { Account, CadenceStep, CampaignPayload, Flow } from "../types";
import { FlowEditor } from "../components/FlowEditor";
import { emptyFlow } from "../lib/flow";
import { PageLoader } from "../components/Spinner";
import { useToast, toastFromError } from "../components/Toast";

const DEFAULT_MESSAGE =
  "Olá {nome}! Vi que já somos conectados aqui no LinkedIn e queria compartilhar uma oportunidade que pode ser interessante para você.";

export function DisparoNewPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState("");

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
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [cadenceEnabled, setCadenceEnabled] = useState(false);
  const [cadence, setCadence] = useState<CadenceStep[]>([]);
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

  const updateCadenceBody = (i: number, body: string) =>
    setCadence((c) => c.map((s, idx) => (idx === i ? { ...s, body } : s)));
  const updateCadenceWait = (i: number, waitDays: number) =>
    setCadence((c) => c.map((s, idx) => (idx === i ? { ...s, waitDays } : s)));
  const addCadenceStep = () => {
    if (cadence.length >= 5) return;
    setCadence((c) => [...c, { body: "", waitDays: 3 }]);
  };
  const removeCadenceStep = (i: number) =>
    setCadence((c) => (c.length > 1 ? c.filter((_, idx) => idx !== i) : c));

  async function onCreate() {
    if (!accountId) {
      toast("error", "Selecione uma conta LinkedIn");
      return;
    }
    if (!message.trim() && !useFlow && !cadenceEnabled) {
      toast("error", "Escreva a mensagem que será enviada");
      return;
    }
    if (cadenceEnabled && cadence.some((s) => !s.body.trim() || s.waitDays < 1 || s.waitDays > 90)) {
      toast("error", "Preencha todas as mensagens da cadência (1 a 90 dias de espera)");
      return;
    }
    setSubmitting(true);
    try {
      const payload: CampaignPayload = {
        name:
          name.trim() ||
          `Disparo · ${new Date().toLocaleDateString("pt-BR")} · ${new Date().toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
        mode: "DISPARO",
        accountId,
        inviteMessage: message,
        cadence: cadenceEnabled ? cadence : undefined,
        dailyLimit: strategy.dailyLimit,
        weeklyLimit: strategy.weeklyLimit,
        minDelayMin: strategy.minDelayMin,
        maxDelayMin: strategy.maxDelayMin,
        workStartHour: strategy.workStartHour,
        workEndHour: strategy.workEndHour,
        maxLeads: strategy.maxLeads,
        agentEnabled,
        flow: useFlow ? flow : undefined,
      };
      const created = await api.post<{ id: string }>("/campaigns", payload);
      toast("success", "Disparo criado. Agora selecione os contatos.");
      navigate(`/disparos/${created.id}/selecionar`);
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
        to="/disparos"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para disparos
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gold-500/30 bg-gold-500/10">
          <Radar className="h-5 w-5 text-gold-500" />
        </div>
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Novo disparo</h1>
          <p className="mt-0.5 text-sm text-cream/50">
            Configure a mensagem e, no próximo passo, escolha para quem enviar
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">1. Conta</h2>
          <div>
            <label htmlFor="accountId" className="label">
              Conta LinkedIn *
            </label>
            <select
              id="accountId"
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
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
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">2. Mensagem</h2>
          <div>
            <label htmlFor="message" className="label">
              Mensagem para os contatos *
            </label>
            <textarea
              id="message"
              className="input min-h-32 resize-y"
              maxLength={300}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Olá {nome}, ..."
            />
            <p className="mt-1 text-right text-xs text-cream/40">{message.length}/300</p>
          </div>
          <p className="text-xs text-cream/40">
            Dica: use <code className="rounded bg-ink-700 px-1 py-0.5 text-gold-400">{"{nome}"}</code>,{" "}
            <code className="rounded bg-ink-700 px-1 py-0.5 text-gold-400">{"{cargo}"}</code> e{" "}
            <code className="rounded bg-ink-700 px-1 py-0.5 text-gold-400">{"{link}"}</code> para
            personalizar com o nome, o cargo e o link do perfil de cada contato.
          </p>
        </section>

        <section className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg text-gold-400">Cadência de acompanhamento</h2>
              <p className="mt-0.5 text-xs text-cream/40">
                Até 5 mensagens. Quem não responder recebe a próxima cópia após o intervalo de dias.
              </p>
            </div>
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              checked={cadenceEnabled}
              onChange={(e) => {
                setCadenceEnabled(e.target.checked);
                if (e.target.checked) {
                  setCadence((c) => (c.length === 0 ? [{ body: message, waitDays: 3 }] : c));
                  setUseFlow(false);
                }
              }}
              aria-label="Ativar cadência de acompanhamento"
            />
          </div>

          {cadenceEnabled && (
            <div className="space-y-4">
              {cadence.map((step, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-ink-400 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gold-400">
                      Mensagem {i + 1}
                      {i === 0 ? " (inicial)" : " (follow-up)"}
                    </span>
                    {cadence.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-cream/40 hover:text-red-400"
                        onClick={() => removeCadenceStep(i)}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <textarea
                    className="input min-h-24 resize-y"
                    maxLength={300}
                    value={step.body}
                    onChange={(e) => updateCadenceBody(i, e.target.value)}
                    placeholder="Olá {nome}, ... (use {nome}, {cargo} e {link})"
                  />
                  <p className="text-right text-xs text-cream/40">{step.body.length}/300</p>
                  {i < cadence.length - 1 && (
                    <div>
                      <label className="label" htmlFor={`cadence-wait-${i}`}>
                        Aguardar quantos dias antes da próxima?
                      </label>
                      <input
                        id={`cadence-wait-${i}`}
                        className="input"
                        type="number"
                        min={1}
                        max={90}
                        value={step.waitDays}
                        onChange={(e) => updateCadenceWait(i, Number(e.target.value))}
                      />
                    </div>
                  )}
                </div>
              ))}
              {cadence.length < 5 && (
                <button type="button" className="btn btn-secondary w-full" onClick={addCadenceStep}>
                  Adicionar mensagem
                </button>
              )}
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-serif text-lg text-gold-400">Bot com IA nesta campanha</h2>
          <label className="mt-3 flex items-start gap-3 text-sm text-cream/70">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-gold-500"
              checked={agentEnabled}
              onChange={(e) => setAgentEnabled(e.target.checked)}
              aria-label="Responder automaticamente às respostas dos contatos"
            />
            <span>
              <span className="font-medium text-cream">
                Responder automaticamente às respostas dos contatos
              </span>
              <span className="mt-0.5 block text-xs text-cream/40">
                Quando desligado, as respostas dos contatos desta campanha são apenas registradas no
                Inbox (sem resposta automática do bot e sem transferência para humano). O agente da
                conta continua disponível em "Agente nativo".
              </span>
            </span>
          </label>
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
                  setCadenceEnabled(false);
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
                No disparo, os contatos já são conexões: o bloco{" "}
                <span className="text-gold-400">Convite</span> envia uma mensagem direta e o{" "}
                <span className="text-gold-400">Quando aceitar</span> passa direto. Um fluxo simples
                seria: Início → Mensagem → Parar.
              </p>
              <FlowEditor
                initialFlow={flow}
                onSave={(f) => {
                  setFlow(f);
                  setUseFlow(f.nodes.length > 0);
                  toast("success", "Fluxo aplicado ao disparo");
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
            Enviar mensagens em massa é agressivo para o LinkedIn. Respeite limites baixos (ex.:
            20–40 por dia) e intervalos de 5 a 15 minutos para proteger a conta de bloqueios.
          </p>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">Confirmar</h2>
          <div>
            <label htmlFor="name" className="label">
              Nome do disparo (opcional)
            </label>
            <input
              id="name"
              className="input"
              maxLength={200}
              placeholder={`Disparo · ${new Date().toLocaleDateString("pt-BR")}`}
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
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {submitting ? "Criando..." : "Criar e selecionar contatos"}
          </button>
          <p className="flex items-start gap-1.5 text-xs text-cream/40">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Você ainda não envia nada agora: no próximo passo varre a rede e escolhe para quem
            enviar.
          </p>
        </section>
      </div>
    </div>
  );
}
