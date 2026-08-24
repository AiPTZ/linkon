import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { refreshCounters, withinLimits } from "../services/invite.service";
import { sendSweepMessage } from "../services/sweep.service";
import { createLog } from "../services/log.service";
import { logger } from "../utils/logger";
import { UnipileError } from "../utils/errors";
import type { SweepJob } from "../services/queue.service";

const worker = new Worker(
  "linkon-sweep",
  async (job) => {
    const { leadId, campaignId } = job.data as SweepJob;

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.status !== "RUNNING") {
      logger.info(`Skipping sweep for lead ${leadId}: campaign not running`);
      return;
    }
    if (campaign.mode !== "SWEEP" && campaign.mode !== "DISPARO") {
      logger.info(`Skipping sweep for lead ${leadId}: campaign is not a sweep/broadcast campaign`);
      return;
    }

    const fresh = await refreshCounters(campaign);
    if (!withinLimits(fresh)) {
      logger.info(`Skipping sweep for lead ${leadId}: campaign reached limits`);
      return;
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.status !== "PENDING" || lead.currentBlockId !== null) {
      return;
    }
    if (campaign.mode === "DISPARO" && !lead.selected) {
      logger.info(`Skipping sweep for lead ${leadId}: lead not selected for broadcast`);
      return;
    }

    try {
      await sendSweepMessage(fresh, lead);
    } catch (err) {
      if (err instanceof UnipileError && !err.isRetryable()) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: "ERROR", errorCode: err.errorType },
        });
        await createLog({
          type: "ERROR",
          level: "ERROR",
          message: `Falha permanente no envio: ${err.message}`,
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
  logger.error(`Sweep job ${job?.id} failed`, err.message);
});

logger.info("Sweep worker started");
