import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import {
  runExtractionSearch,
  scrapeExtractionLead,
  skipExtractionLead,
} from "../services/extraction.service";
import { logger } from "../utils/logger";
import { UnipileError } from "../utils/errors";
import type { ExtractionJob } from "../services/queue.service";

const worker = new Worker(
  "linkon-extraction",
  async (job) => {
    const data = job.data as ExtractionJob;

    const extraction = await prisma.extraction.findUnique({ where: { id: data.extractionId } });
    if (!extraction) return;

    if (data.type === "run") {
      await runExtractionSearch(extraction);
      return;
    }

    if (!data.leadId) return;
    const lead = await prisma.extractedLead.findUnique({ where: { id: data.leadId } });
    if (!lead) return;

    try {
      await scrapeExtractionLead(extraction, lead);
    } catch (err) {
      if (err instanceof UnipileError && !err.isRetryable()) {
        await skipExtractionLead(extraction, lead);
        return;
      }
      throw err;
    }
  },
  { connection: redisConnection, concurrency: 1 },
);

worker.on("failed", (job, err) => {
  logger.error(`Extraction job ${job?.id} failed`, err.message);
});

logger.info("Extraction worker started");
