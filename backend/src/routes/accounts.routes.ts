import { Router } from "express";
import { prisma } from "../lib/prisma";
import { syncAccounts, disconnectAccount } from "../services/auth.service";
import { previewRelations } from "../services/sweep.service";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const accountsRouter = Router();

accountsRouter.get(
  "/",
  ah(async (_req, res) => {
    try {
      await syncAccounts();
    } catch {
      // Unipile nao configurado: retorna contas locais mesmo assim
    }

    const accounts = await prisma.account.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        unipileAccountId: true,
        provider: true,
        username: true,
        authMethod: true,
        status: true,
        checkpointType: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { campaigns: true } },
      },
    });
    res.json({ items: accounts });
  }),
);

accountsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const account = await prisma.account.findUnique({
      where: { id: req.params.id },
      include: {
        campaigns: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!account) throw new ApiError(404, "Conta não encontrada");
    res.json(account);
  }),
);

accountsRouter.post(
  "/:id/disconnect",
  ah(async (req, res) => {
    await disconnectAccount(req.params.id);
    res.json({ ok: true });
  }),
);

accountsRouter.get(
  "/:id/relations",
  ah(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) throw new ApiError(404, "Conta não encontrada");

    const cap = Math.min(10000, Math.max(100, Number(req.query.cap) || 5000));
    const preview = await previewRelations(account.unipileAccountId, cap);
    res.json({ ...preview, account: { id: account.id, username: account.username } });
  }),
);
