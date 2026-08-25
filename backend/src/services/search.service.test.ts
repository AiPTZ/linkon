import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    account: { findUnique: vi.fn() },
    lead: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { searchByUrl: vi.fn() },
}));

vi.mock("./log.service", () => ({ createLog: vi.fn() }));

vi.mock("../utils/time", () => ({
  sleep: vi.fn(() => Promise.resolve()),
  randomInt: vi.fn(() => 3000),
}));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { importLeadsFromSearch } from "./search.service";
import type { Campaign, Account } from "@prisma/client";

const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const leadFindMany = prisma.lead.findMany as ReturnType<typeof vi.fn>;
const leadUpsert = prisma.lead.upsert as ReturnType<typeof vi.fn>;
const searchByUrl = unipile.searchByUrl as ReturnType<typeof vi.fn>;

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

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Busca",
    mode: "SEARCH",
    searchUrl: "https://www.linkedin.com/search/results/people/?keywords=santander",
    status: "IMPORTING",
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

function pageWith(ids: string[]): { items: { type: string; id: string; name: string }[]; paging: unknown } {
  return {
    items: ids.map((id) => ({ type: "PEOPLE", id, name: `Perfil ${id}` })),
    paging: { start: 0, page_count: ids.length, total_count: null },
  };
}

describe("importLeadsFromSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
    leadFindMany.mockResolvedValue([]);
  });

  it("paginiza pela página da URL e para em página vazia", async () => {
    searchByUrl
      .mockResolvedValueOnce(pageWith(["a", "b"]))
      .mockResolvedValueOnce(pageWith(["c", "d"]))
      .mockResolvedValueOnce(pageWith([]));

    const res = await importLeadsFromSearch(campaign());

    expect(searchByUrl).toHaveBeenNthCalledWith(1, "UA1", campaign().searchUrl, 1, 25);
    expect(searchByUrl).toHaveBeenNthCalledWith(2, "UA1", campaign().searchUrl, 2, 25);
    expect(searchByUrl).toHaveBeenNthCalledWith(3, "UA1", campaign().searchUrl, 3, 25);
    expect(leadUpsert).toHaveBeenCalledTimes(4);
    expect(res.imported).toBe(4);
  });

  it("para quando uma página não traz leads novos", async () => {
    searchByUrl
      .mockResolvedValueOnce(pageWith(["a", "b"]))
      .mockResolvedValueOnce(pageWith(["a", "b"]));

    const res = await importLeadsFromSearch(campaign());

    expect(searchByUrl).toHaveBeenCalledTimes(2);
    expect(leadUpsert).toHaveBeenCalledTimes(2);
    expect(res.imported).toBe(2);
  });

  it("respeita maxLeads", async () => {
    searchByUrl.mockResolvedValueOnce(pageWith(["a", "b", "c"]));

    const res = await importLeadsFromSearch(campaign({ maxLeads: 3 }));

    expect(searchByUrl).toHaveBeenCalledTimes(1);
    expect(res.imported).toBe(3);
  });

  it("pula leads já importados na campanha", async () => {
    leadFindMany.mockResolvedValue([{ providerId: "a" }]);
    searchByUrl
      .mockResolvedValueOnce(pageWith(["a", "b"]))
      .mockResolvedValueOnce(pageWith([]));

    const res = await importLeadsFromSearch(campaign());

    expect(leadUpsert).toHaveBeenCalledTimes(1);
    expect(res.imported).toBe(1);
  });
});
