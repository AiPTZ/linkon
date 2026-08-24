import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { importLeadsFromSearch } from "../services/search.service";
import { importLeadsFromSweep } from "../services/sweep.service";
import { createLog } from "../services/log.service";
import { logger } from "../utils/logger";
import type { SearchJob } from "../services/queue.service";

const worker = new Worker(
  "linkon-search",
  async (job) => {
    const { campaignId } = job.data as SearchJob;
    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) return;

    try {
      const { imported, total } =
        campaign.mode === "SWEEP" || campaign.mode === "DISPARO"
          ? await importLeadsFromSweep(campaign)
          : await importLeadsFromSearch(campaign);
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "RUNNING" } });
      await createLog({
        type: "LEAD_IMPORTED",
        message:
          campaign.mode === "SWEEP" || campaign.mode === "DISPARO"
            ? `Conexões da rede importadas: ${imported}`
            : `Importados ${imported} leads (total na busca: ${total})`,
        campaignId,
        payload: { imported, total },
      });
    } catch (err) {
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: "DRAFT" } });
      await createLog({
        type: "ERROR",
        level: "ERROR",
        message: `Falha ao importar leads: ${(err as Error).message}`,
        campaignId,
        payload: { error: (err as Error).message },
      });
      throw err;
    }
  },
  { connection: redisConnection, concurrency: 1 },
);

worker.on("failed", (job, err) => {
  logger.error(`Search job ${job?.id} failed`, err.message);
});

logger.info("Search worker started");
