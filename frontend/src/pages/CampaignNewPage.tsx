import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Workflow } from "lucide-react";
import { api } from "../lib/api";
import type { Account, CampaignPayload, Flow } from "../types";
import { FlowEditor } from "../components/FlowEditor";
import { emptyFlow } from "../lib/flow";
import { useToast, toastFromError } from "../components/Toast";
import { PageLoader } from "../components/Spinner";

const DEFAULT_INVITE =
  "Olá! Vi o seu perfil e gostei muito do seu trabalho. Acredito que podemos trocar experiências valiosas e explorar uma possível parceria. Topa uma conversa rápida?";

export function CampaignNewPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [noInviteMessage, setNoInviteMessage] = useState(false);

  const [form, setForm] = useState<CampaignPayload>({
    name: "",
    searchUrl: "",
    accountId: "",
    inviteMessage: DEFAULT_INVITE,
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    maxLeads: 1000,
  });
  const [flow, setFlow] = useState<Flow>(emptyFlow());

  useEffect(() => {
    api
      .get<{ items: Account[] }>("/accounts")
      .then((r) => {
        setAccounts(r.items);
        if (r.items.length > 0 && !form.accountId) {
          setForm((f) => ({ ...f, accountId: r.items[0].id }));
        }
      })
      .catch(() => setAccounts([]));
  }, []);

  const connectedAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.status === "OK" || a.status === "CONNECTING"),
    [accounts],
  );

  const set = <K extends keyof CampaignPayload>(key: K, value: CampaignPayload[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.accountId) {
      toast("error", "Selecione uma conta LinkedIn");
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.post<{ id: string }>("/campaigns", {
        ...form,
        flow,
      });
      toast("success", "Campanha criada com sucesso");
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
      <Link to="/campanhas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-gold-400">
        <ArrowLeft className="h-4 w-4" />
        Voltar para campanhas
      </Link>
      <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Nova campanha</h1>
      <p className="mt-1 text-sm text-cream/50">
        Cole a URL de uma busca salva do LinkedIn (Sales Navigator ou busca normal)
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">Básico</h2>
          <div>
            <label htmlFor="name" className="label">
              Nome da campanha *
            </label>
            <input
              id="name"
              className="input"
              required
              maxLength={200}
              placeholder="Ex: Prospecção Tech Leads Q3"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="searchUrl" className="label">
              URL da busca do LinkedIn *
            </label>
            <input
              id="searchUrl"
              className="input"
              required
              type="url"
              placeholder="https://www.linkedin.com/search/results/people/..."
              value={form.searchUrl}
              onChange={(e) => set("searchUrl", e.target.value)}
            />
            <p className="mt-1.5 text-xs text-cream/40">
              Acesse o LinkedIn, monte o filtro de pessoas desejado, salve a busca e copie a URL.
              O sistema percorrerá todos os resultados encontrados.
            </p>
          </div>
          <div>
            <label htmlFor="accountId" className="label">
              Conta LinkedIn *
            </label>
            <select
              id="accountId"
              className="input"
              value={form.accountId}
              onChange={(e) => set("accountId", e.target.value)}
            >
              {connectedAccounts.length === 0 && <option value="">Nenhuma conta disponível</option>}
              {connectedAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username ?? a.unipileAccountId} ({a.status})
                </option>
              ))}
            </select>
            {connectedAccounts.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-400">
                Nenhuma conta conectada.{" "}
                <Link to="/conectar" className="underline hover:text-gold-400">
                  Conecte sua conta LinkedIn primeiro
                </Link>
                .
              </p>
            )}
          </div>
          <div>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-cream/80">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-gold-500"
                checked={noInviteMessage}
                onChange={(e) => {
                  setNoInviteMessage(e.target.checked);
                  if (e.target.checked) {
                    set("inviteMessage", "");
                  } else {
                    setForm((f) => ({ ...f, inviteMessage: f.inviteMessage || DEFAULT_INVITE }));
                  }
                }}
              />
              <span>
                Enviar convite sem mensagem — a conversa só começa depois que o contato aceitar
              </span>
            </label>
            {!noInviteMessage && (
              <>
                <label htmlFor="inviteMessage" className="label">
                  Mensagem de convite
                </label>
                <textarea
                  id="inviteMessage"
                  className="input min-h-28 resize-y"
                  maxLength={300}
                  placeholder="Olá {nome}, vi seu trabalho em {cargo} e acredito que podemos trocar experiências..."
                  value={form.inviteMessage}
                  onChange={(e) => set("inviteMessage", e.target.value)}
                />
                <p className="mt-1 text-right text-xs text-cream/40">
                  {form.inviteMessage?.length ?? 0}/300
                </p>
              </>
            )}
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-serif text-lg text-gold-400">
              <Workflow className="h-5 w-5" />
              Fluxo de mensagens
            </h2>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                flow.nodes.length > 0
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                  : "border-ink-400 bg-ink-500/40 text-cream/50"
              }`}
            >
              {flow.nodes.length > 0
                ? `${flow.nodes.length} blocos definidos`
                : "Sem fluxo (comportamento padrão)"}
            </span>
          </div>
          <p className="text-xs text-cream/40">
            Monte o funil em blocos conectáveis: convite (com ou sem mensagem), aguardar, quando
            aceitar, quando responder, condições e parar. Quando o fluxo está preenchido ele comanda
            todos os envios; com o fluxo vazio, a campanha usa o convite padrão + chatbot.
          </p>
          <FlowEditor
            initialFlow={flow}
            onSave={(f) => {
              setFlow(f);
              toast("success", "Fluxo aplicado à campanha");
            }}
          />
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-serif text-lg text-gold-400">Estratégia de envio</h2>
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
                value={form.dailyLimit}
                onChange={(e) => set("dailyLimit", Number(e.target.value))}
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
                value={form.weeklyLimit}
                onChange={(e) => set("weeklyLimit", Number(e.target.value))}
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
                value={form.minDelayMin}
                onChange={(e) => set("minDelayMin", Number(e.target.value))}
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
                value={form.maxDelayMin}
                onChange={(e) => set("maxDelayMin", Number(e.target.value))}
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
                value={form.workStartHour}
                onChange={(e) => set("workStartHour", Number(e.target.value))}
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
                value={form.workEndHour}
                onChange={(e) => set("workEndHour", Number(e.target.value))}
              />
            </div>
            <div>
              <label htmlFor="maxLeads" className="label">
                Máximo de leads
              </label>
              <input
                id="maxLeads"
                className="input"
                type="number"
                min={10}
                max={5000}
                value={form.maxLeads}
                onChange={(e) => set("maxLeads", Number(e.target.value))}
              />
            </div>
          </div>
          <p className="text-xs text-cream/40">
            Recomendado para segurança da conta: até 40 convites/dia e 150/semana, com intervalos
            de 5 a 15 minutos e apenas em horário comercial.
          </p>
        </section>

        <div className="flex items-center justify-end gap-3 pb-8">
          <Link to="/campanhas" className="btn btn-secondary">
            Cancelar
          </Link>
          <button type="submit" className="btn btn-primary" disabled={submitting || accounts.length === 0}>
            {submitting ? "Criando..." : "Criar campanha"}
            {!submitting && <Save className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
