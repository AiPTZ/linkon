import { useState } from "react";
import { Bot, ChevronDown, MessageSquare, Plus, Trash2, X } from "lucide-react";
import type {
  Campaign,
  ChatbotConfig,
  ChatbotKnowledgeBase,
  ChatbotRule,
} from "../types";
import { parseJsonArray } from "../lib/format";

const EMPTY_RULE: ChatbotRule = { matchType: "contains", pattern: "", reply: "" };

const EMPTY_KB: ChatbotKnowledgeBase = {
  product: "",
  faq: [],
  prices: [],
  differentiators: [],
  objections: [],
};

const DEFAULT_CHATBOT_REPLY =
  "Obrigado pela mensagem! Fico feliz com o seu interesse. Pode me contar um pouco mais sobre o que você procura?";

export function defaultChatbotConfig(): ChatbotConfig {
  return {
    chatbotEnabled: false,
    chatbotMode: "RULES",
    chatbotKnowledgeBase: {
      product: "",
      faq: [{ q: "Quanto custa?", a: "A partir de R$ 97 por mês." }],
      prices: ["Plano Mensal: R$ 97"],
      differentiators: ["Mensagens personalizadas com IA"],
      objections: ["Não tenho tempo: o bot responde sozinho"],
    },
    chatbotTone: "consultivo e profissional",
    chatbotInitialMessageMode: "TEMPLATE",
    chatbotInitialTemplate: "",
    chatbotTransferMessage: "Vou conectar você com um especialista do nosso time.",
    chatbotMaxTurns: 6,
    chatbotDefaultReply: DEFAULT_CHATBOT_REPLY,
    chatbotRules: [
      {
        matchType: "contains",
        pattern: "preço",
        reply: "Obrigado pelo interesse! Me conta o seu objetivo que eu te passo as melhores opções.",
      },
    ],
    chatbotReplyDelayMin: 1,
    chatbotReplyDelayMax: 3,
    chatbotStopKeywords: ["não quero", "sem interesse", "pare", "spam"],
    maxRepliesPerLead: 3,
  };
}

export function sanitizeChatbotConfig(cfg: ChatbotConfig): ChatbotConfig {
  const kb = cfg.chatbotKnowledgeBase;
  return {
    ...cfg,
    chatbotRules: cfg.chatbotRules.filter((r) => {
      const hasContent = r.pattern.trim() || r.reply.trim();
      if (!hasContent) return false;
      if (r.matchType === "regex" && !r.pattern.trim()) return false;
      return true;
    }),
    chatbotStopKeywords: [...new Set(cfg.chatbotStopKeywords.map((k) => k.trim()).filter(Boolean))],
    chatbotKnowledgeBase: {
      product: kb?.product ?? "",
      faq: (kb?.faq ?? []).filter((f) => f.q.trim() && f.a.trim()),
      prices: (kb?.prices ?? []).map((p) => p.trim()).filter(Boolean),
      differentiators: (kb?.differentiators ?? []).map((d) => d.trim()).filter(Boolean),
      objections: (kb?.objections ?? []).map((o) => o.trim()).filter(Boolean),
    },
  };
}

