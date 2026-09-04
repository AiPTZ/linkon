import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    account: { findUnique: vi.fn() },
    contact: { upsert: vi.fn(), findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({
  unipile: { getRelations: vi.fn(), getUserContactDetails: vi.fn() },
}));

vi.mock("./queue.service", () => ({ contactsQueue: { add: vi.fn() } }));
vi.mock("./log.service", () => ({ createLog: vi.fn() }));
vi.mock("../utils/time", () => ({ sleep: () => Promise.resolve(), randomInt: () => 3_000 }));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { contactsQueue } from "./queue.service";
import {
  syncAccountNetwork,
  scrapeContactById,
  scheduleContactScrape,
  buildContactsXlsx,
  listContacts,
  getContact,
  upsertRelationContact,
  relationName,
  networkLabel,
  parseList,
} from "./network.service";
import { UnipileError } from "../utils/errors";

const contactUpsert = prisma.contact.upsert as ReturnType<typeof vi.fn>;
const contactFindMany = prisma.contact.findMany as ReturnType<typeof vi.fn>;
const contactCount = prisma.contact.count as ReturnType<typeof vi.fn>;
const accountFind = prisma.account.findUnique as ReturnType<typeof vi.fn>;
const queueAdd = contactsQueue.add as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

const account = { id: "A1", unipileAccountId: "UA1", providerId: "P1", status: "OK" };

describe("relationName", () => {
  it("une primeiro e último nome", () => {
    expect(relationName({ first_name: "Ana", last_name: "Silva" })).toBe("Ana Silva");
  });

  it("usa public_identifier quando sem nome", () => {
    expect(relationName({ public_identifier: "ana-silva" })).toBe("ana-silva");
  });
});

describe("networkLabel / parseList", () => {
  it("traduz grau de rede", () => {
    expect(networkLabel("FIRST_DEGREE")).toBe("1º grau");
  });

  it("faz parse de lista JSON string", () => {
    expect(parseList('["a@b.com"]')).toEqual(["a@b.com"]);
  });
});

describe("syncAccountNetwork", () => {
  it("upsert de contatos por página, acumulativo", async () => {
    accountFind.mockResolvedValue(account);
    (unipile.getRelations as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        items: [{ member_id: "M1", public_identifier: "m1", first_name: "João", headline: "Dev", public_profile_url: "https://linkedin.com/in/m1" }],
        cursor: "next",
      })
      .mockResolvedValueOnce({ items: [{ member_id: "M2" }] });

    const result = await syncAccountNetwork("A1");

    expect(result).toEqual({ imported: 2, total: 2 });
    expect(contactUpsert).toHaveBeenCalledWith({
      where: { accountId_providerId: { accountId: "A1", providerId: "M1" } },
      update: {},
      create: {
        accountId: "A1",
        providerId: "M1",
        publicIdentifier: "m1",
        name: "João",
        headline: "Dev",
        profileUrl: "https://linkedin.com/in/m1",
        networkDistance: "FIRST_DEGREE",
      },
    });
    expect(unipile.getRelations).toHaveBeenNthCalledWith(1, "UA1", undefined, 1000);
    expect(unipile.getRelations).toHaveBeenNthCalledWith(2, "UA1", "next", 1000);
  });

  it("lança erro quando conta não existe", async () => {
    accountFind.mockResolvedValue(null);
    await expect(syncAccountNetwork("A1")).rejects.toThrow("Conta vinculada não encontrada");
  });
});

describe("scrapeContactById", () => {
  it("grava emails, phones, socials, networkDistance e scrapedAt", async () => {
    accountFind.mockResolvedValue(account);
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ id: "CT1", accountId: "A1", providerId: "M1", name: "João" });
    (unipile.getUserContactDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      emails: ["j@b.com"],
      phones: ["11 99999"],
      socials: ["https://site.com"],
      networkDistance: "FIRST_DEGREE",
    });

    await scrapeContactById("CT1");

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "CT1" },
      data: {
        emails: JSON.stringify(["j@b.com"]),
        phones: JSON.stringify(["11 99999"]),
        socials: JSON.stringify(["https://site.com"]),
        networkDistance: "FIRST_DEGREE",
        scrapedAt: expect.any(Date),
      },
    });
  });

  it("marca scrapedAt em erro não retryável", async () => {
    accountFind.mockResolvedValue(account);
    (prisma.contact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CT1", accountId: "A1", providerId: "M1" });
    (unipile.getUserContactDetails as ReturnType<typeof vi.fn>).mockRejectedValue(
      new UnipileError(400, "profile not accessible", "profile not accessible"),
    );

    await scrapeContactById("CT1");

    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: "CT1" },
      data: { scrapedAt: expect.any(Date) },
    });
  });
});

