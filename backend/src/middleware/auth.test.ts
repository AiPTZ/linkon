import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "../lib/prisma";
import { requirePro } from "./auth";

const userFind = prisma.user.findUnique as ReturnType<typeof vi.fn>;

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("requirePro", () => {
  it("passa para ADMIN sem consultar o banco", () => {
    const next = vi.fn();
    requirePro({ user: { sub: "A1", role: "ADMIN", status: "ACTIVE" } } as never, makeRes() as never, next as never);
    expect(next).toHaveBeenCalled();
  });

  it("permite USER com pro=true e status ACTIVE", async () => {
    userFind.mockResolvedValue({ role: "USER", pro: true, status: "ACTIVE" });
    const next = vi.fn();
    const res = makeRes();
    requirePro({ user: { sub: "U1", role: "USER", status: "ACTIVE" } } as never, res as never, next as never);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
  });

  it("rejeita USER sem pro com 403 e code PRO_REQUIRED", async () => {
    userFind.mockResolvedValue({ role: "USER", pro: false, status: "ACTIVE" });
    const next = vi.fn();
    const res = makeRes();
    requirePro({ user: { sub: "U1", role: "USER", status: "ACTIVE" } } as never, res as never, next as never);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(403));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "PRO_REQUIRED" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("rejeita USER sem token com 401", () => {
    const next = vi.fn();
    const res = makeRes();
    requirePro({ user: undefined } as never, res as never, next as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
