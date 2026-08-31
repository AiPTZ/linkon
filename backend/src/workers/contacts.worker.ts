import { Worker } from "bullmq";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { scrapeLeadContact } from "../services/contacts.service";
import { syncAccountNetwork, scrapeContactById } from "../services/network.service";
import { createLog } from "../services/log.service";
import { logger } from "../utils/logger";
import { UnipileError } from "../utils/errors";
import type { ContactsSyncJob, ContactScrapeJob } from "../services/queue.service";

const worker = new Worker(
  "linkon-contacts",
  async (job) => {
    if (job.name === "sync-network") {
      const { accountId } = job.data as ContactsSyncJob;
      await syncAccountNetwork(accountId);
      return;
    }

    const data = job.data as ContactScrapeJob;

    if (data.contactId) {
      await scrapeContactById(data.contactId);
      return;
    }

    const { leadId, campaignId } = data;
    if (!leadId || !campaignId) return;

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
