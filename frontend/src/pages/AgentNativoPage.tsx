import { useEffect, useState } from "react";
import { Bot, Save, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast, toastFromError } from "../components/Toast";
import { Spinner, PageLoader } from "../components/Spinner";
import { ProLock, isPro } from "../components/ProLock";
import {
  AgentConfigSection,
  defaultAgentConfig,
  sanitizeAgentConfig,
} from "../components/ChatbotConfigSection";
import type { AgentAccountListItem, AgentConfig, NativeAgent } from "../types";

interface Row {
  account: AgentAccountListItem["account"];
  agent: AgentAccountListItem["agent"];
  config: AgentConfig;
  saving: boolean;
}

export function AgentNativoPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const aiAllowed = isPro(user);
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      if (!aiAllowed) {
        setRows([]);
        return;
      }
      try {
        const items = await api.get<AgentAccountListItem[]>("/agents");
        setRows(
          items.map((item) => ({
            account: item.account,
            agent: item.agent,
            config: item.agent
              ? {
                  enabled: item.agent.enabled,
                  knowledgeBase: JSON.parse(item.agent.knowledgeBase || "{}"),
                  tone: item.agent.tone,
                  transferMessage: item.agent.transferMessage,
                  replyDelayMin: item.agent.replyDelayMin,
                  replyDelayMax: item.agent.replyDelayMax,
                  maxTurns: item.agent.maxTurns,
                  replyDailyLimit: item.agent.replyDailyLimit,
                  replyWeeklyLimit: item.agent.replyWeeklyLimit,
                  initialMessageMode: item.agent.initialMessageMode,
                  initialTemplate: item.agent.initialTemplate,
                  schedulingEnabled: item.agent.schedulingEnabled,
                  meetingDurationMin: item.agent.meetingDurationMin,
                  meetingTitle: item.agent.meetingTitle,
                }
              : defaultAgentConfig(),
            saving: false,
          })),
        );
      } catch (err) {
        toastFromError(toast, err);
        setRows([]);
      }
    })();
  }, [toast, aiAllowed]);

  if (!aiAllowed) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Agente nativo</h1>
          <p className="mt-1 text-sm text-cream/50">
            Configuração do assistente de IA que responde automaticamente no LinkedIn.
          </p>
        </div>
        <ProLock description="O Agente Nativo responde automaticamente às mensagens recebidas usando IA. Disponível na Versão PRO." />
      </div>
    );
  }

  if (rows === null) return <PageLoader />;

  const setConfig = (accountId: string, next: AgentConfig) =>
    setRows((prev) => prev!.map((r) => (r.account.id === accountId ? { ...r, config: next } : r)));

  const save = async (row: Row) => {
    setRows((prev) => prev!.map((r) => (r.account.id === row.account.id ? { ...r, saving: true } : r)));
    try {
      const body = sanitizeAgentConfig(row.config);
      const agent = await api.put<NativeAgent>(`/agents/${row.account.id}`, body);
      setRows((prev) =>
        prev!.map((r) =>
          r.account.id === row.account.id
            ? {
                ...r,
                agent,
                config: {
                  ...r.config,
                  enabled: agent.enabled,
                  knowledgeBase: JSON.parse(agent.knowledgeBase || "{}"),
                  tone: agent.tone,
                  transferMessage: agent.transferMessage,
                  replyDelayMin: agent.replyDelayMin,
                  replyDelayMax: agent.replyDelayMax,
                  maxTurns: agent.maxTurns,
                  replyDailyLimit: agent.replyDailyLimit,
                  replyWeeklyLimit: agent.replyWeeklyLimit,
                  initialMessageMode: agent.initialMessageMode,
                  initialTemplate: agent.initialTemplate,
                  schedulingEnabled: agent.schedulingEnabled,
                  meetingDurationMin: agent.meetingDurationMin,
                  meetingTitle: agent.meetingTitle,
                },
              }
            : r,
        ),
      );
      toast("success", `Agente de ${row.account.username ?? "conta"} atualizado`);
    } catch (err) {
      toastFromError(toast, err);
    } finally {
      setRows((prev) => prev!.map((r) => (r.account.id === row.account.id ? { ...r, saving: false } : r)));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold gold-gradient-text">Agente nativo</h1>
          <p className="mt-1 text-sm text-cream/50">
            Configure o assistente de IA que responde automaticamente às mensagens recebidas no
            LinkedIn, por conta.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-xs font-medium text-gold-400">
          <Zap className="h-3.5 w-3.5" />
          GPT-4o mini
        </span>
      </div>

      {rows.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-8 text-center text-cream/40">
          <Bot className="h-8 w-8" />
          <span className="text-sm">Nenhuma conta conectada ainda. Conecte uma conta primeiro.</span>
        </div>
      )}

      {rows.map((row) => (
        <div key={row.account.id} className="space-y-3">
          <div className="card flex items-center justify-between p-4">
            <div className="min-w-0">
              <div className="truncate font-medium text-cream">
                {row.account.username ?? "Conta sem nome"}
              </div>
              <div className="truncate text-xs text-cream/45">
                Status: {row.account.status}
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                row.config.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-ink-500 text-cream/50"
              }`}
            >
              {row.config.enabled ? "Ativo" : "Desativado"}
            </span>
          </div>
          <AgentConfigSection value={row.config} onChange={(next) => setConfig(row.account.id, next)} />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary"
              disabled={row.saving}
              onClick={() => save(row)}
            >
              {row.saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              Salvar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
