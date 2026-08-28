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
import { containsStopKeyword, parseKeywords } from "./chatbot.service";
import { logger } from "../utils/logger";
import type { Campaign, Lead, Conversation } from "@prisma/client";

export type BotAction = "reply" | "transfer" | "ignore" | "none";

export async function getOrCreateConversation(input: {
  campaignId: string;
  leadId: string;
  accountId: string;
  unipileChatId: string;
}): Promise<Conversation> {
  return prisma.conversation.upsert({
    where: { unipileChatId: input.unipileChatId },
    update: { lastMessageAt: new Date() },
    create: {
      campaignId: input.campaignId,
      leadId: input.leadId,
      accountId: input.accountId,
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
  campaignId: string;
  leadId: string;
  accountId: string;
  chatId: string;
  conversationId: string;
  reason: string;
}): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id: input.campaignId } });
  const transferText =
    campaign?.chatbotTransferMessage?.trim() || "Vou conectar você com um especialista do nosso time.";
  try {
    await unipile.sendChatMessage(input.chatId, transferText);
  } catch (err) {
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: `Falha ao enviar mensagem de transferência: ${(err as Error).message}`,
      campaignId: input.campaignId,
      leadId: input.leadId,
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
    campaignId: input.campaignId,
    type: "BOT_TRANSFERRED",
    level: "WARN",
    message: `Conversa de um lead foi transferida para atendimento humano (${input.reason}).`,
    payload: { conversationId: input.conversationId, reason: input.reason },
  });
  await createLog({
    type: "BOT_TRANSFERRED",
    level: "WARN",
    message: `Bot transferiu para humano (${input.reason})`,
    campaignId: input.campaignId,
    leadId: input.leadId,
    accountId: input.accountId,
    payload: { chatId: input.chatId, reason: input.reason },
  });
}

export async function handleIncomingMessage(input: {
  campaignId: string;
  leadId: string;
  chatId: string;
  message: string;
}): Promise<BotAction> {
  const campaign = await prisma.campaign.findUnique({ where: { id: input.campaignId } });
  if (!campaign) return "none";
  if (!campaign.chatbotEnabled || campaign.chatbotMode !== "LLM") return "none";

  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) return "none";

  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) return "none";

  const conversation = await getOrCreateConversation({
    campaignId: campaign.id,
    leadId: lead.id,
    accountId: account.id,
    unipileChatId: input.chatId,
  });

  await recordMessage({ conversationId: conversation.id, role: "LEAD", content: input.message });

  const stopKeywords = parseKeywords(campaign.chatbotStopKeywords);
  if (containsStopKeyword(input.message, stopKeywords)) {
    await createLog({
      type: "MESSAGE_RECEIVED",
      message: `Resposta de ${lead.name ?? lead.providerId} ignorada (palavra de parada)`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { message: input.message },
    });
    return "ignore";
  }

  if (lead.replyCount >= campaign.chatbotMaxTurns) {
    await transferToHuman({
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: "limite de turnos atingido",
    });
    return "transfer";
  }

  if (isJailbreak(input.message)) {
    await transferToHuman({
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: "tentativa de jailbreak",
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

  let decision;
  try {
    decision = await generateDecision({
      campaignName: campaign.name,
      knowledgeBase: parseKnowledgeBase(campaign.chatbotKnowledgeBase),
      tone: campaign.chatbotTone,
      leadName: lead.name,
      leadHeadline: lead.headline,
      history,
      message: input.message,
      transferMessage: campaign.chatbotTransferMessage?.trim() || "Vou te conectar com um especialista.",
    });
  } catch (err) {
    await transferToHuman({
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: `falha técnica do LLM (${(err as Error).message})`,
    });
    return "transfer";
  }

  if (!decision.canAnswer || decision.confidence < CONFIDENCE_THRESHOLD) {
    await transferToHuman({
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      chatId: input.chatId,
      conversationId: conversation.id,
      reason: decision.confidence < CONFIDENCE_THRESHOLD ? "confiança baixa" : "fora da base de conhecimento",
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
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastMessageAt: new Date(), lastMessageText: decision.reply, status: "RESPONDED", replyCount: { increment: 1 } },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: "BOT", lastMessageAt: new Date() },
    });
    await createLog({
      type: "BOT_REPLY",
      message: `Resposta IA enviada para ${lead.name ?? lead.providerId}`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { reply: decision.reply, confidence: decision.confidence, costUsd },
    });
    return "reply";
  } catch (err) {
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: `Falha ao enviar resposta do bot: ${(err as Error).message}`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { reply: decision.reply },
    });
    return "transfer";
  }
}

export async function resolveInitialMessage(
  campaign: Pick<
    Campaign,
    | "name"
    | "chatbotMode"
    | "chatbotInitialMessageMode"
    | "chatbotInitialTemplate"
    | "chatbotKnowledgeBase"
    | "chatbotTone"
    | "inviteMessage"
  >,
  lead: Pick<Lead, "name" | "headline">,
): Promise<string> {
  const fallback = (campaign.inviteMessage ?? "").trim();
  if (campaign.chatbotMode !== "LLM" || campaign.chatbotInitialMessageMode !== "AI") {
    return fallback;
  }
  if (!fallback && !campaign.chatbotInitialTemplate) return fallback;
  try {
    const kb = parseKnowledgeBase(campaign.chatbotKnowledgeBase);
    const out = await generateInitialMessage({
      campaignName: campaign.name,
      tone: campaign.chatbotTone || "consultivo e profissional",
      template: campaign.chatbotInitialTemplate || fallback,
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
