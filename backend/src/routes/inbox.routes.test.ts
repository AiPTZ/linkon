import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../services/ai.service", () => ({
  generateHumanReply: vi.fn(),
  parseKnowledgeBase: (raw: string) => JSON.parse(raw || "{}"),
  estimateCost: (tIn: number, tOut: number) => (tIn / 1_000_000) * 0.15 + (tOut / 1_000_000) * 0.6,
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("../services/unipile.service", () => ({ unipile: { sendChatMessage: vi.fn() } }));

import { prisma } from "../lib/prisma";
import { generateHumanReply } from "../services/ai.service";
import { inboxRouter } from "./inbox.routes";
import { ApiError } from "../utils/errors";

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

describe("POST /:id/suggest-reply", () => {
  it("gera rascunho com base na última mensagem do lead e na base do agente", async () => {
    (generateHumanReply as ReturnType<typeof vi.fn>).mockResolvedValue({ reply: "A partir de R$ 97/mês.", tokensIn: 100, tokensOut: 20 });
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "CV1",
      accountId: "A1",
      lead: { name: "João", headline: "CEO" },
      account: { nativeAgent: { knowledgeBase: JSON.stringify({ product: "LinkON", faq: [], prices: [], differentiators: [], objections: [] }), tone: "consultivo" } },
    });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "LEAD", content: "qual o preço?", createdAt: new Date("2026-09-01T10:00:00Z") },
      { role: "BOT", content: "Posso ajudar!", createdAt: new Date("2026-09-01T10:01:00Z") },
    ]);
    const { res } = await invokeRoute("post", "/:id/suggest-reply", { params: { id: "CV1" } });
    expect(res.body.reply).toContain("R$ 97");
    expect(res.body.costUsd).toBeCloseTo(100 / 1_000_000 * 0.15 + 20 / 1_000_000 * 0.6);
    expect(generateHumanReply).toHaveBeenCalledWith(
      expect.objectContaining({ productName: "LinkON", message: "qual o preço?" }),
    );
  });

  it("devolve 400 quando não há mensagem para responder", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "CV1",
      accountId: "A1",
      lead: null,
      account: { nativeAgent: null },
    });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { next } = await invokeRoute("post", "/:id/suggest-reply", { params: { id: "CV1" } });
    expect((next.mock.calls[0][0] as ApiError).status).toBe(400);
  });

  it("devolve 502 quando o LLM falha", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "CV1",
      accountId: "A1",
      lead: { name: "João", headline: "CEO" },
      account: { nativeAgent: { knowledgeBase: JSON.stringify({ product: "LinkON" }), tone: "consultivo" } },
    });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { role: "LEAD", content: "qual o preço?", createdAt: new Date("2026-09-01T10:00:00Z") },
    ]);
    (generateHumanReply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM HTTP 500"));
    const { res } = await invokeRoute("post", "/:id/suggest-reply", { params: { id: "CV1" } });
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("Falha ao gerar resposta");
  });
});
