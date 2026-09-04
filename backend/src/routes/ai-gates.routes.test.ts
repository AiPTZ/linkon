import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "../utils/errors";

vi.mock("../lib/prisma", () => ({
  prisma: {
    campaign: { findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    account: { findUnique: vi.fn() },
    nativeAgent: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("../config/env", () => ({ env: {} }));
vi.mock("../services/campaign.service", () => ({
  pauseCampaign: vi.fn(),
  resumeCampaign: vi.fn(),
  startCampaign: vi.fn(),
}));
vi.mock("../services/contacts.service", () => ({
  buildLeadsXlsx: vi.fn(),
  contactScrapeStats: vi.fn(),
  scheduleContactScrape: vi.fn(),
}));
vi.mock("../services/broadcast.service", () => ({
  importBroadcastLeads: vi.fn(),
  setLeadSelection: vi.fn(),
}));
vi.mock("../services/flow.service", () => ({
  validateFlow: () => ({ ok: true, errors: [] }),
  serializeFlow: (x: unknown) => JSON.stringify(x),
  BLOCK_TYPES: ["start", "invite", "message", "wait", "on_accept", "on_reply", "condition", "stop"],
}));
vi.mock("../services/scheduling.service", () => ({
  parseWindowsInput: (x: unknown) => x,
}));

import { prisma } from "../lib/prisma";
import { inboxRouter } from "./inbox.routes";
import { agentsRouter } from "./agents.routes";
import { calendarRouter } from "./calendar.routes";

function assertGuardOnRouter(router: unknown, expectGuard: boolean, route?: string) {
  type Layer = {
    route?: { path?: string; stack: Array<{ handle?: { name?: string } }> };
    handle?: { name?: string };
  };
  const stack = (router as { stack: Layer[] }).stack;
  const layers = route ? stack.filter((l) => l.route && l.route.path === route) : stack;
  const found = layers.some((l) => {
    if (l.route) return l.route.stack.some((h) => h.handle?.name === "requirePro");
    return l.handle?.name === "requirePro";
  });
  if (expectGuard) expect(found).toBe(true);
  else expect(found).toBe(false);
}

beforeEach(() => vi.clearAllMocks());

describe("gates de IA por rota", () => {
  it("agentsRouter possui requirePro", () => {
    assertGuardOnRouter(agentsRouter, true);
  });

  it("calendarRouter possui requirePro", () => {
    assertGuardOnRouter(calendarRouter, true);
  });

  it("suggest-reply no inboxRouter possui requirePro", () => {
    assertGuardOnRouter(inboxRouter, true, "/:id/suggest-reply");
  });
});

describe("campaign PUT gate agentEnabled", () => {
  it("responde 403 PRO para USER sem pro tentando ativar o bot", async () => {
    (prisma.campaign.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "C1", mode: "SEARCH" });
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      role: "USER",
      pro: false,
      status: "ACTIVE",
    });

    const { campaignsRouter } = await import("./campaigns.routes");
    const layer = (
      campaignsRouter as unknown as {
        stack: Array<{
          route?: { path?: string; methods?: Record<string, boolean>; stack: Array<{ handle: (...a: unknown[]) => unknown }> };
        }>;
      }
    ).stack.find((l) => l.route && l.route.path === "/:id" && l.route.methods?.put);
    if (!layer?.route) throw new Error("PUT /:id not found");
    const handle = layer.route.stack[layer.route.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => void;

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const req = { user: { sub: "U1", role: "USER" }, params: { id: "C1" }, body: { agentEnabled: true } };

    await handle(req, res, next);
    await new Promise((r) => setTimeout(r, 0));

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "U1" }, select: { role: true, pro: true, status: true } }),
    );
    expect(prisma.campaign.update).not.toHaveBeenCalled();
    const [err] = next.mock.calls[0] ?? [];
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe(
      "O bot com IA é um recurso da Versão PRO. Fale com o administrador para liberar.",
    );
  });
});

describe("campaign POST gate agentEnabled", () => {
  it("cria campanha sem bot de IA (agentEnabled=false) para USER sem pro quando o campo é omitido", async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      role: "USER",
      pro: false,
      status: "ACTIVE",
    });
    (prisma.account.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ACC",
      userId: "U1",
    });
    (prisma.campaign.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "C1",
      cadence: null,
    });

    const { campaignsRouter } = await import("./campaigns.routes");
    const layer = (
      campaignsRouter as unknown as {
        stack: Array<{
          route?: { path?: string; methods?: Record<string, boolean>; stack: Array<{ handle: (...a: unknown[]) => unknown }> };
        }>;
      }
    ).stack.find((l) => l.route && l.route.path === "/" && l.route.methods?.post);
    if (!layer?.route) throw new Error("POST / not found");
    const handle = layer.route.stack[layer.route.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => void;

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    const req = {
      user: { sub: "U1", role: "USER" },
      body: { name: "Campanha Kennedy", mode: "SEARCH", accountId: "ACC", searchUrl: "https://www.linkedin.com/search/results/people/?keywords=a" },
    };

    await handle(req, res, next);
    await new Promise((r) => setTimeout(r, 0));

    expect(next).not.toHaveBeenCalled();
    expect(prisma.campaign.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ agentEnabled: false }) }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
