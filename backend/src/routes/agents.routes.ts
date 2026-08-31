import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { resolveScope, assertAccountInScope } from "../utils/scope";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const agentsRouter = Router();

const knowledgeBaseSchema = z.object({
  product: z.string().max(3000).default(""),
  faq: z.array(z.object({ q: z.string().max(500), a: z.string().max(2000) })).default([]),
  prices: z.array(z.string().max(500)).default([]),
  differentiators: z.array(z.string().max(500)).default([]),
  objections: z.array(z.string().max(500)).default([]),
});

const agentUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    knowledgeBase: knowledgeBaseSchema.optional(),
    tone: z.string().max(2000).optional(),
    transferMessage: z.string().max(2000).optional(),
    replyDelayMin: z.number().int().min(0).max(3600).optional(),
    replyDelayMax: z.number().int().min(0).max(7200).optional(),
    maxTurns: z.number().int().min(1).max(20).optional(),
    replyDailyLimit: z.number().int().min(1).max(1000).optional(),
    replyWeeklyLimit: z.number().int().min(1).max(10000).optional(),
    initialMessageMode: z.enum(["TEMPLATE", "AI"]).optional(),
    initialTemplate: z.string().max(2000).optional(),
    schedulingEnabled: z.boolean().optional(),
    meetingDurationMin: z.number().int().min(5).max(240).optional(),
    meetingTitle: z.string().max(200).optional(),
  })
  .refine((body) => body.replyDelayMin === undefined || body.replyDelayMax === undefined || body.replyDelayMin <= body.replyDelayMax, {
    path: ["replyDelayMin"],
    message: "replyDelayMin não pode ser maior que replyDelayMax",
  });

function toData(body: z.infer<typeof agentUpdateSchema>) {
  const data: Record<string, unknown> = {};
  const keys = [
    "enabled",
    "tone",
    "transferMessage",
    "replyDelayMin",
    "replyDelayMax",
    "maxTurns",
    "replyDailyLimit",
    "replyWeeklyLimit",
    "initialMessageMode",
    "initialTemplate",
    "schedulingEnabled",
    "meetingDurationMin",
    "meetingTitle",
  ] as const;
  for (const k of keys) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (body.knowledgeBase !== undefined) {
    data.knowledgeBase = JSON.stringify(body.knowledgeBase);
  }
  return data;
}

agentsRouter.get(
  "/",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const accounts = await prisma.account.findMany({
      where: { ...(userId ? { userId } : {}), status: "OK" },
      orderBy: { createdAt: "desc" },
      include: { nativeAgent: true },
    });
    res.json(
      accounts.map((a) => ({
        account: {
          id: a.id,
          username: a.username,
          unipileAccountId: a.unipileAccountId,
          status: a.status,
        },
        agent: a.nativeAgent,
      })),
    );
  }),
);

agentsRouter.put(
  "/:accountId",
  ah(async (req, res) => {
    const { userId } = resolveScope(req);
    const parsed = agentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path?.[0] ?? "desconhecido";
      throw new ApiError(400, `Dados inválidos (campo: ${field})`);
    }
    const account = await prisma.account.findUnique({ where: { id: req.params.accountId } });
    assertAccountInScope(account, userId);
    const data = toData(parsed.data);
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, "Nenhum campo para atualizar");
    }
    const agent = await prisma.nativeAgent.upsert({
      where: { accountId: account!.id },
      update: data,
      create: { accountId: account!.id, ...data },
    });
    res.json(agent);
  }),
);
