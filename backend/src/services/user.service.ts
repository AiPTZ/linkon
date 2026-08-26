import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { ApiError } from "../utils/errors";

export interface AuthPayload {
  sub: string;
  username: string;
  role: string;
  status: string;
}

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  role: string;
  status: string;
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

function toPublic(u: { id: string; username: string; name: string; role: string; status: string }): PublicUser {
  return { id: u.id, username: u.username, name: u.name, role: u.role, status: u.status };
}

export async function loginUser(
  username: string,
  password: string,
): Promise<{ token: string; user: PublicUser }> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new ApiError(401, "Credenciais inválidas");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new ApiError(401, "Credenciais inválidas");

  if (user.status === "PENDING") throw new ApiError(401, "Aguardando aprovação do administrador.");
  if (user.status === "BLOCKED") throw new ApiError(401, "Acesso bloqueado. Fale com o administrador.");

  const payload: AuthPayload = { sub: user.id, username: user.username, role: user.role, status: user.status };
  const token = jwt.sign(payload, env.AUTH_SECRET, { expiresIn: "7d" });
  return { token, user: toPublic(user) };
}

export async function registerUser(input: {
  name: string;
  username: string;
  password: string;
  whatsapp?: string;
}): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) throw new ApiError(409, "Este usuário já está cadastrado.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      username: input.username,
      passwordHash,
      whatsapp: input.whatsapp || null,
      role: "USER",
      status: "PENDING",
    },
  });
  return toPublic(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new ApiError(400, "Senha atual incorreta");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const u = await prisma.user.findUnique({ where: { id } });
  return u ? toPublic(u) : null;
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, env.AUTH_SECRET) as AuthPayload;
}

export async function listUsers(): Promise<(PublicUser & { whatsapp: string | null; status: string; createdAt: Date; _count: { accounts: number; campaigns: number; extractions: number } })[]> {
  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { accounts: true, campaigns: true, extractions: true } } },
  });
}

export async function approveUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  await prisma.user.update({ where: { id }, data: { status: "ACTIVE" } });
}

export async function blockUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  await prisma.user.update({ where: { id }, data: { status: "BLOCKED" } });
  await prisma.campaign.updateMany({
    where: { userId: id, status: { in: ["RUNNING", "IMPORTING"] } },
    data: { status: "PAUSED" },
  });
}

export async function unblockUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  await prisma.user.update({ where: { id }, data: { status: "ACTIVE" } });
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "Usuário não encontrado");
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
}
