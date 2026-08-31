import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/errors";
import { decrypt } from "../utils/crypto";

vi.mock("../lib/prisma", () => ({
  prisma: {
    calendarConnection: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    sellerAvailability: { findUnique: vi.fn(), upsert: vi.fn() },
    booking: { findMany: vi.fn() },
  },
}));

vi.mock("../config/env", () => ({
  env: {
    GOOGLE_CLIENT_ID: "GID",
    GOOGLE_CLIENT_SECRET: "GSEC",
    GOOGLE_REDIRECT_URI: "http://localhost:3001/api/calendar/oauth/callback",
    AUTH_SECRET: "test-auth-secret-0123456789",
    FRONTEND_ORIGIN: "http://localhost:5173",
    CREDENTIALS_ENCRYPTION_KEY: "test-encryption-key-0123456789",
  },
}));

vi.mock("../services/scheduling.service", () => ({
  parseWindowsInput: (windows: unknown) => windows,
}));

import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { calendarRouter, handleOAuthCallback } from "./calendar.routes";

type MockReq = {
  user?: unknown;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
};

async function invokeRoute(method: "get" | "put" | "post", path: string, req: MockReq) {
  const layer = (
    calendarRouter as unknown as {
      stack: Array<{
        route?: { path?: string; methods?: Record<string, boolean>; stack: Array<{ handle: (...a: unknown[]) => unknown }> };
      }>;
    }
  ).stack.find(
    (l) => l.route && l.route.path === path && l.route.methods?.[method.toLowerCase()],
  );
  if (!layer?.route) throw new Error(`route ${method} ${path} not found`);
  const handlers = layer.route.stack;
  const handle = handlers[handlers.length - 1].handle as (
    req: unknown,
    res: unknown,
    next: unknown,
  ) => void;
  const res: Record<string, any> = {
    statusCode: 200,
    body: undefined,
    status(this: Record<string, any>, code: number) {
      this.statusCode = code;
      return this;
    },
    json(this: Record<string, any>, body: unknown) {
      this.body = body;
      return this;
    },
    end(this: Record<string, any>) {
      this.ended = true;
      return this;
    },
  };
  const next = vi.fn();
  const fullReq = { user: { sub: "U1", role: "USER" }, headers: {}, query: {}, body: {}, ...req };
  handle(fullReq, res, next);
  await new Promise((r) => setTimeout(r, 0));
  return { res, next };
}

async function withEnv(mutate: () => void, fn: () => Promise<void>) {
  const orig = { ...env };
  mutate();
  try {
    await fn();
  } finally {
    Object.assign(env, orig);
  }
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("GET /status", () => {
  it("devolve connected=false sem conexão", async () => {
    (prisma.calendarConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { res } = await invokeRoute("get", "/status", {});
    expect(res.body).toEqual({ connected: false, googleEmail: "", disconnectedAt: null });
  });

  it("devolve connected=true quando CONNECTED", async () => {
    (prisma.calendarConnection.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "CONNECTED",
      googleEmail: "vendedor@x.com",
      disconnectedAt: null,
    });
    const { res } = await invokeRoute("get", "/status", {});
    expect(res.body).toEqual({ connected: true, googleEmail: "vendedor@x.com", disconnectedAt: null });
  });
});

describe("GET /oauth/url", () => {
  it("devolve url com state assinado", async () => {
    const { res } = await invokeRoute("get", "/oauth/url", {});
    expect(res.body.url).toContain("accounts.google.com");
    expect(res.body.url).toContain("state=");
  });

  it("erro 500 quando OAuth não configurado", async () => {
    await withEnv(() => { env.GOOGLE_CLIENT_ID = ""; }, async () => {
      const { next } = await invokeRoute("get", "/oauth/url", {});
      expect((next.mock.calls[0][0] as ApiError).status).toBe(500);
    });
  });

  it("erro 400 para admin sem x-operate-as", async () => {
    const { next } = await invokeRoute("get", "/oauth/url", {
      user: { sub: "ADMIN", role: "ADMIN" },
    });
    expect((next.mock.calls[0][0] as ApiError).status).toBe(400);
  });
});

describe("PUT /availability", () => {
  it("persiste janelas normalizadas e devolve", async () => {
    (prisma.sellerAvailability.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const windows = [{ weekday: 1, startMin: 540, endMin: 1080 }];
    const { res } = await invokeRoute("put", "/availability", { body: windows });
    expect(prisma.sellerAvailability.upsert).toHaveBeenCalledWith({
      where: { userId: "U1" },
      update: { windows: JSON.stringify(windows) },
      create: { userId: "U1", windows: JSON.stringify(windows) },
    });
    expect(res.body).toEqual({ windows });
  });

  it("erro 400 para corpo inválido", async () => {
    const { next } = await invokeRoute("put", "/availability", { body: [{ weekday: 1 }] });
    expect((next.mock.calls[0][0] as ApiError).status).toBe(400);
  });
});

describe("GET /availability", () => {
  it("devolve janelas salvas", async () => {
    const windows = [{ weekday: 2, startMin: 480, endMin: 720 }];
    (prisma.sellerAvailability.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      windows: JSON.stringify(windows),
    });
    const { res } = await invokeRoute("get", "/availability", {});
    expect(res.body).toEqual({ windows });
  });

  it("devolve [] quando windows inválidos", async () => {
    (prisma.sellerAvailability.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      windows: "não é json",
    });
    const { res } = await invokeRoute("get", "/availability", {});
    expect(res.body).toEqual({ windows: [] });
  });
});

