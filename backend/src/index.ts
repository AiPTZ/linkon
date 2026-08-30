import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { env } from "./config/env";
import { redisConnection } from "./lib/redis";
import { apiRouter } from "./routes";
import { startScheduler } from "./scheduler";
import { ensureAdminSeeded } from "./services/user.service";
import { logger } from "./utils/logger";
import { securityHeaders } from "./middleware/security";
import { rateLimit } from "./middleware/rateLimit";

const app = express();

app.set("trust proxy", env.TRUST_PROXY);

app.use(securityHeaders);

const corsOrigins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (env.NODE_ENV !== "production" || !origin) {
        callback(null, true);
        return;
      }
      if (corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);

app.use((req: Request, _res: Response, next: NextFunction) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c as Buffer));
  req.on("end", () => {
    (req as { rawBody?: string }).rawBody = Buffer.concat(chunks).toString("utf8");
  });
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use("/api", apiRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Rota não encontrada" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const where = issue ? ` (${issue.path.join(".") || "body"}: ${issue.message})` : "";
    return res.status(400).json({ error: `Dados inválidos${where}`, details: err.flatten() });
  }
  const e = err as { status?: number; message?: string; details?: unknown };
  const status = e.status ?? 500;
  logger.error("API error", e.message ?? String(err));
  res.status(status).json({ error: e.message ?? "Erro interno", details: e.details });
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down backend...");
  server.close();
  await redisConnection.quit().catch(() => {});
  process.exit(0);
}

async function bootstrap(): Promise<void> {
  await ensureAdminSeeded();
  logger.info(`Link ON backend listening on port ${env.PORT}`);
  startScheduler();
}

const server = app.listen(env.PORT);
bootstrap().catch((err) => {
  logger.error("Failed to bootstrap backend", err);
  process.exit(1);
});

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
