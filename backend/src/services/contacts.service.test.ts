import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    account: { findUnique: vi.fn() },
    lead: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { getUserContactInfo: vi.fn() },
}));

vi.mock("./log.service", () => ({
  createLog: vi.fn(),
}));

vi.mock("./queue.service", () => ({
  contactsQueue: { add: vi.fn() },
}));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { contactsQueue } from "./queue.service";
import {
  parseContactList,
  joinList,
  scrapeLeadContact,
  scheduleContactScrape,
  contactScrapeStats,
  buildLeadsXlsx,
} from "./contacts.service";
import type { Campaign, Lead, Account } from "@prisma/client";

const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const leadFind = prisma.lead.findMany as ReturnType<typeof vi.fn>;
const leadUpdate = prisma.lead.update as ReturnType<typeof vi.fn>;
const leadCount = prisma.lead.count as ReturnType<typeof vi.fn>;
const getContact = unipile.getUserContactInfo as ReturnType<typeof vi.fn>;
const queueAdd = contactsQueue.add as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "santander 01",
    mode: "SEARCH",
    searchUrl: "https://www.linkedin.com/search/results/people",
    status: "RUNNING",
    accountId: "A1",
    inviteMessage: "",
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    chatbotEnabled: false,
    chatbotRules: "[]",
    chatbotDefaultReply: "",
    chatbotReplyDelayMin: 1,
    chatbotReplyDelayMax: 3,
    chatbotStopKeywords: "[]",
    maxRepliesPerLead: 3,
    flow: "",
    invitesSentToday: 0,
    dateOfInviteCount: null,
    invitesSentWeek: 0,
    weekStartDate: null,
    maxLeads: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Campaign;
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "L1",
    campaignId: "C1",
    providerId: "ACoAAmember1",
    publicIdentifier: "joao-silva",
    name: "João Silva",
    headline: "Gerente",
    profileUrl: "https://linkedin.com/in/joao-silva",
    status: "INVITED",
    invitedAt: new Date(),
    acceptedAt: null,
    lastMessageAt: null,
    lastMessageText: null,
    emails: null,
    phones: null,
    contactScrapedAt: null,
    nextInviteAt: null,
    currentBlockId: null,
    replyCount: 0,
    errorCode: null,
    createdAt: new Date(),
    ...overrides,
  } as Lead;
}

const account: Account = {
  id: "A1",
  unipileAccountId: "UA1",
  provider: "LINKEDIN",
  username: "arcanjo",
  authMethod: "NATIVE",
  status: "OK",
  checkpointType: null,
  credentialsEnc: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Account;

describe("parseContactList", () => {
  it("parses a JSON array string", () => {
    expect(parseContactList('["a@b.com","c@d.com"]')).toEqual(["a@b.com", "c@d.com"]);
  });
  it("returns [] for null/empty/invalid", () => {
    expect(parseContactList(null)).toEqual([]);
    expect(parseContactList("")).toEqual([]);
    expect(parseContactList("not-json")).toEqual([]);
    expect(parseContactList('{"a":1}')).toEqual([]);
  });
});

describe("joinList", () => {
  it("joins with semicolon", () => {
    expect(joinList(["a", "b"])).toBe("a; b");
  });
  it("returns empty string for empty list", () => {
    expect(joinList([])).toBe("");
  });
});

describe("scrapeLeadContact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores emails and phones and marks contactScrapedAt", async () => {
    getContact.mockResolvedValue({
      emails: ["joao@empresa.com"],
      phones: ["(19) 99999-0000"],
    });

    const res = await scrapeLeadContact(account, lead());

    expect(getContact).toHaveBeenCalledWith("UA1", "ACoAAmember1");
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: "L1" },
      data: {
        emails: JSON.stringify(["joao@empresa.com"]),
        phones: JSON.stringify(["(19) 99999-0000"]),
        contactScrapedAt: expect.any(Date),
      },
    });
    expect(res).toEqual({ emails: ["joao@empresa.com"], phones: ["(19) 99999-0000"] });
  });

  it("stores empty arrays when no contact info", async () => {
    getContact.mockResolvedValue({ emails: [], phones: [] });
    await scrapeLeadContact(account, lead());
    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: "L1" },
      data: {
        emails: "[]",
        phones: "[]",
        contactScrapedAt: expect.any(Date),
      },
    });
  });
});

describe("scheduleContactScrape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
  });

  it("enqueues one spaced job per lead", async () => {
    leadFind.mockResolvedValue([{ id: "L1" }, { id: "L2" }, { id: "L3" }]);

    const res = await scheduleContactScrape(campaign());

    expect(leadFind).toHaveBeenCalledWith({
      where: { campaignId: "C1" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    expect(queueAdd).toHaveBeenCalledTimes(3);
    expect(queueAdd).toHaveBeenNthCalledWith(
      1,
      "scrape",
      { leadId: "L1", campaignId: "C1" },
      expect.objectContaining({ delay: 0, attempts: 4 }),
    );
    expect(queueAdd).toHaveBeenNthCalledWith(
      2,
      "scrape",
      { leadId: "L2", campaignId: "C1" },
      expect.objectContaining({ delay: 1500 }),
    );
    expect(res).toEqual({ scheduled: 3, skipped: 0 });
  });

  it("returns zero when account is missing", async () => {
    accountFind.mockResolvedValue(null);
    const res = await scheduleContactScrape(campaign());
    expect(leadFind).not.toHaveBeenCalled();
    expect(res).toEqual({ scheduled: 0, skipped: 0 });
  });
});

describe("contactScrapeStats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts scraped and with-contact leads", async () => {
    leadCount.mockResolvedValueOnce(100).mockResolvedValueOnce(40).mockResolvedValueOnce(12).mockResolvedValueOnce(10).mockResolvedValueOnce(5);

    const res = await contactScrapeStats("C1");

    expect(leadCount).toHaveBeenCalledTimes(5);
    expect(res).toEqual({ total: 100, scraped: 40, withContact: 12, withEmail: 10, withPhone: 5, pending: 60 });
  });
});

describe("buildLeadsXlsx", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates a valid xlsx with lead data", async () => {
    leadFind.mockResolvedValue([
      lead({
        emails: JSON.stringify(["joao@empresa.com"]),
        phones: JSON.stringify(["(19) 99999-0000"]),
        contactScrapedAt: new Date("2026-08-25T12:00:00Z"),
      }),
      lead({ id: "L2", providerId: "ACoAAmember2", name: "Maria", emails: null, phones: null }),
    ]);

    const { buffer, filename } = await buildLeadsXlsx(campaign());

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(filename).toBe("santander_01-leads-contatos.xlsx");

    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const sheet = wb.getWorksheet("Leads");
    expect(sheet).toBeDefined();
    const rows = sheet!.getSheetValues() as unknown as Array<Array<string>>;
    const joao = rows.find((r) => Array.isArray(r) && r.some((c) => c === "João Silva"));
    expect(joao).toBeDefined();
    expect(joao![4]).toBe("joao@empresa.com");
    expect(joao![5]).toBe("(19) 99999-0000");
    const maria = rows.find((r) => Array.isArray(r) && r.some((c) => c === "Maria"));
    expect(maria![4]).toBe("");
    expect(maria![5]).toBe("");
  });
});
