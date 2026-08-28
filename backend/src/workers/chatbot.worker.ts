import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { unipile } from "../services/unipile.service";
import {
  containsStopKeyword,
  generateReply,
  parseKeywords,
} from "../services/chatbot.service";
import { createLog } from "../services/log.service";
import { handleIncomingMessage, isConversationLocked } from "../services/chatbot-ai.service";
import { logger } from "../utils/logger";
import type { ChatbotJob } from "../services/queue.service";

const worker = new Worker(
  "linkon-chatbot",
  async (job) => {
    const { chatId, leadId, campaignId, message } = job.data as ChatbotJob;

    const [campaign, lead] = await Promise.all([
      prisma.campaign.findUnique({ where: { id: campaignId } }),
      prisma.lead.findUnique({ where: { id: leadId } }),
    ]);
    if (!campaign || !lead) return;
    if (!campaign.chatbotEnabled) return;

    if (campaign.chatbotMode === "LLM") {
      await handleIncomingMessage({ campaignId, leadId, chatId, message });
      return;
    }

    const conv = await prisma.conversation.findUnique({ where: { unipileChatId: chatId } });
    if (conv && isConversationLocked(conv.status)) {
      await createLog({
        type: "MESSAGE_RECEIVED",
        message: `Resposta de ${lead.name ?? lead.providerId} ignorada (conversa em atendimento humano)`,
        campaignId,
        leadId,
        payload: { message },
      });
      return;
    }

    const stopKeywords = parseKeywords(campaign.chatbotStopKeywords);
    if (containsStopKeyword(message, stopKeywords)) {
      await createLog({
        type: "MESSAGE_RECEIVED",
        message: `Resposta de ${lead.name ?? lead.providerId} ignorada (palavra de parada)`,
        campaignId,
        leadId,
        payload: { message },
      });
      return;
    }

    if (lead.replyCount >= campaign.maxRepliesPerLead) {
      await createLog({
        type: "MESSAGE_RECEIVED",
        message: `Limite de respostas atingido para ${lead.name ?? lead.providerId}`,
        campaignId,
        leadId,
        payload: { message },
      });
      return;
    }

    const reply = generateReply(campaign, message);
    if (!reply) {
      await createLog({
        type: "MESSAGE_RECEIVED",
        message: `Sem regra de resposta para: ${message}`,
        campaignId,
        leadId,
        payload: { message },
      });
      return;
    }

    const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
    if (!account) return;

    try {
      await unipile.sendChatMessage(chatId, reply);
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          lastMessageAt: new Date(),
          replyCount: { increment: 1 },
          status: "RESPONDED",
        },
      });
      await createLog({
        type: "BOT_REPLY",
        message: `Resposta enviada para ${lead.name ?? lead.providerId}`,
        campaignId,
        leadId,
        accountId: account.id,
        payload: { reply },
      });
    } catch (err) {
      await createLog({
        type: "ERROR",
        level: "ERROR",
        message: `Falha ao enviar resposta do bot: ${(err as Error).message}`,
        campaignId,
        leadId,
        accountId: account.id,
      });
      throw err;
    }
  },
  { connection: redisConnection, concurrency: 2 },
);

worker.on("failed", (job, err) => {
  logger.error(`Chatbot job ${job?.id} failed`, err.message);
});

logger.info("Chatbot worker started");
