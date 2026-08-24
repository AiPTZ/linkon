import { prisma } from "../lib/prisma";
import { logger } from "../utils/logger";

export interface NotificationInput {
  accountId?: string;
  campaignId?: string;
  type: string;
  level?: "INFO" | "WARN" | "ERROR";
  message: string;
  payload?: unknown;
}

export async function notify(input: NotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        accountId: input.accountId,
        campaignId: input.campaignId,
        type: input.type,
        level: input.level ?? "INFO",
        message: input.message,
        payload: input.payload !== undefined ? JSON.stringify(input.payload) : undefined,
      },
    });
  } catch (err) {
    logger.error("Failed to create notification", err);
  }
}
