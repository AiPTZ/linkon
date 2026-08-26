import { Router } from "express";
import { prisma } from "../lib/prisma";
import { redisConnection } from "../lib/redis";
import { configService } from "../services/config.service";
import { ah } from "./handler";

export const healthRouter = Router();

healthRouter.get(
  "/",
  ah(async (_req, res) => {
    let redis = false;
    try {
      const pong = await redisConnection.ping();
      redis = pong === "PONG";
    } catch {
      redis = false;
    }

    const accounts = await prisma.account.count();
    const campaigns = await prisma.campaign.count();

    const [dsn, token] = await Promise.all([
      configService.unipileDsn(),
      configService.unipileAccessToken(),
    ]);

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      redis,
      unipileConfigured: Boolean(dsn && token),
      accounts,
      campaigns,
    });
  }),
);
