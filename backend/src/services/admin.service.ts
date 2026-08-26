import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { ApiError } from "../utils/errors";

export interface AdminPayload {
  sub: string;
  username: string;
}

export async function ensureAdminSeeded(): Promise<void> {
  const username = env.ADMIN_USERNAME;
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash },
    create: { username, name: "Administrador", passwordHash, role: "ADMIN", status: "ACTIVE" },
  });
}

export async function loginAdmin(
  username: string,
  password: string,
): Promise<{ token: string; user: { id: string; username: string } }> {
  const admin = await prisma.adminUser.findUnique({ where: { username } });
  if (!admin) throw new ApiError(401, "Credenciais inválidas");

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) throw new ApiError(401, "Credenciais inválidas");

  const payload: AdminPayload = { sub: admin.id, username: admin.username };
  const token = jwt.sign(payload, env.AUTH_SECRET, { expiresIn: "7d" });
  return { token, user: { id: admin.id, username: admin.username } };
}

export function verifyToken(token: string): AdminPayload {
  return jwt.verify(token, env.AUTH_SECRET) as AdminPayload;
}