describe("scheduleContactScrape", () => {
  it("enfileira jobs com espaçamento para ids selecionados", async () => {
    contactFindMany.mockResolvedValue([{ id: "CT1" }, { id: "CT2" }]);

    const result = await scheduleContactScrape("A1", ["CT1", "CT2"]);

    expect(result).toEqual({ scheduled: 2 });
    expect(queueAdd).toHaveBeenCalledTimes(2);
    expect(queueAdd).toHaveBeenNthCalledWith(1, "scrape", { contactId: "CT1", accountId: "A1" }, expect.objectContaining({ delay: 0 }));
    expect(queueAdd).toHaveBeenNthCalledWith(2, "scrape", { contactId: "CT2", accountId: "A1" }, expect.objectContaining({ delay: 1500 }));
  });

  it("sem ids, seleciona contatos sem scrapedAt", async () => {
    contactFindMany.mockResolvedValue([]);
    await scheduleContactScrape("A1");
    expect(contactFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: "A1", scrapedAt: null } }));
  });

  it("com onlyMissing, seleciona contatos sem e-mail ou telefone", async () => {
    contactFindMany.mockResolvedValue([]);
    await scheduleContactScrape("A1", [], { onlyMissing: true });
    const where = contactFindMany.mock.calls[0][0].where;
    expect(where.accountId).toBe("A1");
    expect(where.OR).toHaveLength(2);
    expect(JSON.stringify(where.OR)).toContain('"phones"');
    expect(JSON.stringify(where.OR)).toContain('"emails"');
  });
});

describe("listContacts", () => {
  it("aplica escopo e filtros", async () => {
    contactFindMany.mockResolvedValue([{ id: "CT1", account: { id: "A1", username: "u1" } }]);
    contactCount.mockResolvedValue(1);

    const result = await listContacts("U1", { q: "jo", onlyWithContact: true, limit: 50 });

    expect(result.total).toBe(1);
    expect(contactFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it("admin sem escopo não filtra por usuário", async () => {
    contactFindMany.mockResolvedValue([]);
    contactCount.mockResolvedValue(0);
    await listContacts(null, {});
    const arg = contactFindMany.mock.calls[0][0];
    expect(arg.where).not.toHaveProperty("account");
  });
});

describe("getContact", () => {
  it("busca por id com escopo", async () => {
    (prisma.contact.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CT1", account: { id: "A1", username: "u1" } });
    const out = await getContact("CT1", "U1");
    expect(out?.id).toBe("CT1");
  });
});

describe("upsertRelationContact", () => {
  it("upsert de contato por accountId + providerId", async () => {
    await upsertRelationContact("A1", "M1", "João");
    expect(contactUpsert).toHaveBeenCalledWith({
      where: { accountId_providerId: { accountId: "A1", providerId: "M1" } },
      update: {},
      create: { accountId: "A1", providerId: "M1", name: "João" },
    });
  });
});

describe("buildContactsXlsx", () => {
  it("gera buffer com colunas", async () => {
    contactFindMany.mockResolvedValue([{ id: "CT1", name: "João", headline: "Dev", profileUrl: "u", emails: '["a@b.com"]', phones: null, socials: null, networkDistance: "FIRST_DEGREE", scrapedAt: new Date(), createdAt: new Date(), accountId: "A1", providerId: "M1", publicIdentifier: "m1" }]);
    const out = await buildContactsXlsx(null, []);
    expect(out.buffer).toBeInstanceOf(Buffer);
    expect(out.filename).toContain("contatos");
  });
});
