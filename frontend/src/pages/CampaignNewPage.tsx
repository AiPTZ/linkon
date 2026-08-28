import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Bot, ChevronDown, MessageSquare, Plus, Save, Trash2, Workflow, X } from "lucide-react";
import { api } from "../lib/api";
import type { Account, CampaignPayload, ChatbotKnowledgeBase, ChatbotRule, Flow, KnowledgeBaseEntry } from "../types";
import { FlowEditor } from "../components/FlowEditor";
import { emptyFlow } from "../lib/flow";
import { useToast, toastFromError } from "../components/Toast";
import { PageLoader } from "../components/Spinner";

const EMPTY_RULE: ChatbotRule = { matchType: "contains", pattern: "", reply: "" };

const DEFAULT_INVITE =
  "Olá! Vi o seu perfil e gostei muito do seu trabalho. Acredito que podemos trocar experiências valiosas e explorar uma possível parceria. Topa uma conversa rápida?";

const DEFAULT_CHATBOT_REPLY =
  "Obrigado pela mensagem! Fico feliz com o seu interesse. Pode me contar um pouco mais sobre o que você procura?";

const DEFAULT_STOP_KEYWORDS = "não quero, sem interesse, pare, spam";

export function CampaignNewPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [chatbotOpen, setChatbotOpen] = useState(false);
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
    chatbotEnabled: false,
    chatbotMode: "RULES",
    chatbotKnowledgeBase: {
      product: "",
      faq: [],
      prices: [],
      differentiators: [],
      objections: [],
    },
    chatbotTone: "consultivo e profissional",
    chatbotInitialMessageMode: "TEMPLATE",
    chatbotInitialTemplate: "",
    chatbotTransferMessage: "Vou conectar você com um especialista do nosso time.",
    chatbotMaxTurns: 6,
    chatbotDefaultReply: DEFAULT_CHATBOT_REPLY,
    chatbotReplyDelayMin: 1,
    chatbotReplyDelayMax: 3,
    chatbotStopKeywords: [],
    maxRepliesPerLead: 3,
    maxLeads: 1000,
  });
  const [rules, setRules] = useState<ChatbotRule[]>([
    {
      matchType: "contains",
      pattern: "preço",
      reply: "Obrigado pelo interesse! Me conta o seu objetivo que eu te passo as melhores opções.",
    },
  ]);
  const [stopKeywords, setStopKeywords] = useState<string>(DEFAULT_STOP_KEYWORDS);
  const [faqItems, setFaqItems] = useState<KnowledgeBaseEntry[]>([
    { q: "Quanto custa?", a: "A partir de R$ 97 por mês." },
  ]);
  const [prices, setPrices] = useState<string[]>(["Plano Mensal: R$ 97"]);
  const [differentiators, setDifferentiators] = useState<string[]>(["Mensagens personalizadas com IA"]);
  const [objections, setObjections] = useState<string[]>(["Não tenho tempo: o bot responde sozinho"]);
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

  const stopKeywordsList = useMemo(
    () => stopKeywords.split(",").map((k) => k.trim()).filter(Boolean),
    [stopKeywords],
  );

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
        chatbotRules: rules.filter((r) => r.pattern.trim() || r.reply.trim()),
        chatbotKnowledgeBase: {
          product: form.chatbotKnowledgeBase?.product ?? "",
          faq: faqItems.filter((f) => f.q.trim() && f.a.trim()),
          prices: prices.map((p) => p.trim()).filter(Boolean),
          differentiators: differentiators.map((d) => d.trim()).filter(Boolean),
          objections: objections.map((o) => o.trim()).filter(Boolean),
        } as ChatbotKnowledgeBase,
        chatbotStopKeywords: stopKeywordsList,
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

        <section className="card">
          <button
            type="button"
            className="flex w-full items-center justify-between p-5 text-left"
            onClick={() => setChatbotOpen((v) => !v)}
            aria-expanded={chatbotOpen}
          >
            <span className="flex items-center gap-2 font-serif text-lg text-gold-400">
              <Bot className="h-5 w-5" />
              Chatbot de respostas
            </span>
            <span className="flex items-center gap-2">
              <span
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  form.chatbotEnabled ? "bg-gold-500" : "bg-ink-500"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    form.chatbotEnabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </span>
              <ChevronDown
                className={`h-4 w-4 text-cream/40 transition-transform ${chatbotOpen ? "rotate-180" : ""}`}
              />
            </span>
          </button>

          {chatbotOpen && (
            <div className="space-y-4 border-t border-ink-400 p-5">
              <label className="flex items-center gap-2 text-sm text-cream/70">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-gold-500"
                  checked={form.chatbotEnabled ?? false}
                  onChange={(e) => set("chatbotEnabled", e.target.checked)}
                />
                Responder automaticamente às mensagens recebidas
              </label>

              {form.chatbotEnabled && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="label !mb-0">Regras de resposta</span>
                      <button
                        type="button"
                        className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                        onClick={() => setRules((r) => [...r, { ...EMPTY_RULE }])}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Adicionar regra
                      </button>
                    </div>
                    {rules.map((rule, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-ink-400 bg-ink-800 p-3">
                        <select
                          className="input col-span-3"
                          value={rule.matchType}
                          onChange={(e) => {
                            const next = [...rules];
                            next[i] = { ...next[i], matchType: e.target.value as ChatbotRule["matchType"] };
                            setRules(next);
                          }}
                          aria-label="Tipo de correspondência"
                        >
                          <option value="contains">Contém</option>
                          <option value="keywords">Palavras-chave</option>
                          <option value="regex">Regex</option>
                        </select>
                        <input
                          className="input col-span-4"
                          placeholder={
                            rule.matchType === "contains"
                              ? "texto (ex: preço)"
                              : rule.matchType === "keywords"
                                ? "preço, valor, custo"
                                : "expressão (ex: .*(quanto|preço).*)"
                          }
                          value={rule.pattern}
                          onChange={(e) => {
                            const next = [...rules];
                            next[i] = { ...next[i], pattern: e.target.value };
                            setRules(next);
                          }}
                          aria-label="Padrão"
                        />
                        <input
                          className="input col-span-4"
                          placeholder="Resposta automática"
                          value={rule.reply}
                          onChange={(e) => {
                            const next = [...rules];
                            next[i] = { ...next[i], reply: e.target.value };
                            setRules(next);
                          }}
                          aria-label="Resposta"
                        />
                        <button
                          type="button"
                          className="col-span-1 btn btn-danger !px-2 !py-2"
                          onClick={() => setRules((r) => r.filter((_, idx) => idx !== i))}
                          aria-label="Remover regra"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 border-t border-ink-400 pt-4">
                    <span className="label !mb-0">Modo do chatbot</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          form.chatbotMode === "RULES"
                            ? "border-gold-500 bg-gold-500/15 text-gold-400"
                            : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                        }`}
                        onClick={() => set("chatbotMode", "RULES")}
                      >
                        Regras
                      </button>
                      <button
                        type="button"
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          form.chatbotMode === "LLM"
                            ? "border-gold-500 bg-gold-500/15 text-gold-400"
                            : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                        }`}
                        onClick={() => set("chatbotMode", "LLM")}
                      >
                        IA (GPT-4o mini)
                      </button>
                    </div>
                    <p className="text-xs text-cream/40">
                      Regras: responde por correspondência de texto. IA: usa a base de conhecimento e
                      o tom abaixo para responder com linguagem natural; quando não souber, transfere
                      para um atendente humano.
                    </p>
                  </div>

                  {form.chatbotMode === "LLM" && (
                    <div className="space-y-4 rounded-lg border border-gold-500/30 bg-ink-800 p-4">
                      <div>
                        <label htmlFor="chatbotTone" className="label">
                          Tom de voz
                        </label>
                        <input
                          id="chatbotTone"
                          className="input"
                          placeholder="consultivo e profissional"
                          value={form.chatbotTone ?? ""}
                          onChange={(e) => set("chatbotTone", e.target.value)}
                        />
                      </div>

                      <div>
                        <label htmlFor="kbProduct" className="label">
                          O que você vende (produto/serviço)
                        </label>
                        <textarea
                          id="kbProduct"
                          className="input min-h-20 resize-y"
                          maxLength={3000}
                          placeholder="Ex: Software de automação de vendas B2B com IA."
                          value={form.chatbotKnowledgeBase?.product ?? ""}
                          onChange={(e) =>
                            set("chatbotKnowledgeBase", {
                              ...form.chatbotKnowledgeBase,
                              product: e.target.value,
                            } as ChatbotKnowledgeBase)
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="label !mb-0">Perguntas e respostas (FAQ)</span>
                          <button
                            type="button"
                            className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                            onClick={() => setFaqItems((f) => [...f, { q: "", a: "" }])}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Adicionar
                          </button>
                        </div>
                        {faqItems.map((item, i) => (
                          <div
                            key={i}
                            className="grid grid-cols-12 gap-2 rounded-lg border border-ink-400 bg-ink-900 p-3"
                          >
                            <input
                              className="input col-span-5"
                              placeholder="Pergunta"
                              value={item.q}
                              onChange={(e) => {
                                const next = [...faqItems];
                                next[i] = { ...next[i], q: e.target.value };
                                setFaqItems(next);
                              }}
                              aria-label="Pergunta"
                            />
                            <input
                              className="input col-span-6"
                              placeholder="Resposta"
                              value={item.a}
                              onChange={(e) => {
                                const next = [...faqItems];
                                next[i] = { ...next[i], a: e.target.value };
                                setFaqItems(next);
                              }}
                              aria-label="Resposta"
                            />
                            <button
                              type="button"
                              className="col-span-1 btn btn-danger !px-2 !py-2"
                              onClick={() => setFaqItems((f) => f.filter((_, idx) => idx !== i))}
                              aria-label="Remover FAQ"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div>
                        <span className="label !mb-0">Lista de preços (um por linha)</span>
                        <textarea
                          className="input min-h-16 resize-y"
                          placeholder={"Plano Mensal: R$ 97\nPlano Anual: R$ 900"}
                          value={prices.join("\n")}
                          onChange={(e) => setPrices(e.target.value.split("\n"))}
                        />
                      </div>

                      <div>
                        <span className="label !mb-0">Diferenciais (um por linha)</span>
                        <textarea
                          className="input min-h-16 resize-y"
                          placeholder={"Mensagens personalizadas com IA\nSuporte em português"}
                          value={differentiators.join("\n")}
                          onChange={(e) => setDifferentiators(e.target.value.split("\n"))}
                        />
                      </div>

                      <div>
                        <span className="label !mb-0">Objeções (uma por linha)</span>
                        <textarea
                          className="input min-h-16 resize-y"
                          placeholder={"Não tenho tempo: o bot responde sozinho no seu LinkedIn"}
                          value={objections.join("\n")}
                          onChange={(e) => setObjections(e.target.value.split("\n"))}
                        />
                      </div>

                      <div>
                        <label htmlFor="transferMessage" className="label">
                          Mensagem de transferência para humano
                        </label>
                        <textarea
                          id="transferMessage"
                          className="input min-h-20 resize-y"
                          maxLength={1000}
                          placeholder="Vou conectar você com um especialista do nosso time."
                          value={form.chatbotTransferMessage ?? ""}
                          onChange={(e) => set("chatbotTransferMessage", e.target.value)}
                        />
                      </div>

                      <div>
                        <label htmlFor="chatbotMaxTurns" className="label">
                          Máximo de turnos automáticos
                        </label>
                        <input
                          id="chatbotMaxTurns"
                          className="input"
                          type="number"
                          min={1}
                          max={30}
                          value={form.chatbotMaxTurns}
                          onChange={(e) => set("chatbotMaxTurns", Number(e.target.value))}
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor="defaultReply" className="label">
                      Resposta padrão (quando nenhuma regra corresponde)
                    </label>
                    <textarea
                      id="defaultReply"
                      className="input min-h-20 resize-y"
                      maxLength={2000}
                      placeholder="Obrigado pela mensagem! Em breve retorno."
                      value={form.chatbotDefaultReply ?? ""}
                      onChange={(e) => set("chatbotDefaultReply", e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="replyDelayMin" className="label">
                        Atraso min (min)
                      </label>
                      <input
                        id="replyDelayMin"
                        className="input"
                        type="number"
                        min={0}
                        max={60}
                        value={form.chatbotReplyDelayMin}
                        onChange={(e) => set("chatbotReplyDelayMin", Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label htmlFor="replyDelayMax" className="label">
                        Atraso max (min)
                      </label>
                      <input
                        id="replyDelayMax"
                        className="input"
                        type="number"
                        min={0}
                        max={120}
                        value={form.chatbotReplyDelayMax}
                        onChange={(e) => set("chatbotReplyDelayMax", Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <label htmlFor="maxRepliesPerLead" className="label">
                        Respostas por lead
                      </label>
                      <input
                        id="maxRepliesPerLead"
                        className="input"
                        type="number"
                        min={1}
                        max={20}
                        value={form.maxRepliesPerLead}
                        onChange={(e) => set("maxRepliesPerLead", Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="stopKeywords" className="label">
                      Palavras de parada (separadas por vírgula)
                    </label>
                    <input
                      id="stopKeywords"
                      className="input"
                      placeholder="não quero, sem interesse, pare, spam"
                      value={stopKeywords}
                      onChange={(e) => setStopKeywords(e.target.value)}
                    />
                    <p className="mt-1.5 flex items-start gap-1 text-xs text-cream/40">
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Se o lead usar uma dessas palavras, o bot para de responder.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {stopKeywordsList.map((k) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1 rounded-full border border-ink-400 bg-ink-800 px-2.5 py-0.5 text-xs text-cream/70"
                      >
                        <MessageSquare className="h-3 w-3 text-gold-500" />
                        {k}
                      </span>
                    ))}
                  </div>

                  <div className="space-y-3 border-t border-ink-400 pt-4">
                    <span className="label !mb-0">Mensagem inicial da conversa</span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          form.chatbotInitialMessageMode === "TEMPLATE"
                            ? "border-gold-500 bg-gold-500/15 text-gold-400"
                            : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                        }`}
                        onClick={() => set("chatbotInitialMessageMode", "TEMPLATE")}
                      >
                        Template fixo
                      </button>
                      <button
                        type="button"
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                          form.chatbotInitialMessageMode === "AI"
                            ? "border-gold-500 bg-gold-500/15 text-gold-400"
                            : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                        }`}
                        onClick={() => set("chatbotInitialMessageMode", "AI")}
                      >
                        Personalizar com IA
                      </button>
                    </div>
                    {form.chatbotInitialMessageMode === "TEMPLATE" ? (
                      <div>
                        <label htmlFor="chatbotInitialTemplate" className="label">
                          Template
                        </label>
                        <textarea
                          id="chatbotInitialTemplate"
                          className="input min-h-20 resize-y"
                          maxLength={1000}
                          placeholder="Olá {nome}! Vi o seu perfil e gostaria de conversar."
                          value={form.chatbotInitialTemplate ?? ""}
                          onChange={(e) => set("chatbotInitialTemplate", e.target.value)}
                        />
                        <p className="mt-1 text-xs text-cream/40">
                          Deixe em branco para usar a mensagem de convite da campanha.
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-cream/40">
                        A IA escreve uma mensagem personalizada com base no perfil do lead e na base
                        de conhecimento. Requer o modo IA ativo. Se falhar, usa a mensagem de
                        convite como fallback.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
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
