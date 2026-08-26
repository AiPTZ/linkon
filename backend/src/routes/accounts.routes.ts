import { Router, type Request } from "express";
import { prisma } from "../lib/prisma";
import { syncAccounts, disconnectAccount, confirmHosted } from "../services/auth.service";
import { previewRelations } from "../services/sweep.service";
import { currentUser, resolveScope } from "../utils/scope";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const accountsRouter = Router();

accountsRouter.post(
  "/confirm-hosted",
  ah(async (req, res) => {
    const user = currentUser(req);
    const scope = resolveScope(req);
    const pending = user.role === "USER" || (user.role === "ADMIN" && scope.userId !== null);
    const result = await confirmHosted(scope.userId, { pending });
    res.json(result);
  }),
);

accountsRouter.get(
  "/",
  ah(async (req, res) => {
    try {
      await syncAccounts();
    } catch {
      // Unipile nao configurado: retorna contas locais mesmo assim
    }
    const scope = resolveScope(req);
    const accounts = await prisma.account.findMany({
      where: { userId: scope.userId },
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

async function getScopedAccount(req: Request, id: string) {
  const scope = resolveScope(req);
  const account = await prisma.account.findFirst({ where: { id, userId: scope.userId } });
  if (!account) throw new ApiError(404, "Conta não encontrada");
  return account;
}

accountsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const account = await getScopedAccount(req, req.params.id);
    const full = await prisma.account.findUnique({
      where: { id: account.id },
      include: {
        campaigns: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    res.json(full);
  }),
);

accountsRouter.post(
  "/:id/disconnect",
  ah(async (req, res) => {
    const account = await getScopedAccount(req, req.params.id);
    await disconnectAccount(account.id);
    res.json({ ok: true });
  }),
);

accountsRouter.get(
  "/:id/relations",
  ah(async (req, res) => {
    const account = await getScopedAccount(req, req.params.id);
    const cap = Math.min(10000, Math.max(100, Number(req.query.cap) || 5000));
    const preview = await previewRelations(account.unipileAccountId, cap);
    res.json({ ...preview, account: { id: account.id, username: account.username } });
  }),
);
