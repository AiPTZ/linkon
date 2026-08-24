import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { createLog } from "./log.service";
import { notify } from "./notification.service";
import { UnipileError } from "../utils/errors";
import { randomDelayMs } from "../utils/time";
import type { Account, Campaign, Lead } from "@prisma/client";

export const BLOCK_TYPES = [
  "start",
  "invite",
  "message",
  "wait",
  "on_accept",
  "on_reply",
  "condition",
  "stop",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_META: Record<BlockType, { label: string; color: string }> = {
  start: { label: "Início", color: "#22c55e" },
  invite: { label: "Convite", color: "#eab308" },
  message: { label: "Mensagem", color: "#3b82f6" },
  wait: { label: "Aguardar", color: "#a855f7" },
  on_accept: { label: "Quando aceitar", color: "#14b8a6" },
  on_reply: { label: "Quando responder", color: "#f97316" },
  condition: { label: "Condição", color: "#ef4444" },
  stop: { label: "Parar", color: "#64748b" },
};

export function isConnectedMode(mode: string): boolean {
  return mode === "SWEEP" || mode === "DISPARO";
}

export interface FlowNode {
  id: string;
  type: BlockType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function emptyFlow(): Flow {
  return { nodes: [], edges: [] };
}

export function parseFlow(raw: string | null | undefined): Flow {
  if (!raw) return emptyFlow();
  try {
    const parsed = JSON.parse(raw) as Flow;
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return parsed;
  } catch {
    // fall through
  }
  return emptyFlow();
}

export function serializeFlow(flow: Flow): string {
  return JSON.stringify({ nodes: flow.nodes, edges: flow.edges });
}

export function hasFlow(raw: string | null | undefined): boolean {
  return parseFlow(raw).nodes.length > 0;
}

export function validateFlow(raw: string): { ok: boolean; errors: string[] } {
  const flow = parseFlow(raw);
  const errors: string[] = [];
  if (flow.nodes.length === 0) return { ok: true, errors };

  const starts = flow.nodes.filter((n) => n.type === "start");
  if (starts.length === 0) errors.push("O fluxo precisa de um bloco Início");
  if (starts.length > 1) errors.push("O fluxo só pode ter um bloco Início");

  const ids = new Set(flow.nodes.map((n) => n.id));
  for (const n of flow.nodes) {
    if (!BLOCK_TYPES.includes(n.type)) errors.push(`Bloco desconhecido: ${String(n.type)}`);
    if (n.type === "invite") {
      const msg = String(n.data?.message ?? "").trim();
      const noMessage = Boolean(n.data?.noMessage);
      if (!msg && !noMessage) errors.push('Bloco "Convite" sem texto');
    }
    if (n.type === "message") {
      const msg = String(n.data?.message ?? "").trim();
      if (!msg) errors.push('Bloco "Mensagem" sem texto');
    }
    if (n.type === "wait") {
      const minutes = Number(n.data?.minutes ?? 0);
      if (!Number.isFinite(minutes) || minutes < 1) errors.push("Bloco Aguardar precisa de minutos >= 1");
    }
    if (n.type === "condition") {
      const ct = n.data?.conditionType;
      if (ct !== "accepted" && ct !== "replied" && ct !== "contains") {
        errors.push("Condição sem tipo definido");
      }
      if (ct === "contains" && !String(n.data?.keyword ?? "").trim()) {
        errors.push("Condição \"contém palavra\" sem palavra");
      }
    }
  }

  const edgeBySource = new Map<string, FlowEdge[]>();
  for (const e of flow.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      errors.push("Existe uma conexão com origem/destino inexistente");
      continue;
    }
    const arr = edgeBySource.get(e.source) ?? [];
    arr.push(e);
    edgeBySource.set(e.source, arr);
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
      errors.push(`Bloco "${BLOCK_META[n.type]?.label ?? n.type}" não está conectado ao Início`);
    }
  }

  for (const n of flow.nodes) {
    const out = edgeBySource.get(n.id) ?? [];
    if (n.type === "condition" && out.length > 2) errors.push("Condição não pode ter mais de 2 saídas");
    if (n.type !== "condition" && n.type !== "start" && out.length > 1) {
      errors.push(`Bloco "${BLOCK_META[n.type]?.label ?? n.type}" não pode ter mais de 1 saída`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function nextTarget(flow: Flow, node: FlowNode, handle?: string): string | null {
  const out = flow.edges.filter((e) => e.source === node.id);
  if (node.type === "condition") {
    const wanted = handle === "sim" ? "sim" : "nao";
    const match = out.find((e) => (e.sourceHandle ?? "") === wanted);
    return match ? match.target : null;
  }
  return out[0] ? out[0].target : null;
}

async function setBlock(
  leadId: string,
  blockId: string | null,
  nextInviteAt: Date | null,
): Promise<void> {
  await prisma.lead.update({
    where: { id: leadId },
    data: { currentBlockId: blockId, nextInviteAt },
  });
}

async function advanceImmediately(
  lead: Lead,
  flow: Flow,
  node: FlowNode,
  handle?: string,
): Promise<FlowNode | null> {
  const target = nextTarget(flow, node, handle);
  if (!target) {
    await setBlock(lead.id, null, null);
    return null;
  }
  const next = flow.nodes.find((n) => n.id === target);
  await setBlock(lead.id, target, new Date());
  return next ?? null;
}

async function advanceWithDelay(
  lead: Lead,
  flow: Flow,
  node: FlowNode,
  delayMs: number,
): Promise<FlowNode | null> {
  const target = nextTarget(flow, node);
  if (!target) {
    await setBlock(lead.id, null, null);
    return null;
  }
  await setBlock(lead.id, target, new Date(Date.now() + delayMs));
  return null;
}

async function completeLead(lead: Lead, log: string): Promise<void> {
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: "COMPLETED", currentBlockId: null, nextInviteAt: null },
  });
  await createLog({ type: "FLOW_END", message: log, campaignId: lead.campaignId, leadId: lead.id });
}

async function sendDirectMessageForCampaign(
  campaign: Campaign,
  account: Account,
  lead: Lead,
  text: string,
): Promise<void> {
  await unipile.sendDirectMessage(account.unipileAccountId, lead.providerId, text);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { invitesSentToday: { increment: 1 }, invitesSentWeek: { increment: 1 } },
  });
  await createLog({
    type: "DM_SENT",
    message: `Mensagem enviada para ${lead.name ?? lead.providerId}`,
    campaignId: campaign.id,
    leadId: lead.id,
    accountId: account.id,
    payload: { text },
  });
}

