import { prisma } from "../lib/prisma";
import { unipile, type SearchItem } from "./unipile.service";
import { createLog } from "./log.service";
import { sleep, randomInt } from "../utils/time";
import type { Campaign } from "@prisma/client";

export interface ImportResult {
  imported: number;
  total: number;
}

async function upsertLead(campaignId: string, item: SearchItem): Promise<void> {
  const name =
    item.name ||
    [item.first_name, item.last_name].filter(Boolean).join(" ") ||
    null;
  await prisma.lead.upsert({
    where: {
      campaignId_providerId: { campaignId, providerId: item.id },
    },
    update: {},
    create: {
      campaignId,
      providerId: item.id,
      publicIdentifier: item.public_identifier,
      name,
      headline: item.headline,
      profileUrl: item.public_profile_url || item.profile_url,
    },
  });
}

export async function importLeadsFromSearch(campaign: Campaign): Promise<ImportResult> {
  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) {
    throw new Error(`Account ${campaign.accountId} nao encontrada`);
  }

  const existing = new Set<string>(
    (
      await prisma.lead.findMany({
        where: { campaignId: campaign.id },
        select: { providerId: true },
      })
    ).map((l) => l.providerId),
  );

  let imported = 0;
  let page = 1;
  let reachedEnd = false;

  while (imported < campaign.maxLeads && !reachedEnd) {
    const result = await unipile.searchByUrl(account.unipileAccountId, campaign.searchUrl, page, 25);
    const people = (result.items ?? []).filter((i) => i.type === "PEOPLE");

    let newCount = 0;
    for (const item of people) {
      if (existing.has(item.id)) continue;
      await upsertLead(campaign.id, item);
      existing.add(item.id);
      newCount++;
      imported++;
    }

    if (people.length === 0 || newCount === 0) {
      reachedEnd = true;
    } else if (imported < campaign.maxLeads) {
      await sleep(randomInt(3000, 8000));
    }
    page++;
  }

  return { imported, total: imported };
}
