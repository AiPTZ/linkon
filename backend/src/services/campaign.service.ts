import { prisma } from "../lib/prisma";
import { searchQueue } from "./queue.service";
import { createLog } from "./log.service";
import { notify } from "./notification.service";
import { ApiError } from "../utils/errors";

export async function startCampaign(id: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  if (campaign.status === "RUNNING" || campaign.status === "IMPORTING") return;

  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  if (account.status === "DISCONNECTED") {
    throw new ApiError(400, "Conta LinkedIn desconectada. Reconecte antes de iniciar.");
  }

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
