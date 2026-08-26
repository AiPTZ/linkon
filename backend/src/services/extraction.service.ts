import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { extractionQueue } from "./queue.service";
import { unipile, type SearchItem } from "./unipile.service";
import { sleep, randomInt } from "../utils/time";
import { ApiError } from "../utils/errors";
import type { Account, Extraction, ExtractedLead, User } from "@prisma/client";

const SCRAPE_SPACING_MS = 1200;
const NETWORK_LABEL: Record<string, string> = {
  SELF: "Você",
  FIRST_DEGREE: "1º grau",
  SECOND_DEGREE: "2º grau",
  THIRD_DEGREE: "3º grau",
  OUT_OF_NETWORK: "Fora da rede",
};

export function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function networkLabel(value: string | null | undefined): string {
  return (value && NETWORK_LABEL[value]) || "—";
}

export interface CreateExtractionInput {
  name?: string;
  searchUrl: string;
  accountId: string;
  maxResults?: number;
  userId: string | null;
}

export async function createExtraction(input: CreateExtractionInput): Promise<Extraction> {
  const account = await prisma.account.findUnique({ where: { id: input.accountId } });
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  if (account.status === "DISCONNECTED") {
    throw new ApiError(400, "Conta desconectada do LinkedIn. Conecte a conta antes de extrair.");
  }
  if (!/^https?:\/\//i.test(input.searchUrl.trim())) {
    throw new ApiError(400, "Informe um link válido de pesquisa de pessoas no LinkedIn.");
  }

  const name = (input.name ?? "").trim() || `Extração ${new Date().toLocaleString("pt-BR")}`;
  const maxResults = Math.min(500, Math.max(1, input.maxResults ?? 250));

  const extraction = await prisma.extraction.create({
    data: {
      name: name.slice(0, 120),
      searchUrl: input.searchUrl.trim().slice(0, 2000),
      accountId: account.id,
      maxResults,
      userId: input.userId,
    },
  });

  await extractionQueue.add("run", { extractionId: extraction.id, type: "run" });
  return extraction;
}

function itemName(item: SearchItem): string | null {
  return item.name || [item.first_name, item.last_name].filter(Boolean).join(" ") || null;
}

async function upsertExtractedLead(extractionId: string, item: SearchItem): Promise<void> {
  await prisma.extractedLead.upsert({
    where: { extractionId_providerId: { extractionId, providerId: item.id } },
    update: {},
    create: {
      extractionId,
      providerId: item.id,
      publicIdentifier: item.public_identifier,
      name: itemName(item),
      headline: item.headline,
      profileUrl: item.public_profile_url || item.profile_url,
    },
  });
}

export async function runExtractionSearch(extraction: Extraction): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: extraction.accountId } });
  if (!account) {
    await markExtractionFailed(extraction.id, "Conta não encontrada");
    return;
  }

  let totalFound = 0;
  let page = 1;
  let reachedEnd = false;

  try {
    while (totalFound < extraction.maxResults && !reachedEnd) {
      const result = await unipile.searchByUrl(account.unipileAccountId, extraction.searchUrl, page, 25);
      const people = (result.items ?? []).filter((i) => i.type === "PEOPLE");

      for (const item of people) {
        if (totalFound >= extraction.maxResults) break;
        await upsertExtractedLead(extraction.id, item);
        totalFound++;
      }

      if (people.length === 0) {
        reachedEnd = true;
      } else if (totalFound < extraction.maxResults) {
        await sleep(randomInt(2000, 6000));
      }
      page++;
    }

    await prisma.extraction.update({
      where: { id: extraction.id },
      data: { totalFound, status: "PROCESSING" },
    });

    const leads = await prisma.extractedLead.findMany({
      where: { extractionId: extraction.id },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    let i = 0;
    for (const lead of leads) {
      await extractionQueue.add(
        "scrape",
        { extractionId: extraction.id, type: "scrape", leadId: lead.id },
        {
          delay: i * SCRAPE_SPACING_MS,
          attempts: 4,
          backoff: { type: "exponential", delay: 30_000 },
          removeOnComplete: 1000,
          removeOnFail: 2000,
        },
      );
      i++;
    }
  } catch (err) {
    await markExtractionFailed(extraction.id, (err as Error).message);
    throw err;
  }
}

export async function scrapeExtractionLead(extraction: Extraction, lead: ExtractedLead): Promise<void> {
  const account = await prisma.account.findUnique({ where: { id: extraction.accountId } });
  if (!account) return;

  const details = await unipile.getUserContactDetails(account.unipileAccountId, lead.providerId);
  await prisma.extractedLead.update({
    where: { id: lead.id },
    data: {
      emails: JSON.stringify(details.emails),
      phones: JSON.stringify(details.phones),
      socials: JSON.stringify(details.socials),
      networkDistance: details.networkDistance,
      scrapedAt: new Date(),
    },
  });
  const hasContact = details.emails.length > 0 || details.phones.length > 0 || details.socials.length > 0;
  await bumpProgress(extraction.id, hasContact);
}

export async function skipExtractionLead(extraction: Extraction, lead: ExtractedLead): Promise<void> {
  await prisma.extractedLead.update({
    where: { id: lead.id },
    data: { scrapedAt: new Date() },
  });
  await bumpProgress(extraction.id, false);
}

async function bumpProgress(extractionId: string, hasContact: boolean): Promise<void> {
  const extraction = await prisma.extraction.update({
    where: { id: extractionId },
    data: {
      processed: { increment: 1 },
      ...(hasContact ? { withContact: { increment: 1 } } : {}),
    },
  });
  if (extraction.processed >= extraction.totalFound && extraction.status === "PROCESSING") {
    await prisma.extraction.update({ where: { id: extractionId }, data: { status: "COMPLETED" } });
  }
}

async function markExtractionFailed(extractionId: string, message: string): Promise<void> {
  await prisma.extraction.update({
    where: { id: extractionId },
    data: { status: "FAILED", error: message.slice(0, 500) },
  });
}

export async function listExtractions(
  userId: string | null,
): Promise<(Extraction & { account: Pick<Account, "id" | "username">; user: Pick<User, "id" | "username"> | null })[]> {
  return prisma.extraction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      account: { select: { id: true, username: true } },
      user: { select: { id: true, username: true } },
    },
  });
}