async function handleDmError(
  campaign: Campaign,
  account: Account,
  lead: Lead,
  err: unknown,
): Promise<void> {
  if (!(err instanceof UnipileError)) return;
  if (err.isLimitError()) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "LIMIT_HIT" } });
    await notify({
      accountId: campaign.accountId,
      campaignId: campaign.id,
      type: "BROADCAST_LIMIT_HIT",
      level: "WARN",
      message: `Limite do LinkedIn atingido ao enviar mensagem (${err.errorType}). Disparo pausado.`,
      payload: { error: err.message },
    });
    await createLog({
      type: "RATE_LIMITED",
      level: "WARN",
      message: `Limite do LinkedIn atingido ao enviar mensagem (${err.errorType}). Campanha pausada.`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { error: err.message },
    });
    return;
  }
  if (err.isDisconnected()) {
    await prisma.account.update({ where: { id: account.id }, data: { status: "DISCONNECTED" } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: "Conta desconectada do LinkedIn. Campanhas pausadas.",
      campaignId: campaign.id,
      accountId: account.id,
      payload: { error: err.message },
    });
    return;
  }
  if (!err.isRetryable()) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "ERROR", errorCode: err.errorType },
    });
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: `Falha permanente ao enviar mensagem: ${err.message}`,
      campaignId: campaign.id,
      leadId: lead.id,
      payload: { errorType: err.errorType },
    });
  }
}

