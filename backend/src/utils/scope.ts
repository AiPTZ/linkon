import type { Request } from "express";
import type { AuthPayload } from "../services/user.service";
import { ApiError } from "./errors";

export function currentUser(req: Request): AuthPayload {
  return (req as Request & { user: AuthPayload }).user;
}

export function resolveScope(req: Request): { userId: string | null } {
  const user = currentUser(req);
  if (user.role === "ADMIN") {
    const as = req.headers["x-operate-as"];
    return { userId: typeof as === "string" && as ? as : null };
  }
  return { userId: user.sub };
}

export function assertAccountInScope(
  account: { userId: string | null } | null,
  scopeUserId: string | null,
): void {
  if (!account) throw new ApiError(400, "Conta vinculada não encontrada");
  if (account.userId !== scopeUserId) {
    throw new ApiError(403, "Conta fora do seu escopo");
  }
}
