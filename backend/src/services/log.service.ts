import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";

export interface LogInput {
  type: string;
  level?: "INFO" | "WARN" | "ERROR";
  message: string;
  campaignId?: string;
  leadId?: string;
  accountId?: string;
  payload?: unknown;
}

export async function createLog(input: LogInput): Promise<void> {
  try {
    await prisma.logEvent.create({
      data: {
        type: input.type,
        level: input.level ?? "INFO",
        message: input.message,
        campaignId: input.campaignId,
        leadId: input.leadId,
        accountId: input.accountId,
        payload: input.payload !== undefined ? JSON.stringify(input.payload) : undefined,
      },
    });
  } catch (err) {
    logger.error("Failed to persist log event", err);
  }
}