async function handleSweepInviteBlock(
  campaign: Campaign,
  account: Account,
  lead: Lead,
  flow: Flow,
  node: FlowNode,
): Promise<FlowNode | null> {
  const fromNode = String(node.data?.message ?? "").trim();
  const text = fromNode || String(campaign.inviteMessage ?? "").trim();
  if (!text) {
    return advanceImmediately(lead, flow, node);
  }

  try {
    await sendDirectMessageForCampaign(campaign, account, lead, text);
    const delay = randomDelayMs(campaign.minDelayMin, campaign.maxDelayMin);
    return advanceWithDelay(lead, flow, node, delay);
  } catch (err) {
    await handleDmError(campaign, account, lead, err);
    return null;
  }
}

async function handleInviteBlock(
  campaign: Campaign,
  account: Account,
  lead: Lead,
  flow: Flow,
  node: FlowNode,
): Promise<FlowNode | null> {
  if (isConnectedMode(campaign.mode)) {
    return handleSweepInviteBlock(campaign, account, lead, flow, node);
  }

  if (lead.status !== "PENDING") {
    return advanceImmediately(lead, flow, node);
  }

  const noMessage = Boolean(node.data?.noMessage);
  let message: string | undefined;
  if (!noMessage) {
    const fromNode = String(node.data?.message ?? "").trim();
    const fromCampaign = String(campaign.inviteMessage ?? "").trim();
    message = fromNode || fromCampaign || undefined;
  }
  try {
    const res = await unipile.sendInvitation(account.unipileAccountId, lead.providerId, message);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "INVITED", invitedAt: new Date() },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { invitesSentToday: { increment: 1 }, invitesSentWeek: { increment: 1 } },
    });
    await createLog({
      type: "INVITE_SENT",
      message: message
        ? `Convite enviado para ${lead.name ?? lead.providerId}`
        : `Convite sem mensagem enviado para ${lead.name ?? lead.providerId}`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { invitationId: res.invitation_id, hasMessage: Boolean(message) },
    });
    const delay = randomDelayMs(campaign.minDelayMin, campaign.maxDelayMin);
    return advanceWithDelay(lead, flow, node, delay);
  } catch (err) {
    if (err instanceof UnipileError) {
      if (err.isLimitError()) {
        await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "LIMIT_HIT" } });
        await createLog({
          type: "RATE_LIMITED",
          level: "WARN",
          message: `Limite do LinkedIn atingido (${err.errorType}). Campanha pausada.`,
          campaignId: campaign.id,
          leadId: lead.id,
          accountId: account.id,
          payload: { error: err.message },
        });
        return null;
      }
      if (err.isDisconnected()) {
        await prisma.account.update({ where: { id: account.id }, data: { status: "DISCONNECTED" } });
        await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
        await createLog({
          type: "ERROR",
          level: "ERROR",
          message: "Conta desconectada do LinkedIn. Campanhas pausadas.",
          campaignId: campaign.id,
          accountId: account.id,
          payload: { error: err.message },
        });
        return null;
      }
      if (!err.isRetryable()) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { status: "ERROR", errorCode: err.errorType },
        });
        await createLog({
          type: "ERROR",
          level: "ERROR",
          message: `Falha permanente no convite: ${err.message}`,
          campaignId: campaign.id,
          leadId: lead.id,
          payload: { errorType: err.errorType },
        });
        return null;
      }
    }
    return null;
  }
}

async function handleMessageBlock(
  campaign: Campaign,
  account: Account,
  lead: Lead,
  flow: Flow,
  node: FlowNode,
): Promise<FlowNode | null> {
  const canSend = isConnectedMode(campaign.mode)
    ? lead.status === "PENDING" || lead.status === "ACCEPTED" || lead.status === "RESPONDED"
    : lead.status === "ACCEPTED" || lead.status === "RESPONDED";
  if (!canSend) {
    const retryMs = randomDelayMs(30, 60);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { nextInviteAt: new Date(Date.now() + retryMs) },
    });
    return null;
  }

  const text = String(node.data?.message ?? "").trim();
  if (!text) return advanceImmediately(lead, flow, node);

  try {
    await sendDirectMessageForCampaign(campaign, account, lead, text);
    const delay = randomDelayMs(campaign.minDelayMin, campaign.maxDelayMin);
    return advanceWithDelay(lead, flow, node, delay);
  } catch (err) {
    await handleDmError(campaign, account, lead, err);
    return null;
  }
}

