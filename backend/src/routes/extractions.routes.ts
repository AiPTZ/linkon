import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  createExtraction,
  deleteExtraction,
  exportExtractionXlsx,
  getExtraction,
  listExtractionLeads,
  listExtractions,
} from "../services/extraction.service";
import { ApiError } from "../utils/errors";
import { currentUser, resolveScope, assertAccountInScope } from "../utils/scope";
import { ah } from "./handler";

export const extractionsRouter = Router();

const createSchema = z.object({
  name: z.string().max(120).optional(),
  searchUrl: z.string().min(1).max(2000),
  accountId: z.string().min(1),
  maxResults: z.number().int().min(1).max(500).optional(),
});

extractionsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = createSchema.parse(req.body);
    const account = await prisma.account.findUnique({ where: { id: body.accountId } });
    const scope = resolveScope(req);
    assertAccountInScope(account, scope.userId);
    const extraction = await createExtraction({ ...body, userId: scope.userId });
    res.status(201).json(extraction);
  }),
);

extractionsRouter.get(
  "/",
  ah(async (req, res) => {
    res.json({ items: await listExtractions(resolveScope(req).userId) });
  }),
);

extractionsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const extraction = await getExtraction(req.params.id, resolveScope(req).userId);
    if (!extraction) throw new ApiError(404, "Extração não encontrada");
    const leadsCount = await prisma.extractedLead.count({ where: { extractionId: extraction.id } });
    res.json({ ...extraction, leadsCount });
  }),
);

extractionsRouter.get(
  "/:id/leads",
  ah(async (req, res) => {
    const extraction = await getExtraction(req.params.id, resolveScope(req).userId);
    if (!extraction) throw new ApiError(404, "Extração não encontrada");
    const onlyWithContact = req.query.onlyWithContact === "1" || req.query.onlyWithContact === "true";
    const items = await listExtractionLeads(req.params.id, { onlyWithContact });
    res.json({ items, total: items.length });
  }),
);

extractionsRouter.get(
  "/:id/export-xlsx",
  ah(async (req, res) => {
    const extraction = await getExtraction(req.params.id, resolveScope(req).userId);
    if (!extraction) throw new ApiError(404, "Extração não encontrada");
    const providerIds = typeof req.query.providerIds === "string" && req.query.providerIds.length > 0
      ? req.query.providerIds.split(",").filter(Boolean)
      : [];
    const { buffer, filename } = await exportExtractionXlsx(req.params.id, providerIds, resolveScope(req).userId);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

extractionsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const extraction = await getExtraction(req.params.id, resolveScope(req).userId);
    if (!extraction) throw new ApiError(404, "Extração não encontrada");
    await deleteExtraction(req.params.id, resolveScope(req).userId);
    res.json({ ok: true });
  }),
);
