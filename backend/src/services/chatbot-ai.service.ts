import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { createLog } from "./log.service";
import { notify } from "./notification.service";
import {
  generateDecision,
  generateInitialMessage,
  parseKnowledgeBase,
  isJailbreak,
  estimateCost,
  CONFIDENCE_THRESHOLD,
} from "./ai.service";
import { refreshAgentCounters, agentWithinLimits } from "./native-agent.service";
import { logger } from "../utils/logger";
import type { Campaign, Lead, Conversation } from "@prisma/client";

export type BotAction = "reply" | "transfer" | "ignore" | "none";

export function isConversationLocked(status: string): boolean {
  return status === "NEEDS_HUMAN" || status === "HUMAN" || status === "CLOSED";
}

export async function getOrCreateConversation(input: {
  accountId: string;
  unipileChatId: string;
  campaignId?: string | null;
  leadId?: string | null;
}): Promise<Conversation> {
  return prisma.conversation.upsert({
    where: { unipileChatId: input.unipileChatId },
    update: { lastMessageAt: new Date() },
    create: {
      accountId: input.accountId,
      campaignId: input.campaignId ?? null,
      leadId: input.leadId ?? null,
      unipileChatId: input.unipileChatId,
    },
  });
}

export async function recordMessage(input: {
  conversationId: string;
  role: "LEAD" | "BOT" | "HUMAN" | "SYSTEM";
  content: string;
  messageId?: string;
  costUsd?: number;
}): Promise<void> {
  await prisma.conversationMessage.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content.slice(0, 4000),
      messageId: input.messageId ?? null,
      costUsd: input.costUsd ?? null,
    },
  });
}

export async function transferToHuman(input: {
  accountId: string;
  chatId: string;
  conversationId: string;
  reason: string;
  transferText?: string;
  campaignId?: string | null;
  leadId?: string | null;
}): Promise<void> {
  const transferText =
    input.transferText?.trim() || "Vou conectar você com um especialista do nosso time.";
  try {
    await unipile.sendChatMessage(input.chatId, transferText);
  } catch (err) {
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: `Falha ao enviar mensagem de transferência: ${(err as Error).message}`,
      campaignId: input.campaignId ?? undefined,
      leadId: input.leadId ?? undefined,
      accountId: input.accountId,
      payload: { chatId: input.chatId },
    });
    return;
  }
  await recordMessage({
    conversationId: input.conversationId,
    role: "SYSTEM",
    content: transferText,
  });
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { status: "NEEDS_HUMAN", lastMessageAt: new Date() },
  });
  await notify({
    accountId: input.accountId,
    campaignId: input.campaignId ?? undefined,
    type: "BOT_TRANSFERRED",
    level: "WARN",
    message: `Conversa transferida para atendimento humano (${input.reason}).`,
    payload: { conversationId: input.conversationId, reason: input.reason },
  });
  await createLog({
    type: "BOT_TRANSFERRED",
    level: "WARN",
    message: `Bot transferiu para humano (${input.reason})`,
    campaignId: input.campaignId ?? undefined,
    leadId: input.leadId ?? undefined,
    accountId: input.accountId,
    payload: { chatId: input.chatId, reason: input.reason },
  });
}

