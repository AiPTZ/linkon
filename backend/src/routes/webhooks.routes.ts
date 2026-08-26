import { Router } from "express";
import { prisma } from "../lib/prisma";
import { chatbotQueue } from "../services/queue.service";
import { createLog } from "../services/log.service";
import { advanceOnEvent, hasFlow } from "../services/flow.service";
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

async function handleMessageReceived(event: MessageWebhook): Promise<void> {
  const senderId = event.sender?.attendee_provider_id;
  const ownId = event.account_info?.user_id;
  if (!senderId || senderId === ownId) return;

  const lead = await prisma.lead.findFirst({ where: { providerId: senderId } });
  if (!lead) return;

  const campaign = await prisma.campaign.findUnique({ where: { id: lead.campaignId } });
  if (!campaign) return;

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

  const delay = randomInt(
    campaign.chatbotReplyDelayMin * 60_000,
    campaign.chatbotReplyDelayMax * 60_000,
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

  const lead = await prisma.lead.findFirst({ where: { providerId } });
  if (!lead) return;

  const campaign = await prisma.campaign.findUnique({ where: { id: lead.campaignId } });
  if (!campaign) return;

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

webhooksRouter.post(
  "/unipile",
  (req, res) => {
    const secret = req.headers["unipile-auth"] ?? req.headers["authorization"];
    if (env.UNIPILE_WEBHOOK_SECRET && secret !== env.UNIPILE_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "invalid signature" });
    }

    res.status(200).json({ ok: true });

    const raw = req.body;
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
