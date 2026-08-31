import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({ unipile: { sendChatMessage: vi.fn() } }));

vi.mock("../services/ai.service", () => ({
  generateHumanReply: vi.fn(),
  parseKnowledgeBase: (raw: string) => JSON.parse(raw || "{}"),
  estimateCost: (tIn: number, tOut: number) => (tIn / 1_000_000) * 0.15 + (tOut / 1_000_000) * 0.6,
}));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { generateHumanReply } from "../services/ai.service";
import { listInbox, listMessages, sendHumanMessage, claimConversation, reactivateConversation, markConversationRead, updateConversation, suggestReply } from "./inbox.service";
import { ApiError } from "../utils/errors";

beforeEach(() => vi.clearAllMocks());

describe("listInbox", () => {
  it("lista conversas do usuário com status NEEDS_HUMAN primeiro", async () => {
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "CV1", status: "NEEDS_HUMAN", lastMessageAt: new Date(), lead: { name: "João", headline: "CEO", profileUrl: null }, campaign: { id: "C1", name: "Tech", mode: "DISPARO" } },
    ]);
    (prisma.conversation.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (prisma.conversationMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "oi", role: "LEAD" });
    (prisma.conversationMessage.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const res = await listInbox("U1");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].lastMessage).toBe("oi");
    expect(res.items[0].unread).toBe(0);
    expect(res.needsHuman).toBe(1);
    const arg = (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where).toEqual({ account: { userId: "U1" } });
    expect(arg.include.campaign.select).toMatchObject({ id: true, name: true, mode: true });
  });

  it("admin sem x-operate-as (userId null) filtra conversas por userId null", async () => {
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.conversation.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    await listInbox(null);
    const arg = (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.where).toEqual({ account: { userId: null } });
  });
});

describe("sendHumanMessage", () => {
  it("envia mensagem como humano e marca conversa HUMAN", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1", unipileChatId: "CHAT1" });
    (unipile.sendChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ message_id: "M1" });
    (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "MSG1", role: "HUMAN", content: "oi" });

    const msg = await sendHumanMessage("CV1", "U1", "Olá, tudo bem?");
    expect(msg.id).toBe("MSG1");
    expect(unipile.sendChatMessage).toHaveBeenCalledWith("CHAT1", "Olá, tudo bem?");
    const createArg = (prisma.conversationMessage.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data.role).toBe("HUMAN");
    const upd = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upd.where.id).toBe("CV1");
    expect(upd.data.status).toBe("HUMAN");
  });

  it("lança 404 quando a conversa não é do usuário", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(sendHumanMessage("CV1", "U1", "oi")).rejects.toThrow(ApiError);
    expect(unipile.sendChatMessage).not.toHaveBeenCalled();
  });
});

describe("claimConversation", () => {
  it("marca conversa como HUMAN", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1", unipileChatId: "CHAT1" });
    const res = await claimConversation("CV1", "U1");
    expect(res.ok).toBe(true);
    const upd = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upd.data.status).toBe("HUMAN");
  });
});

describe("reactivateConversation", () => {
  it("reativa a IA voltando a conversa para BOT", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1", unipileChatId: "CHAT1" });
    const res = await reactivateConversation("CV1", "U1");
    expect(res.ok).toBe(true);
    const upd = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upd.where.id).toBe("CV1");
    expect(upd.data.status).toBe("BOT");
  });

  it("lança 404 quando a conversa não é do usuário", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(reactivateConversation("CV1", "U1")).rejects.toThrow(ApiError);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});

describe("markConversationRead", () => {
  it("marca a conversa como lida atualizando updatedAt", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1", unipileChatId: "CHAT1" });
    const res = await markConversationRead("CV1", "U1");
    expect(res.ok).toBe(true);
    const upd = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upd.where.id).toBe("CV1");
    expect(upd.data.updatedAt).toBeInstanceOf(Date);
  });

  it("lança 404 quando a conversa não é do usuário", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(markConversationRead("CV1", "U1")).rejects.toThrow(ApiError);
  });
});

