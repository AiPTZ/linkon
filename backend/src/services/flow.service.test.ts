import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    lead: { update: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    campaign: { update: vi.fn(), findUnique: vi.fn() },
    account: { findUnique: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { sendInvitation: vi.fn(), sendDirectMessage: vi.fn() },
}));

vi.mock("./log.service", () => ({
  createLog: vi.fn(),
}));

vi.mock("./notification.service", () => ({
  notify: vi.fn(),
}));

vi.mock("../utils/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/time")>();
  return { ...actual, randomDelayMs: () => 300_000 };
});

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { processFlowStep, validateFlow, parseFlow, hasFlow } from "./flow.service";
import { notify } from "./notification.service";
import { UnipileError } from "../utils/errors";
import type { Campaign, Lead, Account } from "@prisma/client";

const leadUpdate = prisma.lead.update as ReturnType<typeof vi.fn>;
const campaignUpdate = prisma.campaign.update as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;

function makeFlow(flow: { nodes: unknown[]; edges: unknown[] }): string {
  return JSON.stringify(flow);
}

function baseCampaign(flow: string): Campaign {
  return {
    id: "C1",
    name: "Teste",
    mode: "SEARCH",
    searchUrl: "https://linkedin.com/search",
    status: "RUNNING",
    accountId: "A1",
    inviteMessage: "",
    dailyLimit: 40,
    weeklyLimit: 150,
    minDelayMin: 5,
    maxDelayMin: 15,
    workStartHour: 9,
    workEndHour: 18,
    flow,
    invitesSentToday: 0,
    dateOfInviteCount: null,
    invitesSentWeek: 0,
    weekStartDate: null,
    maxLeads: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Campaign;
}

function baseLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "L1",
    campaignId: "C1",
    providerId: "u:abc",
    publicIdentifier: null,
    name: "Fulano",
    headline: null,
    profileUrl: null,
    status: "PENDING",
    invitedAt: null,
    acceptedAt: null,
    lastMessageAt: null,
    lastMessageText: null,
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

const simpleFlow = makeFlow({
  nodes: [
    { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
    { id: "i1", type: "invite", position: { x: 0, y: 100 }, data: { message: "Olá" } },
    { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
  ],
  edges: [
    { id: "e1", source: "s1", target: "i1" },
    { id: "e2", source: "i1", target: "t1" },
  ],
});

const acceptFlow = makeFlow({
  nodes: [
    { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
    { id: "i1", type: "invite", position: { x: 0, y: 100 }, data: { message: "Olá" } },
    { id: "oa", type: "on_accept", position: { x: 0, y: 200 }, data: {} },
    { id: "m1", type: "message", position: { x: 0, y: 300 }, data: { message: "Obrigado!" } },
    { id: "t1", type: "stop", position: { x: 0, y: 400 }, data: {} },
  ],
  edges: [
    { id: "e1", source: "s1", target: "i1" },
    { id: "e2", source: "i1", target: "oa" },
    { id: "e3", source: "oa", target: "m1" },
    { id: "e4", source: "m1", target: "t1" },
  ],
});

describe("validateFlow", () => {
  it("accepts an empty flow (fallback)", () => {
    const res = validateFlow("{}");
    expect(res.ok).toBe(true);
  });

  it("rejects missing start node", () => {
    const res = validateFlow(
      JSON.stringify({ nodes: [{ id: "i", type: "invite", position: { x: 0, y: 0 }, data: { message: "oi" } }], edges: [] }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toContain("Início");
  });

  it("rejects disconnected nodes", () => {
    const res = validateFlow(
      JSON.stringify({
        nodes: [
          { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
          { id: "m", type: "message", position: { x: 0, y: 100 }, data: { message: "oi" } },
        ],
        edges: [],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toContain("conectado");
  });

  it("rejects invite block without text", () => {
    const res = validateFlow(
      JSON.stringify({
        nodes: [
          { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
          { id: "i", type: "invite", position: { x: 0, y: 100 }, data: { message: "" } },
        ],
        edges: [{ id: "e", source: "s", target: "i" }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toContain("texto");
  });

  it("accepts invite block without text when noMessage is set", () => {
    const res = validateFlow(
      JSON.stringify({
        nodes: [
          { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
          { id: "i", type: "invite", position: { x: 0, y: 100 }, data: { noMessage: true } },
        ],
        edges: [{ id: "e", source: "s", target: "i" }],
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("still rejects message block without text", () => {
    const res = validateFlow(
      JSON.stringify({
        nodes: [
          { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
          { id: "m", type: "message", position: { x: 0, y: 100 }, data: {} },
        ],
        edges: [{ id: "e", source: "s", target: "m" }],
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join()).toContain("texto");
  });
});

describe("parseFlow / hasFlow", () => {
  it("returns empty flow for invalid input", () => {
    const flow = parseFlow("not-json");
    expect(flow.nodes).toEqual([]);
    expect(hasFlow("")).toBe(false);
  });

  it("detects a populated flow", () => {
    expect(hasFlow(simpleFlow)).toBe(true);
  });
});

describe("processFlowStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (unipile.sendInvitation as ReturnType<typeof vi.fn>).mockResolvedValue({ invitation_id: "x" });
  });

  it("runs start -> invite -> stop and marks lead COMPLETED", async () => {
    const lead = baseLead();
    await processFlowStep(baseCampaign(simpleFlow), account, lead, parseFlow(simpleFlow));

    const updates = leadUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(updates.some((d) => d.status === "INVITED")).toBe(true);
    expect(unipile.sendInvitation).toHaveBeenCalledWith("UA1", "u:abc", "Olá");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "C1" },
        data: { invitesSentToday: { increment: 1 }, invitesSentWeek: { increment: 1 } },
      }),
    );

    const lastUpdate = leadUpdate.mock.calls.at(-1)![0] as { data: { currentBlockId: string } };
    expect(lastUpdate.data.currentBlockId).toBe("t1");

    vi.clearAllMocks();
    const atStop = baseLead({ status: "INVITED", currentBlockId: "t1" });
    await processFlowStep(baseCampaign(simpleFlow), account, atStop, parseFlow(simpleFlow));
    expect(
      leadUpdate.mock.calls.some((c) => (c[0] as { data: Record<string, unknown> }).data.status === "COMPLETED"),
    ).toBe(true);
  });

  it("does not resend invite when lead already INVITED", async () => {
    const lead = baseLead({ status: "INVITED", currentBlockId: "i1" });
    await processFlowStep(baseCampaign(simpleFlow), account, lead, parseFlow(simpleFlow));

    expect(unipile.sendInvitation).not.toHaveBeenCalled();
    const updates = leadUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(updates.some((d) => d.status === "COMPLETED")).toBe(true);
  });

  it("sends invite without a message when noMessage is set", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "i1", type: "invite", position: { x: 0, y: 100 }, data: { noMessage: true } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "i1" },
        { id: "e2", source: "i1", target: "t1" },
      ],
    });
    const lead = baseLead();
    await processFlowStep(baseCampaign(flow), account, lead, parseFlow(flow));

    expect(unipile.sendInvitation).toHaveBeenCalledWith("UA1", "u:abc", undefined);
    const updates = leadUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(updates.some((d) => d.status === "INVITED")).toBe(true);
  });

  it("falls back to campaign inviteMessage when invite block has no text", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "i1", type: "invite", position: { x: 0, y: 100 }, data: {} },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "i1" },
        { id: "e2", source: "i1", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.inviteMessage = "Mensagem padrão da campanha";
    await processFlowStep(campaign, account, baseLead(), parseFlow(flow));

    expect(unipile.sendInvitation).toHaveBeenCalledWith("UA1", "u:abc", "Mensagem padrão da campanha");
  });

  it("pauses campaign on LinkedIn limit error", async () => {
    (unipile.sendInvitation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnipileError(422, "errors/limit_exceeded", "limit"),
    );

    const lead = baseLead();
    await processFlowStep(baseCampaign(simpleFlow), account, lead, parseFlow(simpleFlow));

    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "C1" },
        data: expect.objectContaining({ status: "LIMIT_HIT" }),
      }),
    );
  });

  it("waits at on_accept until lead accepts, then sends message", async () => {
    const campaign = baseCampaign(acceptFlow);
    const pendingLead = baseLead({ status: "PENDING", currentBlockId: "oa" });
    await processFlowStep(campaign, account, pendingLead, parseFlow(acceptFlow));
    expect(unipile.sendInvitation).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const acceptedLead = baseLead({ status: "ACCEPTED", currentBlockId: "oa" });
    await processFlowStep(campaign, account, acceptedLead, parseFlow(acceptFlow));

    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "u:abc", "Obrigado!");
  });

  it("waits at on_reply until lead responds, then continues", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "or", type: "on_reply", position: { x: 0, y: 100 }, data: {} },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "or" },
        { id: "e2", source: "or", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);

    const notReplied = baseLead({ status: "INVITED", currentBlockId: "or" });
    await processFlowStep(campaign, account, notReplied, parseFlow(flow));
    expect(leadUpdate.mock.calls.some((c) => (c[0] as { data: Record<string, unknown> }).data.status === "COMPLETED")).toBe(false);

    vi.clearAllMocks();
    const replied = baseLead({ status: "RESPONDED", currentBlockId: "or" });
    await processFlowStep(campaign, account, replied, parseFlow(flow));
    expect(leadUpdate.mock.calls.some((c) => (c[0] as { data: Record<string, unknown> }).data.status === "COMPLETED")).toBe(true);
  });

  it("evaluates condition and follows the 'contains' branch", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        {
          id: "c1",
          type: "condition",
          position: { x: 0, y: 100 },
          data: { conditionType: "contains", keyword: "preço" },
        },
        { id: "tSim", type: "stop", position: { x: 0, y: 200 }, data: {} },
        { id: "tNao", type: "stop", position: { x: 0, y: 300 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "c1" },
        { id: "e2", source: "c1", target: "tSim", sourceHandle: "sim" },
        { id: "e3", source: "c1", target: "tNao", sourceHandle: "nao" },
      ],
    });
    const campaign = baseCampaign(flow);
    const lead = baseLead({ status: "RESPONDED", currentBlockId: "c1", lastMessageText: "Qual o preço?" });
    await processFlowStep(campaign, account, lead, parseFlow(flow));

    expect(leadUpdate.mock.calls.some((c) => (c[0] as { data: Record<string, unknown> }).data.status === "COMPLETED")).toBe(true);
  });

  it("sets a future nextInviteAt on the wait block", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "w1", type: "wait", position: { x: 0, y: 100 }, data: { minutes: 120 } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "w1" },
        { id: "e2", source: "w1", target: "t1" },
      ],
    });
    const lead = baseLead({ currentBlockId: "w1" });
    await processFlowStep(baseCampaign(flow), account, lead, parseFlow(flow));

    const update = leadUpdate.mock.calls.find(
      (c) => (c[0] as { data: Record<string, unknown> }).data.currentBlockId === "t1",
    );
    expect(update).toBeDefined();
    const nextInviteAt = (update![0] as { data: { nextInviteAt: Date } }).data.nextInviteAt;
    expect(nextInviteAt.getTime()).toBeGreaterThan(Date.now() + 1000 * 60 * 60);
  });

  it("sweep: invite block sends a direct message (no invitation)", async () => {
    const sweepFlow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "i1", type: "invite", position: { x: 0, y: 100 }, data: { message: "Olá da varredura" } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "i1" },
        { id: "e2", source: "i1", target: "t1" },
      ],
    });
    const campaign = baseCampaign(sweepFlow);
    campaign.mode = "SWEEP";
    const lead = baseLead();

    await processFlowStep(campaign, account, lead, parseFlow(sweepFlow));

    expect(unipile.sendInvitation).not.toHaveBeenCalled();
    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "u:abc", "Olá da varredura");
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "C1" },
        data: { invitesSentToday: { increment: 1 }, invitesSentWeek: { increment: 1 } },
      }),
    );
  });

  it("sweep: message block sends to a PENDING lead", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m1", type: "message", position: { x: 0, y: 100 }, data: { message: "Oi" } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "m1" },
        { id: "e2", source: "m1", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "SWEEP";

    await processFlowStep(campaign, account, baseLead(), parseFlow(flow));

    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "u:abc", "Oi");
  });

  it("search: message block waits for ACCEPTED/RESPONDED before sending", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m1", type: "message", position: { x: 0, y: 100 }, data: { message: "Oi" } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "m1" },
        { id: "e2", source: "m1", target: "t1" },
      ],
    });

    await processFlowStep(baseCampaign(flow), account, baseLead(), parseFlow(flow));

    expect(unipile.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("sweep: on_accept passes through immediately for PENDING leads", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "oa", type: "on_accept", position: { x: 0, y: 100 }, data: {} },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "oa" },
        { id: "e2", source: "oa", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "SWEEP";

    await processFlowStep(campaign, account, baseLead({ currentBlockId: "oa" }), parseFlow(flow));

    const updates = leadUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(updates.some((d) => d.status === "COMPLETED")).toBe(true);
  });

  it("disparo: invite block sends a direct message (no invitation)", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "i1", type: "invite", position: { x: 0, y: 100 }, data: { message: "Olá do disparo" } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "i1" },
        { id: "e2", source: "i1", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "DISPARO";

    await processFlowStep(campaign, account, baseLead(), parseFlow(flow));

    expect(unipile.sendInvitation).not.toHaveBeenCalled();
    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "u:abc", "Olá do disparo");
  });

  it("disparo: message block sends to a PENDING lead", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m1", type: "message", position: { x: 0, y: 100 }, data: { message: "Oi" } },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "m1" },
        { id: "e2", source: "m1", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "DISPARO";

    await processFlowStep(campaign, account, baseLead(), parseFlow(flow));

    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "u:abc", "Oi");
  });

  it("disparo: on_accept passes through immediately for PENDING leads", async () => {
    const flow = makeFlow({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "oa", type: "on_accept", position: { x: 0, y: 100 }, data: {} },
        { id: "t1", type: "stop", position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "s1", target: "oa" },
        { id: "e2", source: "oa", target: "t1" },
      ],
    });
    const campaign = baseCampaign(flow);
    campaign.mode = "DISPARO";

    await processFlowStep(campaign, account, baseLead({ currentBlockId: "oa" }), parseFlow(flow));

    const updates = leadUpdate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);
    expect(updates.some((d) => d.status === "COMPLETED")).toBe(true);
  });

  it("disparo: notifies BROADCAST_LIMIT_HIT on DM limit error, search does not", async () => {
    (unipile.sendDirectMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnipileError(422, "errors/limit_exceeded", "limit"),
    );

    const disparoCampaign = baseCampaign(acceptFlow);
    disparoCampaign.mode = "DISPARO";
    disparoCampaign.searchUrl = "DISPARO";
    const disparoLead = baseLead({ status: "ACCEPTED", currentBlockId: "oa" });
    await processFlowStep(disparoCampaign, account, disparoLead, parseFlow(acceptFlow));

    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "C1" },
        data: expect.objectContaining({ status: "LIMIT_HIT" }),
      }),
    );
    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_LIMIT_HIT" }));

    vi.clearAllMocks();

    const searchCampaign = baseCampaign(acceptFlow);
    const searchLead = baseLead({ status: "ACCEPTED", currentBlockId: "oa" });
    await processFlowStep(searchCampaign, account, searchLead, parseFlow(acceptFlow));

    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "C1" },
        data: expect.objectContaining({ status: "LIMIT_HIT" }),
      }),
    );
    expect(notifyFn).not.toHaveBeenCalled();
  });
});
