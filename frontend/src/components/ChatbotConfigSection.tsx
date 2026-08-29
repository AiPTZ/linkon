import { useState } from "react";
import { Bot, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { AgentConfig, ChatbotKnowledgeBase } from "../types";

const EMPTY_KB: ChatbotKnowledgeBase = {
  product: "",
  faq: [],
  prices: [],
  differentiators: [],
  objections: [],
};

const DEFAULT_TRANSFER = "Vou conectar você com um especialista do nosso time.";

export function defaultAgentConfig(): AgentConfig {
  return {
    enabled: false,
    knowledgeBase: {
      product: "",
      faq: [{ q: "Quanto custa?", a: "A partir de R$ 97 por mês." }],
      prices: ["Plano Mensal: R$ 97"],
      differentiators: ["Mensagens personalizadas com IA"],
      objections: ["Não tenho tempo: o agente responde sozinho"],
    },
    tone: "consultivo e profissional",
    transferMessage: DEFAULT_TRANSFER,
    replyDelayMin: 30,
    replyDelayMax: 30,
    maxTurns: 6,
    replyDailyLimit: 100,
    replyWeeklyLimit: 400,
    initialMessageMode: "TEMPLATE",
    initialTemplate: "",
  };
}

export function sanitizeAgentConfig(cfg: AgentConfig): AgentConfig {
  const kb = cfg.knowledgeBase ?? EMPTY_KB;
  const floor = (v: number | undefined, min: number, fallback: number) =>
    typeof v !== "number" || !Number.isFinite(v) || v < min ? fallback : Math.floor(v);
  return {
    ...cfg,
    knowledgeBase: {
      product: kb.product ?? "",
      faq: (kb.faq ?? []).filter((f) => f.q.trim() && f.a.trim()),
      prices: (kb.prices ?? []).map((p) => p.trim()).filter(Boolean),
      differentiators: (kb.differentiators ?? []).map((d) => d.trim()).filter(Boolean),
      objections: (kb.objections ?? []).map((o) => o.trim()).filter(Boolean),
    },
    replyDelayMin: floor(cfg.replyDelayMin, 0, 30),
    replyDelayMax: floor(cfg.replyDelayMax, 0, 30),
    maxTurns: floor(cfg.maxTurns, 1, 6),
    replyDailyLimit: floor(cfg.replyDailyLimit, 1, 100),
    replyWeeklyLimit: floor(cfg.replyWeeklyLimit, 1, 400),
  };
}

export function parseAgentConfig(raw: string | null | undefined): AgentConfig {
  const base = defaultAgentConfig();
  if (!raw) return base;
  try {
    const kb = JSON.parse(raw) as Partial<ChatbotKnowledgeBase>;
    return {
      ...base,
      knowledgeBase: {
        product: typeof kb.product === "string" ? kb.product : "",
        faq: Array.isArray(kb.faq)
          ? kb.faq.filter((f): f is ChatbotKnowledgeBase["faq"][number] => Boolean(f && typeof f.q === "string" && typeof f.a === "string"))
          : [],
        prices: Array.isArray(kb.prices) ? kb.prices.filter((x): x is string => typeof x === "string") : [],
        differentiators: Array.isArray(kb.differentiators) ? kb.differentiators.filter((x): x is string => typeof x === "string") : [],
        objections: Array.isArray(kb.objections) ? kb.objections.filter((x): x is string => typeof x === "string") : [],
      },
    };
  } catch {
    return base;
  }
}

interface Props {
  value: AgentConfig;
  onChange: (next: AgentConfig) => void;
  title?: string;
}

export function AgentConfigSection({ value, onChange, title = "Agente nativo" }: Props) {
  const [open, setOpen] = useState(value.enabled);

  const update = (patch: Partial<AgentConfig>) => onChange({ ...value, ...patch });
  const updateKb = (patch: Partial<ChatbotKnowledgeBase>) =>
    update({ knowledgeBase: { ...value.knowledgeBase, ...patch } });

  const kb = value.knowledgeBase ?? EMPTY_KB;
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
              value.enabled ? "bg-gold-500" : "bg-ink-500"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                value.enabled ? "translate-x-4" : "translate-x-0.5"
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
              checked={value.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Responder automaticamente às mensagens recebidas nesta conta
          </label>

          {value.enabled && (
            <>
              <div className="space-y-4 rounded-lg border border-gold-500/30 bg-ink-800 p-4">
                <p className="text-xs text-cream/40">
                  O agente usa IA (GPT-4o mini) e a base de conhecimento abaixo para responder com
                  linguagem natural; quando não souber, transfere para um atendente humano.
                </p>

                <div>
                  <label htmlFor="agentTone" className="label">
                    Tom de voz
                  </label>
                  <input
                    id="agentTone"
                    className="input"
                    placeholder="consultivo e profissional"
                    maxLength={2000}
                    value={value.tone}
                    onChange={(e) => update({ tone: e.target.value })}
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
                        maxLength={500}
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
                        maxLength={2000}
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
                    onChange={(e) =>
                      updateKb({ prices: e.target.value.split("\n").map((l) => l.slice(0, 500)) })
                    }
                  />
                </div>

                <div>
                  <span className="label !mb-0">Diferenciais (um por linha)</span>
                  <textarea
                    className="input min-h-16 resize-y"
                    placeholder={"Mensagens personalizadas com IA\nSuporte em português"}
                    value={kb.differentiators.join("\n")}
                    onChange={(e) =>
                      updateKb({ differentiators: e.target.value.split("\n").map((l) => l.slice(0, 500)) })
                    }
                  />
                </div>

                <div>
                  <span className="label !mb-0">Objeções (uma por linha)</span>
                  <textarea
                    className="input min-h-16 resize-y"
                    placeholder={"Não tenho tempo: o agente responde sozinho no seu LinkedIn"}
                    value={kb.objections.join("\n")}
                    onChange={(e) =>
                      updateKb({ objections: e.target.value.split("\n").map((l) => l.slice(0, 500)) })
                    }
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
                    placeholder={DEFAULT_TRANSFER}
                    value={value.transferMessage}
                    onChange={(e) => update({ transferMessage: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="replyDelayMin" className="label">
                      Atraso min (s)
                    </label>
                    <input
                      id="replyDelayMin"
                      className="input"
                      type="number"
                      min={0}
                      max={3600}
                      value={value.replyDelayMin}
                      onChange={(e) => update({ replyDelayMin: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label htmlFor="replyDelayMax" className="label">
                      Atraso max (s)
                    </label>
                    <input
                      id="replyDelayMax"
                      className="input"
                      type="number"
                      min={0}
                      max={7200}
                      value={value.replyDelayMax}
                      onChange={(e) => update({ replyDelayMax: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label htmlFor="maxTurns" className="label">
                      Máx. turnos
                    </label>
                    <input
                      id="maxTurns"
                      className="input"
                      type="number"
                      min={1}
                      max={20}
                      value={value.maxTurns}
                      onChange={(e) => update({ maxTurns: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label htmlFor="replyDailyLimit" className="label">
                      Respostas/dia (máx.)
                    </label>
                    <input
                      id="replyDailyLimit"
                      className="input"
                      type="number"
                      min={1}
                      max={1000}
                      value={value.replyDailyLimit}
                      onChange={(e) => update({ replyDailyLimit: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label htmlFor="replyWeeklyLimit" className="label">
                      Respostas/semana (máx.)
                    </label>
                    <input
                      id="replyWeeklyLimit"
                      className="input"
                      type="number"
                      min={1}
                      max={10000}
                      value={value.replyWeeklyLimit}
                      onChange={(e) => update({ replyWeeklyLimit: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 border-t border-ink-400 pt-4">
                <span className="label !mb-0">Mensagem inicial da conversa</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      value.initialMessageMode === "TEMPLATE"
                        ? "border-gold-500 bg-gold-500/15 text-gold-400"
                        : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                    }`}
                    onClick={() => update({ initialMessageMode: "TEMPLATE" })}
                  >
                    Template fixo
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      value.initialMessageMode === "AI"
                        ? "border-gold-500 bg-gold-500/15 text-gold-400"
                        : "border-ink-400 bg-ink-800 text-cream/60 hover:text-cream/90"
                    }`}
                    onClick={() => update({ initialMessageMode: "AI" })}
                  >
                    Personalizar com IA
                  </button>
                </div>
                {value.initialMessageMode === "TEMPLATE" ? (
                  <div>
                    <label htmlFor="initialTemplate" className="label">
                      Template
                    </label>
                    <textarea
                      id="initialTemplate"
                      className="input min-h-20 resize-y"
                      maxLength={1000}
                      placeholder="Olá {nome}! Vi o seu perfil e gostaria de conversar."
                      value={value.initialTemplate}
                      onChange={(e) => update({ initialTemplate: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-cream/40">
                      Deixe em branco para usar a mensagem de convite da campanha.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-cream/40">
                    A IA escreve uma mensagem personalizada com base no perfil do lead e na base de
                    conhecimento. Se falhar, usa a mensagem de convite como fallback.
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
