import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { createLog } from "./log.service";
import { notify } from "./notification.service";
import { sleep, randomInt } from "../utils/time";
import { UnipileError } from "../utils/errors";
import type { Campaign, Lead } from "@prisma/client";

export interface ImportResult {
  imported: number;
  total: number;
}

export interface RelationsPreview {
  total: number;
  capped: boolean;
  sample: { name: string | null; headline: string | null; publicProfileUrl: string | null }[];
}

function relationName(rel: {
  first_name?: string;
  last_name?: string;
  public_identifier?: string;
}): string | null {
  return [rel.first_name, rel.last_name].filter(Boolean).join(" ") || rel.public_identifier || null;
}

export async function importLeadsFromSweep(campaign: Campaign): Promise<ImportResult> {
  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) {
    throw new Error(`Account ${campaign.accountId} nao encontrada`);
  }

  let cursor: string | undefined;
  let imported = 0;
  let total = 0;

  do {
    const page = await unipile.getRelations(account.unipileAccountId, cursor, 1000);
    const items = page.items ?? [];
    total += items.length;

    for (const rel of items) {
      await prisma.lead.upsert({
        where: {
          campaignId_providerId: { campaignId: campaign.id, providerId: rel.member_id },
        },
        update: {},
        create: {
          campaignId: campaign.id,
          providerId: rel.member_id,
          publicIdentifier: rel.public_identifier,
          name: relationName(rel),
          headline: rel.headline,
          profileUrl: rel.public_profile_url,
        },
      });
    }
    imported += items.length;

    cursor = page.cursor ?? undefined;
    if (cursor && imported < campaign.maxLeads) {
      await sleep(randomInt(2000, 5000));
    }
  } while (cursor && imported < campaign.maxLeads);

  return { imported, total };
}

export async function previewRelations(accountId: string, cap = 5000): Promise<RelationsPreview> {
  let cursor: string | undefined;
  let total = 0;
  let capped = false;
  const sample: RelationsPreview["sample"] = [];

  do {
    const page = await unipile.getRelations(accountId, cursor, 1000);
    for (const rel of page.items ?? []) {
      total++;
      if (sample.length < 5) {
        sample.push({
          name: relationName(rel),
          headline: rel.headline ?? null,
          publicProfileUrl: rel.public_profile_url ?? null,
        });
      }
      if (total >= cap) {
        capped = true;
        break;
      }
    }
    if (capped) break;
    cursor = page.cursor ?? undefined;
  } while (cursor);

  return { total, capped, sample };
}

export async function sendSweepMessage(campaign: Campaign, lead: Lead): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) {
    throw new Error(`Account ${campaign.accountId} nao encontrada`);
  }

  const text = (campaign.inviteMessage ?? "").trim();
  if (!text) {
    throw new Error("Mensagem de varredura vazia");
  }

  try {
    const res = await unipile.sendDirectMessage(account.unipileAccountId, lead.providerId, text);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { status: "COMPLETED", lastMessageAt: new Date() },
    });
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { invitesSentToday: { increment: 1 }, invitesSentWeek: { increment: 1 } },
    });
    await createLog({
      type: "DM_SENT",
      message: `Mensagem enviada para ${lead.name ?? lead.providerId}`,
      campaignId: campaign.id,
      leadId: lead.id,
      accountId: account.id,
      payload: { text, conversationId: res.conversation_id },
    });
  } catch (err) {
    if (err instanceof UnipileError && err.isLimitError()) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "LIMIT_HIT" } });
      await notify({
        accountId: campaign.accountId,
        campaignId: campaign.id,
        type: "BROADCAST_LIMIT_HIT",
        level: "WARN",
        message: `Limite do LinkedIn atingido (${err.errorType}). Disparo pausado.`,
        payload: { error: err.message },
      });
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
