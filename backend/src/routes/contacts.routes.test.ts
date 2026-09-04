import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: { account: { findUnique: vi.fn(), findMany: vi.fn() } },
}));
vi.mock("../services/network.service", () => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
  scheduleContactScrape: vi.fn(),
  buildContactsXlsx: vi.fn(),
}));
vi.mock("../services/queue.service", () => ({ contactsQueue: { add: vi.fn() } }));

import { ApiError } from "../utils/errors";
import { prisma } from "../lib/prisma";
import { buildContactsXlsx, getContact, scheduleContactScrape } from "../services/network.service";
import { contactsQueue } from "../services/queue.service";
import { syncSchema, scrapeSchema, parseListQuery, contactsRouter } from "./contacts.routes";

async function invokeRoute(
  method: "get" | "post",
  path: string,
  overrides: Record<string, unknown> = {},
): Promise<{ res: Record<string, any>; next: ReturnType<typeof vi.fn> }> {
  const layer = (
    contactsRouter as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods?: Record<string, boolean>;
          stack: Array<{ handle: unknown }>;
        };
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
    sent: undefined,
    headers: {} as Record<string, string>,
    status(this: Record<string, any>, code: number) {
      this.statusCode = code;
      return this;
    },
    json(this: Record<string, any>, body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(this: Record<string, any>, name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    send(this: Record<string, any>, body: unknown) {
      this.sent = body;
      return this;
    },
    end(this: Record<string, any>) {
      this.ended = true;
      return this;
    },
  };
  const next = vi.fn();
  const fullReq = { user: { sub: "U1", role: "USER" }, headers: {}, query: {}, body: {}, params: {}, ...overrides };
  handle(fullReq, res, next);
  await new Promise((r) => setTimeout(r, 0));
  return { res, next };
}

beforeEach(() => vi.clearAllMocks());

describe("contacts.routes helpers", () => {
  it("syncSchema aceita accountId", () => {
    expect(syncSchema.parse({ accountId: "A1" })).toEqual({ accountId: "A1" });
  });

  it("syncSchema rejeita sem accountId", () => {
    expect(() => syncSchema.parse({})).toThrow();
  });

  it("scrapeSchema aceita contactIds opcional", () => {
    expect(scrapeSchema.parse({ contactIds: ["CT1"] })).toEqual({ contactIds: ["CT1"] });
    expect(scrapeSchema.parse({})).toEqual({});
  });

  it("parseListQuery converte filtros de query", () => {
    const filters = parseListQuery({
      q: "joao",
      onlyWithContact: "1",
      accountId: "A1",
      scraped: "true",
      limit: "50",
    });
    expect(filters).toEqual({
      q: "joao",
      onlyWithContact: true,
      accountId: "A1",
      scraped: true,
      limit: 50,
    });
  });
});

describe("GET /export-xlsx", () => {
  it("rejeita sem accountId para usuário não-admin (não vaza dados de outras contas)", async () => {
    const { next } = await invokeRoute("get", "/export-xlsx", {});
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect(buildContactsXlsx).not.toHaveBeenCalled();
  });

  it("gera o xlsx para uma conta dentro do escopo", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A1",
      userId: "U1",
    });
    (buildContactsXlsx as ReturnType<typeof vi.fn>).mockResolvedValue({
      buffer: Buffer.from("xlsx"),
      filename: "contatos-rede.xlsx",
    });
    const { res, next } = await invokeRoute("get", "/export-xlsx", {
      query: { accountId: "A1", providerIds: "P1,P2" },
    });
    expect(next).not.toHaveBeenCalled();
    expect(buildContactsXlsx).toHaveBeenCalledWith("A1", ["P1", "P2"]);
    expect(res.headers["Content-Type"]).toContain("spreadsheetml");
    expect(res.headers["Content-Disposition"]).toContain("contatos-rede.xlsx");
    expect(res.sent).toEqual(Buffer.from("xlsx"));
  });

  it("rejeita conta fora do escopo", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A2",
      userId: "OUTRO",
    });
    const { next } = await invokeRoute("get", "/export-xlsx", {
      query: { accountId: "A2" },
    });
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });
});

describe("POST /sync", () => {
  it("enfileira sync-network para conta dentro do escopo", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A1",
      userId: "U1",
    });
    const { res, next } = await invokeRoute("post", "/sync", {
      body: { accountId: "A1" },
    });
    expect(next).not.toHaveBeenCalled();
    expect(contactsQueue.add).toHaveBeenCalledWith("sync-network", { accountId: "A1" });
    expect(res.body).toEqual({ ok: true });
  });

  it("propaga autoScrape para o job", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A1",
      userId: "U1",
    });
    const { res, next } = await invokeRoute("post", "/sync", {
      body: { accountId: "A1", autoScrape: true },
    });
    expect(next).not.toHaveBeenCalled();
    expect(contactsQueue.add).toHaveBeenCalledWith("sync-network", {
      accountId: "A1",
      autoScrape: true,
    });
    expect(res.body).toEqual({ ok: true });
  });

  it("rejeita conta fora do escopo", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A2",
      userId: "OUTRO",
    });
    const { next } = await invokeRoute("post", "/sync", {
      body: { accountId: "A2" },
    });
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });
});

describe("POST /scrape", () => {
  it("agenda scrape para todas as contas do escopo quando sem contactIds", async () => {
    (prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "A1" },
      { id: "A2" },
    ]);
    (scheduleContactScrape as ReturnType<typeof vi.fn>).mockResolvedValue({ scheduled: 2 });
    const { res, next } = await invokeRoute("post", "/scrape", { body: {} });
    expect(next).not.toHaveBeenCalled();
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { userId: "U1" },
      select: { id: true },
    });
    expect(scheduleContactScrape).toHaveBeenCalledWith("A1", undefined);
    expect(scheduleContactScrape).toHaveBeenCalledWith("A2", undefined);
    expect(res.body).toEqual({ ok: true, scheduled: 4 });
  });

  it("agenda scrape dos contactIds selecionados", async () => {
    (getContact as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "CT1",
      accountId: "A1",
    });
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A1",
      userId: "U1",
    });
    (scheduleContactScrape as ReturnType<typeof vi.fn>).mockResolvedValue({ scheduled: 1 });
    const { res, next } = await invokeRoute("post", "/scrape", {
      body: { contactIds: ["CT1"] },
    });
    expect(next).not.toHaveBeenCalled();
    expect(scheduleContactScrape).toHaveBeenCalledWith("A1", ["CT1"]);
    expect(res.body).toEqual({ ok: true, scheduled: 1 });
  });

  it("com accountId + onlyMissing agenda extração dos faltantes da conta", async () => {
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "A1",
      userId: "U1",
    });
    (scheduleContactScrape as ReturnType<typeof vi.fn>).mockResolvedValue({ scheduled: 3 });
    const { res, next } = await invokeRoute("post", "/scrape", {
      body: { accountId: "A1", onlyMissing: true },
    });
    expect(next).not.toHaveBeenCalled();
    expect(prisma.account.findMany).not.toHaveBeenCalled();
    expect(scheduleContactScrape).toHaveBeenCalledWith("A1", undefined, { onlyMissing: true });
    expect(res.body).toEqual({ ok: true, scheduled: 3 });
  });
});