function evaluateCondition(node: FlowNode, lead: Lead, isSweep: boolean): boolean {
  const type = node.data?.conditionType;
  const keyword = String(node.data?.keyword ?? "").trim().toLowerCase();
  const msg = (lead.lastMessageText ?? "").toLowerCase();
  switch (type) {
    case "accepted":
      return isSweep || lead.status === "ACCEPTED" || lead.status === "RESPONDED";
    case "replied":
      return lead.status === "RESPONDED";
    case "contains":
      return keyword.length > 0 && msg.includes(keyword);
    default:
      return false;
  }
}

async function handleConditionBlock(
  campaign: Campaign,
  lead: Lead,
  flow: Flow,
  node: FlowNode,
): Promise<FlowNode | null> {
  const result = evaluateCondition(node, lead, isConnectedMode(campaign.mode));
  await createLog({
    type: "FLOW_CONDITION",
    message: `Condição "${BLOCK_META.condition.label}" avaliada como ${result ? "SIM" : "NÃO"} para ${lead.name ?? lead.providerId}`,
    campaignId: campaign.id,
    leadId: lead.id,
    payload: { conditionType: node.data?.conditionType, result },
  });
  return advanceImmediately(lead, flow, node, result ? "sim" : "nao");
}

export async function processFlowStep(
  campaign: Campaign,
  account: Account,
  lead: Lead,
  flow: Flow,
): Promise<void> {
  let node: FlowNode | null = flow.nodes.find((n) => n.id === lead.currentBlockId) ?? null;
  if (!node) {
    const start = flow.nodes.find((n) => n.type === "start");
    if (!start) return;
    await prisma.lead.update({ where: { id: lead.id }, data: { currentBlockId: start.id } });
    node = start;
  }

  let iterations = 0;
  while (node && iterations < 50) {
    iterations++;
    switch (node.type) {
      case "start":
        node = await advanceImmediately(lead, flow, node);
        break;
      case "invite":
        node = await handleInviteBlock(campaign, account, lead, flow, node);
        break;
      case "on_accept":
        if (isConnectedMode(campaign.mode) || lead.status === "ACCEPTED" || lead.status === "RESPONDED") {
          node = await advanceImmediately(lead, flow, node);
        } else {
          return;
        }
        break;
      case "on_reply":
        if (lead.status === "RESPONDED") {
          node = await advanceImmediately(lead, flow, node);
        } else {
          return;
        }
        break;
      case "wait": {
        const minutes = Number(node.data?.minutes ?? 30);
        const delay = (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60_000;
        await advanceWithDelay(lead, flow, node, delay);
        return;
      }
      case "message":
        node = await handleMessageBlock(campaign, account, lead, flow, node);
        break;
      case "condition":
        node = await handleConditionBlock(campaign, lead, flow, node);
        break;
      case "stop":
        await completeLead(lead, `Fluxo concluído para ${lead.name ?? lead.providerId}`);
        return;
      default:
        return;
    }
  }
}

export async function initLeadFlow(campaign: Campaign, leadId: string): Promise<void> {
  if (!hasFlow(campaign.flow)) return;
  const flow = parseFlow(campaign.flow);
  const start = flow.nodes.find((n) => n.type === "start");
  if (!start) return;
  await prisma.lead.update({
    where: { id: leadId },
    data: { currentBlockId: start.id, nextInviteAt: null },
  });
}

export async function advanceOnEvent(campaign: Campaign, lead: Lead): Promise<void> {
  if (!hasFlow(campaign.flow)) return;
  const flow = parseFlow(campaign.flow);
  const node = flow.nodes.find((n) => n.id === lead.currentBlockId);
  if (!node) return;
  if (node.type !== "on_accept" && node.type !== "on_reply") return;
  const target = nextTarget(flow, node);
  await setBlock(lead.id, target, new Date());
}
