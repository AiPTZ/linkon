import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { createLog } from "./log.service";
import { resolveInitialMessage } from "./chatbot-ai.service";
import { startOfLocalDay, startOfLocalWeek } from "../utils/time";
import { UnipileError } from "../utils/errors";
import type { Campaign, Lead } from "@prisma/client";

export async function refreshCounters(campaign: Campaign): Promise<Campaign> {
  const now = new Date();
  const today = startOfLocalDay(now);
  const week = startOfLocalWeek(now);
  const updates: { invitesSentToday?: number; dateOfInviteCount?: Date; invitesSentWeek?: number; weekStartDate?: Date } = {};

  if (!campaign.dateOfInviteCount || campaign.dateOfInviteCount < today) {
    updates.invitesSentToday = 0;
    updates.dateOfInviteCount = now;
  }
  if (!campaign.weekStartDate || campaign.weekStartDate < week) {
    updates.invitesSentWeek = 0;
    updates.weekStartDate = now;
  }

  if (Object.keys(updates).length === 0) return campaign;
  return prisma.campaign.update({ where: { id: campaign.id }, data: updates });
}

export function withinLimits(campaign: Campaign): boolean {
  return (
    campaign.invitesSentToday < campaign.dailyLimit &&
    campaign.invitesSentWeek < campaign.weeklyLimit
  );
}

export async function sendInvitation(campaign: Campaign, lead: Lead): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) {
    throw new Error(`Account ${campaign.accountId} nao encontrada`);
  }

  try {
    const message = await resolveInitialMessage(campaign, lead);
    const res = await unipile.sendInvitation(
      account.unipileAccountId,
      lead.providerId,
      message || undefined,
    );

    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "INVITED", invitedAt: new Date() },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { invitesSentToday: { increment: 1 }, invitesSentWeek: { increment: 1 } },
    });
    await createLog({
      type: "INVITE_SENT",
      message: `Convite enviado para ${lead.name ?? lead.providerId}`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { invitationId: res.invitation_id },
    });
  } catch (err) {
    if (err instanceof UnipileError && err.isLimitError()) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "LIMIT_HIT" } });
      await createLog({
        type: "RATE_LIMITED",
        level: "WARN",
        message: `Limite do LinkedIn atingido (${err.errorType}). Campanha pausada.`,
        campaignId: campaign.id,
        leadId: lead.id,
        accountId: account.id,
        payload: { error: err.message },
      });
      throw err;
    }
    if (err instanceof UnipileError && err.isDisconnected()) {
      await prisma.account.update({ where: { id: account.id }, data: { status: "DISCONNECTED" } });
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "PAUSED" } });
      await createLog({
        type: "ERROR",
        level: "ERROR",
        message: "Conta desconectada do LinkedIn. Campanhas pausadas.",
        campaignId: campaign.id,
        accountId: account.id,
        payload: { error: err.message },
      });
      throw err;
    }
    throw err;
  }
}
