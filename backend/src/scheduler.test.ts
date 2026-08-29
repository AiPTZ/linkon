import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./lib/prisma", () => ({
  prisma: {
    campaign: { findMany: vi.fn(), update: vi.fn() },
    lead: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    account: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("./services/invite.service", () => ({
  refreshCounters: vi.fn(),
  withinLimits: vi.fn(),
}));

vi.mock("./services/queue.service", () => ({
  invitesQueue: { add: vi.fn() },
  sweepQueue: { add: vi.fn() },
}));

vi.mock("./services/flow.service", () => ({
  hasFlow: vi.fn(() => false),
  parseFlow: vi.fn(),
  processFlowStep: vi.fn(),
}));

vi.mock("./services/log.service", () => ({ createLog: vi.fn() }));
vi.mock("./services/notification.service", () => ({ notify: vi.fn() }));

vi.mock("./services/native-agent.service", () => ({
  refreshAgentCounters: vi.fn(),
}));

vi.mock("./utils/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils/time")>();
  return { ...actual, isWorkHour: () => true, randomDelayMs: () => 300_000 };
});

import { prisma } from "./lib/prisma";
import { refreshCounters, withinLimits } from "./services/invite.service";
import { refreshAgentCounters } from "./services/native-agent.service";
import { sweepQueue, invitesQueue } from "./services/queue.service";
import { notify } from "./services/notification.service";
import { hasFlow } from "./services/flow.service";
import { processBroadcastCampaign, processFlowCampaign, processInviteCampaign, refreshAgentCountersForAll } from "./scheduler";
import type { Campaign, Account, Lead } from "@prisma/client";

const leadFindFirst = prisma.lead.findFirst as ReturnType<typeof vi.fn>;
const leadCount = prisma.lead.count as ReturnType<typeof vi.fn>;
const campaignUpdate = prisma.campaign.update as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const refresh = refreshCounters as ReturnType<typeof vi.fn>;
const within = withinLimits as ReturnType<typeof vi.fn>;
const sweepAdd = sweepQueue.add as ReturnType<typeof vi.fn>;
const inviteAdd = invitesQueue.add as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;
const flowHas = hasFlow as ReturnType<typeof vi.fn>;
const agentRefresh = refreshAgentCounters as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Disparo",
    mode: "DISPARO",
    searchUrl: "DISPARO",
    status: "RUNNING",
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
    chatbotMode: "RULES",
    chatbotKnowledgeBase: "",
    chatbotTone: "consultivo e profissional",
    chatbotInitialMessageMode: "TEMPLATE",
    chatbotInitialTemplate: "",
    chatbotTransferMessage: "",
    chatbotMaxTurns: 6,
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

describe("processBroadcastCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockImplementation((c: Campaign) => Promise.resolve(c));
    within.mockReturnValue(true);
    accountFind.mockResolvedValue(account);
  });

  it("agenda apenas leads selecionados para DISPARO", async () => {
    leadFindFirst.mockResolvedValue({ id: "L1", campaignId: "C1" } as Lead);
    await processBroadcastCampaign(campaign());
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ selected: true }) }),
    );
    expect(sweepAdd).toHaveBeenCalledWith("sweep", { leadId: "L1", campaignId: "C1" }, expect.anything());
  });

  it("agenda o primeiro disparo do DISPARO imediatamente (delay 0)", async () => {
    leadFindFirst.mockResolvedValueOnce({ id: "L1", campaignId: "C1" } as Lead).mockResolvedValueOnce(null);
    await processBroadcastCampaign(campaign());
    expect(sweepAdd).toHaveBeenCalledWith(
      "sweep",
      { leadId: "L1", campaignId: "C1" },
      expect.objectContaining({ delay: 0 }),
    );
  });

  it("espaça disparos subsequentes do DISPARO em maxDelayMin após o último agendamento", async () => {
    leadFindFirst
      .mockResolvedValueOnce({ id: "L1", campaignId: "C1" } as Lead)
      .mockResolvedValueOnce({ nextInviteAt: new Date(Date.now() - 10 * 60_000) });
    await processBroadcastCampaign(campaign());
    const options = sweepAdd.mock.calls[0][2] as { delay: number };
    expect(options.delay).toBeGreaterThan(290_000);
    expect(options.delay).toBeLessThan(310_000);
  });

  it("não filtra por selected em SWEEP legado", async () => {
    leadFindFirst.mockResolvedValue({ id: "L1", campaignId: "C1" } as Lead);
    await processBroadcastCampaign(campaign({ mode: "SWEEP", searchUrl: "SWEEP" }));
    expect(leadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ selected: true }) }),
    );
  });

  it("completa DISPARO quando não restam selecionados", async () => {
    leadFindFirst.mockResolvedValue(null);
    leadCount.mockResolvedValue(0);
    await processBroadcastCampaign(campaign());
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "COMPLETED" } }),
    );
    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_COMPLETED" }));
  });

  it("completa SWEEP legado sem notificar BROADCAST_COMPLETED", async () => {
    leadFindFirst.mockResolvedValue(null);
    leadCount.mockResolvedValue(0);
    await processBroadcastCampaign(campaign({ mode: "SWEEP", searchUrl: "SWEEP" }));
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "COMPLETED" } }),
    );
    expect(notifyFn).not.toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_COMPLETED" }));
  });

  it("pausa SWEEP no limite semanal sem notificar BROADCAST_LIMIT_HIT", async () => {
    await processBroadcastCampaign(campaign({ mode: "SWEEP", searchUrl: "SWEEP", invitesSentWeek: 999 }));
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "LIMIT_HIT" } }),
    );
    expect(notifyFn).not.toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_LIMIT_HIT" }));
  });
});

