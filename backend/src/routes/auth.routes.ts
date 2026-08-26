import { Router, type Request } from "express";
import { z } from "zod";
import {
  connectNative,
  createHostedAuthUrl,
  registerWebhooks,
  solveCheckpoint,
} from "../services/auth.service";
import { loginUser } from "../services/user.service";
import { requireAuth } from "../middleware/auth";
import { ah } from "./handler";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  ah(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await loginUser(body.username, body.password);
    res.json(result);
  }),
);

authRouter.use(requireAuth);

authRouter.get(
  "/me",
  ah(async (req, res) => {
    const user = (req as Request & { user: { sub: string; username: string } }).user;
    res.json({ id: user.sub, username: user.username });
  }),
);

const nativeSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  country: z.string().min(1).optional(),
});

const checkpointSchema = z.object({
  accountId: z.string().min(1),
  code: z.string().min(1),
});

authRouter.post(
  "/native",
  ah(async (req, res) => {
    const body = nativeSchema.parse(req.body);
    const result = await connectNative(body.username, body.password, body.country);
    if (result.checkpoint) {
      return res.status(202).json({
        status: "CHECKPOINT",
        checkpoint: result.checkpoint,
        accountId: result.localAccountId,
      });
    }
    res.status(201).json({
      status: "OK",
      accountId: result.localAccountId,
      account: result.account,
    });
  }),
);

authRouter.post(
  "/native/checkpoint",
  ah(async (req, res) => {
    const body = checkpointSchema.parse(req.body);
    const result = await solveCheckpoint(body.accountId, body.code);
    if (result.checkpoint) {
      return res.status(202).json({ status: "CHECKPOINT", checkpoint: result.checkpoint });
    }
    res.json({ status: "OK", accountId: result.localAccountId });
  }),
);

authRouter.post(
  "/hosted",
  ah(async (_req, res) => {
    const { url } = await createHostedAuthUrl();
    res.json({ url });
  }),
);

authRouter.post(
  "/webhooks",
  ah(async (_req, res) => {
    const result = await registerWebhooks();
    res.json(result);
  }),
);
