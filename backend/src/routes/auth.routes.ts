import { Router, type Request } from "express";
import { z } from "zod";
import {
  connectNative,
  createHostedAuthUrl,
  registerWebhooks,
  solveCheckpoint,
} from "../services/auth.service";
import {
  changePassword,
  getUserById,
  loginUser,
  registerUser,
} from "../services/user.service";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { ah } from "./handler";

export const authRouter = Router();

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

authRouter.post("/login", ah(async (req, res) => {
  const body = loginSchema.parse(req.body);
  res.json(await loginUser(body.username, body.password));
}));

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  username: z.string().min(3).max(40),
  password: z.string().min(6).max(100),
  whatsapp: z.string().max(25).optional(),
});

authRouter.post("/register", ah(async (req, res) => {
  const body = registerSchema.parse(req.body);
  const user = await registerUser(body);
  res.status(201).json({ user, message: "conta criada, aguardando aprovação" });
}));

authRouter.use(requireAuth);

authRouter.get("/me", ah(async (req, res) => {
  const u = (req as Request & { user: { sub: string } }).user;
  const user = await getUserById(u.sub);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  res.json(user);
}));

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

authRouter.post("/change-password", ah(async (req, res) => {
  const u = (req as Request & { user: { sub: string } }).user;
  const body = changePasswordSchema.parse(req.body);
  await changePassword(u.sub, body.currentPassword, body.newPassword);
  res.json({ ok: true });
}));

const nativeSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  country: z.string().min(1).optional(),
  userId: z.string().optional(),
});

const checkpointSchema = z.object({ accountId: z.string().min(1), code: z.string().min(1) });

authRouter.post("/native", requireAdmin, ah(async (req, res) => {
  const body = nativeSchema.parse(req.body);
  const result = await connectNative(body.username, body.password, body.country, body.userId ?? null);
  if (result.checkpoint) {
    return res.status(202).json({ status: "CHECKPOINT", checkpoint: result.checkpoint, accountId: result.localAccountId });
  }
  res.status(201).json({ status: "OK", accountId: result.localAccountId, account: result.account });
}));

authRouter.post("/native/checkpoint", requireAdmin, ah(async (req, res) => {
  const body = checkpointSchema.parse(req.body);
  const result = await solveCheckpoint(body.accountId, body.code);
  if (result.checkpoint) return res.status(202).json({ status: "CHECKPOINT", checkpoint: result.checkpoint });
  res.json({ status: "OK", accountId: result.localAccountId });
}));

authRouter.post("/hosted", ah(async (req, res) => {
  const user = (req as Request & { user: { sub: string; role: string } }).user;
  const scope = user.role === "ADMIN"
    ? (req.headers["x-operate-as"] as string | undefined) ?? null
    : user.sub;
  const { url } = await createHostedAuthUrl(scope);
  res.json({ url });
}));

authRouter.post("/webhooks", requireAdmin, ah(async (_req, res) => {
  res.json(await registerWebhooks());
}));