export async function handleIncomingMessage(input: {
  accountId: string;
  chatId: string;
  message: string;
  campaignId?: string | null;
  leadId?: string | null;
}): Promise<BotAction> {
  const account = await prisma.account.findUnique({ where: { id: input.accountId } });
  if (!account) return "none";

  const agent = await prisma.nativeAgent.findUnique({ where: { accountId: input.accountId } });
  if (!agent || !agent.enabled) return "none";

  const campaign = input.campaignId
    ? await prisma.campaign.findUnique({ where: { id: input.campaignId } })
    : null;
  const lead = input.leadId ? await prisma.lead.findUnique({ where: { id: input.leadId } }) : null;

  const conversation = await getOrCreateConversation({
    accountId: account.id,
    campaignId: input.campaignId,
    leadId: input.leadId,
    unipileChatId: input.chatId,
  });

  await recordMessage({ conversationId: conversation.id, role: "LEAD", content: input.message });

  if (isConversationLocked(conversation.status)) {
    await createLog({
      type: "MESSAGE_RECEIVED",
      message: "Mensagem ignorada (conversa em atendimento humano)",
      campaignId: input.campaignId ?? undefined,
      leadId: input.leadId ?? undefined,
      accountId: account.id,
      payload: { message: input.message },
    });
    return "ignore";
  }

  const fresh = await refreshAgentCounters(account);
  const limit = agentWithinLimits({ agent, account: fresh });
  if (!limit.ok) {
    await transferToHuman({
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: limit.reason!,
      transferText: agent.transferMessage,
      campaignId: input.campaignId,
      leadId: input.leadId,
    });
    return "transfer";
  }

  if (lead && campaign && lead.replyCount >= agent.maxTurns) {
    await transferToHuman({
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: "limite de turnos atingido",
      transferText: agent.transferMessage,
      campaignId: input.campaignId,
      leadId: input.leadId,
    });
    return "transfer";
  }

  if (isJailbreak(input.message)) {
    await transferToHuman({
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: "tentativa de jailbreak",
      transferText: agent.transferMessage,
      campaignId: input.campaignId,
      leadId: input.leadId,
    });
    return "transfer";
  }

  const historyRows = await prisma.conversationMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    take: 8,
  });
  const history = historyRows
    .filter((m) => m.role === "LEAD" || m.role === "BOT")
    .map((m) => ({ role: (m.role === "LEAD" ? "lead" : "bot") as "lead" | "bot", content: m.content }));

  const kb = parseKnowledgeBase(agent.knowledgeBase);
  let decision;
  try {
    decision = await generateDecision({
      productName: kb.product || campaign?.name || "produto",
      knowledgeBase: kb,
      tone: agent.tone,
      leadName: lead?.name ?? null,
      leadHeadline: lead?.headline ?? null,
      history,
      message: input.message,
      transferMessage: agent.transferMessage?.trim() || "Vou te conectar com um especialista.",
    });
  } catch (err) {
    await transferToHuman({
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: `falha técnica do LLM (${(err as Error).message})`,
      transferText: agent.transferMessage,
      campaignId: input.campaignId,
      leadId: input.leadId,
    });
    return "transfer";
  }

  if (!decision.canAnswer || decision.confidence < CONFIDENCE_THRESHOLD) {
    await transferToHuman({
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: decision.confidence < CONFIDENCE_THRESHOLD ? "confiança baixa" : "fora da base de conhecimento",
      transferText: agent.transferMessage,
      campaignId: input.campaignId,
      leadId: input.leadId,
    });
    return "transfer";
  }

  if (decision.transfer) {
    await transferToHuman({
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: "lead pronto para atendimento humano",
      transferText: agent.transferMessage,
      campaignId: input.campaignId,
      leadId: input.leadId,
    });
    return "transfer";
  }

  try {
    const res = await unipile.sendChatMessage(input.chatId, decision.reply);
    const costUsd = estimateCost(decision.tokensIn, decision.tokensOut);
    await recordMessage({
      conversationId: conversation.id,
      role: "BOT",
      content: decision.reply,
      messageId: res.message_id,
      costUsd,
    });
    await prisma.account.update({
      where: { id: account.id },
      data: { agentRepliesToday: { increment: 1 }, agentRepliesWeek: { increment: 1 } },
    });
    if (lead) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          lastMessageAt: new Date(),
          lastMessageText: decision.reply,
          status: "RESPONDED",
          replyCount: { increment: 1 },
        },
      });
    }
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "BOT", lastMessageAt: new Date() },
    });
    await createLog({
      type: "BOT_REPLY",
      message: `Resposta IA enviada${lead ? ` para ${lead.name ?? lead.providerId}` : ""}`,
      campaignId: input.campaignId ?? undefined,
      leadId: input.leadId ?? undefined,
      accountId: account.id,
      payload: { reply: decision.reply, confidence: decision.confidence, costUsd },
    });
    return "reply";
  } catch (err) {
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: `Falha ao enviar resposta do bot: ${(err as Error).message}`,
      campaignId: input.campaignId ?? undefined,
      leadId: input.leadId ?? undefined,
      accountId: account.id,
      payload: { reply: decision.reply },
    });
    return "transfer";
  }
}

export async function resolveInitialMessage(
  campaign: Pick<Campaign, "name" | "accountId" | "inviteMessage">,
  lead: Pick<Lead, "name" | "headline">,
): Promise<string> {
  const fallback = (campaign.inviteMessage ?? "").trim();
  const agent = await prisma.nativeAgent.findUnique({ where: { accountId: campaign.accountId } });
  if (!agent || agent.initialMessageMode !== "AI") return fallback;
  if (!fallback && !agent.initialTemplate) return fallback;
  try {
    const kb = parseKnowledgeBase(agent.knowledgeBase);
    const out = await generateInitialMessage({
      productName: campaign.name,
      tone: agent.tone || "consultivo e profissional",
      template: agent.initialTemplate || fallback,
      leadName: lead.name,
      leadHeadline: lead.headline,
      product: kb.product || campaign.name,
    });
    return out.text.trim() || fallback;
  } catch (err) {
    logger.warn("resolveInitialMessage: falha ao gerar, usando mensagem padrão", err);
    return fallback;
  }
}
