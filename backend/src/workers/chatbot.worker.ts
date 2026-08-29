import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { handleIncomingMessage } from "../services/chatbot-ai.service";
import { logger } from "../utils/logger";
import type { ChatbotJob } from "../services/queue.service";

const worker = new Worker(
  "linkon-chatbot",
  async (job) => {
    const { accountId, chatId, message, campaignId, leadId } = job.data as ChatbotJob;
    if (!accountId) return;
    await handleIncomingMessage({ accountId, chatId, message, campaignId, leadId });
  },
  { connection: redisConnection, concurrency: 2 },
);

worker.on("failed", (job, err) => {
  logger.error(`Chatbot job ${job?.id} failed`, err.message);
});

logger.info("Chatbot worker started");
