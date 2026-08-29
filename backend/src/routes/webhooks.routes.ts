import { Router } from "express";
import type { Campaign } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { chatbotQueue } from "../services/queue.service";
import { createLog } from "../services/log.service";
import { advanceOnEvent, hasFlow } from "../services/flow.service";
import { unipile } from "../services/unipile.service";
import { getOrCreateConversation, recordMessage, isConversationLocked } from "../services/chatbot-ai.service";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { randomInt } from "../utils/time";

export const webhooksRouter = Router();

interface MessageWebhook {
  event?: string;
  message?: string;
  chat_id?: string;
  account_id?: string;
  account_info?: { user_id?: string; account_id?: string };
  sender?: { attendee_provider_id?: string; name?: string };
  [key: string]: unknown;
}

interface RelationWebhook {
  event?: string;
  user_provider_id?: string;
  user_full_name?: string;
  [key: string]: unknown;
}

export interface WebhookLeadCandidate {
  id: string;
  campaignId: string;
  createdAt: Date;
  providerId?: string;
  name?: string | null;
  headline?: string | null;
  campaign: { status: string };
}

async function syncLeadNameFromProfile(input: {
  accountId: string;
  lead: { id: string; providerId: string; name?: string | null; headline?: string | null };
}): Promise<void> {
  try {
    const account = await prisma.account.findUnique({ where: { id: input.accountId } });
    if (!account) return;
    const profile = await unipile.getProfile(account.unipileAccountId, input.lead.providerId);
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || null;
    if (!fullName) return;
    await prisma.lead.update({
      where: { id: input.lead.id },
      data: {
        name: fullName,
        ...(input.lead.headline ? {} : { headline: profile.headline ?? null }),
      },
    });
  } catch (err) {
    logger.warn(`[webhook] falha ao sincronizar nome do lead do perfil: ${(err as Error).message}`);
  }
}

