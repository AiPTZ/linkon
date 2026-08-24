import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    account: { findUnique: vi.fn() },
    lead: { updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("./sweep.service", () => ({
  importLeadsFromSweep: vi.fn(),
}));

vi.mock("./notification.service", () => ({
  notify: vi.fn(),
}));

import { prisma } from "../lib/prisma";
import { importLeadsFromSweep } from "./sweep.service";
import { notify } from "./notification.service";
import {
  importBroadcastLeads,
  setLeadSelection,
  getSelectionCount,
} from "./broadcast.service";
import { ApiError } from "../utils/errors";
import type { Campaign, Account } from "@prisma/client";

const campaignFind = prisma.campaign.findUnique as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const updateMany = prisma.lead.updateMany as ReturnType<typeof vi.fn>;
const findMany = prisma.lead.findMany as ReturnType<typeof vi.fn>;
const leadCount = prisma.lead.count as ReturnType<typeof vi.fn>;
const importSweep = importLeadsFromSweep as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Disparo teste",
    mode: "DISPARO",
    searchUrl: "DISPARO",
    status: "DRAFT",
    accountId: "A1",
    inviteMessage: "Olá {nome}!",
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

describe("importBroadcastLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
    importSweep.mockResolvedValue({ imported: 110, total: 110 });
  });

  it("importa as relações e notifica", async () => {
    campaignFind.mockResolvedValue(campaign());
    const res = await importBroadcastLeads("C1");
    expect(importSweep).toHaveBeenCalledWith(expect.objectContaining({ id: "C1" }));
    expect(res).toEqual({ imported: 110, total: 110 });
    expect(notifyFn).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "C1", type: "BROADCAST_IMPORT" }),
    );
  });

  it("recusa quando o disparo já foi iniciado", async () => {
    campaignFind.mockResolvedValue(campaign({ status: "RUNNING" }));
    await expect(importBroadcastLeads("C1")).rejects.toThrow(ApiError);
    expect(importSweep).not.toHaveBeenCalled();
  });

  it("recusa conta desconectada", async () => {
    campaignFind.mockResolvedValue(campaign());
    accountFind.mockResolvedValue({ ...account, status: "DISCONNECTED" });
    await expect(importBroadcastLeads("C1")).rejects.toThrow("desconectada");
  });
});

describe("setLeadSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaignFind.mockResolvedValue(campaign());
    leadCount.mockResolvedValue(7);
  });

  it("seleciona todos", async () => {
    const selected = await setLeadSelection("C1", "all");
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1" },
      data: { selected: true },
    });
    expect(selected).toBe(7);
  });

  it("desmarca todos", async () => {
    await setLeadSelection("C1", "none");
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1" },
      data: { selected: false },
    });
  });

  it("alterna um conjunto (toggle)", async () => {
    findMany.mockResolvedValue([{ providerId: "P1", selected: false }]);
    await setLeadSelection("C1", "toggle", ["P1"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1", providerId: { in: ["P1"] } },
      data: { selected: true },
    });
  });

  it("substitui a seleção (replace)", async () => {
    await setLeadSelection("C1", "replace", ["P1", "P2"]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1" },
      data: { selected: false },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { campaignId: "C1", providerId: { in: ["P1", "P2"] } },
      data: { selected: true },
    });
  });

  it("recusa disparo já iniciado", async () => {
    campaignFind.mockResolvedValue(campaign({ status: "RUNNING" }));
    await expect(setLeadSelection("C1", "all")).rejects.toThrow(ApiError);
  });
});

describe("getSelectionCount", () => {
  it("retorna selecionados e total", async () => {
    leadCount.mockResolvedValueOnce(10).mockResolvedValueOnce(110);
    const res = await getSelectionCount("C1");
    expect(res).toEqual({ selected: 10, total: 110 });
  });
});
