import { prisma } from "../lib/prisma";
import { startOfLocalDay, startOfLocalWeek } from "../utils/time";

export interface AgentCounterState {
  id: string;
  agentRepliesToday: number;
  agentRepliesWeek: number;
  agentRepliesDayDate: Date | null;
  agentRepliesWeekDate: Date | null;
}

export async function refreshAgentCounters(account: AgentCounterState): Promise<AgentCounterState> {
  const now = new Date();
  const today = startOfLocalDay(now);
  const week = startOfLocalWeek(now);
  const updates: {
    agentRepliesToday?: number;
    agentRepliesDayDate?: Date;
    agentRepliesWeek?: number;
    agentRepliesWeekDate?: Date;
  } = {};

  if (!account.agentRepliesDayDate || account.agentRepliesDayDate < today) {
    updates.agentRepliesToday = 0;
    updates.agentRepliesDayDate = now;
  }
  if (!account.agentRepliesWeekDate || account.agentRepliesWeekDate < week) {
    updates.agentRepliesWeek = 0;
    updates.agentRepliesWeekDate = now;
  }

  if (Object.keys(updates).length === 0) return account;
  return prisma.account.update({ where: { id: account.id }, data: updates });
}

export function agentWithinLimits(input: {
  agent: { replyDailyLimit: number; replyWeeklyLimit: number };
  account: { agentRepliesToday: number; agentRepliesWeek: number };
}): { ok: boolean; reason?: string } {
  if (input.account.agentRepliesToday >= input.agent.replyDailyLimit) {
    return { ok: false, reason: "limite diário de respostas atingido" };
  }
  if (input.account.agentRepliesWeek >= input.agent.replyWeeklyLimit) {
    return { ok: false, reason: "limite semanal de respostas atingido" };
  }
  return { ok: true };
}
