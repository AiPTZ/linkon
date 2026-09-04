import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findUnique: vi.fn(), update: vi.fn() },
    account: { findUnique: vi.fn() },
    lead: { count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("./queue.service", () => ({
  searchQueue: { add: vi.fn() },
  sweepQueue: { add: vi.fn() },
}));
vi.mock("./log.service", () => ({ createLog: vi.fn() }));
vi.mock("./notification.service", () => ({ notify: vi.fn() }));
vi.mock("./flow.service", () => ({ hasFlow: vi.fn(() => false) }));

import { prisma } from "../lib/prisma";
import { searchQueue, sweepQueue } from "./queue.service";
import { notify } from "./notification.service";
import { hasFlow } from "./flow.service";
import { startCampaign, resumeCampaign } from "./campaign.service";
import { ApiError } from "../utils/errors";
import type { Campaign, Account } from "@prisma/client";

const campaignFind = prisma.campaign.findUnique as ReturnType<typeof vi.fn>;
const campaignUpdate = prisma.campaign.update as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const leadCount = prisma.lead.count as ReturnType<typeof vi.fn>;
const leadFindFirst = prisma.lead.findFirst as ReturnType<typeof vi.fn>;
const searchAdd = searchQueue.add as ReturnType<typeof vi.fn>;
const sweepAdd = sweepQueue.add as ReturnType<typeof vi.fn>;
const flowHas = hasFlow as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Campanha",
    mode: "SEARCH",
    searchUrl: "https://linkedin.com/search",
    status: "DRAFT",
    accountId: "A1",
    inviteMessage: "",
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
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

describe("startCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
  });

  it("inicia DISPARO direto quando há ao menos um contato selecionado", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    leadCount.mockResolvedValue(5);
    await startCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "C1" }, data: { status: "RUNNING" } }),
    );
    expect(searchAdd).not.toHaveBeenCalled();
    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_STARTED" }));
  });

  it("enfileira o primeiro disparo imediatamente ao iniciar DISPARO sem fluxo", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    leadCount.mockResolvedValue(5);
    leadFindFirst.mockResolvedValue({ id: "L1", campaignId: "C1" });
    await startCampaign("C1");
    expect(sweepAdd).toHaveBeenCalledWith(
      "sweep",
      { leadId: "L1", campaignId: "C1" },
      expect.objectContaining({ delay: 0 }),
    );
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "L1" }, data: expect.objectContaining({ nextInviteAt: expect.any(Date) }) }),
    );
  });

  it("não enfileira disparo imediato quando o DISPARO tem fluxo", async () => {
    flowHas.mockReturnValue(true);
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO", flow: "[]" }));
    leadCount.mockResolvedValue(5);
    await startCampaign("C1");
    expect(sweepAdd).not.toHaveBeenCalled();
  });

  it("recusa DISPARO sem contatos selecionados", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    leadCount.mockResolvedValue(0);
    await expect(startCampaign("C1")).rejects.toThrow(ApiError);
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("mantém o fluxo de importação para SEARCH", async () => {
    campaignFind.mockResolvedValue(campaign());
    await startCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "IMPORTING" } }),
    );
    expect(searchAdd).toHaveBeenCalledWith("search", { campaignId: "C1" });
  });

  it("é no-op ao iniciar DISPARO já em RUNNING", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO", status: "RUNNING" }));
    await startCampaign("C1");
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(notifyFn).not.toHaveBeenCalled();
    expect(searchAdd).not.toHaveBeenCalled();
  });

  it("é no-op ao iniciar SEARCH já em IMPORTING", async () => {
    campaignFind.mockResolvedValue(campaign({ status: "IMPORTING" }));
    await startCampaign("C1");
    expect(campaignUpdate).not.toHaveBeenCalled();
  });

  it("recusa iniciar quando a conta está DISCONNECTED", async () => {
    campaignFind.mockResolvedValue(campaign());
    accountFind.mockResolvedValue({ ...account, status: "DISCONNECTED" });
    await expect(startCampaign("C1")).rejects.toThrow("desconectada");
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(searchAdd).not.toHaveBeenCalled();
  });

  it("recusa iniciar quando a conta está em CHECKPOINT", async () => {
    campaignFind.mockResolvedValue(campaign());
    accountFind.mockResolvedValue({ ...account, status: "CHECKPOINT" });
    await expect(startCampaign("C1")).rejects.toThrow("verificação");
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(searchAdd).not.toHaveBeenCalled();
  });
});

describe("resumeCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    campaignFind.mockResolvedValue(campaign());
    accountFind.mockResolvedValue(account);
  });

  it("retoma DISPARO direto, sem reimportar", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    leadCount.mockResolvedValue(5);
    await resumeCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RUNNING" } }),
    );
    expect(searchAdd).not.toHaveBeenCalled();
    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_STARTED" }));
  });

  it("recusa retomar DISPARO sem contatos selecionados", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    leadCount.mockResolvedValue(0);
    await expect(resumeCampaign("C1")).rejects.toThrow(ApiError);
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(notifyFn).not.toHaveBeenCalled();
  });

  it("reimporta SEARCH ao retomar", async () => {
    campaignFind.mockResolvedValue(campaign());
    await resumeCampaign("C1");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "IMPORTING" } }),
    );
    expect(searchAdd).toHaveBeenCalledWith("search", { campaignId: "C1" });
  });

  it("recusa retomar com conta DISCONNECTED", async () => {
    campaignFind.mockResolvedValue(campaign({ mode: "DISPARO", searchUrl: "DISPARO" }));
    accountFind.mockResolvedValue({ ...account, status: "DISCONNECTED" });
    await expect(resumeCampaign("C1")).rejects.toThrow("desconectada");
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(notifyFn).not.toHaveBeenCalled();
  });

  it("recusa retomar quando a conta está em CHECKPOINT", async () => {
    campaignFind.mockResolvedValue(campaign());
    accountFind.mockResolvedValue({ ...account, status: "CHECKPOINT" });
    await expect(resumeCampaign("C1")).rejects.toThrow("verificação");
    expect(campaignUpdate).not.toHaveBeenCalled();
    expect(searchAdd).not.toHaveBeenCalled();
  });
});
