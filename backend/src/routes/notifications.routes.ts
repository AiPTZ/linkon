import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/",
  ah(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const items = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const unread = await prisma.notification.count({ where: { read: false } });
    res.json({ items, unread });
  }),
);

notificationsRouter.post(
  "/read-all",
  ah(async (_req, res) => {
    await prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
    res.json({ ok: true });
  }),
);

notificationsRouter.post(
  "/:id/read",
  ah(async (req, res) => {
    const n = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!n) throw new ApiError(404, "Notificação não encontrada");
    await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
    res.json({ ok: true });
  }),
);
