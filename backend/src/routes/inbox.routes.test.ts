import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("../services/unipile.service", () => ({ unipile: { sendChatMessage: vi.fn() } }));

import { prisma } from "../lib/prisma";
import { inboxRouter } from "./inbox.routes";

type MockReq = {
  user?: unknown;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
  params?: Record<string, string>;
};

async function invokeRoute(method: "get" | "post" | "patch", path: string, req: MockReq) {
  const layer = (
    inboxRouter as unknown as {
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
  const fullReq = { user: { sub: "U1", role: "USER" }, headers: {}, query: {}, body: {}, params: {}, ...req };
  handle(fullReq, res, next);
  await new Promise((r) => setTimeout(r, 0));
  return { res, next };
}

beforeEach(() => vi.clearAllMocks());

describe("inbox routes placeholder", () => {
  it("is overwritten by a later task", () => {
    expect(true).toBe(true);
  });
});
