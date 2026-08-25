import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { importBroadcastLeads, setLeadSelection } from "../services/broadcast.service";
import {
  pauseCampaign,
  resumeCampaign,
  startCampaign,
} from "../services/campaign.service";
import { validateFlow, serializeFlow, BLOCK_TYPES } from "../services/flow.service";
import type { Flow } from "../services/flow.service";
import { ApiError } from "../utils/errors";
import { ah } from "./handler";

export const campaignsRouter = Router();

const chatbotRuleSchema = z.object({
  matchType: z.enum(["contains", "keywords", "regex"]),
  pattern: z.string().max(500),
  reply: z.string().max(2000),
});

const flowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(BLOCK_TYPES as unknown as [string, ...string[]]),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).default({}),
});

const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  label: z.string().optional(),
});

const flowSchema = z.object({
  nodes: z.array(flowNodeSchema).default([]),
  edges: z.array(flowEdgeSchema).default([]),
});

const campaignObjectSchema = z.object({
  name: z.string().min(1).max(200),
  mode: z.enum(["SEARCH", "SWEEP", "DISPARO"]).default("SEARCH"),
  searchUrl: z.string().optional(),
  accountId: z.string().min(1),
  inviteMessage: z.string().max(300).default(""),
  dailyLimit: z.number().int().min(1).max(100).default(40),
  weeklyLimit: z.number().int().min(1).max(200).default(150),
  minDelayMin: z.number().int().min(1).max(180).default(5),
  maxDelayMin: z.number().int().min(1).max(180).default(15),
  workStartHour: z.number().int().min(0).max(23).default(9),
  workEndHour: z.number().int().min(0).max(23).default(18),
  chatbotEnabled: z.boolean().default(false),
  chatbotRules: z.array(chatbotRuleSchema).default([]),
  chatbotDefaultReply: z.string().max(2000).default(""),
  chatbotReplyDelayMin: z.number().int().min(0).max(60).default(1),
  chatbotReplyDelayMax: z.number().int().min(0).max(120).default(3),
  chatbotStopKeywords: z.array(z.string().max(50)).default([]),
  maxRepliesPerLead: z.number().int().min(1).max(20).default(3),
  maxLeads: z.number().int().min(10).max(5000).default(1000),
  flow: flowSchema.optional(),
});

const campaignSchema = campaignObjectSchema.refine((d) => d.minDelayMin <= d.maxDelayMin, {
  message: "minDelayMin deve ser menor ou igual a maxDelayMin",
  path: ["minDelayMin"],
});

const updateCampaignSchema = campaignObjectSchema.partial();

function toData(body: z.infer<typeof campaignSchema> | z.infer<typeof updateCampaignSchema>) {
  const data: Record<string, unknown> = {};
  const keys = [
    "name",
    "mode",
    "searchUrl",
    "accountId",
    "inviteMessage",
    "dailyLimit",
    "weeklyLimit",
    "minDelayMin",
    "maxDelayMin",
    "workStartHour",
    "workEndHour",
    "chatbotEnabled",
    "chatbotDefaultReply",
    "chatbotReplyDelayMin",
    "chatbotReplyDelayMax",
    "maxRepliesPerLead",
    "maxLeads",
  ] as const;
  for (const k of keys) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (body.chatbotRules !== undefined) data.chatbotRules = JSON.stringify(body.chatbotRules);
  if (body.chatbotStopKeywords !== undefined)
    data.chatbotStopKeywords = JSON.stringify(body.chatbotStopKeywords);
  if (body.flow !== undefined) {
    const serialized = serializeFlow(body.flow as unknown as Flow);
    const check = validateFlow(serialized);
    if (!check.ok) throw new ApiError(400, check.errors.join("; "));
    data.flow = serialized;
  }
  return data;
}

async function withStats(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      account: { select: { id: true, username: true, status: true } },
    },
  });
  if (!campaign) return null;

  const [groups, selectedCount] = await Promise.all([
    prisma.lead.groupBy({
      by: ["status"],
      where: { campaignId },
      _count: { _all: true },
    }),
    prisma.lead.count({ where: { campaignId, selected: true } }),
  ]);
  const stats: Record<string, number> = { total: 0 };
  for (const g of groups) {
    stats[g.status] = g._count._all;
    stats.total += g._count._all;
  }
  stats.selected = selectedCount;

  const nextLead = await prisma.lead.findFirst({
    where: {
      campaignId,
      status: { in: ["PENDING", "INVITED", "ACCEPTED", "RESPONDED"] },
      OR: [{ currentBlockId: { not: null } }, { status: "PENDING" }],
      nextInviteAt: { not: null, gt: new Date() },
    },
    orderBy: { nextInviteAt: "asc" },
    select: { nextInviteAt: true },
  });

  return { ...campaign, stats, nextInviteAt: nextLead?.nextInviteAt ?? null };
}

