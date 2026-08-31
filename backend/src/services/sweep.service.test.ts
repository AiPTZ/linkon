import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    lead: { upsert: vi.fn(), update: vi.fn() },
    campaign: { update: vi.fn() },
    account: { findUnique: vi.fn() },
    nativeAgent: { findUnique: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { getRelations: vi.fn(), sendDirectMessage: vi.fn() },
}));

vi.mock("./log.service", () => ({
  createLog: vi.fn(),
}));

vi.mock("./notification.service", () => ({
  notify: vi.fn(),
}));

vi.mock("../utils/time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/time")>();
  return { ...actual, sleep: () => Promise.resolve(), randomInt: () => 3_000 };
});

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { notify } from "./notification.service";
import {
  importLeadsFromSweep,
  previewRelations,
  sendSweepMessage,
  isEligibleForSweep,
} from "./sweep.service";
import { UnipileError } from "../utils/errors";
import type { Campaign, Lead, Account } from "@prisma/client";

const leadUpsert = prisma.lead.upsert as ReturnType<typeof vi.fn>;
const leadUpdate = prisma.lead.update as ReturnType<typeof vi.fn>;
const campaignUpdate = prisma.campaign.update as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const notifyFn = notify as ReturnType<typeof vi.fn>;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "C1",
    name: "Varredura",
    mode: "SWEEP",
    searchUrl: "SWEEP",
    status: "RUNNING",
    accountId: "A1",
    inviteMessage: "Olá da rede!",
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
    cadence: "[]",
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
    headline: "CTO",
    profileUrl: "https://linkedin.com/in/joao-silva",
    status: "PENDING",
    invitedAt: null,
    acceptedAt: null,
    lastMessageAt: null,
    lastMessageText: null,
    nextInviteAt: null,
    currentBlockId: null,
    replyCount: 0,
    cadenceStep: 0,
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

const rel = (overrides: Record<string, unknown> = {}) => ({
  object: "UserRelation",
  first_name: "João",
  last_name: "Silva",
  headline: "CTO",
  public_identifier: "joao-silva",
  public_profile_url: "https://linkedin.com/in/joao-silva",
  member_id: "ACoAAmember1",
  member_urn: "urn:li:fsd_profile:ACoAAmember1",
  connection_urn: "urn:li:fsd_connection:ACoAAmember1",
  ...overrides,
});

describe("importLeadsFromSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
  });

  it("paginates relations and upserts leads", async () => {
    (unipile.getRelations as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ object: "UserRelationsList", items: [rel()], cursor: "page2" })
      .mockResolvedValueOnce({ object: "UserRelationsList", items: [rel({ member_id: "ACoAAmember2", first_name: "Maria" })], cursor: null });

    const res = await importLeadsFromSweep(campaign());

    expect(unipile.getRelations).toHaveBeenCalledTimes(2);
    expect(unipile.getRelations).toHaveBeenNthCalledWith(1, "UA1", undefined, 1000);
    expect(unipile.getRelations).toHaveBeenNthCalledWith(2, "UA1", "page2", 1000);
    expect(leadUpsert).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ imported: 2, total: 2 });
  });

  it("stops at maxLeads", async () => {
    (unipile.getRelations as ReturnType<typeof vi.fn>).mockResolvedValue({
      object: "UserRelationsList",
      items: [rel()],
      cursor: "page2",
    });

    const res = await importLeadsFromSweep(campaign({ maxLeads: 1 }));

    expect(res.imported).toBe(1);
    expect(unipile.getRelations).toHaveBeenCalledTimes(1);
  });
});

describe("previewRelations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts relations and returns a sample", async () => {
    (unipile.getRelations as ReturnType<typeof vi.fn>).mockResolvedValue({
      object: "UserRelationsList",
      items: [rel(), rel({ member_id: "ACoAAmember2" })],
      cursor: null,
    });

    const res = await previewRelations("UA1", 5000);

    expect(res.total).toBe(2);
    expect(res.capped).toBe(false);
    expect(res.sample).toHaveLength(2);
    expect(res.sample[0].name).toBe("João Silva");
  });

  it("caps the count", async () => {
    const big = Array.from({ length: 1500 }, (_, i) => rel({ member_id: `ACoAA${i}` }));
    (unipile.getRelations as ReturnType<typeof vi.fn>).mockResolvedValue({
      object: "UserRelationsList",
      items: big,
      cursor: null,
    });

    const res = await previewRelations("UA1", 1000);

    expect(res.total).toBe(1000);
    expect(res.capped).toBe(true);
    expect(res.sample).toHaveLength(5);
  });
});

