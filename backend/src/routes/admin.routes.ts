import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { invitesQueue, chatbotQueue, searchQueue, contactsQueue } from "../services/queue.service";
import { unipile } from "../services/unipile.service";
import { createLog } from "../services/log.service";
import {
  approveUser,
  blockUser,
  createUser,
  listUsers,
  resetUserPassword,
  unblockUser,
} from "../services/user.service";
import { requireAdmin } from "../middleware/auth";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get(
  "/overview",
  ah(async (_req, res) => {
    let redis = false;
    try {
      redis = (await redisConnection.ping()) === "PONG";
    } catch {
      redis = false;
    }

    const [invites, chatbot, search, accounts, campaigns, leads, logs, queueCounts] =
      await Promise.all([
        invitesQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
        chatbotQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
        searchQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
        prisma.account.count(),
        prisma.campaign.count(),
        prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.logEvent.count(),
        Promise.all([
          invitesQueue.getWaitingCount(),
          invitesQueue.getActiveCount(),
          invitesQueue.getDelayedCount(),
          invitesQueue.getFailedCount(),
        ]),
      ]);

    const leadByStatus: Record<string, number> = {};
    for (const g of leads) leadByStatus[g.status] = g._count._all;

    res.json({
      redis,
      queues: {
        invites,
        chatbot,
        search,
        pendingJobs: queueCounts[0] + queueCounts[1] + queueCounts[2],
        failedJobs: queueCounts[3],
      },
      counts: {
        accounts,
        campaigns,
        leads: Object.values(leadByStatus).reduce((a, b) => a + b, 0),
        logs,
        leadByStatus,
      },
      timestamp: new Date().toISOString(),
    });
  }),
);

adminRouter.get(
  "/logs",
  ah(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const level = typeof req.query.level === "string" && req.query.level ? req.query.level : undefined;

    const where = level ? { level } : {};
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

adminRouter.get(
  "/accounts",
  ah(async (_req, res) => {
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
        user: { select: { id: true, username: true } },
      },
    });
    res.json({ items: accounts });
  }),
);

adminRouter.post(
  "/accounts/:id/disconnect",
  ah(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) throw new ApiError(404, "Conta não encontrada");

    try {
      await unipile.deleteAccount(account.unipileAccountId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        throw new ApiError(
          400,
          "Unipile não configurada. Não é possível desconectar a conta na API.",
        );
      }
      throw err;
    }

    await prisma.account.update({ where: { id: account.id }, data: { status: "DISCONNECTED" } });
    await createLog({
      type: "ACCOUNT_DISCONNECTED",
      message: `Conta ${account.username ?? account.unipileAccountId} desconectada`,
      accountId: account.id,
    });
    res.json({ ok: true });
  }),
);

const createUserSchema = z.object({
  name: z.string().min(1).max(120),
  username: z.string().min(3).max(40),
  password: z.string().min(6).max(100),
  whatsapp: z.string().max(25).optional(),
});

adminRouter.post(
  "/users",
  ah(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const user = await createUser(body);
    res.status(201).json({ user });
  }),
);

adminRouter.get(
  "/users",
  ah(async (_req, res) => {
    res.json({ items: await listUsers() });
  }),
);

adminRouter.post(
  "/users/:id/approve",
  ah(async (req, res) => {
    await approveUser(req.params.id);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/users/:id/block",
  ah(async (req, res) => {
    await blockUser(req.params.id);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/users/:id/unblock",
  ah(async (req, res) => {
    await unblockUser(req.params.id);
    res.json({ ok: true });
  }),
);

const resetPasswordSchema = z.object({ password: z.string().min(6) });

adminRouter.post(
  "/users/:id/reset-password",
  ah(async (req, res) => {
    const { password } = resetPasswordSchema.parse(req.body);
    await resetUserPassword(req.params.id, password);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/global",
  ah(async (_req, res) => {
    const [campaigns, contacts] = await Promise.all([
      prisma.campaign.count({ where: { userId: null } }),
      prisma.contact.count({ where: { account: { userId: null } } }),
    ]);
    res.json({ campaigns, contacts });
  }),
);

adminRouter.post(
  "/accounts/:id/approve",
  ah(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) throw new ApiError(404, "Conta não encontrada");
    if (account.status !== "PENDING_LINKEDIN") throw new ApiError(400, "Conta não está aguardando aprovação");
    await prisma.account.update({ where: { id: account.id }, data: { status: "OK", checkpointType: null } });
    await contactsQueue.add("sync-network", { accountId: account.id });
    await createLog({ type: "ACCOUNT_CONNECTED", message: `Conta ${account.username ?? account.unipileAccountId} aprovada pelo administrador`, accountId: account.id });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  "/accounts/:id/reject",
  ah(async (req, res) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) throw new ApiError(404, "Conta não encontrada");
    if (account.status !== "PENDING_LINKEDIN") throw new ApiError(400, "Conta não está aguardando aprovação");
    await prisma.account.update({ where: { id: account.id }, data: { status: "REJECTED" } });
    res.json({ ok: true });
  }),
);
