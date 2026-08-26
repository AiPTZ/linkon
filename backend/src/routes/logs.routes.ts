import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ah } from "./handler";

export const logsRouter = Router();

logsRouter.get(
  "/",
  ah(async (req, res) => {
    const campaignId = typeof req.query.campaignId === "string" ? req.query.campaignId : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    const where = campaignId ? { campaignId } : {};
    const [items, total] = await Promise.all([
      prisma.logEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.logEvent.count({ where }),
    ]);

    res.json({ items, total, page, pageSize });
  }),
);
