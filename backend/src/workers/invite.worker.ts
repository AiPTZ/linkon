import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { refreshCounters, sendInvitation, withinLimits } from "../services/invite.service";
import { createLog } from "../services/log.service";
import { logger } from "../utils/logger";
import { UnipileError } from "../utils/errors";

const worker = new Worker(
  "linkon-invites",
  async (job) => {
    const { leadId, campaignId } = job.data as { leadId: string; campaignId: string };

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== "RUNNING") {
      logger.info(`Skipping invite for lead ${leadId}: campaign not running`);
      return;
    }

    const fresh = await refreshCounters(campaign);
    if (!withinLimits(fresh)) {
      logger.info(`Skipping invite for lead ${leadId}: campaign reached limits`);
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.status !== "PENDING") {
      return;
    }

    try {
      await sendInvitation(fresh, lead);
    } catch (err) {
      if (err instanceof UnipileError && !err.isRetryable()) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: "ERROR", errorCode: err.errorType },
        });
        await createLog({
          type: "ERROR",
          level: "ERROR",
          message: `Falha permanente no convite: ${err.message}`,
          campaignId,
          leadId,
          payload: { errorType: err.errorType },
        });
        return;
      }
      throw err;
    }
  },
  { connection: redisConnection, concurrency: 2 },
);

worker.on("failed", (job, err) => {
  logger.error(`Invite job ${job?.id} failed`, err.message);
});

logger.info("Invite worker started");