campaignsRouter.post(
  "/",
  ah(async (req, res) => {
    const body = campaignSchema.parse(req.body);
    if (body.mode === "SWEEP" || body.mode === "DISPARO") {
      const hasFlowNodes = (body.flow?.nodes?.length ?? 0) > 0;
      const hasMessage = Boolean((body.inviteMessage ?? "").trim());
      if (!hasFlowNodes && !hasMessage) {
        throw new ApiError(
          400,
          body.mode === "DISPARO"
            ? "Defina a mensagem do disparo ou crie um fluxo de mensagens."
            : "Defina a mensagem de varredura ou crie um fluxo de mensagens.",
        );
      }
      body.searchUrl = body.mode === "DISPARO" ? "DISPARO" : "SWEEP";
    } else if (!body.searchUrl) {
      throw new ApiError(400, "URL da busca é obrigatória");
    }
    const data = toData(body);

    const account = await prisma.account.findUnique({ where: { id: data.accountId as string } });
    if (!account) throw new ApiError(400, "Conta vinculada não encontrada");

    const campaign = await prisma.campaign.create({
      data: data as {
        name: string;
        searchUrl: string;
        accountId: string;
        [key: string]: unknown;
      },
    });
    res.status(201).json(campaign);
  }),
);

campaignsRouter.get(
  "/",
  ah(async (_req, res) => {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        account: { select: { id: true, username: true, status: true } },
        _count: { select: { leads: true } },
      },
    });

    const groups = await prisma.lead.groupBy({
      by: ["campaignId", "status"],
      _count: { _all: true },
    });
    const selectedGroups = await prisma.lead.groupBy({
      by: ["campaignId"],
      where: { selected: true },
      _count: { _all: true },
    });
    const statsByCampaign: Record<string, Record<string, number>> = {};
    for (const g of groups) {
      statsByCampaign[g.campaignId] ??= {};
      statsByCampaign[g.campaignId][g.status] = g._count._all;
    }
    const selectedByCampaign: Record<string, number> = {};
    for (const g of selectedGroups) selectedByCampaign[g.campaignId] = g._count._all;

    res.json({
      items: campaigns.map((c) => ({
        ...c,
        stats: {
          ...(statsByCampaign[c.id] ?? {}),
          total: c._count.leads,
          selected: selectedByCampaign[c.id] ?? 0,
        },
      })),
    });
  }),
);

campaignsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const campaign = await withStats(req.params.id);
    if (!campaign) throw new ApiError(404, "Campanha não encontrada");
    res.json(campaign);
  }),
);

campaignsRouter.put(
  "/:id",
  ah(async (req, res) => {
    const existing = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new ApiError(404, "Campanha não encontrada");

    const body = updateCampaignSchema.parse(req.body);
    const data = toData(body);
    if (data.accountId) {
      const account = await prisma.account.findUnique({ where: { id: data.accountId as string } });
      if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
    }

    const campaign = await prisma.campaign.update({ where: { id: req.params.id }, data });
    res.json(campaign);
  }),
);

campaignsRouter.post(
  "/:id/start",
  ah(async (req, res) => {
    await startCampaign(req.params.id);
    res.json({ ok: true });
  }),
);

campaignsRouter.post(
  "/:id/pause",
  ah(async (req, res) => {
    await pauseCampaign(req.params.id);
    res.json({ ok: true });
  }),
);

campaignsRouter.post(
  "/:id/resume",
  ah(async (req, res) => {
    await resumeCampaign(req.params.id);
    res.json({ ok: true });
  }),
);

campaignsRouter.post(
  "/:id/sweep",
  ah(async (req, res) => {
    const result = await importBroadcastLeads(req.params.id);
    res.json(result);
  }),
);

campaignsRouter.get(
  "/:id/leads/selection",
  ah(async (req, res) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) throw new ApiError(404, "Campanha não encontrada");
    const [selected, total] = await Promise.all([
      prisma.lead.count({ where: { campaignId: req.params.id, selected: true } }),
      prisma.lead.count({ where: { campaignId: req.params.id } }),
    ]);
    res.json({ selected, total });
  }),
);

const selectSchema = z.object({
  action: z.enum(["replace", "all", "none", "toggle"]),
  providerIds: z.array(z.string()).default([]),
});

campaignsRouter.post(
  "/:id/leads/select",
  ah(async (req, res) => {
    const { action, providerIds } = selectSchema.parse(req.body);
    const selected = await setLeadSelection(req.params.id, action, providerIds);
    res.json({ selected });
  }),
);

campaignsRouter.get(
  "/:id/leads",
  ah(async (req, res) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) throw new ApiError(404, "Campanha não encontrada");

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const status =
      typeof req.query.status === "string" && req.query.status.length > 0
        ? req.query.status
        : undefined;

    const where: Prisma.LeadWhereInput = { campaignId: req.params.id };
    if (status) where.status = status;
    const sel = req.query.selected;
    let orderBy: Prisma.LeadOrderByWithRelationInput = { createdAt: "desc" };
    if (campaign.mode === "DISPARO" && sel !== "all" && sel !== "true" && sel !== "false") {
      where.selected = true;
      orderBy = { createdAt: "asc" };
    } else if (sel === "true" || sel === "false") {
      where.selected = sel === "true";
    }
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      where.OR = [{ name: { contains: req.query.q.trim() } }];
    }
    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ items, total, page, pageSize });
  }),
);

campaignsRouter.get(
  "/:id/logs",
  ah(async (req, res) => {
    const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!campaign) throw new ApiError(404, "Campanha não encontrada");

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

    const [items, total] = await Promise.all([
      prisma.logEvent.findMany({
        where: { campaignId: req.params.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.logEvent.count({ where: { campaignId: req.params.id } }),
    ]);

    res.json({ items, total, page, pageSize });
  }),
);