export async function getExtraction(
  id: string,
  userId: string | null,
): Promise<(Extraction & { account: Pick<Account, "id" | "username">; user: Pick<User, "id" | "username"> | null }) | null> {
  return prisma.extraction.findFirst({
    where: { id, userId },
    include: {
      account: { select: { id: true, username: true } },
      user: { select: { id: true, username: true } },
    },
  });
}

export async function listExtractionLeads(
  extractionId: string,
  opts: { onlyWithContact?: boolean } = {},
): Promise<ExtractedLead[]> {
  return prisma.extractedLead.findMany({
    where: {
      extractionId,
      ...(opts.onlyWithContact
        ? {
            OR: [
              { emails: { not: "[]" } },
              { phones: { not: "[]" } },
              { socials: { not: "[]" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function exportExtractionXlsx(
  extractionId: string,
  providerIds: string[] = [],
  userId: string | null,
): Promise<{ buffer: Buffer; filename: string }> {
  const extraction = await prisma.extraction.findFirst({ where: { id: extractionId, userId } });
  if (!extraction) throw new ApiError(404, "Extração não encontrada");

  const leads = await prisma.extractedLead.findMany({
    where: {
      extractionId,
      ...(providerIds.length > 0 ? { providerId: { in: providerIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Link ON";
  const sheet = workbook.addWorksheet("Extraídos");

  sheet.columns = [
    { header: "Nome", key: "name", width: 30 },
    { header: "Cargo", key: "headline", width: 45 },
    { header: "Perfil LinkedIn", key: "profileUrl", width: 45 },
    { header: "E-mail", key: "emails", width: 35 },
    { header: "Telefone", key: "phones", width: 25 },
    { header: "Redes sociais / Sites", key: "socials", width: 40 },
    { header: "Grau", key: "network", width: 12 },
    { header: "Extraído em", key: "scrapedAt", width: 22 },
  ];

  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "1F2937" } };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFF" } };
  sheet.autoFilter = { from: "A1", to: "H1" };

  for (const lead of leads) {
    sheet.addRow({
      name: lead.name ?? "",
      headline: lead.headline ?? "",
      profileUrl: lead.profileUrl ?? "",
      emails: parseList(lead.emails).join("; "),
      phones: parseList(lead.phones).join("; "),
      socials: parseList(lead.socials).join("; "),
      network: networkLabel(lead.networkDistance),
      scrapedAt: lead.scrapedAt ? lead.scrapedAt.toISOString() : "",
    });
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const filename = `${extraction.name.replace(/[^\w\d-]+/g, "_")}-extraidos.xlsx`;
  return { buffer, filename };
}

export async function deleteExtraction(id: string, userId: string | null): Promise<void> {
  const extraction = await prisma.extraction.findFirst({ where: { id, userId } });
  if (!extraction) throw new ApiError(404, "Extração não encontrada");
  await prisma.$transaction([
    prisma.extractedLead.deleteMany({ where: { extractionId: id } }),
    prisma.extraction.delete({ where: { id } }),
  ]);
}