function parseJsonObject<T extends object>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return typeof v === "object" && v !== null ? { ...fallback, ...(v as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function parseCampaignToChatbotConfig(c: Campaign): ChatbotConfig {
  const kb = parseJsonObject<ChatbotKnowledgeBase>(c.chatbotKnowledgeBase, EMPTY_KB);
  return {
    chatbotEnabled: c.chatbotEnabled,
    chatbotMode: c.chatbotMode,
    chatbotKnowledgeBase: kb,
    chatbotTone: c.chatbotTone,
    chatbotInitialMessageMode: c.chatbotInitialMessageMode,
    chatbotInitialTemplate: c.chatbotInitialTemplate,
    chatbotTransferMessage: c.chatbotTransferMessage,
    chatbotMaxTurns: c.chatbotMaxTurns,
    chatbotDefaultReply: c.chatbotDefaultReply,
    chatbotRules: parseJsonArray<ChatbotRule>(c.chatbotRules),
    chatbotReplyDelayMin: c.chatbotReplyDelayMin,
    chatbotReplyDelayMax: c.chatbotReplyDelayMax,
    chatbotStopKeywords: parseJsonArray<string>(c.chatbotStopKeywords),
    maxRepliesPerLead: c.maxRepliesPerLead,
  };
}

interface Props {
  value: ChatbotConfig;
  onChange: (next: ChatbotConfig) => void;
  title?: string;
}

export function ChatbotConfigSection({ value, onChange, title = "Chatbot de respostas" }: Props) {
  const [open, setOpen] = useState(value.chatbotEnabled);
  const [stopKeywordsText, setStopKeywordsText] = useState(value.chatbotStopKeywords.join(", "));

  const update = (patch: Partial<ChatbotConfig>) => onChange({ ...value, ...patch });

  const updateKb = (patch: Partial<ChatbotKnowledgeBase>) =>
    update({ chatbotKnowledgeBase: { ...value.chatbotKnowledgeBase, ...patch } });

  const kb = value.chatbotKnowledgeBase ?? EMPTY_KB;

  const stopKeywordsList = stopKeywordsText
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const setStopKeywords = (text: string) => {
    setStopKeywordsText(text);
    update({
      chatbotStopKeywords: text.split(",").map((k) => k.trim()).filter(Boolean),
    });
  };

  const setRules = (next: ChatbotRule[]) => update({ chatbotRules: next });
  const setFaqItems = (next: ChatbotKnowledgeBase["faq"]) => updateKb({ faq: next });

  return (
    <section className="card">
      <button
        type="button"
        className="flex w-full items-center justify-between p-5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 font-serif text-lg text-gold-400">
          <Bot className="h-5 w-5" />
          {title}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value.chatbotEnabled ? "bg-gold-500" : "bg-ink-500"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                value.chatbotEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
          <ChevronDown className={`h-4 w-4 text-cream/40 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-ink-400 p-5">
          <label className="flex items-center gap-2 text-sm text-cream/70">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              checked={value.chatbotEnabled}
              onChange={(e) => update({ chatbotEnabled: e.target.checked })}
            />
            Responder automaticamente às mensagens recebidas
          </label>

          {value.chatbotEnabled && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="label !mb-0">Regras de resposta</span>
                  <button
                    type="button"
                    className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                    onClick={() => setRules([...value.chatbotRules, { ...EMPTY_RULE }])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar regra
                  </button>
                </div>
                {value.chatbotRules.map((rule, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-ink-400 bg-ink-800 p-3">
                    <select
                      className="input col-span-3"
                      value={rule.matchType}
                      onChange={(e) => {
                        const next = [...value.chatbotRules];
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
                        const next = [...value.chatbotRules];
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
                        const next = [...value.chatbotRules];
                        next[i] = { ...next[i], reply: e.target.value };
                        setRules(next);
                      }}
                      aria-label="Resposta"
                    />
                    <button
                      type="button"
                      className="col-span-1 btn btn-danger !px-2 !py-2"
                      onClick={() => setRules(value.chatbotRules.filter((_, idx) => idx !== i))}
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
                      value.chatbotMode === "RULES"
                        ? "border-gold-500 bg-gold-500/15 text-gold-400"
                        : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                    }`}
                    onClick={() => update({ chatbotMode: "RULES" })}
                  >
                    Regras
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      value.chatbotMode === "LLM"
                        ? "border-gold-500 bg-gold-500/15 text-gold-400"
                        : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                    }`}
                    onClick={() => update({ chatbotMode: "LLM" })}
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

              {value.chatbotMode === "LLM" && (
                <div className="space-y-4 rounded-lg border border-gold-500/30 bg-ink-800 p-4">
                  <div>
                    <label htmlFor="chatbotTone" className="label">
                      Tom de voz
                    </label>
                    <input
                      id="chatbotTone"
                      className="input"
                      placeholder="consultivo e profissional"
                      value={value.chatbotTone}
                      onChange={(e) => update({ chatbotTone: e.target.value })}
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
                      value={kb.product}
                      onChange={(e) => updateKb({ product: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="label !mb-0">Perguntas e respostas (FAQ)</span>
                      <button
                        type="button"
                        className="btn btn-secondary !px-2.5 !py-1.5 text-xs"
                        onClick={() => setFaqItems([...kb.faq, { q: "", a: "" }])}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Adicionar
                      </button>
                    </div>
                    {kb.faq.map((item, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-ink-400 bg-ink-900 p-3">
                        <input
                          className="input col-span-5"
                          placeholder="Pergunta"
                          value={item.q}
                          onChange={(e) => {
                            const next = [...kb.faq];
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
                            const next = [...kb.faq];
                            next[i] = { ...next[i], a: e.target.value };
                            setFaqItems(next);
                          }}
                          aria-label="Resposta"
                        />
                        <button
                          type="button"
                          className="col-span-1 btn btn-danger !px-2 !py-2"
                          onClick={() => setFaqItems(kb.faq.filter((_, idx) => idx !== i))}
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
                      value={kb.prices.join("\n")}
                      onChange={(e) => updateKb({ prices: e.target.value.split("\n") })}
                    />
                  </div>

                  <div>
                    <span className="label !mb-0">Diferenciais (um por linha)</span>
                    <textarea
                      className="input min-h-16 resize-y"
                      placeholder={"Mensagens personalizadas com IA\nSuporte em português"}
                      value={kb.differentiators.join("\n")}
                      onChange={(e) => updateKb({ differentiators: e.target.value.split("\n") })}
                    />
                  </div>

                  <div>
                    <span className="label !mb-0">Objeções (uma por linha)</span>
                    <textarea
                      className="input min-h-16 resize-y"
                      placeholder={"Não tenho tempo: o bot responde sozinho no seu LinkedIn"}
                      value={kb.objections.join("\n")}
                      onChange={(e) => updateKb({ objections: e.target.value.split("\n") })}
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
                      value={value.chatbotTransferMessage}
                      onChange={(e) => update({ chatbotTransferMessage: e.target.value })}
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
                      max={20}
                      value={value.chatbotMaxTurns}
                      onChange={(e) => update({ chatbotMaxTurns: Number(e.target.value) })}
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
                  value={value.chatbotDefaultReply}
                  onChange={(e) => update({ chatbotDefaultReply: e.target.value })}
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
                    value={value.chatbotReplyDelayMin}
                    onChange={(e) => update({ chatbotReplyDelayMin: Number(e.target.value) })}
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
                    value={value.chatbotReplyDelayMax}
                    onChange={(e) => update({ chatbotReplyDelayMax: Number(e.target.value) })}
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
                    value={value.maxRepliesPerLead}
                    onChange={(e) => update({ maxRepliesPerLead: Number(e.target.value) })}
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
                  value={stopKeywordsText}
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
                      value.chatbotInitialMessageMode === "TEMPLATE"
                        ? "border-gold-500 bg-gold-500/15 text-gold-400"
                        : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                    }`}
                    onClick={() => update({ chatbotInitialMessageMode: "TEMPLATE" })}
                  >
                    Template fixo
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      value.chatbotInitialMessageMode === "AI"
                        ? "border-gold-500 bg-gold-500/15 text-gold-400"
                        : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                    }`}
                    onClick={() => update({ chatbotInitialMessageMode: "AI" })}
                  >
                    Personalizar com IA
                  </button>
                </div>
                {value.chatbotInitialMessageMode === "TEMPLATE" ? (
                  <div>
                    <label htmlFor="chatbotInitialTemplate" className="label">
                      Template
                    </label>
                    <textarea
                      id="chatbotInitialTemplate"
                      className="input min-h-20 resize-y"
                      maxLength={1000}
                      placeholder="Olá {nome}! Vi o seu perfil e gostaria de conversar."
                      value={value.chatbotInitialTemplate}
                      onChange={(e) => update({ chatbotInitialTemplate: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-cream/40">
                      Deixe em branco para usar a mensagem de convite da campanha.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-cream/40">
                    A IA escreve uma mensagem personalizada com base no perfil do lead e na base
                    de conhecimento. Requer o modo IA ativo. Se falhar, usa a mensagem de convite
                    como fallback.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
