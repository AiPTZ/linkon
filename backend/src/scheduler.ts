import cron from "node-cron";
import { prisma } from "./lib/prisma";
import { invitesQueue, sweepQueue } from "./services/queue.service";
import { refreshCounters, withinLimits } from "./services/invite.service";
import { hasFlow, parseFlow, processFlowStep, advanceOnEvent } from "./services/flow.service";
import { createLog } from "./services/log.service";
import { notify } from "./services/notification.service";
import { refreshAgentCounters } from "./services/native-agent.service";
import { upsertRelationContact, relationName } from "./services/network.service";
import { unipile } from "./services/unipile.service";
import { logger } from "./utils/logger";
import { randomDelayMs, isWorkHour, sleep } from "./utils/time";
import { parseCadence } from "./utils/cadence";
import type { Campaign, Lead } from "@prisma/client";

const lastAcceptReconcileAt = new Map<string, number>();
const ACCEPT_RECONCILE_TTL_MS = 10 * 60_000;

export function startScheduler(): void {
  cron.schedule("*/5 * * * *", async () => {
    try {
      await Promise.all([
        processCampaigns(),
        reconcileInviteAcceptances(),
        refreshAgentCountersForAll(),
        expireStaleScheduling(),
      ]);
    } catch (err) {
      logger.error("scheduler error", err);
    }
  });
  cron.schedule("*/15 * * * *", async () => {
    try {
      await expireStaleScheduling();
    } catch (err) {
      logger.error("expireStaleScheduling error", err);
    }
  });
  logger.info("Scheduler started (runs every 5 minutes)");
}

export async function reconcileInviteAcceptances(): Promise<number> {
  const campaigns = await prisma.campaign.findMany({
    where: { mode: "SEARCH", status: { in: ["RUNNING", "PAUSED", "LIMIT_HIT"] } },
  });
  if (campaigns.length === 0) return 0;

  const byAccount = new Map<string, Campaign[]>();
  for (const c of campaigns) {
    const list = byAccount.get(c.accountId) ?? [];
    list.push(c);
    byAccount.set(c.accountId, list);
  }

  let matched = 0;
  for (const [accountId, accountCampaigns] of byAccount) {
    const last = lastAcceptReconcileAt.get(accountId) ?? 0;
    if (Date.now() - last < ACCEPT_RECONCILE_TTL_MS) continue;

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.status !== "OK") {
      lastAcceptReconcileAt.set(accountId, Date.now());
      continue;
    }

    const campaignById = new Map(accountCampaigns.map((c) => [c.id, c]));
    const invited = await prisma.lead.findMany({
      where: { campaignId: { in: accountCampaigns.map((c) => c.id) }, status: "INVITED" },
      select: { id: true, campaignId: true, providerId: true },
    });
    if (invited.length === 0) {
      lastAcceptReconcileAt.set(accountId, Date.now());
      continue;
    }

    const wanted = new Map(invited.map((l) => [l.providerId, l]));
    const remaining = new Set(wanted.keys());

    try {
      let cursor: string | undefined;
      do {
        const page = await unipile.getRelations(account.unipileAccountId, cursor, 1000);
        for (const rel of page.items ?? []) {
          if (!remaining.delete(rel.member_id)) continue;
          const lead = wanted.get(rel.member_id);
          if (!lead) continue;
          const campaign = campaignById.get(lead.campaignId);
          if (!campaign) continue;
          const relFullName = relationName(rel);
          await prisma.lead.update({
            where: { id: lead.id },
            data: { status: "ACCEPTED", acceptedAt: new Date() },
          });
          await upsertRelationContact(accountId, rel.member_id, relFullName ?? undefined);
          await createLog({
            type: "INVITE_ACCEPTED",
            message: `Convite aceito por ${relFullName || rel.member_id} (verificação de rede)`,
            campaignId: lead.campaignId,
            leadId: lead.id,
          });
          const full = await prisma.lead.findUnique({ where: { id: lead.id } });
          if (full) {
            await advanceOnEvent(campaign, { ...full, status: "ACCEPTED" } as Lead);
          }
          matched += 1;
        }
        cursor = page.cursor ?? undefined;
        if (cursor && remaining.size > 0) await sleep(1500);
      } while (cursor && remaining.size > 0);
    } catch (err) {
      logger.warn(`reconcileInviteAcceptances error for account ${accountId}: ${(err as Error).message}`);
    }
    lastAcceptReconcileAt.set(accountId, Date.now());
  }
  if (matched > 0) {
    logger.info(`reconcileInviteAcceptances: ${matched} convite(s) marcado(s) como aceito pela verificação de rede`);
  }
  return matched;
}

export async function expireStaleScheduling(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  const stale = await prisma.conversation.findMany({
    where: {
      scheduleState: { in: ["OFFERING", "AWAITING_EMAIL", "CONFIRMING"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
  });
  for (const c of stale) {
    await prisma.conversation.update({
      where: { id: c.id },
      data: { scheduleState: "NONE", scheduleData: "{}" },
    });
  }
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
  const cadence = parseCadence(fresh.cadence);

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
  if (!String(fresh.inviteMessage ?? "").trim() && cadence.length === 0) {
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

  const dueCopy1 = await prisma.lead.findFirst({
    where: {
      campaignId: fresh.id,
      status: "PENDING",
      currentBlockId: null,
      ...selectedFilter,
      OR: [{ nextInviteAt: null }, { nextInviteAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
  let due = dueCopy1;
  if (!due && cadence.length > 1) {
    due = await prisma.lead.findFirst({
      where: {
        campaignId: fresh.id,
        status: "COMPLETED",
        currentBlockId: null,
        ...selectedFilter,
        cadenceStep: { lt: cadence.length },
        nextInviteAt: { not: null, lte: now },
      },
      orderBy: { nextInviteAt: "asc" },
    });
  }

  if (!due) {
    const [remainingCopy1, remainingFollowUps] = await Promise.all([
      prisma.lead.count({
        where: { campaignId: fresh.id, status: "PENDING", currentBlockId: null, ...selectedFilter },
      }),
      cadence.length > 1
        ? prisma.lead.count({
            where: {
              campaignId: fresh.id,
              status: "COMPLETED",
              currentBlockId: null,
              ...selectedFilter,
              cadenceStep: { lt: cadence.length },
            },
          })
        : Promise.resolve(0),
    ]);
    if (remainingCopy1 === 0 && remainingFollowUps === 0) {
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
