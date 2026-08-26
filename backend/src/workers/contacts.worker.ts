import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { scrapeLeadContact } from "../services/contacts.service";
import { createLog } from "../services/log.service";
import { logger } from "../utils/logger";
import { UnipileError } from "../utils/errors";
import type { ContactScrapeJob } from "../services/queue.service";

const worker = new Worker(
  "linkon-contacts",
  async (job) => {
    const { leadId, campaignId } = job.data as ContactScrapeJob;

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { account: true },
    });
    if (!campaign?.account) return;

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    try {
      const contact = await scrapeLeadContact(campaign.account, lead);
      if (contact.emails.length > 0 || contact.phones.length > 0) {
        await createLog({
          type: "CONTACT_SCRAPED",
          message: `Contato extraído para ${lead.name ?? lead.providerId}`,
          campaignId,
          leadId,
          accountId: campaign.account.id,
          payload: {
            emails: contact.emails.length,
            phones: contact.phones.length,
          },
        });
      }
    } catch (err) {
      if (err instanceof UnipileError && !err.isRetryable()) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { contactScrapedAt: new Date() },
        });
        return;
      }
      throw err;
    }
  },
  { connection: redisConnection, concurrency: 1 },
);

worker.on("failed", (job, err) => {
  logger.error(`Contacts job ${job?.id} failed`, err.message);
});

logger.info("Contacts worker started");
