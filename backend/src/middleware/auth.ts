import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthPayload } from "../services/user.service";

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
