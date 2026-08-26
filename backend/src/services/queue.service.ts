import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis";

export const invitesQueue = new Queue("linkon-invites", { connection: redisConnection });
export const chatbotQueue = new Queue("linkon-chatbot", { connection: redisConnection });
export const searchQueue = new Queue("linkon-search", { connection: redisConnection });
export const sweepQueue = new Queue("linkon-sweep", { connection: redisConnection });
export const contactsQueue = new Queue("linkon-contacts", { connection: redisConnection });
export const extractionQueue = new Queue("linkon-extraction", { connection: redisConnection });

export interface InviteJob {
  leadId: string;
  campaignId: string;
}

export interface SweepJob {
  leadId: string;
  campaignId: string;
}

export interface ChatbotJob {
  chatId: string;
  leadId: string;
  campaignId: string;
  message: string;
}

export interface SearchJob {
  campaignId: string;
}

export interface ContactScrapeJob {
  leadId: string;
  campaignId: string;
}

export interface ExtractionJob {
  extractionId: string;
  type: "run" | "scrape";
  leadId?: string;
}