describe("processInviteCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockImplementation((c: Campaign) => Promise.resolve(c));
    within.mockReturnValue(true);
  });

  it("agenda o primeiro convite do SEARCH imediatamente (delay 0)", async () => {
    leadFindFirst.mockResolvedValue({ id: "L1", campaignId: "C1" } as Lead);
    await processInviteCampaign(campaign({ mode: "SEARCH", searchUrl: "https://linkedin.com/search" }));
    expect(inviteAdd).toHaveBeenCalledWith(
      "invite",
      { leadId: "L1", campaignId: "C1" },
      expect.objectContaining({ delay: 0 }),
    );
  });

  it("espaça convites subsequentes do SEARCH em maxDelayMin após o último agendamento", async () => {
    leadFindFirst
      .mockResolvedValueOnce({ id: "L1", campaignId: "C1" } as Lead)
      .mockResolvedValueOnce({ nextInviteAt: new Date(Date.now() - 10 * 60_000) });
    await processInviteCampaign(campaign({ mode: "SEARCH", searchUrl: "https://linkedin.com/search" }));
    const options = inviteAdd.mock.calls[0][2] as { delay: number };
    expect(options.delay).toBeGreaterThan(290_000);
    expect(options.delay).toBeLessThan(310_000);
  });

  it("pausa SEARCH no limite semanal", async () => {
    await processInviteCampaign(
      campaign({ mode: "SEARCH", searchUrl: "https://linkedin.com/search", invitesSentWeek: 999 }),
    );
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "LIMIT_HIT" } }),
    );
    expect(inviteAdd).not.toHaveBeenCalled();
  });
});

describe("processFlowCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refresh.mockImplementation((c: Campaign) => Promise.resolve(c));
    accountFind.mockResolvedValue(account);
  });

  it("completa SEARCH com fluxo sem notificar BROADCAST_COMPLETED", async () => {
    flowHas.mockReturnValue(true);
    leadFindFirst.mockResolvedValue(null);
    leadCount.mockResolvedValue(0);
    await processFlowCampaign(campaign({ mode: "SEARCH", searchUrl: "SEARCH", flow: "[]" }));
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "COMPLETED" } }),
    );
    expect(notifyFn).not.toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_COMPLETED" }));
  });
});

describe("refreshAgentCountersForAll", () => {
  it("zera contadores de contas com agente", async () => {
    const accountFindMany = prisma.account.findMany as ReturnType<typeof vi.fn>;
    accountFindMany.mockResolvedValue([{ id: "A1", agentRepliesToday: 3, agentRepliesWeek: 9, agentRepliesDayDate: new Date(), agentRepliesWeekDate: new Date() }]);
    agentRefresh.mockResolvedValue({});
    await refreshAgentCountersForAll();
    expect(agentRefresh).toHaveBeenCalledWith(expect.objectContaining({ id: "A1" }));
  });
});
