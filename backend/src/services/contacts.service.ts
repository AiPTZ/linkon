import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { contactsQueue } from "./queue.service";
import { unipile } from "./unipile.service";
import { createLog } from "./log.service";
import type { Account, Campaign, Lead } from "@prisma/client";

const SCRAPE_SPACING_MS = 1500;

export function parseContactList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function joinList(items: string[]): string {
  return items.join("; ");
}

export async function scrapeLeadContact(account: Account, lead: Lead): Promise<{ emails: string[]; phones: string[] }> {
  const contact = await unipile.getUserContactInfo(account.unipileAccountId, lead.providerId);
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      emails: JSON.stringify(contact.emails),
      phones: JSON.stringify(contact.phones),
      contactScrapedAt: new Date(),
    },
  });
  return contact;
}

export interface ScrapeScheduleResult {
  scheduled: number;
  skipped: number;
}

export async function scheduleContactScrape(campaign: Campaign): Promise<ScrapeScheduleResult> {
  const account = await prisma.account.findUnique({ where: { id: campaign.accountId } });
  if (!account) return { scheduled: 0, skipped: 0 };

  const leads = await prisma.lead.findMany({
    where: { campaignId: campaign.id },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  let scheduled = 0;
  for (const lead of leads) {
    await contactsQueue.add(
      "scrape",
      { leadId: lead.id, campaignId: campaign.id },
      {
        delay: scheduled * SCRAPE_SPACING_MS,
        attempts: 4,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    );
    scheduled += 1;
  }

  await createLog({
    type: "CONTACT_SCRAPE_STARTED",
    message: `Extração de contatos iniciada para ${scheduled} lead(s)`,
    campaignId: campaign.id,
    accountId: account.id,
    payload: { scheduled },
  });

  return { scheduled, skipped: leads.length - scheduled };
}

export interface ContactScrapeStats {
  total: number;
  scraped: number;
  withContact: number;
  withEmail: number;
  withPhone: number;
  pending: number;
}

export async function contactScrapeStats(campaignId: string): Promise<ContactScrapeStats> {
  const [total, scraped, withContact, withEmail, withPhone] = await Promise.all([
    prisma.lead.count({ where: { campaignId } }),
    prisma.lead.count({ where: { campaignId, contactScrapedAt: { not: null } } }),
    prisma.lead.count({
      where: { campaignId, OR: [{ emails: { not: null } }, { phones: { not: null } }] },
    }),
    prisma.lead.count({ where: { campaignId, emails: { not: null } } }),
    prisma.lead.count({ where: { campaignId, phones: { not: null } } }),
  ]);
  return {
    total,
    scraped,
    withContact,
    withEmail,
    withPhone,
    pending: total - scraped,
  };
}

export async function buildLeadsXlsx(campaign: Campaign): Promise<{ buffer: Buffer; filename: string }> {
  const leads = await prisma.lead.findMany({
    where: { campaignId: campaign.id },
    orderBy: { createdAt: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Link ON";
  const sheet = workbook.addWorksheet("Leads");

  sheet.columns = [
    { header: "Nome", key: "name", width: 30 },
    { header: "Cargo", key: "headline", width: 45 },
    { header: "Perfil LinkedIn", key: "profileUrl", width: 45 },
    { header: "E-mail", key: "emails", width: 35 },
    { header: "Telefone", key: "phones", width: 25 },
    { header: "Status", key: "status", width: 14 },
    { header: "Convite enviado em", key: "invitedAt", width: 22 },
    { header: "Contato extraído em", key: "contactScrapedAt", width: 22 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "1F2937" },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFF" } };
  sheet.autoFilter = { from: "A1", to: "H1" };

  for (const lead of leads) {
    sheet.addRow({
      name: lead.name ?? "",
      headline: lead.headline ?? "",
      profileUrl: lead.profileUrl ?? "",
      emails: joinList(parseContactList(lead.emails)),
      phones: joinList(parseContactList(lead.phones)),
      status: lead.status,
      invitedAt: lead.invitedAt ? lead.invitedAt.toISOString() : "",
      contactScrapedAt: lead.contactScrapedAt ? lead.contactScrapedAt.toISOString() : "",
    });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const filename = `${campaign.name.replace(/[^\w\d-]+/g, "_")}-leads-contatos.xlsx`;
  return { buffer, filename };
}
