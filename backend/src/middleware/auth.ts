import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthPayload } from "../services/user.service";
import { prisma } from "../lib/prisma";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  try {
    const payload = verifyToken(token);
    if (payload.status !== "ACTIVE") {
      res.status(401).json({ error: "Acesso bloqueado. Fale com o administrador." });
      return;
    }
    (req as Request & { user: AuthPayload }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Sessão expirada ou inválida" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user: AuthPayload }).user;
  if (user?.role !== "ADMIN") {
    res.status(403).json({ error: "Acesso restrito ao administrador" });
    return;
  }
  next();
}

export function requirePro(req: Request, res: Response, next: NextFunction): void {
  const user = (req as Request & { user: AuthPayload }).user;
  if (!user) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  if (user.role === "ADMIN") {
    next();
    return;
  }
  prisma.user
    .findUnique({ where: { id: user.sub }, select: { role: true, pro: true, status: true } })
    .then((u) => {
      if (u && (u.role === "ADMIN" || (u.pro === true && u.status === "ACTIVE"))) {
        next();
        return;
      }
      res.status(403).json({
        error: "Recurso disponível na Versão PRO. Fale com o administrador para liberar.",
        code: "PRO_REQUIRED",
      });
    })
    .catch(() => {
      res.status(500).json({ error: "Erro interno ao validar permissões" });
    });
}
