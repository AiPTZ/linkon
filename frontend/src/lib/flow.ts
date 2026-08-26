import {
  CheckCheck,
  GitBranch,
  Hourglass,
  MessageSquare,
  Play,
  Reply,
  Square,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { BlockType, Flow, FlowNode } from "../types";

export const BLOCK_DEFS: Record<
  BlockType,
  { label: string; color: string; icon: LucideIcon; description: string }
> = {
  start: { label: "Início", color: "#22c55e", icon: Play, description: "Entrada do fluxo" },
  invite: { label: "Convite", color: "#eab308", icon: UserPlus, description: "Envia convite de conexão" },
  message: { label: "Mensagem", color: "#3b82f6", icon: MessageSquare, description: "Envia DM após aceite" },
  wait: { label: "Aguardar", color: "#a855f7", icon: Hourglass, description: "Espera antes do próximo passo" },
  on_accept: { label: "Quando aceitar", color: "#14b8a6", icon: CheckCheck, description: "Aguarda o lead aceitar o convite" },
  on_reply: { label: "Quando responder", color: "#f97316", icon: Reply, description: "Aguarda o lead responder" },
  condition: { label: "Condição", color: "#ef4444", icon: GitBranch, description: "Ramifica o fluxo (SIM/NÃO)" },
  stop: { label: "Parar", color: "#64748b", icon: Square, description: "Encerra o fluxo do lead" },
};

export const BLOCK_ORDER: BlockType[] = [
  "start",
  "invite",
  "message",
  "wait",
  "on_accept",
  "on_reply",
  "condition",
  "stop",
];

export function emptyFlow(): Flow {
  return { nodes: [], edges: [] };
}

export function parseFlow(raw: string | null | undefined): Flow {
  if (!raw) return emptyFlow();
  try {
    const parsed = JSON.parse(raw) as Flow;
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return parsed;
  } catch {
    // ignore
  }
  return emptyFlow();
}

export function defaultTemplate(): Flow {
  const nodes: FlowNode[] = [
    { id: "n1", type: "start", position: { x: 0, y: 120 }, data: {} },
    {
      id: "n2",
      type: "invite",
      position: { x: 260, y: 120 },
      data: { noMessage: true },
    },
    { id: "n3", type: "on_accept", position: { x: 520, y: 120 }, data: {} },
    {
      id: "n4",
      type: "message",
      position: { x: 780, y: 120 },
      data: { message: "Obrigado por aceitar! Pode me contar um pouco mais sobre o que você procura?" },
    },
    { id: "n5", type: "stop", position: { x: 1040, y: 120 }, data: {} },
  ];
  const edges = [
    { id: "e1", source: "n1", target: "n2" },
    { id: "e2", source: "n2", target: "n3" },
    { id: "e3", source: "n3", target: "n4" },
    { id: "e4", source: "n4", target: "n5" },
  ];
  return { nodes, edges };
}

export function blockSubtitle(data: { type: BlockType } & Record<string, unknown>): string {
  const def = BLOCK_DEFS[data.type];
  switch (data.type) {
    case "invite": {
      if (Boolean(data.noMessage)) return "Sem mensagem (aguarda aceite)";
      const msg = String(data.message ?? "").trim();
      return msg ? (msg.length > 34 ? `${msg.slice(0, 34)}…` : msg) : "Sem texto";
    }
    case "message": {
      const msg = String(data.message ?? "").trim();
      return msg ? (msg.length > 34 ? `${msg.slice(0, 34)}…` : msg) : "Sem texto";
    }
    case "wait": {
      const minutes = Number(data.minutes ?? 0);
      if (minutes >= 1440) return `${Math.round(minutes / 1440)} dia(s)`;
      if (minutes >= 60) return `${Math.round(minutes / 60)}h ${minutes % 60 ? `${minutes % 60}min` : ""}`;
      return minutes > 0 ? `${minutes} min` : "30 min";
    }
    case "condition": {
      const t = data.conditionType;
      if (t === "accepted") return "Se o lead aceitou";
      if (t === "replied") return "Se o lead respondeu";
      if (t === "contains") return `Se contém "${String(data.keyword ?? "")}"`;
      return "Tipo não definido";
    }
    default:
      return def.description;
  }
}

export function validateClientFlow(flow: Flow): string[] {
  const errors: string[] = [];
  if (flow.nodes.length === 0) return errors;

  const starts = flow.nodes.filter((n) => n.type === "start");
  if (starts.length === 0) errors.push("O fluxo precisa de um bloco Início");
  if (starts.length > 1) errors.push("O fluxo só pode ter um bloco Início");

  const ids = new Set(flow.nodes.map((n) => n.id));
  const edgeBySource = new Map<string, Flow["edges"]>();
  for (const e of flow.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      errors.push("Existe uma conexão com origem/destino inexistente");
      continue;
    }
    const arr = edgeBySource.get(e.source) ?? [];
    arr.push(e);
    edgeBySource.set(e.source, arr);
  }

  for (const n of flow.nodes) {
    if (n.type === "invite") {
      const hasText = Boolean(String(n.data?.message ?? "").trim());
      const noMessage = Boolean(n.data?.noMessage);
      if (!hasText && !noMessage) errors.push('Bloco "Convite" sem texto');
    }
    if (n.type === "message" && !String(n.data?.message ?? "").trim()) {
      errors.push('Bloco "Mensagem" sem texto');
    }
    if (n.type === "wait" && !(Number(n.data?.minutes) >= 1)) {
      errors.push("Bloco Aguardar precisa de minutos ≥ 1");
    }
    if (n.type === "condition") {
      const ct = n.data?.conditionType;
      if (ct !== "accepted" && ct !== "replied" && ct !== "contains") {
        errors.push("Condição sem tipo definido");
      }
      if (ct === "contains" && !String(n.data?.keyword ?? "").trim()) {
        errors.push('Condição "contém palavra" sem palavra');
      }
    }
  }

  const reachable = new Set<string>();
  const stack = starts.map((s) => s.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of edgeBySource.get(id) ?? []) stack.push(e.target);
  }
  for (const n of flow.nodes) {
    if (n.type !== "start" && !reachable.has(n.id)) {
      errors.push(`Bloco "${BLOCK_DEFS[n.type].label}" não está conectado ao Início`);
    }
  }

  for (const n of flow.nodes) {
    const out = edgeBySource.get(n.id) ?? [];
    if (n.type === "condition" && out.length > 2) errors.push("Condição não pode ter mais de 2 saídas");
    if (n.type !== "condition" && n.type !== "start" && out.length > 1) {
      errors.push(`Bloco "${BLOCK_DEFS[n.type].label}" não pode ter mais de 1 saída`);
    }
  }

  return errors;
}
