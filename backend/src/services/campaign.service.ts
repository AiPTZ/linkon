import { prisma } from "../lib/prisma";
import { searchQueue, sweepQueue } from "./queue.service";
import { createLog } from "./log.service";
import { notify } from "./notification.service";
import { ApiError } from "../utils/errors";
import { hasFlow } from "./flow.service";
import type { Account } from "@prisma/client";

export function assertAccountReady(account: Pick<Account, "id" | "status">): void {
  if (account.status === "OK") return;
  const message =
    account.status === "DISCONNECTED"
      ? "Conta LinkedIn desconectada. Reconecte antes de iniciar."
      : account.status === "CHECKPOINT"
        ? "Conta LinkedIn aguardando verificação. Conclua a verificação antes de iniciar."
        : account.status === "REJECTED"
          ? "Conexão LinkedIn recusada. Conecte novamente antes de iniciar."
          : "Conta LinkedIn ainda não está pronta. Aguarde a conexão concluir antes de iniciar.";
  throw new ApiError(400, message);
}

export async function startCampaign(id: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  if (campaign.status === "RUNNING" || campaign.status === "IMPORTING") return;

  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  assertAccountReady(account);

  if (campaign.mode === "DISPARO") {
    const selected = await prisma.lead.count({ where: { campaignId: id, selected: true } });
    if (selected === 0) {
      throw new ApiError(400, "Selecione ao menos um contato antes de iniciar o disparo.");
    }
    await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
    await createLog({
      type: "CAMPAIGN_STARTED",
      message: `Disparo "${campaign.name}" iniciado (${selected} contatos)`,
      campaignId: id,
    });
    await notify({
      accountId: campaign.accountId,
      campaignId: id,
      type: "BROADCAST_STARTED",
      level: "INFO",
      message: `Disparo "${campaign.name}" iniciado para ${selected} contatos.`,
      payload: { selected },
    });
    if (!hasFlow(campaign.flow)) {
      const due = await prisma.lead.findFirst({
        where: {
          campaignId: id,
          selected: true,
          status: "PENDING",
          currentBlockId: null,
          OR: [{ nextInviteAt: null }, { nextInviteAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
      });
      if (due) {
        await prisma.lead.update({
          where: { id: due.id },
          data: { nextInviteAt: new Date() },
        });
        await sweepQueue.add(
          "sweep",
          { leadId: due.id, campaignId: id },
          {
            delay: 0,
            attempts: 5,
            backoff: { type: "exponential", delay: 60_000 },
            removeOnComplete: 500,
            removeOnFail: 1000,
          },
        );
      }
    }
    return;
  }

  await prisma.campaign.update({ where: { id }, data: { status: "IMPORTING" } });
  await searchQueue.add("search", { campaignId: id });
  await createLog({
    type: "CAMPAIGN_STARTED",
    message: `Campanha "${campaign.name}" iniciada (importando leads)`,
    campaignId: id,
  });
}

export async function pauseCampaign(id: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  await prisma.campaign.update({ where: { id }, data: { status: "PAUSED" } });
  await createLog({
    type: "CAMPAIGN_PAUSED",
    message: `Campanha "${campaign.name}" pausada`,
    campaignId: id,
  });
}

export async function resumeCampaign(id: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");

  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  assertAccountReady(account);
  if (campaign.status === "RUNNING" || campaign.status === "IMPORTING") return;

  if (campaign.mode === "DISPARO") {
    const selected = await prisma.lead.count({ where: { campaignId: id, selected: true } });
    if (selected === 0) {
      throw new ApiError(400, "Selecione ao menos um contato antes de retomar o disparo.");
    }
    await prisma.campaign.update({ where: { id }, data: { status: "RUNNING" } });
    await createLog({
      type: "CAMPAIGN_STARTED",
      message: `Disparo "${campaign.name}" retomado (${selected} contatos)`,
      campaignId: id,
    });
    await notify({
      accountId: campaign.accountId,
      campaignId: id,
      type: "BROADCAST_STARTED",
      level: "INFO",
      message: `Disparo "${campaign.name}" retomado para ${selected} contatos.`,
      payload: { selected },
    });
    return;
  }

  await prisma.campaign.update({ where: { id }, data: { status: "IMPORTING" } });
  await searchQueue.add("search", { campaignId: id });
  await createLog({
    type: "CAMPAIGN_STARTED",
    message: `Campanha "${campaign.name}" retomada`,
    campaignId: id,
  });
}
