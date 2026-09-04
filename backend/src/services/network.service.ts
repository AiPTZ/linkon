import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { contactsQueue } from "./queue.service";
import { unipile } from "./unipile.service";
import { createLog } from "./log.service";
import { sleep, randomInt } from "../utils/time";
import { ApiError, UnipileError } from "../utils/errors";
import type { Account, Contact } from "@prisma/client";

const SCRAPE_SPACING_MS = 1500;
const RELATIONS_LIMIT = 1000;

const NETWORK_LABEL: Record<string, string> = {
  SELF: "Você",
  FIRST_DEGREE: "1º grau",
  SECOND_DEGREE: "2º grau",
  THIRD_DEGREE: "3º grau",
  OUT_OF_NETWORK: "Fora da rede",
};

export type ContactWithAccount = Contact & { account: { id: string; username: string | null } };

export interface ContactListFilters {
  q?: string;
  onlyWithContact?: boolean;
  accountId?: string;
  scraped?: boolean;
  limit?: number;
}

export interface ContactScrapeStats {
  total: number;
  scraped: number;
  withContact: number;
  withEmail: number;
  withPhone: number;
  pending: number;
}

export function parseList(raw: string | null | undefined): string[] {
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

export function networkLabel(value: string | null | undefined): string {
  return (value && NETWORK_LABEL[value]) || "—";
}

export function relationName(rel: {
  first_name?: string;
  last_name?: string;
  public_identifier?: string;
}): string | null {
  return [rel.first_name, rel.last_name].filter(Boolean).join(" ") || rel.public_identifier || null;
}

function onlyWithContactWhere(): { OR: { emails?: { not: string }; phones?: { not: string }; socials?: { not: string } }[] } {
  return {
    OR: [
      { emails: { not: "[]" } },
      { phones: { not: "[]" } },
      { socials: { not: "[]" } },
    ],
  };
}

export async function syncAccountNetwork(accountId: string): Promise<{ imported: number; total: number }> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  if (account.status === "DISCONNECTED") {
    throw new ApiError(400, "Conta desconectada do LinkedIn. Conecte a conta antes de sincronizar.");
  }

  let cursor: string | undefined;
  let imported = 0;
  let total = 0;

  do {
    const page = await unipile.getRelations(account.unipileAccountId, cursor, RELATIONS_LIMIT);
    const items = page.items ?? [];
    total += items.length;

    for (const rel of items) {
      await prisma.contact.upsert({
        where: { accountId_providerId: { accountId, providerId: rel.member_id } },
        update: {},
        create: {
          accountId,
          providerId: rel.member_id,
          publicIdentifier: rel.public_identifier,
          name: relationName(rel),
          headline: rel.headline,
          profileUrl: rel.public_profile_url,
          networkDistance: "FIRST_DEGREE",
        },
      });
    }
    imported += items.length;

    cursor = page.cursor ?? undefined;
    if (cursor) {
      await sleep(randomInt(2000, 5000));
    }
  } while (cursor);

  await createLog({
    type: "CONTACT_SYNC",
    message: `Sincronização da rede concluída: ${imported} conexões armazenadas`,
    accountId,
    payload: { imported, total },
  });

  return { imported, total };
}

export async function scrapeContact(
  account: Account,
  contact: Contact,
): Promise<{ emails: string[]; phones: string[]; socials: string[]; networkDistance: string | null }> {
  const details = await unipile.getUserContactDetails(account.unipileAccountId, contact.providerId);
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      emails: JSON.stringify(details.emails),
      phones: JSON.stringify(details.phones),
      socials: JSON.stringify(details.socials),
      networkDistance: details.networkDistance,
      scrapedAt: new Date(),
    },
  });
  return details;
}

export async function scrapeContactById(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) return;
  const account = await prisma.account.findUnique({ where: { id: contact.accountId } });
  if (!account) return;

  try {
    await scrapeContact(account, contact);
  } catch (err) {
    if (err instanceof UnipileError && !err.isRetryable()) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { scrapedAt: new Date() },
      });
      return;
    }
    throw err;
  }
}

