import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: { account: { update: vi.fn() } },
}));

import { prisma } from "../lib/prisma";
import { refreshAgentCounters, agentWithinLimits } from "./native-agent.service";

const accountUpdate = prisma.account.update as ReturnType<typeof vi.fn>;

const base = {
  id: "A1",
  agentRepliesToday: 42,
  agentRepliesWeek: 100,
  agentRepliesDayDate: new Date("2026-08-28T10:00:00Z"),
  agentRepliesWeekDate: new Date("2026-08-17T10:00:00Z"),
};

beforeEach(() => vi.clearAllMocks());

describe("refreshAgentCounters", () => {
  it("não reseta quando dia e semana não mudaram", async () => {
    const account = { ...base, agentRepliesDayDate: new Date(), agentRepliesWeekDate: new Date() };
    const result = await refreshAgentCounters(account);
    expect(result).toBe(account);
    expect(accountUpdate).not.toHaveBeenCalled();
  });

  it("zera o contador diário quando a data de reset é de outro dia", async () => {
    const account = { ...base, agentRepliesWeekDate: new Date() };
    accountUpdate.mockResolvedValue({ ...account, agentRepliesToday: 0 });
    const result = await refreshAgentCounters(account);
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: "A1" },
      data: expect.objectContaining({ agentRepliesToday: 0 }),
    });
    expect(result.agentRepliesToday).toBe(0);
  });

  it("zera o contador semanal quando a semana mudou", async () => {
    const account = { ...base, agentRepliesDayDate: new Date() };
    accountUpdate.mockResolvedValue({ ...account, agentRepliesWeek: 0 });
    const result = await refreshAgentCounters(account);
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: "A1" },
      data: expect.objectContaining({ agentRepliesWeek: 0 }),
    });
    expect(result.agentRepliesWeek).toBe(0);
  });
});

describe("agentWithinLimits", () => {
  it("permite responder quando abaixo dos limites", () => {
    expect(agentWithinLimits({ agent: { replyDailyLimit: 100, replyWeeklyLimit: 400 }, account: { agentRepliesToday: 5, agentRepliesWeek: 10 } })).toEqual({ ok: true });
  });

  it("bloqueia ao atingir o limite diário", () => {
    const r = agentWithinLimits({ agent: { replyDailyLimit: 100, replyWeeklyLimit: 400 }, account: { agentRepliesToday: 100, agentRepliesWeek: 10 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("limite diário de respostas atingido");
  });

  it("bloqueia ao atingir o limite semanal", () => {
    const r = agentWithinLimits({ agent: { replyDailyLimit: 100, replyWeeklyLimit: 400 }, account: { agentRepliesToday: 10, agentRepliesWeek: 400 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("limite semanal de respostas atingido");
  });
});