describe("updateConversation", () => {
  it("atualiza nota e resolvida e retorna o item atualizado", async () => {
    const row = {
      id: "CV1", status: "HUMAN", note: "", resolved: false, lastMessageAt: new Date(),
      lead: { name: "João", headline: "CEO", profileUrl: null },
      campaign: { id: "C1", name: "Tech", mode: "DISPARO" },
      account: { username: "acme" },
      bookings: [],
    };
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(row);
    (prisma.conversation.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.conversationMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "oi", role: "LEAD" });
    (prisma.conversationMessage.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const item = await updateConversation("CV1", "U1", { note: "cliente quente", resolved: true });
    expect(item.id).toBe("CV1");
    expect(item.note).toBe("cliente quente");
    expect(item.resolved).toBe(true);
    const upd = (prisma.conversation.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(upd.data).toEqual({ note: "cliente quente", resolved: true });
  });

  it("lança 404 quando a conversa não é do usuário", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(updateConversation("CV1", "U1", { note: "x" })).rejects.toThrow(ApiError);
  });
});

describe("listInbox paginação", () => {
  it("aplica offset/limit e calcula hasMore", async () => {
    const row = {
      id: "CV1", status: "NEEDS_HUMAN", note: "", resolved: false, lastMessageAt: new Date(),
      lead: { name: "João", headline: "CEO", profileUrl: null },
      campaign: { id: "C1", name: "Tech", mode: "DISPARO" },
      account: { username: "acme" },
      bookings: [],
      updatedAt: new Date(),
    };
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([row]);
    (prisma.conversation.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    (prisma.conversationMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "oi", role: "LEAD" });
    (prisma.conversationMessage.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const res = await listInbox("U1", { offset: 0, limit: 50 });
    expect(res.total).toBe(5);
    expect(res.hasMore).toBe(true);
    const arg = (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(50);
  });

  it("retorna hasMore false quando offset+items >= total", async () => {
    (prisma.conversation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "CV1", status: "BOT", note: "", resolved: false, lastMessageAt: new Date(), lead: { name: null, headline: null, profileUrl: null }, campaign: null, account: { username: null }, bookings: [], updatedAt: new Date() },
    ]);
    (prisma.conversation.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    (prisma.conversationMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ content: "oi", role: "LEAD" });
    (prisma.conversationMessage.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    const res = await listInbox("U1", { offset: 0, limit: 50 });
    expect(res.hasMore).toBe(false);
  });
});

describe("listMessages", () => {
  it("retorna as mais recentes sem cursor e nextCursor quando há mais", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1" });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "M2", conversationId: "CV1", role: "BOT", content: "olá", messageId: "x", tokensIn: 1, tokensOut: 1, costUsd: 0, createdAt: new Date("2026-09-01T10:01:00Z") },
      { id: "M1", conversationId: "CV1", role: "LEAD", content: "oi", messageId: null, tokensIn: null, tokensOut: null, costUsd: null, createdAt: new Date("2026-09-01T10:00:00Z") },
    ]);
    (prisma.conversationMessage.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    const res = await listMessages("CV1", "U1", { limit: 2 });
    expect(res.items.map((m) => m.id)).toEqual(["M1", "M2"]);
    expect(res.nextCursor).toBe("M1");
    const arg = (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.skip).toBeUndefined();
    expect(arg.take).toBe(2);
  });

  it("usa cursor e skip 1 em páginas seguintes e encerra no fim", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "CV1", accountId: "A1" });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "M3", conversationId: "CV1", role: "LEAD", content: "mais antiga", messageId: null, tokensIn: null, tokensOut: null, costUsd: null, createdAt: new Date("2026-09-01T09:59:00Z") },
    ]);
    (prisma.conversationMessage.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    const res = await listMessages("CV1", "U1", { cursor: "M1", limit: 2 });
    expect(res.items.map((m) => m.id)).toEqual(["M3"]);
    expect(res.nextCursor).toBeNull();
    const arg = (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.cursor).toEqual({ id: "M1" });
    expect(arg.skip).toBe(1);
  });
});

describe("suggestReply", () => {
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
    const res = await suggestReply("CV1", "U1");
    expect(res.reply).toContain("R$ 97");
    expect(res.costUsd).toBeCloseTo(100 / 1_000_000 * 0.15 + 20 / 1_000_000 * 0.6);
    expect(generateHumanReply).toHaveBeenCalledWith(
      expect.objectContaining({ productName: "LinkON", message: "qual o preço?" }),
    );
  });

  it("lança 400 quando não há mensagem para responder", async () => {
    (prisma.conversation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "CV1",
      accountId: "A1",
      lead: null,
      account: { nativeAgent: null },
    });
    (prisma.conversationMessage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await expect(suggestReply("CV1", "U1")).rejects.toThrow(ApiError);
  });
});
