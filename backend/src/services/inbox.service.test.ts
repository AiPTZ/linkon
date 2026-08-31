import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    conversation: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("./unipile.service", () => ({ unipile: { sendChatMessage: vi.fn() } }));

import { prisma } from "../lib/prisma";
import { unipile } from "./unipile.service";
import { listInbox, sendHumanMessage, claimConversation, reactivateConversation, markConversationRead, updateConversation } from "./inbox.service";
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
