import cron from "node-cron";
import { prisma } from "./lib/prisma";
import { invitesQueue, sweepQueue } from "./services/queue.service";
import { refreshCounters, withinLimits } from "./services/invite.service";
import { hasFlow, parseFlow, processFlowStep } from "./services/flow.service";
import { createLog } from "./services/log.service";
import { notify } from "./services/notification.service";
import { refreshAgentCounters } from "./services/native-agent.service";
import { logger } from "./utils/logger";
import { randomDelayMs, isWorkHour } from "./utils/time";
import type { Campaign } from "@prisma/client";

export function startScheduler(): void {
  cron.schedule("*/5 * * * *", async () => {
    try {
      await Promise.all([processCampaigns(), refreshAgentCountersForAll()]);
    } catch (err) {
      logger.error("scheduler error", err);
    }
  });
  logger.info("Scheduler started (runs every 5 minutes)");
}

async function processCampaigns(): Promise<void> {
  const campaigns = await prisma.campaign.findMany({ where: { status: "RUNNING" } });

  for (const campaign of campaigns) {
    try {
      const connected = campaign.mode === "SWEEP" || campaign.mode === "DISPARO";
      if (connected) {
        if (hasFlow(campaign.flow)) {
          await processFlowCampaign(campaign);
        } else {
          await processBroadcastCampaign(campaign);
        }
        continue;
      }
      if (hasFlow(campaign.flow)) {
        await processFlowCampaign(campaign);
      } else {
        await processInviteCampaign(campaign);
      }
    } catch (err) {
      logger.error(`scheduler error for campaign ${campaign.id}`, err);
    }
  }
}

export async function refreshAgentCountersForAll(): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { nativeAgent: { isNot: null } },
    select: {
      id: true,
      agentRepliesToday: true,
      agentRepliesWeek: true,
      agentRepliesDayDate: true,
      agentRepliesWeekDate: true,
    },
  });
  for (const account of accounts) {
    await refreshAgentCounters(account);
  }
}

export async function processFlowCampaign(campaign: Campaign): Promise<void> {
  const fresh = await refreshCounters(campaign);
  const now = new Date();
  const selectedFilter = fresh.mode === "DISPARO" ? { selected: true } : {};

  if (fresh.invitesSentWeek >= fresh.weeklyLimit) {
    await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "LIMIT_HIT" } });
    await createLog({
      type: "RATE_LIMITED",
      level: "WARN",
      message: `Limite semanal de ${fresh.weeklyLimit} ações atingido. Campanha pausada.`,
      campaignId: fresh.id,
    });
    if (fresh.mode === "DISPARO") {
      await notify({
        accountId: fresh.accountId,
        campaignId: fresh.id,
        type: "BROADCAST_LIMIT_HIT",
        level: "WARN",
        message: `Campanha "${fresh.name}" pausada: limite semanal de ${fresh.weeklyLimit} ações atingido.`,
      });
    }
    return;
  }
  if (fresh.invitesSentToday >= fresh.dailyLimit) {
    logger.info(`Campaign ${fresh.id} reached daily limit; waiting for next day`);
    return;
  }
  if (!isWorkHour(now, fresh.workStartHour, fresh.workEndHour)) {
    return;
  }

  const account = await prisma.account.findUnique({ where: { id: fresh.accountId } });
  if (!account) return;
  if (account.status === "DISCONNECTED") {
    await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "PAUSED" } });
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: "Conta desconectada do LinkedIn. Campanhas pausadas.",
      campaignId: fresh.id,
      accountId: account.id,
    });
    return;
  }

  const due = await prisma.lead.findFirst({
    where: {
      campaignId: fresh.id,
      status: { in: ["PENDING", "INVITED", "ACCEPTED", "RESPONDED"] },
      ...selectedFilter,
      OR: [
        { status: "PENDING", currentBlockId: null, nextInviteAt: null },
        {
          currentBlockId: { not: null },
          OR: [{ nextInviteAt: null }, { nextInviteAt: { lte: now } }],
        },
      ],
    },
    orderBy: [{ nextInviteAt: "asc" }, { createdAt: "asc" }],
  });

  if (!due) {
    const active = await prisma.lead.count({
      where: {
        campaignId: fresh.id,
        status: { in: ["PENDING", "INVITED", "ACCEPTED", "RESPONDED"] },
        ...selectedFilter,
      },
    });
    if (active === 0) {
      await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "COMPLETED" } });
      logger.info(`Campaign ${fresh.id} completed (flow)`);
      if (fresh.mode === "DISPARO") {
        await notify({
          accountId: fresh.accountId,
          campaignId: fresh.id,
          type: "BROADCAST_COMPLETED",
          level: "INFO",
          message: `Disparo "${fresh.name}" concluído com sucesso.`,
        });
      }
    }
    return;
  }

  const flow = parseFlow(fresh.flow);
  await processFlowStep(fresh, account, due, flow);
}