describe("sendSweepMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
    (unipile.sendDirectMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ chat_id: "chat1" });
  });

  it("sends a DM and completes the lead", async () => {
    await sendSweepMessage(campaign(), lead());

    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "ACoAAmember1", "Olá da rede!");
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "L1" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "C1" },
        data: { invitesSentToday: { increment: 1 }, invitesSentWeek: { increment: 1 } },
      }),
    );
  });

  it("throws on empty message", async () => {
    await expect(sendSweepMessage(campaign({ inviteMessage: "  " }), lead())).rejects.toThrow(
      "vazia",
    );
    expect(unipile.sendDirectMessage).not.toHaveBeenCalled();
  });

  it("pauses the campaign on LinkedIn limit error", async () => {
    (unipile.sendDirectMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnipileError(422, "errors/limit_exceeded", "limit"),
    );

    await expect(sendSweepMessage(campaign(), lead())).rejects.toThrow("limit");

    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "C1" },
        data: expect.objectContaining({ status: "LIMIT_HIT" }),
      }),
    );
  });

  it("não notifica BROADCAST_LIMIT_HIT em SWEEP legado", async () => {
    (unipile.sendDirectMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnipileError(422, "errors/limit_exceeded", "limit"),
    );

    await expect(sendSweepMessage(campaign({ mode: "SWEEP", searchUrl: "SWEEP" }), lead())).rejects.toThrow(
      "limit",
    );

    expect(notifyFn).not.toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_LIMIT_HIT" }));
  });

  it("notifica BROADCAST_LIMIT_HIT em DISPARO", async () => {
    (unipile.sendDirectMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnipileError(422, "errors/limit_exceeded", "limit"),
    );

    await expect(
      sendSweepMessage(campaign({ mode: "DISPARO", searchUrl: "DISPARO", inviteMessage: "Olá {nome}!" }), lead()),
    ).rejects.toThrow("limit");

    expect(notifyFn).toHaveBeenCalledWith(expect.objectContaining({ type: "BROADCAST_LIMIT_HIT" }));
  });
});

describe("sendSweepMessage com cadência", () => {
  const cadenceCampaign = (cadence: unknown) =>
    campaign({
      mode: "DISPARO",
      searchUrl: "DISPARO",
      cadence: JSON.stringify(cadence),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    accountFind.mockResolvedValue(account);
    (unipile.sendDirectMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ chat_id: "chat1" });
  });

  it("usa cadence[step] com placeholders e incrementa cadenceStep", async () => {
    await sendSweepMessage(
      cadenceCampaign([
        { body: "Oi {nome}", waitDays: 3 },
        { body: "Ainda {nome}?", waitDays: 5 },
      ]),
      lead({ status: "PENDING", cadenceStep: 0 }),
    );

    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "ACoAAmember1", "Oi João Silva");
    const update = leadUpdate.mock.calls[0][0] as {
      data: { cadenceStep: number; nextInviteAt: Date };
    };
    expect(update.data.cadenceStep).toBe(1);
    const next = update.data.nextInviteAt.getTime();
    expect(next).toBeGreaterThan(Date.now() + 3 * 86_400_000 - 60_000);
    expect(next).toBeLessThan(Date.now() + 3 * 86_400_000 + 60_000);
  });

  it("não agenda próxima cópia na última mensagem da cadência", async () => {
    await sendSweepMessage(
      cadenceCampaign([{ body: "c1", waitDays: 2 }]),
      lead({ status: "PENDING", cadenceStep: 0 }),
    );

    const update = leadUpdate.mock.calls[0][0] as {
      data: { cadenceStep: number; nextInviteAt: Date | null };
    };
    expect(update.data.cadenceStep).toBe(1);
    expect(update.data.nextInviteAt).toBeNull();
  });

  it("envia a cópia do passo atual para lead COMPLETED em cadência", async () => {
    await sendSweepMessage(
      cadenceCampaign([
        { body: "c1", waitDays: 2 },
        { body: "c2", waitDays: 4 },
      ]),
      lead({ status: "COMPLETED", cadenceStep: 1 }),
    );

    expect(unipile.sendDirectMessage).toHaveBeenCalledWith("UA1", "ACoAAmember1", "c2");
    const update = leadUpdate.mock.calls[0][0] as {
      data: { cadenceStep: number };
    };
    expect(update.data.cadenceStep).toBe(2);
  });
});

describe("isEligibleForSweep", () => {
  const twoCopy = campaign({
    cadence: JSON.stringify([
      { body: "c1", waitDays: 2 },
      { body: "c2", waitDays: 2 },
    ]),
  });

  it("aceita lead PENDING (cópia 1)", () => {
    expect(isEligibleForSweep(lead({ status: "PENDING" }), campaign())).toBe(true);
  });

  it("rejeita lead RESPONDED", () => {
    expect(isEligibleForSweep(lead({ status: "RESPONDED" }), campaign())).toBe(false);
  });

  it("rejeita lead COMPLETED sem cadência", () => {
    expect(isEligibleForSweep(lead({ status: "COMPLETED", cadenceStep: 1 }), campaign())).toBe(false);
  });

  it("aceita lead COMPLETED em cadência com passo restante", () => {
    expect(isEligibleForSweep(lead({ status: "COMPLETED", cadenceStep: 1 }), twoCopy)).toBe(true);
  });

  it("rejeita lead COMPLETED no fim da cadência", () => {
    expect(isEligibleForSweep(lead({ status: "COMPLETED", cadenceStep: 2 }), twoCopy)).toBe(false);
  });

  it("rejeita lead com currentBlockId", () => {
    expect(isEligibleForSweep(lead({ status: "PENDING", currentBlockId: "B1" }), campaign())).toBe(false);
  });
});
