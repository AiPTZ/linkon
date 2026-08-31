import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../services/broadcast.service", () => ({
  importBroadcastLeads: vi.fn(),
  setLeadSelection: vi.fn(),
}));
vi.mock("../services/contacts.service", () => ({
  buildLeadsXlsx: vi.fn(),
  contactScrapeStats: vi.fn(),
  scheduleContactScrape: vi.fn(),
}));
vi.mock("../services/campaign.service", () => ({
  pauseCampaign: vi.fn(),
  resumeCampaign: vi.fn(),
  startCampaign: vi.fn(),
}));
vi.mock("../services/flow.service", () => ({
  BLOCK_TYPES: ["start", "invite", "message", "wait", "on_accept", "on_reply", "condition", "stop"],
  validateFlow: vi.fn(() => ({ ok: true, errors: [] })),
  serializeFlow: vi.fn((f: unknown) => JSON.stringify(f)),
}));

import { campaignSchema, updateCampaignSchema, toData, withCadence } from "./campaigns.routes";
import type { Campaign } from "@prisma/client";

const base = { name: "D", mode: "DISPARO", accountId: "A1" };

describe("campaignSchema (cadência)", () => {
  it("aceita cadence no modo DISPARO", () => {
    const parsed = campaignSchema.parse({ ...base, cadence: [{ body: "Oi {nome}", waitDays: 3 }] });
    expect(parsed.cadence).toHaveLength(1);
  });

  it("aceita inviteMessage omitido quando cadence está presente", () => {
    const parsed = campaignSchema.parse({ ...base, cadence: [{ body: "Oi", waitDays: 3 }] });
    expect(parsed.inviteMessage).toBe("");
  });

  it("aceita até 5 itens", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ body: `c${i}`, waitDays: 1 }));
    const parsed = campaignSchema.parse({ ...base, cadence: five });
    expect(parsed.cadence).toHaveLength(5);
  });

  it("rejeita 6 itens", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ body: `c${i}`, waitDays: 1 }));
    expect(() => campaignSchema.parse({ ...base, cadence: six })).toThrow();
  });

  it("rejeita cadence fora do modo DISPARO", () => {
    expect(() =>
      campaignSchema.parse({
        name: "S",
        mode: "SEARCH",
        accountId: "A1",
        searchUrl: "https://linkedin.com/search",
        cadence: [{ body: "Oi", waitDays: 3 }],
      }),
    ).toThrow();
  });
});

describe("updateCampaignSchema (cadência)", () => {
  it("aceita cadence em PUT parcial", () => {
    const parsed = updateCampaignSchema.parse({ cadence: [{ body: "oi", waitDays: 2 }] });
    expect(parsed.cadence).toHaveLength(1);
  });
});

describe("toData (cadência)", () => {
  it("serializa cadence para JSON string", () => {
    const data = toData({ cadence: [{ body: "oi", waitDays: 2 }] } as Parameters<typeof toData>[0]);
    expect(data.cadence).toBe('[{"body":"oi","waitDays":2}]');
  });

  it("não define cadence quando ausente", () => {
    const data = toData({ name: "D" } as Parameters<typeof toData>[0]);
    expect(data.cadence).toBeUndefined();
  });
});

describe("withCadence", () => {
  it("parseia a string do banco para array na resposta", () => {
    const out = withCadence({ id: "C1", cadence: '[{"body":"oi","waitDays":2}]' } as Partial<Campaign>);
    expect((out.cadence as { body: string; waitDays: number }[])).toEqual([
      { body: "oi", waitDays: 2 },
    ]);
  });

  it("retorna array vazio quando cadence é inválida", () => {
    const out = withCadence({ id: "C1", cadence: "não é json" } as Partial<Campaign>);
    expect(out.cadence).toEqual([]);
  });
});
