import { describe, expect, it } from "vitest";

import type { ContactsSyncJob, ContactScrapeJob } from "./queue.service";

describe("queue job types", () => {
  it("ContactsSyncJob carrega accountId", () => {
    const job: ContactsSyncJob = { accountId: "A1" };
    expect(job.accountId).toBe("A1");
  });

  it("ContactScrapeJob aceita payload de contato e de lead", () => {
    const contactJob: ContactScrapeJob = { contactId: "CT1", accountId: "A1" };
    const leadJob: ContactScrapeJob = { leadId: "L1", campaignId: "C1" };
    expect(contactJob.contactId).toBe("CT1");
    expect(leadJob.leadId).toBe("L1");
  });
});
