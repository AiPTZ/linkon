import { Router } from "express";
import { healthRouter } from "./health.routes";
import { configRouter } from "./config.routes";
import { authRouter } from "./auth.routes";
import { accountsRouter } from "./accounts.routes";
import { campaignsRouter } from "./campaigns.routes";
import { extractionsRouter } from "./extractions.routes";
import { logsRouter } from "./logs.routes";
import { notificationsRouter } from "./notifications.routes";
import { webhooksRouter } from "./webhooks.routes";
import { adminRouter } from "./admin.routes";
import { requireAuth } from "../middleware/auth";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/webhooks", webhooksRouter);
apiRouter.use("/auth", authRouter);

apiRouter.use(requireAuth);
apiRouter.use("/config", configRouter);
apiRouter.use("/accounts", accountsRouter);
apiRouter.use("/campaigns", campaignsRouter);
apiRouter.use("/extractions", extractionsRouter);
apiRouter.use("/logs", logsRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/admin", adminRouter);