export async function processInviteCampaign(campaign: Campaign): Promise<void> {
  const fresh = await refreshCounters(campaign);
  const now = new Date();

  if (fresh.invitesSentWeek >= fresh.weeklyLimit) {
    await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "LIMIT_HIT" } });
    await createLog({
      type: "RATE_LIMITED",
      level: "WARN",
      message: `Limite semanal de ${fresh.weeklyLimit} convites atingido. Campanha pausada.`,
      campaignId: fresh.id,
    });
    return;
  }
  if (fresh.invitesSentToday >= fresh.dailyLimit) {
    return;
  }
  if (!isWorkHour(now, fresh.workStartHour, fresh.workEndHour)) {
    return;
  }

  const due = await prisma.lead.findFirst({
    where: {
      campaignId: fresh.id,
      status: "PENDING",
      OR: [{ nextInviteAt: null }, { nextInviteAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
  });

  if (!due) {
    const remaining = await prisma.lead.count({
      where: { campaignId: fresh.id, status: "PENDING" },
    });
    if (remaining === 0) {
      await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "COMPLETED" } });
      logger.info(`Campaign ${fresh.id} completed`);
    }
    return;
  }

  if (!withinLimits(fresh)) return;

  const lastScheduled = await prisma.lead.findFirst({
    where: { campaignId: fresh.id, nextInviteAt: { not: null } },
    orderBy: { nextInviteAt: "desc" },
    select: { nextInviteAt: true },
  });
  let delay: number;
  if (!lastScheduled?.nextInviteAt) {
    delay = 0;
  } else {
    const intervalMs = fresh.maxDelayMin * 60_000;
    delay = Math.max(0, lastScheduled.nextInviteAt.getTime() + intervalMs - Date.now());
  }
  await prisma.lead.update({
    where: { id: due.id },
    data: { nextInviteAt: new Date(Date.now() + delay) },
  });
  await invitesQueue.add(
    "invite",
    { leadId: due.id, campaignId: fresh.id },
    {
      delay,
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  );
  logger.info(`Scheduled invite for lead ${due.id} in ${Math.round(delay / 60000)} min`);
}

export async function processBroadcastCampaign(campaign: Campaign): Promise<void> {
  const fresh = await refreshCounters(campaign);
  const now = new Date();
  const selectedFilter = campaign.mode === "DISPARO" ? { selected: true } : {};

  if (fresh.invitesSentWeek >= fresh.weeklyLimit) {
    await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "LIMIT_HIT" } });
    await createLog({
      type: "RATE_LIMITED",
      level: "WARN",
      message: `Limite semanal de ${fresh.weeklyLimit} mensagens atingido. Disparo pausado.`,
      campaignId: fresh.id,
    });
    if (campaign.mode === "DISPARO") {
      await notify({
        accountId: fresh.accountId,
        campaignId: fresh.id,
        type: "BROADCAST_LIMIT_HIT",
        level: "WARN",
        message: `Disparo "${fresh.name}" pausado: limite semanal de ${fresh.weeklyLimit} mensagens atingido.`,
      });
    }
    return;
  }
  if (fresh.invitesSentToday >= fresh.dailyLimit) {
    return;
  }
  if (!isWorkHour(now, fresh.workStartHour, fresh.workEndHour)) {
    return;
  }
  if (!String(fresh.inviteMessage ?? "").trim()) {
    return;
  }

  const account = await prisma.account.findUnique({ where: { id: fresh.accountId } });
  if (!account) return;
  if (account.status === "DISCONNECTED") {
    await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "PAUSED" } });
    await createLog({
      type: "ERROR",
      level: "ERROR",
      message: "Conta desconectada do LinkedIn. Campanhas pausadas.",
      campaignId: fresh.id,
      accountId: account.id,
    });
    return;
  }

  const due = await prisma.lead.findFirst({
    where: {
      campaignId: fresh.id,
      status: "PENDING",
      currentBlockId: null,
      ...selectedFilter,
      OR: [{ nextInviteAt: null }, { nextInviteAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
  });

  if (!due) {
    const remaining = await prisma.lead.count({
      where: { campaignId: fresh.id, status: "PENDING", currentBlockId: null, ...selectedFilter },
    });
    if (remaining === 0) {
      await prisma.campaign.update({ where: { id: fresh.id }, data: { status: "COMPLETED" } });
      await createLog({
        type: "CAMPAIGN_COMPLETED",
        message: `Disparo "${fresh.name}" concluído`,
        campaignId: fresh.id,
      });
      if (campaign.mode === "DISPARO") {
        await notify({
          accountId: fresh.accountId,
          campaignId: fresh.id,
          type: "BROADCAST_COMPLETED",
          level: "INFO",
          message: `Disparo "${fresh.name}" concluído com sucesso.`,
        });
      }
      logger.info(`Campaign ${fresh.id} completed (broadcast)`);
    }
    return;
  }

  if (!withinLimits(fresh)) return;

  let delay: number;
  if (fresh.mode === "DISPARO") {
    const lastScheduled = await prisma.lead.findFirst({
      where: { campaignId: fresh.id, nextInviteAt: { not: null } },
      orderBy: { nextInviteAt: "desc" },
      select: { nextInviteAt: true },
    });
    if (!lastScheduled?.nextInviteAt) {
      delay = 0;
    } else {
      const intervalMs = fresh.maxDelayMin * 60_000;
      delay = Math.max(0, lastScheduled.nextInviteAt.getTime() + intervalMs - Date.now());
    }
  } else {
    delay = randomDelayMs(fresh.minDelayMin, fresh.maxDelayMin);
  }
  await prisma.lead.update({
    where: { id: due.id },
    data: { nextInviteAt: new Date(Date.now() + delay) },
  });
  await sweepQueue.add(
    "sweep",
    { leadId: due.id, campaignId: fresh.id },
    {
      delay,
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    },
  );
  logger.info(`Scheduled sweep message for lead ${due.id} in ${Math.round(delay / 60000)} min`);
}