export async function scheduleContactScrape(
  accountId: string,
  contactIds: string[] = [],
  options: { onlyMissing?: boolean } = {},
): Promise<{ scheduled: number }> {
  const where = contactIds.length > 0
    ? { id: { in: contactIds }, accountId }
    : options.onlyMissing
      ? {
          accountId,
          OR: [
            { OR: [{ emails: null }, { emails: "[]" }] },
            { OR: [{ phones: null }, { phones: "[]" }] },
          ],
        }
      : { accountId, scrapedAt: null };

  const contacts = await prisma.contact.findMany({
    where,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  let scheduled = 0;
  for (const contact of contacts) {
    await contactsQueue.add(
      "scrape",
      { contactId: contact.id, accountId },
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

  if (scheduled > 0) {
    await createLog({
      type: "CONTACT_SCRAPE_STARTED",
      message: `Extração de contatos iniciada para ${scheduled} contato(s)`,
      accountId,
      payload: { scheduled },
    });
  }

  return { scheduled };
}

export async function contactScrapeStats(accountId: string | null): Promise<ContactScrapeStats> {
  const baseWhere = accountId ? { accountId } : {};
  const [total, scraped, withContact, withEmail, withPhone] = await Promise.all([
    prisma.contact.count({ where: baseWhere }),
    prisma.contact.count({ where: { ...baseWhere, scrapedAt: { not: null } } }),
    prisma.contact.count({
      where: { ...baseWhere, OR: [{ emails: { not: null } }, { phones: { not: null } }] },
    }),
    prisma.contact.count({ where: { ...baseWhere, emails: { not: null } } }),
    prisma.contact.count({ where: { ...baseWhere, phones: { not: null } } }),
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

export async function listContacts(
  scopeUserId: string | null,
  filters: ContactListFilters,
): Promise<{ items: ContactWithAccount[]; total: number }> {
  const q = (filters.q ?? "").trim();
  const limit = Math.min(1000, Math.max(1, filters.limit ?? 200));

  const where: Record<string, unknown> = {};
  if (scopeUserId) where.account = { userId: scopeUserId };
  if (filters.accountId) where.accountId = filters.accountId;
  if (filters.scraped) where.scrapedAt = { not: null };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { headline: { contains: q, mode: "insensitive" } },
    ];
  }
  if (filters.onlyWithContact) {
    where.OR = [...(Array.isArray(where.OR) ? where.OR : []), ...onlyWithContactWhere().OR];
  }

  const [items, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: { account: { select: { id: true, username: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return { items, total };
}

export async function getContact(
  id: string,
  scopeUserId: string | null,
): Promise<ContactWithAccount | null> {
  const where: Record<string, unknown> = { id };
  if (scopeUserId) where.account = { userId: scopeUserId };
  return prisma.contact.findFirst({
    where,
    include: { account: { select: { id: true, username: true } } },
  });
}

export async function upsertRelationContact(
  accountId: string,
  providerId: string,
  name?: string,
): Promise<void> {
  await prisma.contact.upsert({
    where: { accountId_providerId: { accountId, providerId } },
    update: {},
    create: { accountId, providerId, name: name ?? null },
  });
}

export async function buildContactsXlsx(
  accountId: string | null,
  providerIds: string[],
): Promise<{ buffer: Buffer; filename: string }> {
  const where: Record<string, unknown> = {};
  if (accountId) where.accountId = accountId;
  if (providerIds.length > 0) where.providerId = { in: providerIds };

  const contacts = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Link ON";
  const sheet = workbook.addWorksheet("Contatos");

  sheet.columns = [
    { header: "Nome", key: "name", width: 30 },
    { header: "Cargo", key: "headline", width: 45 },
    { header: "Perfil LinkedIn", key: "profileUrl", width: 45 },
    { header: "E-mail", key: "emails", width: 35 },
    { header: "Telefone", key: "phones", width: 25 },
    { header: "Redes sociais / Sites", key: "socials", width: 40 },
    { header: "Grau", key: "network", width: 12 },
    { header: "Contato extraído em", key: "scrapedAt", width: 22 },
    { header: "Adicionado em", key: "createdAt", width: 22 },
  ];

  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F2937" } };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFF" } };
  sheet.autoFilter = { from: "A1", to: "I1" };

  for (const contact of contacts) {
    sheet.addRow({
      name: contact.name ?? "",
      headline: contact.headline ?? "",
      profileUrl: contact.profileUrl ?? "",
      emails: joinList(parseList(contact.emails)),
      phones: joinList(parseList(contact.phones)),
      socials: joinList(parseList(contact.socials)),
      network: networkLabel(contact.networkDistance),
      scrapedAt: contact.scrapedAt ? contact.scrapedAt.toISOString() : "",
      createdAt: contact.createdAt ? contact.createdAt.toISOString() : "",
    });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const filename = "contatos-rede.xlsx";
  return { buffer, filename };
}
