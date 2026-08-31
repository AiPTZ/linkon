import { Router } from "express";
import { healthRouter } from "./health.routes";
import { configRouter } from "./config.routes";
import { authRouter } from "./auth.routes";
import { accountsRouter } from "./accounts.routes";
import { agentsRouter } from "./agents.routes";
import { campaignsRouter } from "./campaigns.routes";
import { extractionsRouter } from "./extractions.routes";
import { logsRouter } from "./logs.routes";
import { notificationsRouter } from "./notifications.routes";
import { inboxRouter } from "./inbox.routes";
import { webhooksRouter } from "./webhooks.routes";
import { adminRouter } from "./admin.routes";
import { calendarRouter, handleOAuthCallback } from "./calendar.routes";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { env } from "../config/env";
import { ah } from "./handler";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/webhooks", webhooksRouter);
apiRouter.use("/auth", authRouter);

apiRouter.get("/calendar/oauth/callback", ah(async (req, res) => {
  try {
    const url = await handleOAuthCallback(req.query.code, req.query.state);
    res.redirect(url);
  } catch (err) {
    const dest = `${env.FRONTEND_ORIGIN}/configuracoes?calendar=error`;
    res.redirect(dest);
  }
}));

apiRouter.use(requireAuth);
apiRouter.use(rateLimit({ windowMs: 60_000, max: env.RATE_LIMIT_API_MAX }));
apiRouter.use("/config", configRouter);
apiRouter.use("/accounts", accountsRouter);
apiRouter.use("/agents", agentsRouter);
apiRouter.use("/campaigns", campaignsRouter);
apiRouter.use("/extractions", extractionsRouter);
apiRouter.use("/logs", logsRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/inbox", inboxRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/calendar", calendarRouter);