export function pickBestLead<T extends WebhookLeadCandidate>(leads: T[]): T | null {
  if (leads.length === 0) return null;
  const score = (l: WebhookLeadCandidate) => (l.campaign.status === "RUNNING" ? 2 : 0);
  return [...leads].sort(
    (a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

async function resolveAccount(input: {
  accountId?: string;
  userId?: string;
}): Promise<{ id: string; providerId: string | null } | null> {
  if (input.accountId) {
    const byUnipile = await prisma.account.findUnique({ where: { unipileAccountId: input.accountId } });
    if (byUnipile) return { id: byUnipile.id, providerId: byUnipile.providerId ?? null };
  }
  if (input.userId) {
    const byProvider = await prisma.account.findFirst({ where: { providerId: input.userId } });
    if (byProvider) return { id: byProvider.id, providerId: byProvider.providerId ?? null };
  }
  return null;
}

async function handleMessageReceived(event: MessageWebhook): Promise<void> {
  const senderId = event.sender?.attendee_provider_id;
  const ownId = event.account_info?.user_id;
  if (!senderId) return;

  const account = await resolveAccount({
    accountId: event.account_id ?? event.account_info?.account_id,
    userId: event.account_info?.user_id,
  });
  if (!account) return;

  if (senderId === ownId || senderId === account.providerId) {
    await createLog({
      type: "BOT_SELF_MESSAGE",
      message: `Mensagem de conta própria ignorada (${senderId})`,
      accountId: account.id,
      payload: { chatId: event.chat_id },
    });
    return;
  }

  if (ownId && account.providerId !== ownId) {
    await prisma.account.update({
      where: { id: account.id },
      data: { providerId: ownId },
    });
    account.providerId = ownId;
  }

  const agent = await prisma.nativeAgent.findUnique({ where: { accountId: account.id } });
  const text = typeof event.message === "string" ? event.message.slice(0, 1000) : "";
  const hasChat = Boolean(event.chat_id && text);

  const candidates = await prisma.lead.findMany({
    where: { providerId: senderId, campaign: { accountId: account.id } },
    include: { campaign: { select: { status: true } } },
  });
  const lead = pickBestLead(candidates);

  let campaign: Campaign | null = null;
  if (lead) {
    campaign = await prisma.campaign.findUnique({ where: { id: lead.campaignId } });
    if (campaign && lead.providerId && (!lead.name || lead.name === lead.providerId)) {
      await syncLeadNameFromProfile({ accountId: account.id, lead: lead as never });
    }
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastMessageAt: new Date(), lastMessageText: text, status: "RESPONDED" },
    });
    await createLog({
      type: "MESSAGE_RECEIVED",
      message: `Mensagem recebida de ${event.sender?.name || senderId}${text ? `: "${text}"` : ""}`,
      campaignId: lead.campaignId,
      leadId: lead.id,
      accountId: account.id,
      payload: { chatId: event.chat_id, message: text },
    });
    if (campaign) await advanceOnEvent(campaign, { ...lead, status: "RESPONDED" });
    if (campaign && hasFlow(campaign.flow)) return;
  }

  if (lead && campaign && campaign.agentEnabled === false) {
    await createLog({
      type: "AGENT_DISABLED",
      message: `Mensagem de ${event.sender?.name || senderId} ignorada (bot desativado nesta campanha)`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { chatId: event.chat_id, message: text },
    });
    return;
  }

  if (!agent || !agent.enabled) {
    await createLog({
      type: "AGENT_DISABLED",
      message: `Mensagem de ${event.sender?.name || senderId} ignorada (agente nativo desligado)`,
      accountId: account.id,
      payload: { chatId: event.chat_id, message: text },
    });
    return;
  }
  if (!hasChat) return;

  const conversation = await getOrCreateConversation({
    accountId: account.id,
    campaignId: lead?.campaignId ?? null,
    leadId: lead?.id ?? null,
    unipileChatId: event.chat_id as string,
  });

  if (isConversationLocked(conversation.status)) {
    if (text) {
      await recordMessage({ conversationId: conversation.id, role: "LEAD", content: text });
    }
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
    await createLog({
      type: "MESSAGE_RECEIVED",
      message: `Mensagem de ${event.sender?.name || senderId} ignorada pelo agente (conversa em atendimento humano)`,
      accountId: account.id,
      payload: { chatId: event.chat_id, message: text },
    });
    return;
  }

  const delay = randomInt(agent.replyDelayMin * 1000, agent.replyDelayMax * 1000);
  await chatbotQueue.add(
    "reply",
    {
      accountId: account.id,
      chatId: event.chat_id,
      leadId: lead?.id ?? null,
      campaignId: lead?.campaignId ?? null,
      message: text,
    },
    {
      delay,
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  );
}

async function handleNewRelation(event: RelationWebhook): Promise<void> {
  const providerId = event.user_provider_id;
  if (!providerId) return;

  const candidates = await prisma.lead.findMany({
    where: { providerId },
    include: { campaign: { select: { status: true } } },
  });
  const lead = pickBestLead(candidates);
  if (!lead) return;

  const campaign = await prisma.campaign.findUnique({ where: { id: lead.campaignId } });
  if (!campaign) return;

  if (event.user_full_name && event.user_full_name !== lead.name) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: { name: event.user_full_name },
    });
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });
  await createLog({
    type: "INVITE_ACCEPTED",
    message: `Convite aceito por ${event.user_full_name || providerId}`,
    campaignId: lead.campaignId,
    leadId: lead.id,
    payload: { user: event },
  });

  await advanceOnEvent(campaign, { ...lead, status: "ACCEPTED" });
}

export async function handleWebhookEvent(raw: unknown): Promise<void> {
  const event = (raw ?? {}) as MessageWebhook & RelationWebhook;
  switch (event.event) {
    case "message_received":
      await handleMessageReceived(event);
      break;
    case "new_relation":
      await handleNewRelation(event);
      break;
    default:
      break;
  }
}

export function parseWebhookBody(reqBody: unknown, rawBody: string): unknown {
  const trimmed = (rawBody ?? "").trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return reqBody;
    }
  }
  return reqBody;
}

webhooksRouter.post(
  "/unipile",
  (req, res) => {
    const secret = req.headers["unipile-auth"] ?? req.headers["authorization"];
    if (env.UNIPILE_WEBHOOK_SECRET && secret !== env.UNIPILE_WEBHOOK_SECRET) {
      logger.warn(`[webhook] rejected: invalid signature`);
      return res.status(401).json({ error: "invalid signature" });
    }

    res.status(200).json({ ok: true });

    const raw = parseWebhookBody(req.body, (req as { rawBody?: string }).rawBody ?? "");
    logger.info(
      `[webhook] POST /api/webhooks/unipile ct=${req.headers["content-type"]} event=${(raw as MessageWebhook)?.event} chat_id=${(raw as MessageWebhook)?.chat_id}`,
    );
    Promise.resolve()
      .then(() => handleWebhookEvent(raw))
      .catch((err) => logger.error("Webhook processing failed", err));
  },
);

webhooksRouter.get(
  "/unipile",
  (_req, res) => {
    const secret = _req.headers["unipile-auth"] ?? _req.headers["authorization"];
    if (env.UNIPILE_WEBHOOK_SECRET && secret !== env.UNIPILE_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "invalid signature" });
    }
    res.status(200).json({ ok: true });
  },
);

webhooksRouter.get("/ping", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});