describe("POST /disconnect", () => {
  it("marca desconectado e responde 204", async () => {
    (prisma.calendarConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { res } = await invokeRoute("post", "/disconnect", {});
    expect(prisma.calendarConnection.update).toHaveBeenCalledWith({
      where: { userId: "U1" },
      data: { status: "DISCONNECTED", refreshToken: "", disconnectedAt: expect.any(Date) },
    });
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });
});

describe("GET /bookings", () => {
  it("devolve bookings confirmados mapeados", async () => {
    (prisma.booking.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "B1",
        startTime: new Date("2026-09-01T12:00:00Z"),
        endTime: new Date("2026-09-01T12:30:00Z"),
        title: "Reunião",
        meetLink: "https://meet.google.com/abc",
        leadEmail: "joao@x.com",
        leadName: "João",
      },
    ]);
    const { res } = await invokeRoute("get", "/bookings", { query: {} });
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "U1", status: "CONFIRMED" }),
        take: 100,
      }),
    );
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: "B1", leadName: "João", title: "Reunião" });
  });
});

describe("handleOAuthCallback", () => {
  it("troca code, persiste refreshToken criptografado e devolve URL de redirect", async () => {
    const state = jwt.sign({ sub: "U1" }, env.AUTH_SECRET, { expiresIn: "10m" });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ refresh_token: "RT", access_token: "AT" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: "vendedor@x.com" }) });
    vi.stubGlobal("fetch", fetchFn as unknown as typeof fetch);

    const url = await handleOAuthCallback("CODE", state);

    expect(url).toBe("http://localhost:5173/configuracoes?calendar=connected");
    expect(prisma.calendarConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "U1" },
        update: expect.objectContaining({ googleEmail: "vendedor@x.com", status: "CONNECTED" }),
      }),
    );
    const arg = (prisma.calendarConnection.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(decrypt(arg.update.refreshToken)).toBe("RT");
    expect(decrypt(arg.create.refreshToken)).toBe("RT");
  });

  it("rejeita com 400 para state inválido", async () => {
    await expect(handleOAuthCallback("CODE", "state-inexistente")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejeita com 400 para parâmetros ausentes", async () => {
    await expect(handleOAuthCallback(undefined, undefined)).rejects.toMatchObject({ status: 400 });
  });

  it("rejeita com 500 quando OAuth não configurado", async () => {
    await withEnv(() => { env.GOOGLE_CLIENT_ID = ""; }, async () => {
      await expect(handleOAuthCallback("CODE", "x")).rejects.toMatchObject({ status: 500 });
    });
  });
});
