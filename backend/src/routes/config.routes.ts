import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { configService } from "../services/config.service";
import { env } from "../config/env";
import { requireAdmin } from "../middleware/auth";
import { ah } from "./handler";

export const configRouter = Router();

const updateConfigSchema = z
  .object({
    unipileDsn: z.string().url().optional().or(z.literal("")),
    unipileAccessToken: z.string().min(1).optional().or(z.literal("")),
    webhookPublicUrl: z.string().url().optional().or(z.literal("")),
  })
  .strict();

configRouter.get(
  "/",
  requireAdmin,
  ah(async (_req, res) => {
    const [dsn, token, storedWebhookUrl] = await Promise.all([
      configService.unipileDsn(),
      configService.unipileAccessToken(),
      configService.get("webhookPublicUrl"),
    ]);
    const webhookPublicUrl = storedWebhookUrl || env.WEBHOOK_PUBLIC_URL || "";

    const webhooks = await prisma.webhookRegistration.findMany({
      orderBy: { createdAt: "desc" },
    });

    res.json({
      unipileDsnConfigured: Boolean(dsn),
      unipileAccessTokenConfigured: Boolean(token),
      webhookPublicUrl: webhookPublicUrl || "",
      webhookPublicUrlConfigured: Boolean(webhookPublicUrl),
      webhooks,
    });
  }),
);

configRouter.put(
  "/",
  requireAdmin,
  ah(async (req, res) => {
    const body = updateConfigSchema.parse(req.body);

    if (body.unipileDsn !== undefined) {
      await configService.set("unipileDsn", body.unipileDsn.trim());
    }
    if (body.unipileAccessToken !== undefined) {
      await configService.set("unipileAccessToken", body.unipileAccessToken.trim());
    }
    if (body.webhookPublicUrl !== undefined) {
      await configService.set("webhookPublicUrl", body.webhookPublicUrl.trim());
    }

    res.json({ ok: true });
  }),
);
