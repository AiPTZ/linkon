import { describe, expect, it, vi, beforeEach } from "vitest";
import { ZodError } from "zod";

vi.mock("../services/inbox.service", () => ({
  listInbox: vi.fn(),
  listMessages: vi.fn(),
  sendHumanMessage: vi.fn(),
  claimConversation: vi.fn(),
  reactivateConversation: vi.fn(),
  markConversationRead: vi.fn(),
  updateConversation: vi.fn(),
  suggestReply: vi.fn(),
}));

import { inboxRouter } from "./inbox.routes";
import {
  listInbox,
  listMessages,
  sendHumanMessage,
  claimConversation,
  reactivateConversation,
  markConversationRead,
  updateConversation,
  suggestReply,
} from "../services/inbox.service";

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
  const fullReq = { user: { sub: "U1", role: "USER" }, headers: {}, query: {}, body: {}, params: { id: "CV1" }, ...req };
  handle(fullReq, res, next);
  await new Promise((r) => setTimeout(r, 0));
  return { res, next };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /", () => {
  it("repassa offset/limit para listInbox", async () => {
    (listInbox as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [], needsHuman: 0, total: 0, hasMore: false });
    const { res } = await invokeRoute("get", "/", { query: { offset: "10", limit: "25" } });
    expect(listInbox).toHaveBeenCalledWith("U1", { offset: 10, limit: 25 });
    expect(res.statusCode).toBe(200);
    expect(res.body.hasMore).toBe(false);
  });

  it("usa defaults quando offset/limit não são numéricos", async () => {
    (listInbox as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [], needsHuman: 0, total: 0, hasMore: false });
    const { res } = await invokeRoute("get", "/", { query: { offset: "abc", limit: "-3" } });
    expect(listInbox).toHaveBeenCalledWith("U1", { offset: 0, limit: 50 });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /:id/messages", () => {
  it("repassa cursor e limit", async () => {
    (listMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ items: [], nextCursor: null });
    const { res } = await invokeRoute("get", "/:id/messages", { query: { cursor: "M1", limit: "10" } });
    expect(listMessages).toHaveBeenCalledWith("CV1", "U1", { cursor: "M1", limit: 10 });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /:id/read", () => {
  it("retorna 204", async () => {
    (markConversationRead as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const { res } = await invokeRoute("post", "/:id/read", {});
    expect(markConversationRead).toHaveBeenCalledWith("CV1", "U1");
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });
});

describe("PATCH /:id", () => {
  it("atualiza nota e resolvida", async () => {
    (updateConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", note: "x", resolved: true });
    const { res } = await invokeRoute("patch", "/:id", { body: { note: "x", resolved: true } });
    expect(updateConversation).toHaveBeenCalledWith("CV1", "U1", { note: "x", resolved: true });
    expect(res.body.resolved).toBe(true);
  });

  it("rejeita campos inválidos com ZodError", async () => {
    const { next } = await invokeRoute("patch", "/:id", { body: { note: 123 } });
    expect(next).toHaveBeenCalledWith(expect.any(ZodError));
  });
});

describe("POST /:id/suggest-reply", () => {
  it("retorna rascunho e custo", async () => {
    (suggestReply as ReturnType<typeof vi.fn>).mockResolvedValue({ reply: "Rascunho", costUsd: 0.001 });
    const { res } = await invokeRoute("post", "/:id/suggest-reply", {});
    expect(suggestReply).toHaveBeenCalledWith("CV1", "U1", undefined);
    expect(res.body.reply).toBe("Rascunho");
  });

  it("retorna 502 quando o LLM falha", async () => {
    (suggestReply as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("LLM down"));
    const { res } = await invokeRoute("post", "/:id/suggest-reply", {});
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("Falha ao gerar resposta");
  });
});
