import { prisma } from "../lib/prisma";
import { importLeadsFromSweep } from "./sweep.service";
import { notify } from "./notification.service";
import { ApiError } from "../utils/errors";

const STARTED_STATUSES = ["RUNNING", "IMPORTING", "COMPLETED"];

export async function importBroadcastLeads(
  campaignId: string,
): Promise<{ imported: number; total: number }> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  if (campaign.mode !== "DISPARO") {
    throw new ApiError(400, "Operação disponível apenas para disparos em massa.");
  }
  if (STARTED_STATUSES.includes(campaign.status)) {
    throw new ApiError(400, "O disparo já foi iniciado. Pause para alterar a seleção.");
  }

  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  if (account.status === "DISCONNECTED") {
    throw new ApiError(400, "Conta LinkedIn desconectada. Reconecte antes de varrer a rede.");
  }

  const { imported, total } = await importLeadsFromSweep(campaign);
  await notify({
    accountId: campaign.accountId,
    campaignId: campaign.id,
    type: "BROADCAST_IMPORT",
    level: "INFO",
    message: `Varredura concluída: ${imported} conexões importadas para o disparo "${campaign.name}".`,
    payload: { imported, total },
  });
  return { imported, total };
}

export type SelectAction = "replace" | "all" | "none" | "toggle";

export async function setLeadSelection(
  campaignId: string,
  action: SelectAction,
  providerIds: string[] = [],
): Promise<number> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new ApiError(404, "Campanha não encontrada");
  if (campaign.mode !== "DISPARO") {
    throw new ApiError(400, "Operação disponível apenas para disparos em massa.");
  }
  if (STARTED_STATUSES.includes(campaign.status)) {
    throw new ApiError(400, "O disparo já foi iniciado. Pause para alterar a seleção.");
  }

  switch (action) {
    case "all":
      await prisma.lead.updateMany({ where: { campaignId }, data: { selected: true } });
      break;
    case "none":
      await prisma.lead.updateMany({ where: { campaignId }, data: { selected: false } });
      break;
    case "toggle": {
      if (providerIds.length === 0) break;
      const leads = await prisma.lead.findMany({
        where: { campaignId, providerId: { in: providerIds } },
        select: { providerId: true, selected: true },
      });
      const toOn = leads.filter((l) => !l.selected).map((l) => l.providerId);
      const toOff = leads.filter((l) => l.selected).map((l) => l.providerId);
      if (toOn.length > 0) {
        await prisma.lead.updateMany({
          where: { campaignId, providerId: { in: toOn } },
          data: { selected: true },
        });
      }
      if (toOff.length > 0) {
        await prisma.lead.updateMany({
          where: { campaignId, providerId: { in: toOff } },
          data: { selected: false },
        });
      }
      break;
    }
    case "replace": {
      await prisma.lead.updateMany({ where: { campaignId }, data: { selected: false } });
      if (providerIds.length > 0) {
        await prisma.lead.updateMany({
          where: { campaignId, providerId: { in: providerIds } },
          data: { selected: true },
        });
      }
      break;
    }
    default:
      throw new ApiError(400, "Ação de seleção inválida");
  }

  return prisma.lead.count({ where: { campaignId, selected: true } });
}

export async function getSelectionCount(
  campaignId: string,
): Promise<{ selected: number; total: number }> {
  const [selected, total] = await Promise.all([
    prisma.lead.count({ where: { campaignId, selected: true } }),
    prisma.lead.count({ where: { campaignId } }),
  ]);
  return { selected, total };
}
