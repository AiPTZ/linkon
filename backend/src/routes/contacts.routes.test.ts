import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("../services/network.service", () => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
  scheduleContactScrape: vi.fn(),
  buildContactsXlsx: vi.fn(),
}));
vi.mock("../services/queue.service", () => ({ contactsQueue: { add: vi.fn() } }));

import { syncSchema, scrapeSchema, parseListQuery } from "./contacts.routes";

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
