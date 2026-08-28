import { Router } from "express";
import { prisma } from "../lib/prisma";
import { chatbotQueue } from "../services/queue.service";
import { createLog } from "../services/log.service";
import { advanceOnEvent, hasFlow } from "../services/flow.service";
import { unipile } from "../services/unipile.service";
import { recordMessage, isConversationLocked } from "../services/chatbot-ai.service";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { randomInt } from "../utils/time";

export const webhooksRouter = Router();

interface MessageWebhook {
  event?: string;
  message?: string;
  chat_id?: string;
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
  campaign: { status: string; chatbotEnabled: boolean };
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
  const score = (l: WebhookLeadCandidate) =>
    (l.campaign.status === "RUNNING" ? 2 : 0) + (l.campaign.chatbotEnabled ? 1 : 0);
  return [...leads].sort(
    (a, b) => score(b) - score(a) || b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
}

async function handleMessageReceived(event: MessageWebhook): Promise<void> {
  const senderId = event.sender?.attendee_provider_id;
  const ownId = event.account_info?.user_id;
  if (!senderId || senderId === ownId) return;

  const candidates = await prisma.lead.findMany({
    where: { providerId: senderId },
    include: { campaign: { select: { status: true, chatbotEnabled: true } } },
  });
  const lead = pickBestLead(candidates);
  if (!lead) return;

  const campaign = await prisma.campaign.findUnique({ where: { id: lead.campaignId } });
  if (!campaign) return;

  if (lead.providerId && (!lead.name || lead.name === lead.providerId)) {
    await syncLeadNameFromProfile({ accountId: campaign.accountId, lead: lead as never });
  }

  const text = typeof event.message === "string" ? event.message.slice(0, 1000) : "";
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      lastMessageAt: new Date(),
      lastMessageText: text,
      status: "RESPONDED",
    },
  });
  await createLog({
    type: "MESSAGE_RECEIVED",
    message: `Mensagem recebida de ${event.sender?.name || senderId}${text ? `: "${text}"` : ""}`,
    campaignId: lead.campaignId,
    leadId: lead.id,
    payload: { chatId: event.chat_id, message: text },
  });

  await advanceOnEvent(campaign, { ...lead, status: "RESPONDED" });

  if (!campaign.chatbotEnabled || hasFlow(campaign.flow) || !text || !event.chat_id) return;

  if (event.chat_id) {
    const existing = await prisma.conversation.findUnique({
      where: { unipileChatId: event.chat_id },
    });
    if (existing && isConversationLocked(existing.status)) {
      if (text) {
        await recordMessage({ conversationId: existing.id, role: "LEAD", content: text });
      }
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { lastMessageAt: new Date() },
      });
      await createLog({
        type: "MESSAGE_RECEIVED",
        message: `Mensagem de ${event.sender?.name || senderId} ignorada pelo bot (conversa em atendimento humano)`,
        campaignId: lead.campaignId,
        leadId: lead.id,
        payload: { chatId: event.chat_id, message: text },
      });
      return;
    }
  }

  const delay = randomInt(
    campaign.chatbotReplyDelayMin * 1000,
    campaign.chatbotReplyDelayMax * 1000,
  );
  await chatbotQueue.add(
    "reply",
    {
      chatId: event.chat_id,
      leadId: lead.id,
      campaignId: campaign.id,
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
    include: { campaign: { select: { status: true, chatbotEnabled: true } } },
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
