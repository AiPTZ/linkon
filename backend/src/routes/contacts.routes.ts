import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  buildContactsXlsx,
  getContact,
  listContacts,
  scheduleContactScrape,
} from "../services/network.service";
import { contactsQueue } from "../services/queue.service";
import { ApiError } from "../utils/errors";
import { resolveScope, assertAccountInScope } from "../utils/scope";
import { ah } from "./handler";

export const contactsRouter = Router();

export const syncSchema = z.object({
  accountId: z.string().min(1),
});

export const scrapeSchema = z.object({
  contactIds: z.array(z.string()).optional(),
});

export function parseListQuery(query: Record<string, unknown>): {
  q?: string;
  onlyWithContact?: boolean;
  accountId?: string;
  scraped?: boolean;
  limit?: number;
} {
  const only = query.onlyWithContact === "1" || query.onlyWithContact === "true";
  const scraped = query.scraped === "1" || query.scraped === "true";
  const limit = Number(query.limit);
  return {
    q: typeof query.q === "string" && query.q.length > 0 ? query.q : undefined,
    onlyWithContact: only ? true : undefined,
    accountId: typeof query.accountId === "string" && query.accountId.length > 0 ? query.accountId : undefined,
    scraped: scraped ? true : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(1000, Math.floor(limit)) : undefined,
  };
}

contactsRouter.get(
  "/",
  ah(async (req, res) => {
    const scope = resolveScope(req);
    const { items, total } = await listContacts(scope.userId, parseListQuery(req.query));
    res.json({ items, total });
  }),
);

contactsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const contact = await getContact(req.params.id, resolveScope(req).userId);
    if (!contact) throw new ApiError(404, "Contato não encontrado");
    res.json(contact);
  }),
);

contactsRouter.post(
  "/sync",
  ah(async (req, res) => {
    const body = syncSchema.parse(req.body);
    const account = await prisma.account.findUnique({ where: { id: body.accountId } });
    assertAccountInScope(account, resolveScope(req).userId);
    await contactsQueue.add("sync-network", { accountId: body.accountId });
    res.json({ ok: true });
  }),
);

contactsRouter.post(
  "/scrape",
  ah(async (req, res) => {
    const body = scrapeSchema.parse(req.body);
    const scope = resolveScope(req);

    let accountId: string | null = null;
    if (body.contactIds && body.contactIds.length > 0) {
      const contact = await getContact(body.contactIds[0], scope.userId);
      if (!contact) throw new ApiError(404, "Contato não encontrado");
      accountId = contact.accountId;
    }

    if (accountId) {
      assertAccountInScope(await prisma.account.findUnique({ where: { id: accountId } }), scope.userId);
    } else {
      const accounts = await prisma.account.findMany({
        where: scope.userId ? { userId: scope.userId } : {},
        select: { id: true },
      });
      if (accounts.length === 0) throw new ApiError(400, "Nenhuma conta conectada");
      accountId = accounts[0].id;
    }

    const { scheduled } = await scheduleContactScrape(accountId, body.contactIds);
    res.json({ ok: true, scheduled });
  }),
);

contactsRouter.get(
  "/export-xlsx",
  ah(async (req, res) => {
    const scope = resolveScope(req);
    const providerIds = typeof req.query.providerIds === "string" && req.query.providerIds.length > 0
      ? req.query.providerIds.split(",").filter(Boolean)
      : [];
    const accountId = typeof req.query.accountId === "string" && req.query.accountId.length > 0
      ? req.query.accountId
      : null;
    if (accountId) {
      assertAccountInScope(await prisma.account.findUnique({ where: { id: accountId } }), scope.userId);
    }
    const { buffer, filename } = await buildContactsXlsx(accountId, providerIds);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);
